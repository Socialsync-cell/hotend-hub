import crypto from 'node:crypto';
import {q} from './db.mjs';
import {syncCustomerByNumericId,syncOrderByNumericId} from './sync.mjs';
import {sendWelcomeStory} from './email.mjs';
import {syncAbandonedCheckouts,processDueAbandonedEmails} from './abandoned.mjs';
import {scheduleReviewForShopifyOrder,processDueReviewRequests} from './reviews.mjs';
import {automationRule} from './automations.mjs';

function timingSafeHexEqual(a,b){
  if(!a||!b||a.length!==b.length)return false;
  try{return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}catch{return false;}
}

export function verifyShopifyWebhook(rawBody,hmacHeader){
  const secret=process.env.SHOPIFY_CLIENT_SECRET||'';
  if(!secret||!hmacHeader)return false;
  const expected=crypto.createHmac('sha256',secret).update(rawBody).digest('base64');
  const a=Buffer.from(expected);
  const b=Buffer.from(String(hmacHeader));
  if(a.length!==b.length)return false;
  try{return crypto.timingSafeEqual(a,b);}catch{return false;}
}

function normalizeTopic(value){
  return String(value||'').trim().toLowerCase();
}

export async function processShopifyWebhook({rawBody,headers}){
  const webhookId=String(headers['x-shopify-webhook-id']||'').trim();
  const topic=normalizeTopic(headers['x-shopify-topic']);
  const shopDomain=String(headers['x-shopify-shop-domain']||'').trim().toLowerCase();
  const hmac=String(headers['x-shopify-hmac-sha256']||'');

  if(!verifyShopifyWebhook(rawBody,hmac))return {status:401,body:{ok:false,message:'Invalid webhook signature'}};
  if(!webhookId||!topic)return {status:400,body:{ok:false,message:'Missing Shopify webhook headers'}};

  let payload={};
  try{payload=JSON.parse(rawBody.toString('utf8')||'{}');}
  catch{return {status:400,body:{ok:false,message:'Invalid JSON payload'}};}

  const inserted=await q(`INSERT INTO webhook_events(webhook_id,topic,shop_domain,payload)
    VALUES($1,$2,$3,$4::jsonb)
    ON CONFLICT(webhook_id) DO NOTHING
    RETURNING id`,[webhookId,topic,shopDomain,JSON.stringify(payload)]);

  if(!inserted.rows[0])return {status:200,body:{ok:true,duplicate:true}};

  try{
    if(topic==='customers/create'||topic==='customers/update'){
      const gid=String(payload.id||'').startsWith('gid://')?String(payload.id):`gid://shopify/Customer/${payload.id}`;
      const before=(await q(`SELECT id,marketing_status FROM customers WHERE shopify_customer_id=$1 LIMIT 1`,[gid])).rows[0]||null;
      await syncCustomerByNumericId(payload.id);
      const after=(await q(`SELECT id,marketing_status FROM customers WHERE shopify_customer_id=$1 LIMIT 1`,[gid])).rows[0]||null;
      if(after?.id&&after.marketing_status==='SUBSCRIBED'&&before?.marketing_status!=='SUBSCRIBED'){
        const rule=await automationRule('welcome-story');
        if(rule?.enabled)await sendWelcomeStory(after.id);
      }
    }else if(topic==='checkouts/create'||topic==='checkouts/update'){
      const rule=await automationRule('abandoned-cart');
      if(rule?.enabled){
        await syncAbandonedCheckouts();
        await processDueAbandonedEmails(25);
      }
    }else if(
      topic==='orders/create'||
      topic==='orders/updated'||
      topic==='orders/fulfilled'||
      topic==='orders/partially_fulfilled'
    ){
      await syncOrderByNumericId(payload.id);
      if(topic==='orders/fulfilled'){
        const rule=await automationRule('post-purchase-review');
        if(rule?.enabled){
          const delayDays=Number(rule.config?.delay_days||7);
          await scheduleReviewForShopifyOrder(payload.id,delayDays);
          await processDueReviewRequests(25);
        }
      }
    }else if(topic==='app/uninstalled'){
      await q(`DELETE FROM shopify_installations WHERE shop_domain=$1`,[shopDomain]);
    }

    await q(`UPDATE webhook_events SET status='PROCESSED',processed_at=NOW() WHERE webhook_id=$1`,[webhookId]);
    return {status:200,body:{ok:true,topic}};
  }catch(e){
    await q(`UPDATE webhook_events SET status='FAILED',error=$2,processed_at=NOW() WHERE webhook_id=$1`,[webhookId,String(e.message||e).slice(0,2000)]);
    console.error('Shopify webhook failed',topic,e);
    return {status:500,body:{ok:false,message:'Webhook processing failed'}};
  }
}
