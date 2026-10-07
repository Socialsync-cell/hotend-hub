import {q} from './db.mjs';
import {abandonedCheckoutPages} from './shopify.mjs';
import {sendEmail,brandEmailHeader,wrapHotendEmail} from './email.mjs';
import {automationRule,renderAutomationEmail} from './automations.mjs';

function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function normalizeEmailImageUrl(value){
  let url=String(value??'').trim();
  if(!url)return '';
  if(url.startsWith('//'))return 'https:'+url;
  if(url.startsWith('/'))return 'https://hotend.co.nz'+url;
  if(/^http:\/\//i.test(url))return 'https://'+url.slice(7);
  return /^https:\/\//i.test(url)?url:'';
}

export async function syncAbandonedCheckouts(){
  const stats={checkouts:0,scheduled:0,recovered:0};
  for await(const nodes of abandonedCheckoutPages()){
    for(const a of nodes){
      const email=(a.customer?.email||'').trim().toLowerCase()||null;
      let customerId=null;
      if(a.customer?.id){
        customerId=(await q(`SELECT id FROM customers WHERE shopify_customer_id=$1 LIMIT 1`,[a.customer.id])).rows[0]?.id||null;
      }else if(email){
        customerId=(await q(`SELECT id FROM customers WHERE email=$1 LIMIT 1`,[email])).rows[0]?.id||null;
      }
      const money=a.totalPriceSet?.shopMoney||{};
      const items=(a.lineItems?.nodes||[]).map(x=>({
        id:x.id,title:x.title||'Product',variantTitle:x.variantTitle||null,sku:x.sku||null,
        quantity:Number(x.quantity||1),productId:x.product?.id||null,variantId:x.variant?.id||null,
        imageUrl:x.variant?.image?.url||x.product?.featuredImage?.url||null,
        unitPrice:num(x.originalUnitPriceSet?.shopMoney?.amount),
        currency:x.originalUnitPriceSet?.shopMoney?.currencyCode||money.currencyCode||null
      }));
      const saved=await q(`INSERT INTO abandoned_checkouts(
        shopify_checkout_id,customer_id,email,customer_first_name,recovery_url,currency,total_price,
        completed_at,created_at_shopify,updated_at_shopify,line_items,recovered,last_synced_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,NOW())
        ON CONFLICT(shopify_checkout_id) DO UPDATE SET
          customer_id=EXCLUDED.customer_id,email=EXCLUDED.email,customer_first_name=EXCLUDED.customer_first_name,
          recovery_url=EXCLUDED.recovery_url,currency=EXCLUDED.currency,total_price=EXCLUDED.total_price,
          completed_at=EXCLUDED.completed_at,updated_at_shopify=EXCLUDED.updated_at_shopify,
          line_items=EXCLUDED.line_items,recovered=EXCLUDED.recovered,last_synced_at=NOW()
        RETURNING id,recovered`,[
          a.id,customerId,email,a.customer?.firstName||null,String(a.abandonedCheckoutUrl||'')||null,
          money.currencyCode||null,num(money.amount),a.completedAt||null,a.createdAt,a.updatedAt,
          JSON.stringify(items),!!a.completedAt
        ]);
      const checkoutId=saved.rows[0].id;
      stats.checkouts++;

      if(email){
        const carts=(await q(`UPDATE storefront_carts
          SET recovered=TRUE,recovery_reason='CHECKOUT_STARTED',updated_at=NOW()
          WHERE recovered=FALSE AND LOWER(email)=LOWER($1)
          RETURNING id`,[email])).rows;
        for(const cart of carts){
          await q(`UPDATE storefront_cart_steps
            SET status='CANCELLED',cancelled_at=NOW()
            WHERE storefront_cart_id=$1 AND status='PENDING'`,[cart.id]);
        }
      }
      if(a.completedAt){
        await q(`UPDATE abandoned_checkout_steps SET status='CANCELLED',cancelled_at=NOW()
          WHERE abandoned_checkout_id=$1 AND status='PENDING'`,[checkoutId]);
        stats.recovered++;
        continue;
      }
      const created=new Date(a.createdAt);
      const rule=await automationRule('abandoned-cart');
      const configured=Array.isArray(rule?.config?.delays_days)?rule.config.delays_days:[1,5,10];
      const delays=configured.slice(0,3).map((x,i)=>[i+1,Math.max(0,Number(x)||0)]);
      for(const [step,days] of delays){
        const due=new Date(created.getTime()+days*86400000);
        const ins=await q(`INSERT INTO abandoned_checkout_steps(abandoned_checkout_id,step_number,due_at)
          VALUES($1,$2,$3)
          ON CONFLICT(abandoned_checkout_id,step_number) DO NOTHING
          RETURNING id`,[checkoutId,step,due]);
        if(ins.rows[0])stats.scheduled++;
      }
    }
  }
  return stats;
}

function itemTableHtml(items){
  return (items||[]).slice(0,12).map(x=>{
    const imageUrl=normalizeEmailImageUrl(x.imageUrl);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #dce4e3;margin:10px 0;background:#ffffff">
      <tr>
        ${imageUrl?`<td width="78" valign="middle" style="width:78px;padding:10px"><img src="${esc(imageUrl)}" width="58" height="58" alt="${esc(x.title||'Product')}" style="display:block;width:58px;height:58px;object-fit:cover;border:1px solid #e1e7e6;border-radius:6px;background:#f7f9f9"></td>`:''}
        <td valign="middle" style="padding:12px ${imageUrl?'8px 12px 2px':'12px'}">
          <div style="color:#1c3a52;font-size:11px;font-weight:800;line-height:1.35">${esc(x.title||'Product')}</div>
          ${x.variantTitle?`<div style="color:#20aeb3;font-size:8px;font-weight:700;line-height:1.35;margin-top:4px">${esc(x.variantTitle)}</div>`:''}
          <div style="color:#7c9088;font-size:8px;line-height:1.35;margin-top:5px">SKU: ${esc(x.sku||'-')}</div>
        </td>
        <td width="52" valign="middle" align="center" style="width:52px;padding:10px;color:#1c3a52">
          <div style="font-size:7px;font-weight:700;text-transform:uppercase;color:#7c9088">Qty</div>
          <div style="font-size:13px;font-weight:900;margin-top:4px">${Number(x.quantity||1)}</div>
        </td>
      </tr>
    </table>`;
  }).join('');
}

function subjectFor(step){
  if(step===1)return 'Your Hotend filament is still waiting';
  if(step===2)return 'Still planning that next print?';
  return 'Your saved Hotend cart is still here';
}

function abandonedCopy(step){
  if(step===1)return {
    heading:'Your filament is still waiting',
    intro:'Looks like you left a few items behind. No rush — your saved Hotend checkout is ready whenever you are.'
  };
  if(step===2)return {
    heading:'Still planning that next print?',
    intro:'Your filament is still saved. If your project is waiting on the right colour or material, you can pick up exactly where you left off.'
  };
  return {
    heading:'Your saved cart is still here',
    intro:'Just one last reminder from us — your Hotend checkout is still available if you want to finish your order. We’d love to help get your next print moving.'
  };
}

function htmlFor(row,step){
  const items=Array.isArray(row.line_items)?row.line_items:[];
  const itemHtml=itemTableHtml(items);
  const copy=abandonedCopy(step);
  return wrapHotendEmail(`
    <div style="font-size:22px;font-weight:800;line-height:1.3;margin-bottom:9px">${esc(copy.heading)}</div>
    <div style="color:#657d7a;font-size:12px;line-height:1.65;margin-bottom:16px">Hi ${esc(row.customer_first_name||'there')}, ${esc(copy.intro)}</div>
    ${itemHtml}
    <p style="margin:24px 0;text-align:center"><a href="${esc(row.recovery_url||'https://hotend.co.nz/cart')}" style="display:inline-block;background:#1c3a52;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.5px">RETURN TO YOUR CHECKOUT</a></p>
    <div style="color:#718581;font-size:9px;line-height:1.55">If you already completed your order, you can ignore this email.</div>
  `);
}

export async function processDueAbandonedEmails(limit=25){
  const due=(await q(`SELECT s.id step_id,s.step_number,a.*,c.marketing_status,c.id customer_id_resolved
    FROM abandoned_checkout_steps s
    JOIN abandoned_checkouts a ON a.id=s.abandoned_checkout_id
    LEFT JOIN customers c ON c.id=a.customer_id
    WHERE s.status='PENDING' AND s.due_at<=NOW() AND a.recovered=FALSE
    ORDER BY s.due_at ASC LIMIT $1`,[Math.max(1,Math.min(100,Number(limit)||25))])).rows;
  const out={checked:due.length,sent:0,skipped:0,failed:0};
  for(const row of due){
    if(!row.email||row.marketing_status!=='SUBSCRIBED'||!row.recovery_url){
      await q(`UPDATE abandoned_checkout_steps SET status='CANCELLED',cancelled_at=NOW() WHERE id=$1`,[row.step_id]);
      out.skipped++;
      continue;
    }
    const step=Number(row.step_number);
    const items=Array.isArray(row.line_items)?row.line_items:[];
    const itemHtml=itemTableHtml(items);
    const copy=abandonedCopy(step);
    const intro=copy.intro;
    const rendered=await renderAutomationEmail('abandoned-cart',{
      fallbackSubject:subjectFor(step),
      fallbackHtml:htmlFor(row,step),
      vars:{
        first_name:esc(row.customer_first_name||'there'),
        step_subject:subjectFor(step),
        heading:esc(copy.heading),
        intro:esc(intro),
        items_html:itemHtml,
        recovery_url:esc(row.recovery_url||'https://hotend.co.nz/cart'),
        brand_header:brandEmailHeader(),
        step:String(step)
      }
    });
    const result=await sendEmail({
      customerId:row.customer_id_resolved||row.customer_id||null,
      emailType:`ABANDONED_CHECKOUT_${row.step_number}`,
      to:row.email,
      subject:rendered.subject,
      html:rendered.html,
      metadata:{automation:'abandoned-cart',checkout_id:row.shopify_checkout_id,step}
    });
    if(result.ok){
      await q(`UPDATE abandoned_checkout_steps SET status='SENT',email_delivery_id=$2,sent_at=NOW() WHERE id=$1`,[row.step_id,result.deliveryId]);
      out.sent++;
    }else{
      const providerBlocked=/RESEND_403|domain is not verified|validation_error/i.test(String(result.error||''));
      if(providerBlocked){
        await q(`UPDATE abandoned_checkout_steps SET status='PAUSED' WHERE id=$1`,[row.step_id]);
      }
      out.failed++;
    }
  }
  return out;
}

export async function recordStorefrontCart(data={}){
  const visitorId=String(data.visitor_id||'').trim().slice(0,120);
  if(!visitorId)return {ok:false,message:'visitor_id required'};

  const email=String(data.email||'').trim().toLowerCase()||null;
  const currency=String(data.currency||'NZD').trim().slice(0,12)||'NZD';
  const totalPrice=Math.max(0,Number(data.total_price||0));
  const itemCount=Math.max(0,Number(data.item_count||0));
  const items=Array.isArray(data.line_items)?data.line_items.slice(0,100):[];
  const cartUrl=String(data.cart_url||'https://hotend.co.nz/cart').trim().slice(0,1000);

  let customerId=null;
  if(email){
    customerId=(await q(`SELECT id FROM customers WHERE LOWER(email)=LOWER($1) LIMIT 1`,[email])).rows[0]?.id||null;
  }

  const saved=(await q(`INSERT INTO storefront_carts(
      visitor_id,customer_id,email,currency,total_price,item_count,line_items,cart_url,
      first_seen_at,last_seen_at,emptied_at,recovered,recovery_reason,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,NOW(),NOW(),
      CASE WHEN $6=0 THEN NOW() ELSE NULL END,
      CASE WHEN $6=0 THEN TRUE ELSE FALSE END,
      CASE WHEN $6=0 THEN 'CART_EMPTIED' ELSE NULL END,
      NOW())
    ON CONFLICT(visitor_id) DO UPDATE SET
      customer_id=COALESCE(EXCLUDED.customer_id,storefront_carts.customer_id),
      email=COALESCE(EXCLUDED.email,storefront_carts.email),
      currency=EXCLUDED.currency,
      total_price=EXCLUDED.total_price,
      item_count=EXCLUDED.item_count,
      line_items=EXCLUDED.line_items,
      cart_url=EXCLUDED.cart_url,
      last_seen_at=NOW(),
      emptied_at=CASE WHEN EXCLUDED.item_count=0 THEN NOW() ELSE NULL END,
      recovered=CASE WHEN EXCLUDED.item_count=0 THEN TRUE ELSE FALSE END,
      recovery_reason=CASE WHEN EXCLUDED.item_count=0 THEN 'CART_EMPTIED' ELSE NULL END,
      updated_at=NOW()
    RETURNING *`,[
      visitorId,customerId,email,currency,totalPrice,itemCount,JSON.stringify(items),cartUrl
    ])).rows[0];

  if(itemCount===0){
    await q(`UPDATE storefront_cart_steps
      SET status='CANCELLED',cancelled_at=NOW()
      WHERE storefront_cart_id=$1 AND status='PENDING'`,[saved.id]);
    return {ok:true,recovered:true};
  }

  const rule=await automationRule('abandoned-cart');
  const idleMinutes=Math.max(15,Number(rule?.config?.cart_idle_minutes||120));
  const configured=Array.isArray(rule?.config?.delays_days)?rule.config.delays_days:[1,5,10];
  const delays=configured.slice(0,3).map((x,i)=>[i+1,Math.max(0,Number(x)||0)]);

  if(saved.email){
    for(const [step,days] of delays){
      const due=new Date(Date.now()+idleMinutes*60000+days*86400000);
      await q(`INSERT INTO storefront_cart_steps(storefront_cart_id,step_number,due_at)
        VALUES($1,$2,$3)
        ON CONFLICT(storefront_cart_id,step_number) DO UPDATE SET
          due_at=CASE WHEN storefront_cart_steps.status='PENDING' THEN EXCLUDED.due_at ELSE storefront_cart_steps.due_at END`,
        [saved.id,step,due]);
    }
  }

  return {ok:true,recovered:false,tracked:true};
}

export async function processDueStorefrontCartEmails(limit=25){
  const due=(await q(`SELECT s.id step_id,s.step_number,c.*,cu.marketing_status,cu.first_name,cu.id customer_id_resolved
    FROM storefront_cart_steps s
    JOIN storefront_carts c ON c.id=s.storefront_cart_id
    LEFT JOIN customers cu ON cu.id=c.customer_id
    WHERE s.status='PENDING'
      AND s.due_at<=NOW()
      AND c.recovered=FALSE
      AND c.item_count>0
    ORDER BY s.due_at ASC
    LIMIT $1`,[Math.max(1,Math.min(100,Number(limit)||25))])).rows;

  const out={checked:due.length,sent:0,skipped:0,failed:0};
  for(const row of due){
    if(!row.email||row.marketing_status!=='SUBSCRIBED'){
      await q(`UPDATE storefront_cart_steps SET status='CANCELLED',cancelled_at=NOW() WHERE id=$1`,[row.step_id]);
      out.skipped++;
      continue;
    }

    const step=Number(row.step_number);
    const items=Array.isArray(row.line_items)?row.line_items:[];
    const itemHtml=itemTableHtml(items);
    const copy=abandonedCopy(step);
    const rendered=await renderAutomationEmail('abandoned-cart',{
      fallbackSubject:subjectFor(step),
      fallbackHtml:htmlFor({customer_first_name:row.first_name||'there',line_items:items,recovery_url:row.cart_url||'https://hotend.co.nz/cart'},step),
      vars:{
        first_name:esc(row.first_name||'there'),
        step_subject:subjectFor(step),
        heading:esc(copy.heading),
        intro:esc(copy.intro),
        items_html:itemHtml,
        recovery_url:esc(row.cart_url||'https://hotend.co.nz/cart'),
        brand_header:brandEmailHeader(),
        step:String(step)
      }
    });

    const result=await sendEmail({
      customerId:row.customer_id_resolved||row.customer_id||null,
      emailType:`ABANDONED_CART_${step}`,
      to:row.email,
      subject:rendered.subject,
      html:rendered.html,
      metadata:{automation:'abandoned-cart',source:'storefront-cart',visitor_id:row.visitor_id,step}
    });

    if(result.ok){
      await q(`UPDATE storefront_cart_steps
        SET status='SENT',email_delivery_id=$2,sent_at=NOW()
        WHERE id=$1`,[row.step_id,result.deliveryId]);
      out.sent++;
    }else{
      out.failed++;
    }
  }
  return out;
}

export async function abandonedStats(){
  return (await q(`SELECT
    COUNT(*)::int total,
    COUNT(*) FILTER (WHERE recovered=FALSE)::int open,
    COUNT(*) FILTER (WHERE recovered=TRUE)::int recovered
    FROM abandoned_checkouts`)).rows[0];
}
