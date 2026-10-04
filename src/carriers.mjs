import crypto from 'node:crypto';
import {q} from './db.mjs';

function baseUrl(){return String(process.env.PUBLIC_BASE_URL||'https://hotend-hub.onrender.com').replace(/\/$/,'');}
function secret(){return process.env.APP_SECRET||process.env.SHOPIFY_CLIENT_SECRET||'';}
function nzPostWebhookToken(){return secret()?crypto.createHmac('sha256',secret()).update('nzpost-tracking-webhook').digest('hex'):'';}

export function carrierConfigStatus(){
  return {
    nzPost:!!process.env.NZPOST_TRACKING_API_KEY,
    freightways:!!(process.env.FREIGHTWAYS_CLIENT_ID&&process.env.FREIGHTWAYS_CLIENT_SECRET&&process.env.FREIGHTWAYS_CUSTOMER_ID),
    aramex:!!process.env.ARAMEX_TRACKING_API_KEY
  };
}

export async function registerNzPostWatch(shipment){
  if(!process.env.NZPOST_TRACKING_API_KEY)return {ok:false,skipped:'NZPOST_TRACKING_API_KEY_MISSING'};
  if(!shipment?.tracking_number)return {ok:false,skipped:'TRACKING_NUMBER_MISSING'};
  const webhook=baseUrl()+'/webhooks/nzpost?token='+encodeURIComponent(nzPostWebhookToken());
  const params=new URLSearchParams();
  params.set('license_key',process.env.NZPOST_TRACKING_API_KEY);
  params.set('tracking_code',shipment.tracking_number);
  params.set('channel','webhook');
  params.set('channel_identifier',webhook);
  params.append('event','all_event');
  params.set('alias',shipment.order_name||shipment.tracking_number);

  const r=await fetch('https://api.nzpost.co.nz/tracking-notification/api/watch',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:params
  });
  const text=await r.text();
  if(!r.ok){
    await q(`UPDATE shipments SET carrier_sync_status='ERROR',carrier_error=$2,carrier_last_sync_at=NOW() WHERE id=$1`,[shipment.id,text.slice(0,2000)]);
    return {ok:false,error:text};
  }
  let data={}; try{data=JSON.parse(text||'{}')}catch{}
  await q(`UPDATE shipments SET carrier_watch_id=$2,carrier_sync_status='WATCHING',carrier_error=NULL,carrier_last_sync_at=NOW() WHERE id=$1`,[
    shipment.id,data.tracking_identifier||null
  ]);
  return {ok:true,trackingIdentifier:data.tracking_identifier||null};
}

export async function registerMissingNzPostWatches(limit=100){
  if(!process.env.NZPOST_TRACKING_API_KEY)return {checked:0,registered:0,failed:0,skipped:true};
  const rows=(await q(`SELECT s.id,s.tracking_number,s.carrier,o.order_name
    FROM shipments s LEFT JOIN orders o ON o.id=s.order_id
    WHERE s.tracking_number IS NOT NULL
      AND s.carrier_watch_id IS NULL
      AND (LOWER(COALESCE(s.carrier,'')) LIKE '%nz post%' OR LOWER(COALESCE(s.carrier,'')) LIKE '%courierpost%')
    ORDER BY s.id DESC LIMIT $1`,[Math.max(1,Math.min(500,Number(limit)||100))])).rows;
  const out={checked:rows.length,registered:0,failed:0};
  for(const row of rows){
    const r=await registerNzPostWatch(row);
    if(r.ok)out.registered++; else out.failed++;
  }
  return out;
}

function normalizeNzPostEvent(event,message=''){
  const e=String(event||'').toLowerCase();
  const m=String(message||'').toLowerCase();
  if(e==='delivered'||m.includes('delivered')||m.includes('delivery complete'))return 'DELIVERED';
  if(e==='failed'||m.includes('failed')||m.includes('unable to deliver'))return 'DELIVERY_ISSUE';
  if(m.includes('out for delivery'))return 'OUT_FOR_DELIVERY';
  if(e==='moved')return 'IN_TRANSIT';
  if(e==='untracked'||e==='welcome')return 'COURIER_BOOKED_FOR_PICKUP';
  return String(event||'IN_TRANSIT').toUpperCase();
}

export async function processNzPostWebhook({url,rawBody}){
  const token=String(url.searchParams.get('token')||'');
  const expected=nzPostWebhookToken();
  if(!expected||token.length!==expected.length)return {status:401,body:'Invalid token'};
  try{if(!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(expected)))return {status:401,body:'Invalid token'};}catch{return {status:401,body:'Invalid token'};}

  const params=new URLSearchParams(rawBody.toString('utf8'));
  const tracking=String(params.get('tracking_code')||'').trim();
  if(!tracking)return {status:400,body:'Missing tracking_code'};
  const event=String(params.get('event')||'').trim();
  const message=String(params.get('message')||'').trim();
  const eventTime=String(params.get('datetime')||'').trim()||new Date().toISOString();
  const shipment=(await q(`SELECT id FROM shipments WHERE tracking_number=$1 ORDER BY id DESC LIMIT 1`,[tracking])).rows[0];
  if(!shipment)return {status:404,body:'Shipment not found'};

  const status=normalizeNzPostEvent(event,message);
  await q(`INSERT INTO shipment_events(shipment_id,status,description,event_time,raw)
    VALUES($1,$2,$3,$4,$5::jsonb)`,[
    shipment.id,status,message||event,eventTime,JSON.stringify(Object.fromEntries(params.entries()))
  ]);
  await q(`UPDATE shipments SET status=$2,last_event_at=$3,
    delivered_at=CASE WHEN $2='DELIVERED' THEN COALESCE(delivered_at,$3) ELSE delivered_at END,
    carrier_sync_status='WATCHING',carrier_last_sync_at=NOW(),carrier_error=NULL
    WHERE id=$1`,[shipment.id,status,eventTime]);

  return {status:200,body:'OK'};
}
