import {q} from './db.mjs';
import {abandonedCheckoutPages} from './shopify.mjs';
import {sendEmail,brandEmailHeader} from './email.mjs';
import {automationRule,renderAutomationEmail} from './automations.mjs';

function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

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
  const rows=(items||[]).slice(0,12).map(x=>`
    <tr>
      <td valign="top" style="width:23%;padding:10px;border-bottom:1px solid #dce4e3;color:#1c3a52;font-size:9px;font-weight:600;line-height:1.35;word-break:break-word">${esc(x.sku||'-')}</td>
      <td valign="top" style="width:62%;padding:8px;border-bottom:1px solid #dce4e3">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          ${x.imageUrl?`<td width="58" valign="top" style="width:58px;padding-right:8px"><img src="${esc(x.imageUrl)}" width="50" alt="${esc(x.title||'Product')}" style="display:block;width:50px;height:50px;object-fit:cover;border:1px solid #e1e7e6;border-radius:5px"></td>`:''}
          <td valign="top">
            <div style="color:#1c3a52;font-size:10px;font-weight:700;line-height:1.35">${esc(x.title||'Product')}</div>
            ${x.variantTitle?`<div style="color:#3fc2c2;font-size:8px;line-height:1.35;margin-top:3px">${esc(x.variantTitle)}</div>`:''}
          </td>
        </tr></table>
      </td>
      <td valign="top" align="center" style="width:15%;padding:10px 5px;border-bottom:1px solid #dce4e3;color:#1c3a52;font-size:11px;font-weight:800;text-align:center">${Number(x.quantity||1)}</td>
    </tr>`).join('');
  if(!rows)return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #dce4e3;table-layout:fixed">
    <tr>
      <td style="width:23%;background:#1c3a52;color:#fff;padding:10px;font-size:8px;font-weight:700;text-transform:uppercase">SKU</td>
      <td style="width:62%;background:#1c3a52;color:#fff;padding:10px;font-size:8px;font-weight:700;text-transform:uppercase">Product</td>
      <td align="center" style="width:15%;background:#1c3a52;color:#fff;padding:10px 5px;font-size:8px;font-weight:700;text-transform:uppercase;text-align:center">Qty</td>
    </tr>
    ${rows}
  </table>`;
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
  const intro=copy.intro;
  return `<!doctype html><html><body style="margin:0;background:#fffcf7;font-family:Arial,sans-serif;color:#172033">
  <div style="max-width:640px;margin:auto;padding:28px 18px">
    ${brandEmailHeader()}
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px;margin-top:16px">
      <h1 style="color:#0b2748;margin-top:0">Hi ${esc(row.customer_first_name||'there')},</h1>
      <p>${intro}</p>
      ${itemHtml}
      <p style="margin:26px 0"><a href="${esc(row.recovery_url||'https://hotend.co.nz/cart')}" style="background:#f5b51b;color:#0b2748;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:10px;display:inline-block">Return to your checkout</a></p>
      <p style="font-size:13px;color:#667085">If you already completed your order, you can ignore this email.</p>
    </div>
  </div></body></html>`;
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

export async function abandonedStats(){
  return (await q(`SELECT
    COUNT(*)::int total,
    COUNT(*) FILTER (WHERE recovered=FALSE)::int open,
    COUNT(*) FILTER (WHERE recovered=TRUE)::int recovered
    FROM abandoned_checkouts`)).rows[0];
}
