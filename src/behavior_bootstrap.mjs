import http from 'node:http';
import crypto from 'node:crypto';

const originalCreateServer=http.createServer.bind(http);

function esc(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function verifyProxy(url){
  const secret=process.env.SHOPIFY_CLIENT_SECRET||'';
  if(!secret)return false;
  const params=[...url.searchParams.entries()]
    .filter(([k])=>k!=='signature')
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>`${k}=${v}`)
    .join('');
  const expected=crypto.createHmac('sha256',secret).update(params).digest('hex');
  const actual=String(url.searchParams.get('signature')||'');
  if(expected.length!==actual.length)return false;
  try{return crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(actual));}catch{return false;}
}

async function readBody(req,max=128*1024){
  const chunks=[];
  let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>max)throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res,status,body){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}

let schemaReady=false;
let schemaPromise=null;
async function ensureBehaviorSchema(){
  if(schemaReady)return;
  if(schemaPromise)return schemaPromise;
  schemaPromise=(async()=>{
    const {q}=await import('./db.mjs');
    await q(`CREATE TABLE IF NOT EXISTS behavior_product_views (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      visitor_id TEXT,
      product_id TEXT,
      product_handle TEXT NOT NULL,
      product_title TEXT NOT NULL,
      product_url TEXT NOT NULL,
      image_url TEXT,
      viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await q(`CREATE INDEX IF NOT EXISTS behavior_product_views_email_viewed_idx
      ON behavior_product_views(LOWER(email),viewed_at DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS behavior_product_views_customer_idx
      ON behavior_product_views(customer_id,viewed_at DESC)`);
    await q(`CREATE TABLE IF NOT EXISTS behavior_followups (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      due_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      email_delivery_id BIGINT REFERENCES email_deliveries(id) ON DELETE SET NULL,
      sent_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await q(`CREATE INDEX IF NOT EXISTS behavior_followups_due_idx
      ON behavior_followups(status,due_at)`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS behavior_followups_one_pending_email_idx
      ON behavior_followups((LOWER(email))) WHERE status='PENDING'`);
    await q(`INSERT INTO automation_rules(key,name,module,enabled,config)
      VALUES('recently-viewed','Recently Viewed Products','marketing',TRUE,
        '{"delay_hours":6,"lookback_days":7,"cooldown_days":7,"max_products":3,"email_subject":"Still thinking about these?"}'::jsonb)
      ON CONFLICT(key) DO NOTHING`);
    schemaReady=true;
  })();
  try{await schemaPromise;}catch(e){schemaPromise=null;throw e;}
}

async function recordProductView(data){
  await ensureBehaviorSchema();
  const {q}=await import('./db.mjs');
  const email=String(data.email||'').trim().toLowerCase();
  const handle=String(data.product_handle||'').trim();
  const title=String(data.product_title||'').trim();
  const productUrl=String(data.product_url||'').trim();
  if(!email||!email.includes('@')||!handle||!title||!productUrl){
    return {ok:false,message:'Missing product view details'};
  }

  const customer=(await q(`SELECT id,email,first_name,marketing_status
    FROM customers WHERE LOWER(email)=LOWER($1) LIMIT 1`,[email])).rows[0];
  if(!customer||customer.marketing_status!=='SUBSCRIBED'){
    return {ok:true,tracked:false,reason:'marketing_consent_required'};
  }

  const recent=(await q(`SELECT id FROM behavior_product_views
    WHERE LOWER(email)=LOWER($1) AND product_handle=$2
      AND viewed_at>=NOW()-INTERVAL '30 minutes'
    ORDER BY viewed_at DESC LIMIT 1`,[email,handle])).rows[0];

  if(recent){
    await q(`UPDATE behavior_product_views SET
      product_title=$2,product_url=$3,image_url=$4,product_id=$5,visitor_id=$6,viewed_at=NOW()
      WHERE id=$1`,[
      recent.id,title,productUrl,String(data.image_url||'').trim()||null,
      String(data.product_id||'').trim()||null,String(data.visitor_id||'').trim()||null
    ]);
  }else{
    await q(`INSERT INTO behavior_product_views(
      customer_id,email,visitor_id,product_id,product_handle,product_title,product_url,image_url,viewed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,[
      customer.id,email,String(data.visitor_id||'').trim()||null,
      String(data.product_id||'').trim()||null,handle,title,productUrl,
      String(data.image_url||'').trim()||null
    ]);
  }

  const rule=(await q(`SELECT enabled,config FROM automation_rules WHERE key='recently-viewed' LIMIT 1`)).rows[0];
  if(!rule?.enabled)return {ok:true,tracked:true,scheduled:false};
  const delayHours=Math.max(1,Math.min(168,Number(rule.config?.delay_hours||6)));
  const due=new Date(Date.now()+delayHours*3600000);

  const pending=(await q(`SELECT id FROM behavior_followups
    WHERE LOWER(email)=LOWER($1) AND status='PENDING' LIMIT 1`,[email])).rows[0];
  if(pending){
    await q(`UPDATE behavior_followups
      SET customer_id=$2,due_at=$3,updated_at=NOW()
      WHERE id=$1`,[pending.id,customer.id,due]);
  }else{
    await q(`INSERT INTO behavior_followups(customer_id,email,due_at)
      VALUES($1,$2,$3)`,[customer.id,email,due]);
  }

  return {ok:true,tracked:true,scheduled:true,due_at:due.toISOString()};
}

function productsHtml(products){
  return products.map(p=>`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #dce4e3;margin:10px 0;background:#fff"><tr>
    ${p.image_url?`<td width="82" valign="middle" style="width:82px;padding:10px"><img src="${esc(p.image_url)}" width="62" height="62" alt="" style="display:block;width:62px;height:62px;object-fit:cover;border-radius:6px"></td>`:''}
    <td valign="middle" style="padding:12px"><div style="font-size:12px;font-weight:800;color:#1c3a52;line-height:1.35">${esc(p.product_title)}</div><div style="margin-top:8px"><a href="${esc(p.product_url)}" style="color:#0b5260;font-size:10px;font-weight:800;text-decoration:none">VIEW PRODUCT →</a></div></td>
  </tr></table>`).join('');
}

function applyTokens(value,vars){
  return String(value??'').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,(_,key)=>
    Object.prototype.hasOwnProperty.call(vars,key)?String(vars[key]??''):''
  );
}

async function processBehavioralFollowups(limit=30){
  try{
    await ensureBehaviorSchema();
    const {q}=await import('./db.mjs');
    const {sendEmail,wrapHotendEmail}=await import('./email.mjs');
    const rule=(await q(`SELECT enabled,config FROM automation_rules WHERE key='recently-viewed' LIMIT 1`)).rows[0];
    if(!rule?.enabled)return {checked:0,sent:0,skipped:0};

    const config=rule.config||{};
    const lookbackDays=Math.max(1,Math.min(30,Number(config.lookback_days||7)));
    const cooldownDays=Math.max(1,Math.min(30,Number(config.cooldown_days||7)));
    const maxProducts=Math.max(1,Math.min(6,Number(config.max_products||3)));

    const due=(await q(`SELECT f.*,c.first_name,c.marketing_status
      FROM behavior_followups f
      LEFT JOIN customers c ON c.id=f.customer_id
      WHERE f.status='PENDING' AND f.due_at<=NOW()
      ORDER BY f.due_at ASC LIMIT $1`,[Math.max(1,Math.min(100,Number(limit)||30))])).rows;

    const out={checked:due.length,sent:0,skipped:0,failed:0};
    for(const row of due){
      if(!row.email||row.marketing_status!=='SUBSCRIBED'){
        await q(`UPDATE behavior_followups SET status='CANCELLED',cancelled_at=NOW(),updated_at=NOW() WHERE id=$1`,[row.id]);
        out.skipped++;
        continue;
      }

      const last=(await q(`SELECT sent_at FROM email_deliveries
        WHERE LOWER(recipient)=LOWER($1) AND email_type='RECENTLY_VIEWED' AND status='SENT'
        ORDER BY sent_at DESC NULLS LAST,id DESC LIMIT 1`,[row.email])).rows[0];
      if(last?.sent_at){
        const nextAllowed=new Date(new Date(last.sent_at).getTime()+cooldownDays*86400000);
        if(nextAllowed>Date.now()){
          await q(`UPDATE behavior_followups SET due_at=$2,updated_at=NOW() WHERE id=$1`,[row.id,nextAllowed]);
          out.skipped++;
          continue;
        }
      }

      const products=(await q(`SELECT DISTINCT ON (product_handle)
          product_handle,product_title,product_url,image_url,viewed_at
        FROM behavior_product_views
        WHERE LOWER(email)=LOWER($1)
          AND viewed_at>=NOW()-($2::text||' days')::interval
        ORDER BY product_handle,viewed_at DESC`,[row.email,String(lookbackDays)])).rows
        .sort((a,b)=>new Date(b.viewed_at)-new Date(a.viewed_at))
        .slice(0,maxProducts);

      if(!products.length){
        await q(`UPDATE behavior_followups SET status='CANCELLED',cancelled_at=NOW(),updated_at=NOW() WHERE id=$1`,[row.id]);
        out.skipped++;
        continue;
      }

      const productCards=productsHtml(products);
      const vars={
        first_name:esc(row.first_name||'there'),
        store_name:'Hotend',
        products_html:productCards,
        shop_url:'https://hotend.co.nz/collections/all'
      };
      const subject=applyTokens(String(config.email_subject||'Still thinking about these?'),vars);
      const custom=String(config.email_html||'').trim();
      const html=custom
        ? applyTokens(custom,vars)
        : wrapHotendEmail(`<div style="font-size:22px;font-weight:800;line-height:1.3;margin-bottom:9px">Still thinking about these?</div>
          <div style="color:#657d7a;font-size:12px;line-height:1.65;margin-bottom:16px">Hi ${vars.first_name}, you recently viewed these products at Hotend.</div>
          ${productCards}
          <p style="margin:24px 0;text-align:center"><a href="https://hotend.co.nz/collections/all" style="display:inline-block;background:#1c3a52;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.5px">KEEP BROWSING</a></p>
          <div style="color:#718581;font-size:9px;line-height:1.55">You received this because you subscribed to Hotend marketing emails.</div>`);

      const result=await sendEmail({
        customerId:row.customer_id||null,
        emailType:'RECENTLY_VIEWED',
        to:row.email,
        subject,
        html,
        metadata:{automation:'recently-viewed',products:products.map(p=>p.product_handle)}
      });

      if(result.ok){
        await q(`UPDATE behavior_followups
          SET status='SENT',email_delivery_id=$2,sent_at=NOW(),updated_at=NOW()
          WHERE id=$1`,[row.id,result.deliveryId]);
        out.sent++;
      }else{
        out.failed++;
      }
    }

    await q(`DELETE FROM behavior_product_views WHERE viewed_at<NOW()-INTERVAL '30 days'`);
    await q(`DELETE FROM behavior_followups WHERE status<>'PENDING' AND updated_at<NOW()-INTERVAL '90 days'`);
    return out;
  }catch(e){
    console.error('Recently viewed automation failed:',e.message);
    return {checked:0,sent:0,failed:1,error:e.message};
  }
}

const behaviorClient=`;(function(){
  try{
    if(!location.pathname.startsWith('/products/'))return;
    var email='';
    try{email=String(localStorage.getItem('hh_known_email')||sessionStorage.getItem('hh_chat_email')||'').trim().toLowerCase();}catch(e){}
    if(!email||email.indexOf('@')<1)return;
    var visitor='';
    try{
      visitor=localStorage.getItem('hh_behavior_visitor')||localStorage.getItem('hh_cart_visitor_id')||'';
      if(!visitor){visitor='HHV-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,9).toUpperCase();localStorage.setItem('hh_behavior_visitor',visitor);}
    }catch(e){}
    var handle=(location.pathname.split('/products/')[1]||'').split(/[?#/]/)[0];
    if(!handle)return;
    fetch('/products/'+encodeURIComponent(handle)+'.js',{credentials:'same-origin',cache:'no-store'})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(p){
        if(!p)return;
        var img=p.featured_image||'';
        if(img&&typeof img==='object')img=img.url||img.src||'';
        return fetch('/apps/hotend-hub/behavior',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          visitor_id:visitor,email:email,product_id:String(p.id||''),product_handle:handle,
          product_title:String(p.title||document.title||'Product'),product_url:location.origin+'/products/'+handle,image_url:String(img||'')
        }),keepalive:true});
      }).catch(function(){});
  }catch(e){}
})();`;

http.createServer=function(...args){
  const handler=typeof args[0]==='function'?args[0]:null;
  if(!handler)return originalCreateServer(...args);

  const wrapped=async(req,res)=>{
    let url;
    try{url=new URL(req.url||'/','https://hotend.co.nz');}catch{return handler(req,res);}

    if(url.pathname==='/proxy/behavior'){
      if(!verifyProxy(url))return sendJson(res,401,{ok:false,message:'Invalid Shopify proxy signature'});
      if(req.method!=='POST')return sendJson(res,405,{ok:false,message:'Method not allowed'});
      try{
        const raw=await readBody(req);
        let data={};
        try{data=JSON.parse(raw||'{}');}catch{return sendJson(res,400,{ok:false,message:'Invalid JSON'});}
        const result=await recordProductView(data);
        return sendJson(res,result.ok?200:400,result);
      }catch(e){
        console.error('Behavior event failed:',e.message);
        return sendJson(res,500,{ok:false,message:'Unable to record product view'});
      }
    }

    if(url.pathname==='/assets/hotend-hub.js'){
      const end=res.end.bind(res);
      res.end=(chunk,encoding,callback)=>{
        res.end=end;
        try{
          if(typeof chunk==='string')chunk=chunk+'\n'+behaviorClient;
          else if(Buffer.isBuffer(chunk))chunk=Buffer.concat([chunk,Buffer.from('\n'+behaviorClient)]);
        }catch(e){}
        return end(chunk,encoding,callback);
      };
    }
    return handler(req,res);
  };

  return originalCreateServer(wrapped,...args.slice(1));
};

setTimeout(()=>{
  ensureBehaviorSchema().then(()=>processBehavioralFollowups()).catch(e=>console.error('Behavior setup failed:',e.message));
},12000).unref();

setInterval(()=>{
  processBehavioralFollowups().then(r=>{
    if(r.sent||r.failed)console.log('Recently viewed processor',r);
  });
},15*60*1000).unref();
