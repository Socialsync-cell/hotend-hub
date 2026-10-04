import http from 'node:http';
import {migrate} from './db.mjs';
import {dashboard,setupPage,marketingPage} from './ui.mjs';
import {testShopify,buildOAuthUrl,validOAuthCallback,exchangeCode,registerHotendHubStorefront,cleanupHotendHubScriptTags,registerHotendHubWebhooks,getGrantedAccessScopes,setCustomerEmailMarketingState} from './shopify.mjs';
import {syncShopifyCore,backfillEmailProductImages,backfillCustomerPhones,backfillOrderPhones,backfillShippingMethods} from './sync.mjs';
import {verifyShopifyProxy,proxyReviews,proxyTracking,proxyConfig,proxyChat,proxySubscribe,proxySubmitReview,proxyCartTrack} from './proxy.mjs';
import {storefrontScript} from './storefront.mjs';
import {processShopifyWebhook} from './webhooks.mjs';
import {emailConfigStatus,recentEmailDeliveries,emailPreviewHtml} from './email.mjs';
import {syncAbandonedCheckouts,processDueAbandonedEmails,processDueStorefrontCartEmails,abandonedStats} from './abandoned.mjs';
import {renderReviewForm,submitReviewForm,processDueReviewRequests,reviewAutomationStats,renderReviewStartPage,beginVerifiedProductReview,getReviewPhoto} from './reviews.mjs';
import {createCampaign,listCampaigns,queueCampaign,sendCampaignTest,processCampaignQueue} from './campaigns.mjs';
import {listPopups,updatePopup,togglePopup,deletePopup} from './popups.mjs';
import {listChatSessions,getChatSession,replyToChat,setChatClosed} from './chats.mjs';
import {getChatSettings,updateChatSettings,chatIntegrationStatus,generateAiReply,saveAiSummary} from './ai_chat.mjs';
import {verifyWhatsAppWebhook,processWhatsAppWebhook} from './whatsapp.mjs';
import {listShipments,getShipment,findPublicShipment,trackingStats} from './tracking.mjs';
import {carrierConfigStatus,registerMissingNzPostWatches,processNzPostWebhook} from './carriers.mjs';
import {listCustomers,getCustomerProfile,customerStats} from './customers.mjs';
import {listReviews,setReviewApproved,reviewStats} from './review_admin.mjs';
import {listAutomationRules,updateAutomationRule,automationRule} from './automations.mjs';
import {automationEmailPreviewPdf} from './automation_pdf.mjs';
import {sendAutomationTestEmail} from './automation_test.mjs';
import crypto from 'node:crypto';
import {processChatLifecycle} from './chat_lifecycle.mjs';

const port=Number(process.env.PORT||10000);

setInterval(async()=>{
  try{
    const abandonedRule=await automationRule('abandoned-cart');
    const reviewRule=await automationRule('post-purchase-review');
    const abandoned=abandonedRule?.enabled
      ? (await syncAbandonedCheckouts(), await processDueAbandonedEmails(50))
      : {sent:0,failed:0};
    const storefrontCarts=abandonedRule?.enabled
      ? await processDueStorefrontCartEmails(50)
      : {sent:0,failed:0};
    const reviews=reviewRule?.enabled
      ? await processDueReviewRequests(50)
      : {sent:0,failed:0};
    const campaigns=await processCampaignQueue(30);
    const nzpost=await registerMissingNzPostWatches(100);
    if(abandoned.sent||abandoned.failed)console.log('Abandoned checkout processor',abandoned);
    if(storefrontCarts.sent||storefrontCarts.failed)console.log('Storefront abandoned cart processor',storefrontCarts);
    if(reviews.sent||reviews.failed)console.log('Review request processor',reviews);
    if(campaigns.sent||campaigns.failed)console.log('Campaign processor',campaigns);
    if(nzpost.registered||nzpost.failed)console.log('NZ Post watch registration',nzpost);
  }catch(e){
    console.error('Marketing background processor failed:',e.message);
  }
},60*60*1000).unref();
setInterval(async()=>{
  try{
    const result=await processChatLifecycle();
    if(result.humanClosed||result.humanTranscripts||result.humanTranscriptFailed||result.aiClosed||result.transcripts||result.transcriptFailed){
      console.log('Chat lifecycle processor',result);
    }
  }catch(e){
    console.error('Chat lifecycle processor failed:',e.message);
  }
},60*1000).unref();

