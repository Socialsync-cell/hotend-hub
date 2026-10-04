import {q} from './db.mjs';

export function normalizeTrackingStatus(status){
  const s=String(status||'').trim().toUpperCase();
  if(!s)return 'Courier booked for pick up';
  if(['SUCCESS','DELIVERED','DELIVERY_SUCCESS'].includes(s))return 'Delivered';
  if(s.includes('OUT_FOR_DELIVERY')||s.includes('OUT FOR DELIVERY'))return 'Out for delivery';
  if(s.includes('IN_TRANSIT')||s.includes('IN TRANSIT')||s.includes('TRANSIT'))return 'In transit';
  if(s.includes('ATTEMPT'))return 'Delivery attempted';
  if(s.includes('PICKUP')||s.includes('BOOKED')||s.includes('PENDING')||s.includes('OPEN'))return 'Courier booked for pick up';
  if(s.includes('FAIL')||s.includes('EXCEPTION')||s.includes('HOLD'))return 'Delivery issue';
  return s.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,m=>m.toUpperCase());
}

export async function listShipments(limit=200){
  return (await q(`SELECT s.id,s.carrier,s.tracking_number,s.tracking_url,s.status,s.last_event_at,s.delivered_at,s.created_at,
      o.order_name,o.email,o.fulfillment_status,c.first_name,c.last_name
    FROM shipments s
    LEFT JOIN orders o ON o.id=s.order_id
    LEFT JOIN customers c ON c.id=o.customer_id
    ORDER BY COALESCE(s.last_event_at,s.created_at) DESC
    LIMIT $1`,[Math.max(1,Math.min(500,Number(limit)||200))])).rows;
}

export async function getShipment(id){
  const shipment=(await q(`SELECT s.*,o.order_name,o.email,o.fulfillment_status,o.financial_status,
      c.first_name,c.last_name
    FROM shipments s
    LEFT JOIN orders o ON o.id=s.order_id
    LEFT JOIN customers c ON c.id=o.customer_id
    WHERE s.id=$1 LIMIT 1`,[Number(id)])).rows[0];
  if(!shipment)return null;
  const events=(await q(`SELECT id,status,description,location,event_time,created_at
    FROM shipment_events WHERE shipment_id=$1
    ORDER BY COALESCE(event_time,created_at) DESC,id DESC`,[shipment.id])).rows;
  return {...shipment,events};
}

export async function findPublicShipment({order,email,phone}){
  const e=String(email||'').trim().toLowerCase();
  let p=String(phone||'').replace(/\D/g,'');
  if(p.startsWith('0'))p='64'+p.slice(1);
  const raw=String(order||'').trim();
  if(!raw||(!e&&!p))return null;
  const noHash=raw.replace(/^#/,'');
  const candidates=[...new Set([raw,noHash,'#'+noHash])];
  const params=[candidates];
  const where=[`o.order_name=ANY($1::text[])`];
  if(e){
    params.push(e);
    where.push(`LOWER(COALESCE(o.email,c.email,''))=$${params.length}`);
  }else{
    params.push(p);
    where.push(`REGEXP_REPLACE(CASE WHEN REGEXP_REPLACE(COALESCE(o.phone,c.phone,''),'[^0-9]','','g') LIKE '0%' THEN '64'||SUBSTRING(REGEXP_REPLACE(COALESCE(o.phone,c.phone,''),'[^0-9]','','g') FROM 2) ELSE REGEXP_REPLACE(COALESCE(o.phone,c.phone,''),'[^0-9]','','g') END,'^00','','g')=$${params.length}`);
  }
  const shipment=(await q(`SELECT s.id,s.carrier,s.tracking_number,s.tracking_url,s.status,s.last_event_at,s.delivered_at,
      o.order_name,o.fulfillment_status
    FROM shipments s
    JOIN orders o ON o.id=s.order_id
    LEFT JOIN customers c ON c.id=o.customer_id
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(s.last_event_at,s.created_at) DESC
    LIMIT 1`,params)).rows[0];
  if(!shipment)return null;
  const events=(await q(`SELECT status,description,location,event_time,created_at
    FROM shipment_events WHERE shipment_id=$1
    ORDER BY COALESCE(event_time,created_at) DESC,id DESC`,[shipment.id])).rows;
  return {...shipment,events};
}

export async function trackingStats(){
  const r=(await q(`SELECT
    COUNT(*)::int total,
    COUNT(*) FILTER (WHERE delivered_at IS NOT NULL OR UPPER(status)='SUCCESS')::int delivered,
    COUNT(*) FILTER (WHERE delivered_at IS NULL AND UPPER(status)<>'SUCCESS')::int active
    FROM shipments`)).rows[0];
  return r;
}
