import crypto from 'node:crypto';
import {q} from './db.mjs';
import {sendEmail,brandEmailHeader,wrapHotendEmail} from './email.mjs';
import {renderAutomationEmail} from './automations.mjs';

function esc(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function normalizeEmailImageUrl(value){
  let url=String(value??'').trim();
  if(!url)return '';
  if(url.startsWith('//'))return 'https:'+url;
  if(url.startsWith('/'))return 'https://hotend.co.nz'+url;
  if(/^http:\/\//i.test(url))return 'https://'+url.slice(7);
  return /^https:\/\//i.test(url)?url:'';
}

function tokenHash(token){
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function normalizeShopifyOrderId(id){
  const s=String(id||'');
  return s.startsWith('gid://')?s:`gid://shopify/Order/${s}`;
}

export async function scheduleReviewForShopifyOrder(shopifyOrderId,delayDays=7){
  const gid=normalizeShopifyOrderId(shopifyOrderId);
  const order=(await q(`SELECT id FROM orders WHERE shopify_order_id=$1 LIMIT 1`,[gid])).rows[0];
  if(!order)return {ok:false,reason:'order_not_synced'};
  const due=new Date(Date.now()+Number(delayDays||7)*86400000);
  const result=await q(`INSERT INTO review_schedules(order_id,due_at)
    VALUES($1,$2)
    ON CONFLICT(order_id) DO NOTHING
    RETURNING id,due_at`,[order.id,due]);
  return result.rows[0]?{ok:true,created:true,...result.rows[0]}:{ok:true,created:false};
}

function reviewItemTableHtml(items){
  return (items||[]).slice(0,12).map(x=>{
    const imageUrl=normalizeEmailImageUrl(x.image_url);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #dce4e3;margin:10px 0;background:#ffffff">
      <tr>
        ${imageUrl?`<td width="78" valign="middle" style="width:78px;padding:10px"><img src="${esc(imageUrl)}" width="58" height="58" alt="${esc(x.product_title||'Product')}" style="display:block;width:58px;height:58px;object-fit:cover;border:1px solid #e1e7e6;border-radius:6px;background:#f7f9f9"></td>`:''}
        <td valign="middle" style="padding:12px ${imageUrl?'8px 12px 2px':'12px'}">
          <div style="color:#1c3a52;font-size:11px;font-weight:800;line-height:1.35">${esc(x.product_title||'Product')}</div>
          ${x.variant_title?`<div style="color:#20aeb3;font-size:8px;font-weight:700;line-height:1.35;margin-top:4px">${esc(x.variant_title)}</div>`:''}
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

function reviewEmailHtml({name,orderName,token,items}){
  const base=String(process.env.PUBLIC_BASE_URL||'https://hotend-hub.onrender.com').replace(/\/$/,'');
  const url=base+'/review?token='+encodeURIComponent(token);
  const list=reviewItemTableHtml(items);
  return wrapHotendEmail(`
    <div style="font-size:22px;font-weight:800;line-height:1.3;margin-bottom:9px">How did your filament go, ${esc(name||'there')}?</div>
    <div style="color:#657d7a;font-size:12px;line-height:1.65;margin-bottom:16px">We'd value your feedback on order <strong>${esc(orderName||'')}</strong>.</div>
    ${list}
    <div style="background:#f5f7f7;border:1px solid #d7dfdf;border-left:5px solid #3fc2c2;padding:12px 14px;margin-top:16px;color:#718581;font-size:10px;line-height:1.55">You can also tell us which <strong style="color:#1c3a52">materials</strong> or <strong style="color:#1c3a52">colours</strong> you would like Hotend to stock next.</div>
    <p style="margin:24px 0;text-align:center"><a href="${esc(url)}" style="display:inline-block;background:#1c3a52;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.5px">LEAVE A REVIEW</a></p>
    <div style="color:#718581;font-size:9px;line-height:1.55">Thank you for helping other New Zealand makers choose the right filament.</div>
  `);
}

export async function processDueReviewRequests(limit=25){
  const due=(await q(`SELECT rs.id schedule_id,rs.order_id,o.order_name,o.email,o.customer_id,
      c.first_name,c.marketing_status
    FROM review_schedules rs
    JOIN orders o ON o.id=rs.order_id
    LEFT JOIN customers c ON c.id=o.customer_id
    WHERE rs.status='PENDING' AND rs.due_at<=NOW()
    ORDER BY rs.due_at ASC
    LIMIT $1`,[Math.max(1,Math.min(100,Number(limit)||25))])).rows;

  const stats={checked:due.length,sent:0,skipped:0,failed:0};
  for(const row of due){
    const email=String(row.email||'').trim().toLowerCase();
    if(!email||row.marketing_status!=='SUBSCRIBED'){
      await q(`UPDATE review_schedules SET status='CANCELLED',cancelled_at=NOW() WHERE id=$1`,[row.schedule_id]);
      stats.skipped++;
      continue;
    }

    const items=(await q(`SELECT id,shopify_product_id,product_title,variant_title,sku,quantity,image_url
      FROM order_items WHERE order_id=$1 ORDER BY id`,[row.order_id])).rows;
    if(!items.length){
      await q(`UPDATE review_schedules SET status='CANCELLED',cancelled_at=NOW() WHERE id=$1`,[row.schedule_id]);
      stats.skipped++;
      continue;
    }

    const token=crypto.randomBytes(32).toString('hex');
    const hash=tokenHash(token);
    const request=(await q(`INSERT INTO review_requests(order_id,customer_id,token_hash,expires_at)
      VALUES($1,$2,$3,NOW()+INTERVAL '60 days')
      RETURNING id`,[row.order_id,row.customer_id||null,hash])).rows[0];

    const base=String(process.env.PUBLIC_BASE_URL||'https://hotend-hub.onrender.com').replace(/\/$/,'');
    const reviewUrl=base+'/review?token='+encodeURIComponent(token);
    const list=reviewItemTableHtml(items);
    const rendered=await renderAutomationEmail('post-purchase-review',{
      fallbackSubject:`How did your Hotend order ${row.order_name||''} go?`,
      fallbackHtml:reviewEmailHtml({
        name:row.first_name||'there',
        orderName:row.order_name||'',
        token,
        items
      }),
      vars:{
        first_name:esc(row.first_name||'there'),
        order_name:esc(row.order_name||''),
        review_url:esc(reviewUrl),
        items_html:list,
        brand_header:brandEmailHeader()
      }
    });
    const result=await sendEmail({
      customerId:row.customer_id||null,
      emailType:'REVIEW_REQUEST',
      to:email,
      subject:rendered.subject,
      html:rendered.html,
      metadata:{automation:'product-review',order_id:row.order_id,review_request_id:request.id}
    });

    if(result.ok){
      await q(`UPDATE review_requests SET sent_at=NOW() WHERE id=$1`,[request.id]);
      await q(`UPDATE review_schedules SET status='SENT',review_request_id=$2,sent_at=NOW() WHERE id=$1`,[row.schedule_id,request.id]);
      stats.sent++;
    }else{
      await q(`DELETE FROM review_requests WHERE id=$1`,[request.id]);
      const blocked=/RESEND_403|domain is not verified|validation_error/i.test(String(result.error||''));
      if(blocked)await q(`UPDATE review_schedules SET status='PAUSED' WHERE id=$1`,[row.schedule_id]);
      stats.failed++;
    }
  }
  return stats;
}

function normalizePublicPhone(value){
  let p=String(value||'').replace(/[^0-9+]/g,'').trim();
  if(p.startsWith('+'))p=p.slice(1);
  if(p.startsWith('00'))p=p.slice(2);
  if(p.startsWith('0'))p='64'+p.slice(1);
  return p.replace(/\D/g,'');
}

function orderCandidates(value){
  const raw=String(value||'').trim();
  const noHash=raw.replace(/^#/,'');
  return [...new Set([raw,noHash,'#'+noHash].filter(Boolean))];
}

export function renderReviewStartPage({productId='',productTitle='',message=''}) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Leave a Hotend review</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:680px;margin:auto;padding:28px 18px}.brand{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:18px;text-align:center}.brand img{display:block;margin:auto;max-width:110px;width:28%;height:auto}.panel{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;margin-top:16px}.muted{color:#667085;font-size:13px;line-height:1.5}.choice{display:flex;gap:8px;align-items:center;margin:16px 0 4px}.choice button{border:0;background:transparent;color:#0b2748;font-weight:800;cursor:pointer;padding:0 0 4px;border-bottom:2px solid transparent}.choice button.active{border-bottom-color:#f5b51b}.field{display:none}.field.active{display:block}label{display:block;font-weight:700;margin:12px 0}input{width:100%;margin-top:6px;border:1px solid #cbd5e1;border-radius:10px;padding:12px;font:inherit}.btn{background:#f5b51b;color:#0b2748;border:0;border-radius:10px;padding:12px 18px;font-weight:900;cursor:pointer}.msg{background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:10px;padding:12px;margin:12px 0}
  </style><script>
  function choose(type){
    const e=document.getElementById('email-field'),p=document.getElementById('phone-field');
    const eb=document.getElementById('email-btn'),pb=document.getElementById('phone-btn');
    const phone=type==='phone';
    e.classList.toggle('active',!phone);p.classList.toggle('active',phone);
    eb.classList.toggle('active',!phone);pb.classList.toggle('active',phone);
    e.querySelector('input').disabled=phone;p.querySelector('input').disabled=!phone;
  }
  document.addEventListener('DOMContentLoaded',()=>choose('email'));
  </script></head><body><div class="wrap">
    <div class="brand"><img src="https://cdn.shopify.com/s/files/1/1006/1519/2875/files/hotend-filament-supplies-logo.jpg?v=1791002415" alt="Hotend Filament Supplies"></div>
    <div class="panel"><h1>Leave a review</h1>
      <p class="muted">To keep Hotend reviews verified, enter the order number and the email address or phone number used for your purchase.</p>
      ${productTitle?`<p><strong>Product:</strong> ${esc(productTitle)}</p>`:''}
      ${message?`<div class="msg">${esc(message)}</div>`:''}
      <form method="post" action="/review/start">
        <input type="hidden" name="product_id" value="${esc(productId)}">
        <input type="hidden" name="product_title" value="${esc(productTitle)}">
        <label>Order number<input name="order" required placeholder="#1234" autocomplete="off"></label>
        <div class="choice"><span class="muted">Verify with:</span><button id="email-btn" type="button" onclick="choose('email')">Email</button><span class="muted">or</span><button id="phone-btn" type="button" onclick="choose('phone')">Phone</button></div>
        <label id="email-field" class="field active">Email address<input type="email" name="email" placeholder="you@example.com" autocomplete="email"></label>
        <label id="phone-field" class="field">Phone number<input type="tel" name="phone" placeholder="021 123 4567" autocomplete="tel"></label>
        <p><button class="btn" type="submit">Continue to review</button></p>
      </form>
    </div>
  </div></body></html>`;
}

export async function beginVerifiedProductReview(data){
  const productId=String(data.product_id||'').trim();
  const productTitle=String(data.product_title||'').trim();
  const order=String(data.order||'').trim();
  const email=String(data.email||'').trim().toLowerCase();
  const phone=normalizePublicPhone(data.phone||'');
  if(!productId||!order||(!email&&!phone))return {ok:false,productId,productTitle,message:'Enter your order number and either your email address or phone number.'};

  const candidates=orderCandidates(order);
  const params=[candidates,productId];
  const where=[`o.order_name=ANY($1::text[])`,`oi.shopify_product_id=$2`];

  if(email){
    params.push(email);
    where.push(`LOWER(COALESCE(o.email,c.email,''))=${params.length}`);
  }else{
    params.push(phone);
    where.push(`REGEXP_REPLACE(CASE WHEN REGEXP_REPLACE(COALESCE(c.phone,''),'[^0-9]','','g') LIKE '0%' THEN '64'||SUBSTRING(REGEXP_REPLACE(COALESCE(c.phone,''),'[^0-9]','','g') FROM 2) ELSE REGEXP_REPLACE(COALESCE(c.phone,''),'[^0-9]','','g') END,'^00','','g')=${params.length}`);
  }

  const row=(await q(`SELECT o.id order_id,o.customer_id,oi.id order_item_id
    FROM orders o
    JOIN order_items oi ON oi.order_id=o.id
    LEFT JOIN customers c ON c.id=o.customer_id
    WHERE ${where.join(' AND ')}
    ORDER BY o.created_at_shopify DESC
    LIMIT 1`,params)).rows[0];

  if(!row)return {ok:false,productId,productTitle,message:'We could not match that product to the order and contact details provided.'};

  const existing=(await q(`SELECT id FROM product_reviews WHERE order_item_id=$1 LIMIT 1`,[row.order_item_id])).rows[0];
  if(existing)return {ok:false,productId,productTitle,message:'A review has already been submitted for this product from that order.'};

  const token=crypto.randomBytes(32).toString('hex');
  const hash=tokenHash(token);
  await q(`INSERT INTO review_requests(order_id,customer_id,token_hash,expires_at)
    VALUES($1,$2,$3,NOW()+INTERVAL '60 days')`,[row.order_id,row.customer_id||null,hash]);

  return {ok:true,token,productId,productTitle};
}

export async function renderReviewForm(token,message='',productId=''){
  const hash=tokenHash(token);
  const req=(await q(`SELECT rr.id,rr.order_id,rr.submitted_at,rr.expires_at,o.order_name,c.first_name
    FROM review_requests rr
    JOIN orders o ON o.id=rr.order_id
    LEFT JOIN customers c ON c.id=rr.customer_id
    WHERE rr.token_hash=$1 LIMIT 1`,[hash])).rows[0];

  if(!req)return reviewMessagePage('Review link not found','This review link is invalid or has expired.');
  if(req.submitted_at)return reviewMessagePage('Thank you','This review has already been submitted.');
  if(req.expires_at&&new Date(req.expires_at)<new Date())return reviewMessagePage('Review link expired','This review link has expired.');

  const items=(await q(`SELECT id,shopify_product_id,product_title,variant_title
    FROM order_items
    WHERE order_id=$1
      AND ($2='' OR shopify_product_id=$2)
    ORDER BY id`,[req.order_id,String(productId||'')])).rows;

  const blocks=items.map((x,i)=>`<div class="item">
    <h3>${esc(x.product_title)}${x.variant_title?' — '+esc(x.variant_title):''}</h3>
    <input type="hidden" name="item_id_${i}" value="${x.id}">
    <input type="hidden" name="product_id_${i}" value="${esc(x.shopify_product_id||'')}">
    <label>Rating
      <select name="rating_${i}" required>
        <option value="">Choose a rating</option>
        <option value="5">5 — Excellent</option><option value="4">4 — Very good</option>
        <option value="3">3 — Good</option><option value="2">2 — Fair</option><option value="1">1 — Poor</option>
      </select>
    </label>
    <label>Your feedback<textarea name="feedback_${i}" placeholder="How did it print? What did you make?"></textarea></label>
  </div>`).join('');

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review Hotend</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:760px;margin:auto;padding:28px 18px}.brand{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;text-align:center}.brand img{display:block;margin:auto;max-width:160px;width:40%;height:auto}.panel{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;margin-top:16px}.item{border-top:1px solid #eef2f6;padding:18px 0}.item:first-of-type{border-top:0}label{display:block;font-weight:700;margin:12px 0}select,textarea,input[type=text]{width:100%;margin-top:6px;border:1px solid #cbd5e1;border-radius:10px;padding:11px;font:inherit}textarea{min-height:100px}.btn{background:#f5b51b;color:#0b2748;border:0;border-radius:10px;padding:13px 20px;font-weight:900;cursor:pointer}.msg{background:#eef6ff;border:1px solid #bfdbfe;padding:12px;border-radius:10px;margin-bottom:14px}
  </style></head><body><div class="wrap"><div class="brand"><img src="https://cdn.shopify.com/s/files/1/1006/1519/2875/files/hotend-filament-supplies-logo.jpg?v=1791002415" alt="Hotend Filament Supplies"></div><div class="panel">
  <h1>Review order ${esc(req.order_name||'')}</h1><p>Hi ${esc(req.first_name||'there')}, tell us how your Hotend filament performed.</p>
  ${message?'<div class="msg">'+esc(message)+'</div>':''}
  <form method="post" action="/review/submit">
    <input type="hidden" name="token" value="${esc(token)}">
    <input type="hidden" name="product_id_filter" value="${esc(productId||'')}">
    <input type="hidden" name="item_count" value="${items.length}">
    ${blocks}
    <h2>What should Hotend stock next?</h2>
    <label>Materials you would like to see<input type="text" name="requested_materials" placeholder="e.g. ASA-CF, TPU 95A, PLA-CF"></label>
    <label>Colours you would like to see<input type="text" name="requested_colours" placeholder="e.g. burnt orange, mint green, metallic purple"></label>
    <p><button class="btn" type="submit">Submit review</button></p>
  </form></div></div></body></html>`;
}

function reviewMessagePage(title,message){
  return `<!doctype html><html><body style="font-family:system-ui;background:#fffcf7;color:#172033"><div style="max-width:680px;margin:60px auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px"><img src="https://cdn.shopify.com/s/files/1/1006/1519/2875/files/hotend-filament-supplies-logo.jpg?v=1791002415" alt="Hotend Filament Supplies" style="display:block;margin:0 auto 20px;max-width:150px;width:40%;height:auto"><h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="https://hotend.co.nz">Return to Hotend</a></p></div></body></html>`;
}

export async function submitReviewForm(data){
  const token=String(data.token||'');
  const hash=tokenHash(token);
  const req=(await q(`SELECT rr.id,rr.order_id,rr.customer_id,rr.submitted_at,rr.expires_at
    FROM review_requests rr WHERE rr.token_hash=$1 LIMIT 1`,[hash])).rows[0];

  if(!req)return {ok:false,message:'Invalid review link.'};
  if(req.submitted_at)return {ok:false,message:'This review was already submitted.'};
  if(req.expires_at&&new Date(req.expires_at)<new Date())return {ok:false,message:'This review link has expired.'};

  const count=Math.max(0,Math.min(100,Number(data.item_count)||0));
  const materials=String(data.requested_materials||'').trim()||null;
  const colours=String(data.requested_colours||'').trim()||null;
  let inserted=0;

  for(let i=0;i<count;i++){
    const itemId=Number(data['item_id_'+i]);
    const productId=String(data['product_id_'+i]||'').trim();
    const rating=Number(data['rating_'+i]);
    const feedback=String(data['feedback_'+i]||'').trim()||null;
    if(!itemId||!productId||rating<1||rating>5)continue;

    const valid=(await q(`SELECT id FROM order_items WHERE id=$1 AND order_id=$2 AND shopify_product_id=$3 LIMIT 1`,[itemId,req.order_id,productId])).rows[0];
    if(!valid)continue;

    await q(`INSERT INTO product_reviews(
      review_request_id,order_item_id,customer_id,shopify_product_id,rating,feedback,requested_materials,requested_colours,approved)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE)`,[
        req.id,itemId,req.customer_id||null,productId,rating,feedback,materials,colours
      ]);
    inserted++;
  }

  if(!inserted)return {ok:false,message:'Please rate at least one product.'};
  await q(`UPDATE review_requests SET submitted_at=NOW() WHERE id=$1`,[req.id]);
  return {ok:true,message:'Thank you — your review has been submitted.'};
}

export async function reviewAutomationStats(){
  return (await q(`SELECT
    COUNT(*) FILTER (WHERE status='PENDING')::int pending,
    COUNT(*) FILTER (WHERE status='SENT')::int sent,
    COUNT(*) FILTER (WHERE status='PAUSED')::int paused,
    COUNT(*) FILTER (WHERE status='CANCELLED')::int cancelled
    FROM review_schedules`)).rows[0];
}


export async function submitDirectProductReview(data){
  const productId=String(data.product_id||'').trim();
  const reviewerName=String(data.reviewer_name||'').trim().slice(0,120)||null;
  const orderNumber=String(data.order_number||'').trim().slice(0,80)||null;
  const rating=Number(data.rating||0);
  const feedback=String(data.feedback||'').trim().slice(0,5000);
  const photos=Array.isArray(data.photos)?data.photos.slice(0,3):[];

  if(!productId)return {ok:false,message:'Product is missing.'};
  if(rating<1||rating>5)return {ok:false,message:'Please choose a star rating.'};
  if(!feedback)return {ok:false,message:'Please write a short review.'};

  const review=(await q(`INSERT INTO product_reviews(
      review_request_id,order_item_id,customer_id,shopify_product_id,rating,feedback,approved,reviewer_name,submitted_order_number
    ) VALUES(NULL,NULL,NULL,$1,$2,$3,TRUE,$4,$5)
    RETURNING id,created_at`,[
      productId,rating,feedback,reviewerName,orderNumber
    ])).rows[0];

  let photoCount=0;
  for(const item of photos){
    const raw=String(item||'');
    const m=raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if(!m)continue;
    const buf=Buffer.from(m[2],'base64');
    if(!buf.length||buf.length>900*1024)continue;
    await q(`INSERT INTO review_photos(review_id,mime_type,image_data)
      VALUES($1,$2,$3)`,[review.id,m[1],buf]);
    photoCount++;
  }

  return {ok:true,review_id:review.id,photo_count:photoCount,message:'Thank you — your review has been submitted.'};
}

export async function getReviewPhoto(id){
  const row=(await q(`SELECT mime_type,image_data
    FROM review_photos
    WHERE id=$1
    LIMIT 1`,[Number(id)])).rows[0];
  return row||null;
}