let ready=false,error=null;
try{await migrate();ready=true;}catch(e){error=e.message;console.error('Hotend Hub startup:',e.message);}
if(ready){
  setTimeout(async()=>{
    try{
      try{
        const storefrontCleanup=await cleanupHotendHubScriptTags();
        console.log('Storefront ScriptTag cleanup',storefrontCleanup);
      }catch(e){
        console.error('Storefront ScriptTag cleanup failed:',e.message);
      }
      const result=await backfillEmailProductImages();
      console.log('Email product image backfill',result);
      const phones=await backfillCustomerPhones();
      console.log('Customer phone backfill',phones);
      const orderPhones=await backfillOrderPhones();
      console.log('Order phone backfill',orderPhones);
      const shippingMethods=await backfillShippingMethods();
      console.log('Shipping method backfill',shippingMethods);
    }catch(e){
      console.error('Email product image backfill failed:',e.message);
    }
  },5000).unref();
}

async function readBody(req,max=1024*1024){
  const chunks=[]; let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>max)throw new Error('BODY_TOO_LARGE');chunks.push(chunk);}
  return Buffer.concat(chunks);
}

function send(res,status,body,type='application/json'){
  res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});
  res.end(typeof body==='string'?body:JSON.stringify(body));
}

function adminSessionSecret(){
  return process.env.APP_SECRET||process.env.SHOPIFY_CLIENT_SECRET||'';
}

function makeAdminSessionToken(){
  const payload=Buffer.from(JSON.stringify({
    shop:process.env.SHOPIFY_STORE||'',
    exp:Date.now()+12*60*60*1000
  })).toString('base64url');
  const sig=crypto.createHmac('sha256',adminSessionSecret()).update(payload).digest('base64url');
  return payload+'.'+sig;
}

function makeAdminSessionCookie(){
  return 'hotend_hub_admin='+makeAdminSessionToken()+'; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=43200';
}

function b64urlJson(part){
  return JSON.parse(Buffer.from(String(part||''),'base64url').toString('utf8'));
}

function validShopifyIdToken(token){
  try{
    const parts=String(token||'').split('.');
    if(parts.length!==3)return false;
    const [headerPart,payloadPart,sig]=parts;
    const header=b64urlJson(headerPart);
    const payload=b64urlJson(payloadPart);
    if(header.alg!=='HS256')return false;

    const secret=process.env.SHOPIFY_CLIENT_SECRET||'';
    const clientId=process.env.SHOPIFY_CLIENT_ID||'';
    const expectedShop='https://'+String(process.env.SHOPIFY_STORE||'');
    if(!secret||!clientId||!expectedShop)return false;

    const expectedSig=crypto.createHmac('sha256',secret)
      .update(headerPart+'.'+payloadPart)
      .digest('base64url');
    if(expectedSig.length!==sig.length)return false;
    if(!crypto.timingSafeEqual(Buffer.from(expectedSig),Buffer.from(sig)))return false;

    const now=Math.floor(Date.now()/1000);
    const aud=Array.isArray(payload.aud)?payload.aud:[payload.aud];
    if(!aud.includes(clientId))return false;
    if(String(payload.dest||'')!==expectedShop)return false;
    if(Number(payload.exp||0)<now-5)return false;
    if(Number(payload.nbf||0)>now+5)return false;
    return payload;
  }catch{
    return false;
  }
}

function embeddedBootstrapPage(next='/'){
  const clientId=String(process.env.SHOPIFY_CLIENT_ID||'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const safeNext=String(next||'/').startsWith('/')&&!String(next||'/').startsWith('//')?String(next):'/';
  return `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="shopify-api-key" content="${clientId}">
    <title>Opening Hotend Hub…</title>
    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
    <style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#fffcf7;color:#172033;margin:0;padding:32px}.box{max-width:520px;margin:10vh auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px}.muted{color:#667085}</style>
  </head><body><div class="box"><h1>Opening Hotend Hub…</h1><p class="muted" id="status">Authenticating with Shopify.</p></div>
  <script>
  (async()=>{
    const status=document.getElementById('status');
    try{
      if(!window.shopify||typeof window.shopify.idToken!=='function')throw new Error('Shopify App Bridge did not initialize');
      const token=await window.shopify.idToken();
      const r=await fetch('/auth/session',{
        method:'POST',
        headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        credentials:'include',
        body:'{}'
      });
      if(!r.ok)throw new Error(await r.text());
      location.replace(${JSON.stringify(safeNext)});
    }catch(e){
      status.textContent='Unable to authenticate Hotend Hub: '+(e&&e.message?e.message:String(e));
    }
  })();
  </script></body></html>`;
}

function parseCookies(req){
  const out={};
  for(const part of String(req.headers.cookie||'').split(';')){
    const i=part.indexOf('=');
    if(i<0)continue;
    const k=part.slice(0,i).trim();
    const v=part.slice(i+1).trim();
    if(k)out[k]=v;
  }
  return out;
}

function validAdminSession(req){
  const token=parseCookies(req).hotend_hub_admin||'';
  const [payload,sig]=token.split('.');
  if(!payload||!sig||!adminSessionSecret())return false;
  const expected=crypto.createHmac('sha256',adminSessionSecret()).update(payload).digest('base64url');
  if(expected.length!==sig.length)return false;
  try{
    if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(sig)))return false;
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    return data.shop===process.env.SHOPIFY_STORE&&Number(data.exp)>Date.now();
  }catch{return false;}
}

