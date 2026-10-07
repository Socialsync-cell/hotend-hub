import crypto from 'node:crypto';
import {closeChatNowByReference} from './chat_lifecycle.mjs';
import {q} from './db.mjs';
import {subscribeMarketingCustomer} from './shopify.mjs';
import {sendSignupDiscountEmail,sendSignupOwnerNotification,sendWelcomeStory} from './email.mjs';
import {getChatSettings,generateAiReply,chatIntegrationStatus} from './ai_chat.mjs';
import {sendStaffChatMessage} from './whatsapp.mjs';
import {submitDirectProductReview} from './reviews.mjs';
import {recordStorefrontCart} from './abandoned.mjs';
import {automationRule} from './automations.mjs';

async function sendWelcomeStoryIfEnabled(customerId){
  if(!customerId)return {ok:false,skipped:'no_customer'};
  try{
    const rule=await automationRule('welcome-story');
    if(!rule?.enabled)return {ok:true,skipped:'disabled'};
    const result=await sendWelcomeStory(customerId);
    if(!result.ok&&!result.skipped){
      console.error('Welcome story email failed:',result.error||'unknown');
    }
    return result;
  }catch(e){
    console.error('Welcome story email failed:',e.message);
    return {ok:false,error:e.message};
  }
}

export function verifyShopifyProxy(url){
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

export async function proxyReviews(url){
  const productId=String(url.searchParams.get('product_id')||'');
  if(!productId)return {status:400,body:{ok:false,message:'product_id required'}};
  const rows=await q(`SELECT pr.id,pr.rating,pr.feedback,pr.created_at,pr.reviewer_name,pr.submitted_order_number,
      c.first_name,c.last_name,
      EXISTS(SELECT 1 FROM review_requests rr WHERE rr.id=pr.review_request_id) AS verified_purchase,
      COALESCE((SELECT json_agg(json_build_object('id',rp.id))
        FROM review_photos rp WHERE rp.review_id=pr.id),'[]'::json) AS photos
    FROM product_reviews pr
    LEFT JOIN customers c ON c.id=pr.customer_id
    WHERE pr.shopify_product_id=$1 AND pr.approved=TRUE
    ORDER BY pr.created_at DESC LIMIT 100`,[productId]);
  const count=rows.rows.length;
  const average=count?rows.rows.reduce((a,x)=>a+Number(x.rating||0),0)/count:0;
  return {status:200,body:{
    ok:true,count,average:Number(average.toFixed(2)),
    reviews:rows.rows.map(x=>({
      rating:Number(x.rating),
      feedback:x.feedback||'',
      customer_name:x.reviewer_name||[x.first_name,x.last_name?.slice(0,1)&&x.last_name.slice(0,1)+'.'].filter(Boolean).join(' ')||'Customer',
      verified_purchase:!!x.verified_purchase,
      order_number:x.submitted_order_number||'',
      photos:(x.photos||[]).map(p=>({url:'https://hotend-hub.onrender.com/review-photo/'+p.id})),
      created_at:x.created_at
    }))
  }};
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
  if(!raw)return [];
  const noHash=raw.replace(/^#/,'');
  return [...new Set([raw,noHash,'#'+noHash])];
}

export async function proxyTracking(url){
  const order=String(url.searchParams.get('order')||'').trim();
  const email=String(url.searchParams.get('email')||'').trim().toLowerCase();
  const phone=normalizePublicPhone(url.searchParams.get('phone')||'');
  if(!order||(!email&&!phone)){
    return {status:400,body:{ok:false,message:'Enter your order number and either your email address or phone number.'}};
  }

  const candidates=orderCandidates(order);
  const params=[candidates];
  const where=[`o.order_name = ANY($1::text[])`];

  if(email){
    params.push(email);
    where.push(`LOWER(COALESCE(o.email,c.email,''))=$${params.length}`);
  }else{
    params.push(phone);
    where.push(`REGEXP_REPLACE(
      CASE
        WHEN REGEXP_REPLACE(COALESCE(o.phone,c.phone,''),'[^0-9]','','g') LIKE '0%'
          THEN '64'||SUBSTRING(REGEXP_REPLACE(COALESCE(o.phone,c.phone,''),'[^0-9]','','g') FROM 2)
        ELSE REGEXP_REPLACE(COALESCE(o.phone,c.phone,''),'[^0-9]','','g')
      END,
      '^00','','g'
    )=$${params.length}`);
  }

  const orderRow=(await q(`SELECT o.id AS order_id,o.order_name,o.fulfillment_status,o.financial_status,o.total_price,o.currency,o.created_at_shopify,o.shipping_method,o.fulfilled_at
    FROM orders o
    LEFT JOIN customers c ON c.id=o.customer_id
    WHERE ${where.join(' AND ')}
    ORDER BY o.created_at_shopify DESC
    LIMIT 1`,params)).rows[0];

  if(!orderRow)return {status:404,body:{ok:false,message:'We could not match that order number with those contact details. Please check them and try again.'}};

  const items=await q(`SELECT product_title,variant_title,sku,quantity,image_url
    FROM order_items WHERE order_id=$1 ORDER BY id`,[orderRow.order_id]);

  const ship=(await q(`SELECT id,carrier,tracking_number,tracking_url,status,last_event_at,delivered_at
    FROM shipments
    WHERE order_id=$1
    ORDER BY COALESCE(last_event_at,created_at) DESC
    LIMIT 1`,[orderRow.order_id])).rows[0];

  const orderBody={
    order_name:orderRow.order_name,
    fulfillment_status:orderRow.fulfillment_status,
    financial_status:orderRow.financial_status,
    total_price:orderRow.total_price,
    currency:orderRow.currency,
    created_at:orderRow.created_at_shopify,
    fulfilled_at:orderRow.fulfilled_at,
    delivered_at:null,
    items:items.rows
  };

  const shippingMethod=String(orderRow.shipping_method||'').trim();
  const isHamiltonLocal=/free delivery within hamilton/i.test(shippingMethod);
  const fulfilled=String(orderRow.fulfillment_status||'').toUpperCase()==='FULFILLED';

  if(!ship&&isHamiltonLocal){
    return {status:200,body:{
      ok:true,
      tracking_available:true,
      local_delivery:true,
      message:fulfilled?'Order was delivered by Hotend team.':'Your order is scheduled for local delivery by Hotend team.',
      shipment:{
        id:null,
        carrier:'Hotend team',
        tracking_number:null,
        tracking_url:null,
        status:fulfilled?'DELIVERED_BY_HOTEND_TEAM':'LOCAL_DELIVERY',
        last_event_at:null,
        delivered_at:fulfilled?(orderRow.fulfilled_at||new Date().toISOString()):null,
        events:[{
          status:fulfilled?'DELIVERED_BY_HOTEND_TEAM':'LOCAL_DELIVERY',
          description:fulfilled?'Order was delivered by Hotend team.':'Your order is scheduled for local delivery by Hotend team.',
          location:'Hamilton',
          event_time:fulfilled?(orderRow.fulfilled_at||null):null
        }]
      },
      order:orderBody
    }};
  }

  if(!ship){
    return {status:200,body:{
      ok:true,
      tracking_available:false,
      message:'Order found. Tracking information is not available yet.',
      shipment:{
        id:null,
        carrier:null,
        tracking_number:null,
        tracking_url:null,
        status:'TRACKING_NOT_AVAILABLE',
        last_event_at:null,
        delivered_at:null,
        events:[]
      },
      order:orderBody
    }};
  }

  const events=await q(`SELECT status,description,location,event_time
    FROM shipment_events WHERE shipment_id=$1
    ORDER BY COALESCE(event_time,created_at) DESC,id DESC`,[ship.id]);

  orderBody.delivered_at=ship.delivered_at
    || (String(ship.status||'').toUpperCase()==='SUCCESS' ? (ship.last_event_at||events.rows[0]?.event_time||orderRow.fulfilled_at||null) : null)
    || orderRow.fulfilled_at
    || null;

  return {status:200,body:{ok:true,tracking_available:true,shipment:{...ship,events:events.rows},order:orderBody}};
}

export async function proxyConfig(){
  const popups=await q(`SELECT id,name,popup_type,headline,body_text,image_url,cta_text,cta_url,discount_code,targeting,starts_at,ends_at
    FROM popups WHERE enabled=TRUE AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW())
    ORDER BY id DESC LIMIT 10`);
  const logo=String(process.env.HOTEND_LOGO_URL||'').trim();
  const chatSettings=await getChatSettings();
  const integration=chatIntegrationStatus(chatSettings);
  return {status:200,body:{
    ok:true,
    logo,
    chat:{
      enabled:true,
      endpoint:'/apps/hotend-hub/chat',
      ai_mode:chatSettings?.ai_mode||'OFF',
      human_handoff_enabled:!!chatSettings?.whatsapp_enabled,
      integrations:integration
    },
    reviews:{enabled:true,endpoint:'/apps/hotend-hub/reviews'},
    tracking:{enabled:true,endpoint:'/apps/hotend-hub/tracking'},
    subscribe:{enabled:true,endpoint:'/apps/hotend-hub/subscribe'},
    popups:popups.rows
  }};
}

export async function proxyChat(req,url,readBody){
  if(req.method==='GET'){
    const reference=String(url.searchParams.get('reference')||'').trim();
    if(!reference)return {status:200,body:{ok:true,enabled:true}};
    const session=(await q(`SELECT id,reference,closed_at,needs_human FROM chat_sessions WHERE reference=$1 LIMIT 1`,[reference])).rows[0];
    if(!session)return {status:404,body:{ok:false,message:'Conversation not found'}};
    const messages=(await q(`SELECT sender,message,created_at FROM chat_messages WHERE session_id=$1 ORDER BY id ASC LIMIT 200`,[session.id])).rows;
    return {status:200,body:{ok:true,reference:session.reference,closed:!!session.closed_at,needs_human:!!session.needs_human,messages}};
  }

  if(req.method!=='POST')return {status:405,body:{ok:false,message:'Method not allowed'}};
  const raw=(await readBody(req,64*1024)).toString('utf8');
  let data={}; try{data=JSON.parse(raw||'{}')}catch{}
  const name=String(data.name||'').trim();
  const email=String(data.email||'').trim().toLowerCase();
  const message=String(data.message||'').trim();
  const existingReference=String(data.reference||'').trim();
  const startOnly=!!data.start_only;
  const closeChat=!!data.close_chat;
  if(closeChat){
    const result=await closeChatNowByReference(existingReference);
    return {status:result.ok?200:404,body:result};
  }
  if(!message&&!startOnly)return {status:400,body:{ok:false,message:'message required'}};

  let customerId=null;
  if(email){
    const existing=(await q(`SELECT id,marketing_status FROM customers WHERE email=$1 LIMIT 1`,[email])).rows[0];
    if(existing){
      customerId=existing.id;
      await q(`UPDATE customers SET first_name=COALESCE(NULLIF($2,''),first_name),
        marketing_status=CASE WHEN $3 THEN 'SUBSCRIBED' ELSE marketing_status END,updated_at=NOW()
        WHERE id=$1`,[customerId,name,!!data.marketing_opt_in]);
    }else{
      const up=await q(`INSERT INTO customers(email,first_name,marketing_status,updated_at)
        VALUES($1,$2,$3,NOW()) RETURNING id`,[email,name||null,data.marketing_opt_in?'SUBSCRIBED':'NOT_SUBSCRIBED']);
      customerId=up.rows[0].id;
    }
  }

  if(email&&data.marketing_opt_in){
    try{
      const shopifyCustomer=await subscribeMarketingCustomer({email,firstName:name});
      if(customerId&&shopifyCustomer?.id){
        await q(`UPDATE customers SET shopify_customer_id=COALESCE(shopify_customer_id,$2),marketing_status='SUBSCRIBED',marketing_opt_in_level='SINGLE_OPT_IN',updated_at=NOW() WHERE id=$1`,[customerId,shopifyCustomer.id]);
      }
    }catch(e){
      console.error('Chat marketing consent sync failed:',e.message);
    }
  }

  if(email&&data.marketing_opt_in&&customerId){
    setImmediate(()=>sendWelcomeStoryIfEnabled(customerId));
  }

  let session=null;
  if(existingReference){
    session=(await q(`SELECT id,reference,closed_at,needs_human FROM chat_sessions WHERE reference=$1 LIMIT 1`,[existingReference])).rows[0]||null;
  }

  if(!session){
    const ref='CHAT-'+Date.now().toString(36).toUpperCase();
    session=(await q(`INSERT INTO chat_sessions(reference,customer_id,marketing_opt_in)
      VALUES($1,$2,$3) RETURNING id,reference,closed_at,needs_human`,[ref,customerId,!!data.marketing_opt_in])).rows[0];
  }else{
    await q(`UPDATE chat_sessions SET customer_id=COALESCE($2,customer_id),
      marketing_opt_in=marketing_opt_in OR $3,last_activity_at=NOW(),closed_at=NULL WHERE id=$1`,[
      session.id,customerId,!!data.marketing_opt_in
    ]);
  }

  if(startOnly){
    const existingMessages=(await q(`SELECT sender,message,created_at
      FROM chat_messages WHERE session_id=$1 ORDER BY id ASC LIMIT 200`,[session.id])).rows;
    if(!existingMessages.length){
      const welcome='Hi '+(name||'there')+' 👋 Welcome to Hotend. I can help you find filament and accessories, check live stock and prices, suggest similar products, help with print settings, delivery, or your order. What are you looking for today?';
      await q(`INSERT INTO chat_messages(session_id,sender,message) VALUES($1,'AI',$2)`,[session.id,welcome]);
      existingMessages.push({sender:'AI',message:welcome,created_at:new Date().toISOString()});
    }
    return {status:200,body:{
      ok:true,
      started:true,
      reference:session.reference,
      subscribed:!!data.marketing_opt_in,
      messages:existingMessages
    }};
  }

  const inserted=(await q(`INSERT INTO chat_messages(session_id,sender,message)
    VALUES($1,'CUSTOMER',$2) RETURNING id`,[session.id,message])).rows[0];
  await q(`UPDATE chat_sessions SET last_activity_at=NOW() WHERE id=$1`,[session.id]);

  setImmediate(async()=>{
    try{
      if(session.needs_human){
        const forwarded=await sendStaffChatMessage(session.id);
        if(!forwarded.ok)console.error('Human chat forward failed:',forwarded.error||forwarded.skipped||'unknown');
        return;
      }

      const ai=await generateAiReply(session.id,{expectedCustomerMessageId:inserted.id});
      if(ai?.escalate){
        await q(`INSERT INTO chat_messages(session_id,sender,message) VALUES($1,'SYSTEM',$2)`,[
          session.id,ai.reply||'A Hotend team member will follow up.'
        ]);
      }
      if(ai?.error)console.error('AI chat reply error:',ai.error);
      if(ai?.skipped&&!['stale_customer_message','ai_off'].includes(ai.skipped)){
        console.error('AI chat reply skipped:',ai.skipped);
      }
    }catch(e){
      console.error('AI chat background failure:',e.message);
    }
  });

  const settings=await getChatSettings();
  const messages=(await q(`SELECT sender,message,created_at FROM chat_messages WHERE session_id=$1 ORDER BY id ASC LIMIT 200`,[session.id])).rows;
  return {status:200,body:{
    ok:true,
    reference:session.reference,
    accepted:true,
    ai_mode:settings?.ai_mode||'OFF',
    messages
  }};
}


export async function proxySubscribe(req,url,readBody){
  if(req.method!=='POST')return {status:405,body:{ok:false,message:'Method not allowed'}};
  const raw=(await readBody(req,64*1024)).toString('utf8');
  let data={}; try{data=JSON.parse(raw||'{}')}catch{}
  const email=String(data.email||'').trim().toLowerCase();
  const firstName=String(data.first_name||'').trim();
  const lastName=String(data.last_name||'').trim();
  const marketingOptIn=data.marketing_opt_in!==false;
  const popupId=Number(data.popup_id||0);

  if(!email||!email.includes('@'))return {status:400,body:{ok:false,message:'Please enter a valid email address.'}};

  const popup=popupId?(await q(`SELECT id,name,headline,discount_code FROM popups WHERE id=$1 LIMIT 1`,[popupId])).rows[0]:null;
  let effectiveDiscountCode=String(popup?.discount_code||'').trim();
  if(!effectiveDiscountCode){
    const fallback=(await q(`SELECT discount_code
      FROM popups
      WHERE enabled=TRUE
        AND discount_code IS NOT NULL
        AND BTRIM(discount_code)<>''
        AND (starts_at IS NULL OR starts_at<=NOW())
        AND (ends_at IS NULL OR ends_at>=NOW())
      ORDER BY CASE WHEN popup_type='NEWSLETTER' THEN 0 ELSE 1 END,id DESC
      LIMIT 1`)).rows[0];
    effectiveDiscountCode=String(fallback?.discount_code||'').trim();
  }

  if(!marketingOptIn){
    return {status:200,body:{ok:true,subscribed:false,message:'No marketing subscription was added.'}};
  }

  const shopify=await subscribeMarketingCustomer({email,firstName,lastName});
  const shopifyId=shopify?.id||null;
  const up=(await q(`INSERT INTO customers(shopify_customer_id,email,first_name,last_name,marketing_status,marketing_opt_in_level,updated_at)
    VALUES($1,$2,$3,$4,'SUBSCRIBED','SINGLE_OPT_IN',NOW())
    ON CONFLICT(email) DO UPDATE SET
      shopify_customer_id=COALESCE(EXCLUDED.shopify_customer_id,customers.shopify_customer_id),
      first_name=COALESCE(NULLIF(EXCLUDED.first_name,''),customers.first_name),
      last_name=COALESCE(NULLIF(EXCLUDED.last_name,''),customers.last_name),
      marketing_status='SUBSCRIBED',
      marketing_opt_in_level='SINGLE_OPT_IN',
      updated_at=NOW()
    RETURNING id`,[shopifyId,email,firstName||null,lastName||null])).rows[0];

  setImmediate(()=>sendWelcomeStoryIfEnabled(up.id));

  const discountCode=effectiveDiscountCode;
  let emailResult={ok:false,skipped:'no_discount_code'};
  if(discountCode){
    emailResult=await sendSignupDiscountEmail({
      customerId:up.id,
      to:email,
      firstName,
      discountCode,
      popupName:popup?.name||''
    });
  }

  setImmediate(async()=>{
    try{
      const ownerNotice=await sendSignupOwnerNotification({
        customerId:up.id,
        email,
        firstName,
        lastName,
        popupName:popup?.name||''
      });
      if(!ownerNotice.ok)console.error('Signup owner notification failed:',ownerNotice.error||ownerNotice.skipped||'unknown');
    }catch(e){
      console.error('Signup owner notification failed:',e.message);
    }
  });

  const codeAlreadySent=emailResult.skipped==='already_sent';

  return {status:200,body:{
    ok:true,
    subscribed:true,
    discount_code:codeAlreadySent?null:(discountCode||null),
    discount_email_sent:!!emailResult.ok&&!codeAlreadySent,
    discount_already_sent:codeAlreadySent,
    message:codeAlreadySent
      ? 'You’re already on the Hotend list 😊 We sent your welcome discount to this email before, so there’s nothing else you need to do. Keep an eye on your inbox for future Hotend offers and new releases.'
      : (discountCode
          ? (emailResult.ok?'Thanks for subscribing. Your discount code has been emailed to you.':'Thanks for subscribing.')
          : 'Thanks for subscribing to Hotend.')
  }};
}


export async function proxyCartTrack(req,url,readBody){
  if(req.method!=='POST')return {status:405,body:{ok:false,message:'Method not allowed'}};
  const raw=(await readBody(req,256*1024)).toString('utf8');
  let data={};
  try{data=JSON.parse(raw||'{}')}catch{return {status:400,body:{ok:false,message:'Invalid cart data'}};}
  try{
    const result=await recordStorefrontCart(data);
    return {status:result.ok?200:400,body:result};
  }catch(e){
    console.error('Storefront cart tracking failed:',e.message);
    return {status:500,body:{ok:false,message:'Unable to track cart'}};
  }
}

export async function proxySubmitReview(req,url,readBody){
  if(req.method!=='POST')return {status:405,body:{ok:false,message:'Method not allowed'}};
  const raw=(await readBody(req,4*1024*1024)).toString('utf8');
  let data={};
  try{data=JSON.parse(raw||'{}')}catch{return {status:400,body:{ok:false,message:'Invalid review data'}};}
  try{
    const result=await submitDirectProductReview(data);
    return {status:result.ok?200:400,body:result};
  }catch(e){
    console.error('Storefront review submit failed:',e.message);
    return {status:500,body:{ok:false,message:'Unable to submit your review right now.'}};
  }
}