function isAdminPath(req,url){
  if(req.method==='GET'&&(['/','/setup','/marketing','/marketing/email-preview','/popups','/chats','/chat-settings','/tracking-admin','/customers','/reviews-admin','/automations'].includes(url.pathname)||url.pathname.startsWith('/automations/')))return true;
  if(req.method==='POST'&&(
    url.pathname.startsWith('/admin/')||
    url.pathname.startsWith('/marketing/campaign/')||
    url.pathname.startsWith('/popups/')||
    url.pathname.startsWith('/chats/')||
    url.pathname.startsWith('/chat-settings/')||
    url.pathname.startsWith('/reviews-admin/')||
    url.pathname.startsWith('/automations/')
  ))return true;
  return false;
}

http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/webhooks/whatsapp'){
    const verify=verifyWhatsAppWebhook(url);
    if(verify.ok)return send(res,200,verify.challenge,'text/plain');
    return send(res,403,'Verification failed','text/plain');
  }

  if(req.method==='POST'&&url.pathname==='/auth/session'){
    const auth=String(req.headers.authorization||'');
    const token=auth.startsWith('Bearer ')?auth.slice(7).trim():'';
    const payload=validShopifyIdToken(token);
    if(!payload)return send(res,401,'Invalid Shopify ID token','text/plain');
    res.writeHead(204,{
      'Set-Cookie':makeAdminSessionCookie(),
      'Cache-Control':'no-store'
    });
    return res.end();
  }

  if(req.method==='POST'&&url.pathname==='/webhooks/whatsapp'){
    const rawBody=await readBody(req,512*1024);
    const result=await processWhatsAppWebhook(rawBody);
    return send(res,result.ok?200:400,result.ok?'EVENT_RECEIVED':(result.error||'ERROR'),'text/plain');
  }

  if(req.method==='POST'&&url.pathname==='/webhooks/nzpost'){
    const rawBody=await readBody(req,256*1024);
    const result=await processNzPostWebhook({url,rawBody});
    return send(res,result.status,result.body,'text/plain');
  }

  if(req.method==='POST'&&url.pathname==='/webhooks/shopify'){
    const rawBody=await readBody(req,2*1024*1024);
    const result=await processShopifyWebhook({rawBody,headers:req.headers});
    return send(res,result.status,result.body);
  }

  if(url.pathname==='/proxy'||url.pathname.startsWith('/proxy/')){
    if(!verifyShopifyProxy(url))return send(res,401,{ok:false,message:'Invalid Shopify proxy signature'});
    let result;
    if(url.pathname==='/proxy'||url.pathname==='/proxy/config')result=await proxyConfig();
    else if(url.pathname==='/proxy/reviews')result=await proxyReviews(url);
    else if(url.pathname==='/proxy/review-submit')result=await proxySubmitReview(req,url,readBody);
    else if(url.pathname==='/proxy/tracking')result=await proxyTracking(url);
    else if(url.pathname==='/proxy/chat')result=await proxyChat(req,url,readBody);
    else if(url.pathname==='/proxy/subscribe')result=await proxySubscribe(req,url,readBody);
    else if(url.pathname==='/proxy/cart-track')result=await proxyCartTrack(req,url,readBody);
    else return send(res,404,{ok:false,message:'Proxy route not found'});
    res.writeHead(result.status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    return res.end(JSON.stringify(result.body));
  }

  if(req.method==='GET'&&url.pathname.startsWith('/review-photo/')){
    const id=Number(url.pathname.split('/').pop()||0);
    const photo=await getReviewPhoto(id);
    if(!photo)return send(res,404,'Not found','text/plain');
    res.writeHead(200,{
      'Content-Type':photo.mime_type,
      'Cache-Control':'public, max-age=86400',
      'X-Content-Type-Options':'nosniff'
    });
    return res.end(photo.image_data);
  }

  if(req.method==='GET'&&url.pathname==='/assets/hotend-hub.js'){
    res.writeHead(200,{
      'Content-Type':'application/javascript; charset=utf-8',
      'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma':'no-cache',
      'Expires':'0'
    });
    return res.end(storefrontScript());
  }

  if(isAdminPath(req,url)&&!validAdminSession(req)){
    const embedded=url.searchParams.get('embedded')==='1'||url.searchParams.has('host');
    if(req.method==='GET'&&embedded){
      const next=url.pathname;
      return send(res,200,embeddedBootstrapPage(next),'text/html');
    }
    const next=encodeURIComponent(url.pathname+url.search);
    res.writeHead(302,{Location:'/auth/shopify?next='+next});
    return res.end();
  }
  if(req.method==='POST'&&url.pathname==='/admin/register-webhooks'){
    try{
      const result=await registerHotendHubWebhooks();
      const message=result.ok
        ? `Shopify webhooks ready: ${result.created} created, ${result.existing} already registered.`
        : `Webhook registration incomplete: ${result.failed.map(x=>x.topic+': '+(x.errors||[]).map(e=>e.message).join(' | ')).join('; ')}`;
      if(!result.ok)console.error('Webhook registration userErrors',JSON.stringify(result.failed));
      res.writeHead(303,{Location:'/setup?message='+encodeURIComponent(message)});return res.end();
    }catch(e){
      console.error('Webhook registration failed:',e.message);
      res.writeHead(303,{Location:'/setup?message='+encodeURIComponent('Webhook registration failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='POST'&&url.pathname==='/admin/install-storefront'){
    try{
      const result=await registerHotendHubStorefront();
      const msg=result.ok?(result.existing?'Hotend Hub storefront is already installed.':'Hotend Hub storefront installed successfully.'):'Storefront install failed.';
      res.writeHead(303,{Location:'/setup?message='+encodeURIComponent(msg)});return res.end();
    }catch(e){
      console.error('Storefront install failed:',e.message);
      res.writeHead(303,{Location:'/setup?message='+encodeURIComponent('Storefront install failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='GET'&&url.pathname==='/health')return send(res,ready?200:503,{ok:ready,app:'Hotend Hub',database:ready?'connected':'not connected',error});
  if(req.method==='GET'&&url.pathname==='/auth/shopify'){
    const {url:authUrl,state,shop}=buildOAuthUrl();
    await (await import('./db.mjs')).q(`INSERT INTO oauth_states(state,shop_domain) VALUES($1,$2) ON CONFLICT(state) DO NOTHING`,[state,shop]);
    const next=String(url.searchParams.get('next')||'/');
    const safeNext=next.startsWith('/')&&!next.startsWith('//')?next:'/';
    res.writeHead(302,{
      Location:authUrl,
      'Set-Cookie':'hotend_hub_next='+encodeURIComponent(safeNext)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'
    });return res.end();
  }
  if(req.method==='GET'&&url.pathname==='/auth/callback'){
    const state=String(url.searchParams.get('state')||'');
    const code=String(url.searchParams.get('code')||'');
    const shop=String(url.searchParams.get('shop')||'');
    if(!state||!code||!shop)return send(res,400,'Missing OAuth parameters','text/plain');
    if(!validOAuthCallback(url))return send(res,401,'Invalid Shopify OAuth signature','text/plain');
    const {q}=await import('./db.mjs');
    const found=(await q(`DELETE FROM oauth_states WHERE state=$1 AND shop_domain=$2 RETURNING state`,[state,shop])).rows[0];
    if(!found)return send(res,401,'Invalid or expired OAuth state','text/plain');
    if(shop!==process.env.SHOPIFY_STORE)return send(res,403,'Unexpected Shopify store','text/plain');
    try{
      await exchangeCode(code);
      const cookies=parseCookies(req);
      let next='/';
      try{
        const candidate=decodeURIComponent(cookies.hotend_hub_next||'');
        if(candidate.startsWith('/')&&!candidate.startsWith('//'))next=candidate;
      }catch{}
      res.writeHead(302,{
        Location:next,
        'Set-Cookie':[
          makeAdminSessionCookie(),
          'hotend_hub_next=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
        ]
      });return res.end();
    }catch(e){
      console.error('Shopify OAuth callback failed:',e.message);
      return send(res,500,'Shopify connection failed: '+e.message,'text/plain');
    }
  }
  if(req.method==='GET'&&url.pathname==='/auth/logout'){
    res.writeHead(302,{
      Location:'/',
      'Set-Cookie':'hotend_hub_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
    });
    return res.end();
  }

  if(req.method==='GET'&&url.pathname==='/unsubscribe'){
    const customerId=String(url.searchParams.get('customer')||'');
    const token=String(url.searchParams.get('token')||'');
    const secret=process.env.APP_SECRET||process.env.SHOPIFY_CLIENT_SECRET||'';
    const expected=secret?crypto.createHmac('sha256',secret).update(customerId).digest('hex'):'';
    let valid=false;
    try{valid=!!expected&&expected.length===token.length&&crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(token));}catch{}
    if(!valid)return send(res,400,'Invalid unsubscribe link','text/plain');
    const {q}=await import('./db.mjs');
    const customer=(await q(`SELECT id,shopify_customer_id,email FROM customers WHERE id=$1 LIMIT 1`,[Number(customerId)])).rows[0];
    if(!customer?.shopify_customer_id)return send(res,404,'Customer not found','text/plain');
    try{
      await setCustomerEmailMarketingState(customer.shopify_customer_id,'UNSUBSCRIBED');
      await q(`UPDATE customers SET marketing_status='UNSUBSCRIBED',updated_at=NOW() WHERE id=$1`,[customer.id]);
      return send(res,200,`<!doctype html><html><body style="font-family:system-ui;background:#fffcf7;color:#172033"><div style="max-width:640px;margin:60px auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px"><h1>Unsubscribed</h1><p>You have been unsubscribed from Hotend marketing emails.</p><p><a href="https://hotend.co.nz">Return to Hotend</a></p></div></body></html>`,'text/html');
    }catch(e){
      return send(res,500,'Unable to unsubscribe: '+e.message,'text/plain');
    }
  }

  if(req.method==='GET'&&url.pathname==='/review/start'){
    const productId=String(url.searchParams.get('product_id')||'');
    const productTitle=String(url.searchParams.get('product_title')||'');
    return send(res,200,renderReviewStartPage({productId,productTitle}),'text/html');
  }

  if(req.method==='POST'&&url.pathname==='/review/start'){
    const raw=(await readBody(req,128*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    const result=await beginVerifiedProductReview(data);
    if(!result.ok){
      return send(res,200,renderReviewStartPage({
        productId:result.productId,
        productTitle:result.productTitle,
        message:result.message
      }),'text/html');
    }
    res.writeHead(303,{Location:'/review?token='+encodeURIComponent(result.token)+'&product_id='+encodeURIComponent(result.productId)});
    return res.end();
  }

  if(req.method==='GET'&&url.pathname==='/review'){
    const token=String(url.searchParams.get('token')||'');
    const productId=String(url.searchParams.get('product_id')||'');
    return send(res,200,await renderReviewForm(token,'',productId),'text/html');
  }

  if(req.method==='POST'&&url.pathname==='/review/submit'){
    const raw=(await readBody(req,256*1024)).toString('utf8');
    const params=new URLSearchParams(raw);
    const data=Object.fromEntries(params.entries());
    const result=await submitReviewForm(data);
    const token=String(data.token||'');
    const productId=String(data.product_id_filter||'');
    return send(res,200,await renderReviewForm(token,result.message,productId),'text/html');
  }

  if(req.method==='GET'&&url.pathname==='/marketing/email-preview'){
    return send(res,200,emailPreviewHtml(url.searchParams.get('type')||'welcome'),'text/html');
  }

  if(req.method==='POST'&&url.pathname==='/marketing/campaign/create'){
    const raw=(await readBody(req,256*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    try{
      await createCampaign(data);
      res.writeHead(303,{Location:'/marketing?message='+encodeURIComponent('Campaign draft created.')});return res.end();
    }catch(e){
      res.writeHead(303,{Location:'/marketing?message='+encodeURIComponent('Campaign create failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='POST'&&url.pathname==='/marketing/campaign/test'){
    const raw=(await readBody(req,64*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    const result=await sendCampaignTest(Number(data.campaign_id),String(data.to||process.env.EMAIL_REPLY_TO||''));
    const msg=result.ok?'Test email sent.':'Test email failed: '+result.error;
    res.writeHead(303,{Location:'/marketing?message='+encodeURIComponent(msg)});return res.end();
  }

  if(req.method==='POST'&&url.pathname==='/marketing/campaign/launch'){
    const raw=(await readBody(req,64*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    try{
      await queueCampaign(Number(data.campaign_id));
      const result=await processCampaignQueue(30);
      res.writeHead(303,{Location:'/marketing?message='+encodeURIComponent(`Campaign queued. ${result.sent} sent immediately, ${result.failed} failed.`)});return res.end();
    }catch(e){
      res.writeHead(303,{Location:'/marketing?message='+encodeURIComponent('Campaign launch failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='GET'&&url.pathname==='/automations/preview.pdf'){
    const key=String(url.searchParams.get('key')||'');
    if(!['welcome-story','abandoned-cart','post-purchase-review','chat-transcript'].includes(key)){
      return send(res,400,'Unknown automation','text/plain');
    }
    try{
      const pdf=await automationEmailPreviewPdf(key);
      res.writeHead(200,{
        'Content-Type':'application/pdf',
        'Content-Disposition':'inline; filename="hotend-'+key+'-preview.pdf"',
        'Cache-Control':'no-store'
      });
      return res.end(pdf);
    }catch(e){
      console.error('Automation PDF preview failed:',e.message);
      return send(res,500,'Unable to build PDF preview: '+e.message,'text/plain');
    }
  }

  if(req.method==='POST'&&url.pathname==='/automations/test-send'){
    const raw=(await readBody(req,256*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    const key=String(data.key||'');
    const to=String(process.env.EMAIL_REPLY_TO||'info@hotend.co.nz').trim();
    try{
      const result=await sendAutomationTestEmail(key,to);
      const msg=result.ok
        ? 'Test email sent to '+to+'.'
        : 'Test email failed: '+String(result.error||result.skipped||'unknown error');
      res.writeHead(303,{Location:'/automations?message='+encodeURIComponent(msg)});
      return res.end();
    }catch(e){
      res.writeHead(303,{Location:'/automations?message='+encodeURIComponent('Test email failed: '+e.message)});
      return res.end();
    }
  }

  if(req.method==='GET'&&url.pathname==='/automations'){
    const rules=await listAutomationRules();
    return send(res,200,await (await import('./ui.mjs')).automationsPage({rules,message:url.searchParams.get('message')||''}),'text/html');
  }

  if(req.method==='POST'&&url.pathname==='/automations/update'){
    const raw=(await readBody(req,64*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    const key=String(data.key||'');
    try{
      const current=await automationRule(key);
      if(!current)throw new Error('Automation rule not found');
      let config={...(current.config||{})};
      if(key==='abandoned-cart'){
        config.delays_days=[
          Math.max(0,Number(data.delay1||1)),
          Math.max(0,Number(data.delay2||5)),
          Math.max(0,Number(data.delay3||10))
        ];
      }else if(key==='post-purchase-review'){
        config.delay_days=Math.max(0,Number(data.delay_days||7));
      }else if(key==='chat-transcript'){
        config.idle_minutes=Math.max(1,Number(data.idle_minutes||10));
      }
      if(Object.prototype.hasOwnProperty.call(data,'email_subject')){
        config.email_subject=String(data.email_subject||'').trim();
      }
      if(Object.prototype.hasOwnProperty.call(data,'email_html')){
        config.email_html=String(data.email_html||'').trim();
      }
      await updateAutomationRule(key,{enabled:String(data.enabled)==='on',config});
      res.writeHead(303,{Location:'/automations?message='+encodeURIComponent('Automation updated.')});return res.end();
    }catch(e){
      res.writeHead(303,{Location:'/automations?message='+encodeURIComponent('Automation update failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='GET'&&url.pathname==='/reviews-admin'){
    const status=String(url.searchParams.get('status')||'all');
    const rating=String(url.searchParams.get('rating')||'');
    const search=String(url.searchParams.get('q')||'');
    const reviews=await listReviews({status,rating,search,limit:400});
    const stats=await reviewStats();
    return send(res,200,await (await import('./ui.mjs')).reviewsAdminPage({reviews,stats,status,rating,search,message:url.searchParams.get('message')||''}),'text/html');
  }

  if(req.method==='POST'&&url.pathname==='/reviews-admin/moderate'){
    const raw=(await readBody(req,64*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    await setReviewApproved(Number(data.id),String(data.approved)==='true');
    const back=String(data.back||'/reviews-admin');
    res.writeHead(303,{Location:back+(back.includes('?')?'&':'?')+'message='+encodeURIComponent(String(data.approved)==='true'?'Review approved.':'Review hidden.')});return res.end();
  }

  if(req.method==='GET'&&url.pathname==='/customers'){
    const search=String(url.searchParams.get('q')||'');
    const customers=await listCustomers({search,limit:300});
    const selectedId=Number(url.searchParams.get('id')||0);
    const selected=selectedId?await getCustomerProfile(selectedId):null;
    const stats=await customerStats();
    return send(res,200,await (await import('./ui.mjs')).customersPage({customers,selected,stats,search,message:url.searchParams.get('message')||''}),'text/html');
  }

  if(req.method==='GET'&&url.pathname==='/tracking-admin'){
    const shipments=await listShipments(300);
    const selectedId=Number(url.searchParams.get('id')||0);
    const selected=selectedId?await getShipment(selectedId):null;
    const stats=await trackingStats();
    const carrierConfig=carrierConfigStatus();
    return send(res,200,await (await import('./ui.mjs')).trackingAdminPage({shipments,selected,stats,carrierConfig,message:url.searchParams.get('message')||''}),'text/html');
  }

  if(req.method==='GET'&&url.pathname==='/track'){
    const order=String(url.searchParams.get('order')||'');
    const email=String(url.searchParams.get('email')||'');
    const phone=String(url.searchParams.get('phone')||'');
    const searched=!!(order&&(email||phone));
    const shipment=searched?await findPublicShipment({order,email,phone}):null;
    return send(res,200,await (await import('./ui.mjs')).publicTrackingPage({shipment,searched,order,email,phone}),'text/html');
  }

  if(req.method==='GET'&&url.pathname==='/chat-settings'){
    const settings=await getChatSettings();
    const integration=chatIntegrationStatus(settings);
    return send(res,200,await (await import('./ui.mjs')).chatSettingsPage({settings,integration,message:url.searchParams.get('message')||''}),'text/html');
  }

  if(req.method==='POST'&&url.pathname==='/chat-settings/update'){
    const raw=(await readBody(req,64*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    try{
      await updateChatSettings(data);
      res.writeHead(303,{Location:'/chat-settings?message='+encodeURIComponent('Chat settings updated.')});return res.end();
    }catch(e){
      res.writeHead(303,{Location:'/chat-settings?message='+encodeURIComponent('Chat settings update failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='POST'&&url.pathname==='/chats/ai-draft'){
    const raw=(await readBody(req,64*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    const id=Number(data.id);
    try{
      const result=await generateAiReply(id,{forceDraft:true});
      const msg=result.ok?'AI draft generated.':(result.escalate?'Conversation marked for human follow-up.':'AI draft unavailable: '+(result.error||result.skipped||'unknown'));
      res.writeHead(303,{Location:'/chats?id='+encodeURIComponent(id)+'&message='+encodeURIComponent(msg)});return res.end();
    }catch(e){
      res.writeHead(303,{Location:'/chats?id='+encodeURIComponent(id)+'&message='+encodeURIComponent('AI draft failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='POST'&&url.pathname==='/chats/summary'){
    const raw=(await readBody(req,64*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    const id=Number(data.id);
    try{
      const result=await saveAiSummary(id);
      const msg=result.ok?'AI summary updated.':'AI summary unavailable: '+(result.error||result.skipped||'unknown');
      res.writeHead(303,{Location:'/chats?id='+encodeURIComponent(id)+'&message='+encodeURIComponent(msg)});return res.end();
    }catch(e){
      res.writeHead(303,{Location:'/chats?id='+encodeURIComponent(id)+'&message='+encodeURIComponent('AI summary failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='GET'&&url.pathname==='/chats'){
    const sessions=await listChatSessions(200);
    const selectedId=Number(url.searchParams.get('id')||0);
    const selected=selectedId?await getChatSession(selectedId):null;
    return send(res,200,await (await import('./ui.mjs')).chatsPage({sessions,selected,message:url.searchParams.get('message')||''}),'text/html');
  }

  if(req.method==='POST'&&url.pathname==='/chats/reply'){
    const raw=(await readBody(req,64*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    try{
      await replyToChat(Number(data.id),String(data.message||''));
      res.writeHead(303,{Location:'/chats?id='+encodeURIComponent(data.id)+'&message='+encodeURIComponent('Reply added.')});return res.end();
    }catch(e){
      res.writeHead(303,{Location:'/chats?id='+encodeURIComponent(data.id||'')+'&message='+encodeURIComponent('Reply failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='POST'&&url.pathname==='/chats/status'){
    const raw=(await readBody(req,64*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    await setChatClosed(Number(data.id),String(data.closed)==='true');
    res.writeHead(303,{Location:'/chats?id='+encodeURIComponent(data.id)+'&message='+encodeURIComponent(String(data.closed)==='true'?'Conversation closed.':'Conversation reopened.')});return res.end();
  }

  if(req.method==='GET'&&url.pathname==='/popups'){
    const popups=await listPopups();
    return send(res,200,await (await import('./ui.mjs')).popupsPage({popups,message:url.searchParams.get('message')||''}),'text/html');
  }


  if(req.method==='POST'&&url.pathname==='/popups/update'){
    const raw=(await readBody(req,256*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    try{
      await updatePopup(Number(data.id),data);
      res.writeHead(303,{Location:'/popups?message='+encodeURIComponent('Popup updated.')});return res.end();
    }catch(e){
      res.writeHead(303,{Location:'/popups?message='+encodeURIComponent('Popup update failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='POST'&&url.pathname==='/popups/toggle'){
    const raw=(await readBody(req,64*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    await togglePopup(Number(data.id),String(data.enabled)==='true');
    res.writeHead(303,{Location:'/popups?message='+encodeURIComponent('Popup status updated.')});return res.end();
  }

  if(req.method==='POST'&&url.pathname==='/popups/delete'){
    const raw=(await readBody(req,64*1024)).toString('utf8');
    const data=Object.fromEntries(new URLSearchParams(raw).entries());
    await deletePopup(Number(data.id));
    res.writeHead(303,{Location:'/popups?message='+encodeURIComponent('Popup deleted.')});return res.end();
  }

  if(req.method==='GET'&&url.pathname==='/marketing'){
    const emailConfig=emailConfigStatus();
    const recentDeliveries=await recentEmailDeliveries(100);
    return send(res,200,await marketingPage({emailConfig,recentDeliveries,message:url.searchParams.get('message')||''}),'text/html');
  }

  if(req.method==='GET'&&url.pathname==='/setup'){
    const status={
      database:ready,
      shopifyStore:!!process.env.SHOPIFY_STORE,
      shopifyClientId:!!process.env.SHOPIFY_CLIENT_ID,
      shopifyClientSecret:!!process.env.SHOPIFY_CLIENT_SECRET
    };
    let shopify=null,grantedScopes=[];
    if(status.shopifyStore&&status.shopifyClientId&&status.shopifyClientSecret){
      try{
        shopify=await testShopify();
        grantedScopes=await getGrantedAccessScopes();
      }catch(e){shopify={error:e.message};}
    }
    return send(res,200,setupPage({status,shopify,grantedScopes,message:url.searchParams.get('message')||''}),'text/html');
  }
  if(req.method==='POST'&&url.pathname==='/admin/register-nzpost-watches'){
    try{
      const result=await registerMissingNzPostWatches(200);
      const msg=result.skipped?'NZ Post tracking API key is not configured.':`NZ Post watches: ${result.registered} registered, ${result.failed} failed.`;
      res.writeHead(303,{Location:'/tracking-admin?message='+encodeURIComponent(msg)});return res.end();
    }catch(e){
      res.writeHead(303,{Location:'/tracking-admin?message='+encodeURIComponent('NZ Post watch registration failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='POST'&&url.pathname==='/admin/sync-tracking'){
    try{
      const stats=await syncShopifyCore();
      console.log('Shopify tracking sync complete',stats);
      res.writeHead(303,{Location:'/tracking-admin?message='+encodeURIComponent(`Tracking sync complete: ${stats.orders} orders refreshed.`)});return res.end();
    }catch(e){
      console.error('Tracking sync failed:',e.message);
      res.writeHead(303,{Location:'/tracking-admin?message='+encodeURIComponent('Tracking sync failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='POST'&&url.pathname==='/admin/sync-abandoned'){
    try{
      const sync=await syncAbandonedCheckouts();
      const processed=await processDueAbandonedEmails(100);
      const msg=`Abandoned checkout sync complete: ${sync.checkouts} checkouts, ${sync.scheduled} steps scheduled, ${sync.recovered} recovered; ${processed.sent} emails sent, ${processed.skipped} skipped.`;
      res.writeHead(303,{Location:'/marketing?message='+encodeURIComponent(msg)});return res.end();
    }catch(e){
      console.error('Abandoned checkout sync failed:',e.message);
      res.writeHead(303,{Location:'/marketing?message='+encodeURIComponent('Abandoned checkout sync failed: '+e.message)});return res.end();
    }
  }

  if(req.method==='POST'&&url.pathname==='/admin/sync-shopify'){
    try{
      const stats=await syncShopifyCore();
      console.log('Shopify core sync complete',stats);
      res.writeHead(303,{Location:'/setup?message='+encodeURIComponent(`Shopify sync complete: ${stats.customers} customers, ${stats.orders} orders, ${stats.items} items.`)});
      return res.end();
    }catch(e){
      console.error('Shopify core sync failed:',e.message);
      res.writeHead(303,{Location:'/setup?message='+encodeURIComponent('Shopify sync failed: '+e.message)});
      return res.end();
    }
  }
  if(req.method==='GET'&&url.pathname==='/'){
    if(!ready)return send(res,200,`<!doctype html><html><body style="font-family:system-ui;padding:30px"><h1>Hotend Hub</h1><p>Clean setup is ready for database connection.</p><p>Missing/failed: ${String(error||'DATABASE_URL')}</p></body></html>`,'text/html');
    return send(res,200,await dashboard(),'text/html');
  }
  return send(res,404,{message:'Not found'});
}).listen(port,'0.0.0.0',()=>console.log('Hotend Hub listening on',port));
