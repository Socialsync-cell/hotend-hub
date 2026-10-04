import crypto from 'node:crypto';
import {q} from './db.mjs';

function required(name){
  const value=process.env[name];
  if(!value)throw new Error(name+'_MISSING');
  return value;
}

function shopDomain(){
  return required('SHOPIFY_STORE');
}

export async function getStoredAccessToken(){
  const shop=shopDomain();
  const row=(await q(`SELECT access_token,refresh_token,expires_at FROM shopify_installations WHERE shop_domain=$1 LIMIT 1`,[shop])).rows[0];
  if(!row?.access_token)throw new Error('SHOPIFY_NOT_CONNECTED');
  return row.access_token;
}

export function buildOAuthUrl(){
  const shop=shopDomain();
  const clientId=required('SHOPIFY_CLIENT_ID');
  const base=String(process.env.PUBLIC_BASE_URL||'https://hotend-hub.onrender.com').replace(/\/$/,'');
  const redirectUri=base+'/auth/callback';
  const scopes='write_customers,read_orders,read_products,write_script_tags,write_app_proxy';
  const state=crypto.randomBytes(24).toString('hex');
  return {url:`https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`,state,shop};
}

export function validOAuthCallback(url){
  const secret=required('SHOPIFY_CLIENT_SECRET');
  const hmac=String(url.searchParams.get('hmac')||'');
  const pairs=[...url.searchParams.entries()]
    .filter(([k])=>k!=='hmac'&&k!=='signature')
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>`${k}=${v}`)
    .join('&');
  const digest=crypto.createHmac('sha256',secret).update(pairs).digest('hex');
  if(hmac.length!==digest.length)return false;
  try{return crypto.timingSafeEqual(Buffer.from(hmac,'utf8'),Buffer.from(digest,'utf8'));}catch{return false;}
}

export async function exchangeCode(code){
  const shop=shopDomain();
  const r=await fetch(`https://${shop}/admin/oauth/access_token`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      client_id:required('SHOPIFY_CLIENT_ID'),
      client_secret:required('SHOPIFY_CLIENT_SECRET'),
      code
    })
  });
  const text=await r.text();
  if(!r.ok)throw new Error('SHOPIFY_OAUTH_EXCHANGE_FAILED: '+text.slice(0,500));
  const data=JSON.parse(text);
  const expiresAt=data.expires_in?new Date(Date.now()+Number(data.expires_in)*1000):null;
  await q(`INSERT INTO shopify_installations(shop_domain,access_token,scope,refresh_token,expires_at,updated_at)
    VALUES($1,$2,$3,$4,$5,NOW())
    ON CONFLICT(shop_domain) DO UPDATE SET access_token=EXCLUDED.access_token,scope=EXCLUDED.scope,refresh_token=EXCLUDED.refresh_token,expires_at=EXCLUDED.expires_at,updated_at=NOW()`,[
      shop,data.access_token,data.scope||null,data.refresh_token||null,expiresAt
    ]);
  return data;
}

export async function gql(query,variables={}){
  const store=shopDomain();
  const version=process.env.SHOPIFY_API_VERSION||'2026-10';
  const token=await getStoredAccessToken();
  const r=await fetch(`https://${store}/admin/api/${version}/graphql.json`,{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},
    body:JSON.stringify({query,variables})
  });
  const text=await r.text();
  if(!r.ok)throw new Error('SHOPIFY_GRAPHQL_HTTP_'+r.status+': '+text.slice(0,500));
  const data=JSON.parse(text);
  if(data.errors?.length)throw new Error('SHOPIFY_GRAPHQL_ERROR: '+data.errors.map(x=>x.message).join('; '));
  return data.data;
}

export async function testShopify(){
  const data=await gql(`query{shop{name myshopifyDomain}}`);
  return data.shop;
}

export async function* customerPages(){
  let after=null;
  do{
    const data=await gql(`query Customers($after:String){
      customers(first:100,after:$after,sortKey:UPDATED_AT){
        pageInfo{hasNextPage endCursor}
        nodes{
          id firstName lastName tags numberOfOrders amountSpent{amount currencyCode}
          defaultEmailAddress{emailAddress marketingState marketingOptInLevel marketingUpdatedAt validFormat}
          defaultPhoneNumber{phoneNumber}
        }
      }
    }`,{after});
    yield data.customers.nodes||[];
    after=data.customers.pageInfo.hasNextPage?data.customers.pageInfo.endCursor:null;
  }while(after);
}

export async function* orderPages(){
  let after=null;
  do{
    const data=await gql(`query Orders($after:String){
      orders(first:50,after:$after,sortKey:CREATED_AT,reverse:true){
        pageInfo{hasNextPage endCursor}
        nodes{
          id name createdAt email displayFinancialStatus displayFulfillmentStatus
          currentTotalPriceSet{shopMoney{amount currencyCode}}
          customer{id}
          shippingAddress{phone}
          billingAddress{phone}
          shippingLine{title code phone}
          lineItems(first:100){
            nodes{
              id name title variantTitle sku quantity
              product{id featuredImage{url altText}}
              variant{id image{url altText}}
            }
          }
          fulfillments(first:20){
            id status updatedAt
            trackingInfo(first:20){company number url}
          }
        }
      }
    }`,{after});
    yield data.orders.nodes||[];
    after=data.orders.pageInfo.hasNextPage?data.orders.pageInfo.endCursor:null;
  }while(after);
}


export async function registerHotendHubStorefront(){
  // The live Hotend theme loads /assets/hotend-hub.js directly.
  // Do not create a second Shopify ScriptTag: duplicate loaders cause flicker.
  const cleanup=await cleanupHotendHubScriptTags();
  const base=String(process.env.PUBLIC_BASE_URL||'https://hotend-hub.onrender.com').replace(/\/$/,'');
  return {
    ok:true,
    existing:true,
    mode:'theme_include',
    src:base+'/assets/hotend-hub.js',
    cleanup
  };
}

export async function cleanupHotendHubScriptTags(){
  const base=String(process.env.PUBLIC_BASE_URL||'https://hotend-hub.onrender.com').replace(/\/$/,'');
  let existing=[];
  try{
    existing=(await gql(`query{scriptTags(first:100){nodes{id src}}}`)).scriptTags?.nodes||[];
  }catch(e){
    return {ok:false,skipped:'script_tag_list_unavailable',error:e.message};
  }

  const stale=existing.filter(x=>String(x.src||'').startsWith(base+'/assets/hotend-hub.js'));
  let deleted=0,failed=0;
  for(const tag of stale){
    try{
      const data=await gql(`mutation RemoveScript($id:ID!){
        scriptTagDelete(id:$id){deletedScriptTagId userErrors{field message}}
      }`,{id:tag.id});
      if(data.scriptTagDelete?.userErrors?.length)failed++;
      else deleted++;
    }catch(e){
      failed++;
      console.error('Hotend Hub ScriptTag cleanup failed',{id:tag.id,error:e.message});
    }
  }
  return {ok:failed===0,found:stale.length,deleted,failed};
}


export async function registerHotendHubWebhooks(){
  const base=String(process.env.PUBLIC_BASE_URL||'https://hotend-hub.onrender.com').replace(/\/$/,'');
  const uri=base+'/webhooks/shopify';
  const desired=[
    'APP_UNINSTALLED',
    'CUSTOMERS_CREATE',
    'CUSTOMERS_UPDATE',
    'ORDERS_CREATE',
    'ORDERS_UPDATED',
    'ORDERS_FULFILLED',
    'ORDERS_PARTIALLY_FULFILLED',
    'CHECKOUTS_CREATE',
    'CHECKOUTS_UPDATE'
  ];

  const existingData=await gql(`query{
    webhookSubscriptions(first:100){
      nodes{id topic uri}
    }
  }`);
  const existing=existingData.webhookSubscriptions?.nodes||[];
  const results=[];

  for(const topic of desired){
    const same=existing.find(x=>x.topic===topic&&String(x.uri)===uri);
    if(same){
      results.push({topic,ok:true,existing:true,id:same.id});
      continue;
    }
    const data=await gql(`mutation CreateWebhook($topic:WebhookSubscriptionTopic!,$webhookSubscription:WebhookSubscriptionInput!){
      webhookSubscriptionCreate(topic:$topic,webhookSubscription:$webhookSubscription){
        webhookSubscription{id topic uri}
        userErrors{field message}
      }
    }`,{topic,webhookSubscription:{uri,format:'JSON'}});
    const result=data.webhookSubscriptionCreate;
    if(result.userErrors?.length){
      results.push({topic,ok:false,errors:result.userErrors});
    }else{
      results.push({topic,ok:true,existing:false,id:result.webhookSubscription?.id});
    }
  }

  return {
    ok:results.every(x=>x.ok),
    uri,
    created:results.filter(x=>x.ok&&!x.existing).length,
    existing:results.filter(x=>x.ok&&x.existing).length,
    failed:results.filter(x=>!x.ok),
    results
  };
}


export async function getGrantedAccessScopes(){
  const data=await gql(`query{
    currentAppInstallation{
      accessScopes{handle}
    }
  }`);
  return (data.currentAppInstallation?.accessScopes||[]).map(x=>x.handle).filter(Boolean).sort();
}


export async function* abandonedCheckoutPages(){
  let after=null;
  do{
    const data=await gql(`query Abandoned($after:String){
      abandonedCheckouts(first:50,after:$after,reverse:true){
        pageInfo{hasNextPage endCursor}
        nodes{
          id abandonedCheckoutUrl completedAt createdAt updatedAt
          customer{id firstName lastName email}
          totalPriceSet{shopMoney{amount currencyCode}}
          lineItems(first:100){
            nodes{
              id title variantTitle sku quantity
              product{id featuredImage{url altText}}
              variant{id image{url altText}}
              originalUnitPriceSet{shopMoney{amount currencyCode}}
            }
          }
        }
      }
    }`,{after});
    yield data.abandonedCheckouts.nodes||[];
    after=data.abandonedCheckouts.pageInfo.hasNextPage?data.abandonedCheckouts.pageInfo.endCursor:null;
  }while(after);
}


export async function setCustomerEmailMarketingState(customerId,marketingState){
  const data=await gql(`mutation UpdateEmailConsent($input:CustomerEmailMarketingConsentUpdateInput!){
    customerEmailMarketingConsentUpdate(input:$input){
      customer{id}
      userErrors{field message}
    }
  }`,{input:{
    customerId,
    emailMarketingConsent:{
      marketingState,
      marketingOptInLevel:'SINGLE_OPT_IN',
      consentUpdatedAt:new Date().toISOString()
    }
  }});
  const result=data.customerEmailMarketingConsentUpdate;
  if(result.userErrors?.length)throw new Error('SHOPIFY_MARKETING_CONSENT_ERROR: '+result.userErrors.map(x=>x.message).join('; '));
  return result.customer;
}


export async function subscribeMarketingCustomer({email,firstName='',lastName=''}) {
  const normalized=String(email||'').trim().toLowerCase();
  if(!normalized)throw new Error('EMAIL_REQUIRED');

  const found=await gql(`query FindCustomer($q:String!){
    customers(first:1,query:$q){
      nodes{id firstName lastName defaultEmailAddress{emailAddress marketingState marketingOptInLevel}}
    }
  }`,{q:`email:${normalized}`});

  let customer=found.customers?.nodes?.[0]||null;
  if(!customer){
    const created=await gql(`mutation CreateCustomer($input:CustomerInput!){
      customerCreate(input:$input){
        customer{id firstName lastName defaultEmailAddress{emailAddress marketingState marketingOptInLevel}}
        userErrors{field message}
      }
    }`,{input:{
      email:normalized,
      firstName:String(firstName||'').trim()||null,
      lastName:String(lastName||'').trim()||null,
      emailMarketingConsent:{
        marketingState:'SUBSCRIBED',
        marketingOptInLevel:'SINGLE_OPT_IN',
        consentUpdatedAt:new Date().toISOString()
      }
    }});
    if(created.customerCreate?.userErrors?.length){
      throw new Error('SHOPIFY_CUSTOMER_CREATE_ERROR: '+created.customerCreate.userErrors.map(x=>x.message).join('; '));
    }
    customer=created.customerCreate?.customer||null;
  }else{
    const updateInput={id:customer.id};
    if(String(firstName||'').trim())updateInput.firstName=String(firstName).trim();
    if(String(lastName||'').trim())updateInput.lastName=String(lastName).trim();
    if(Object.keys(updateInput).length>1){
      const updated=await gql(`mutation UpdateCustomer($input:CustomerInput!){
        customerUpdate(input:$input){customer{id} userErrors{field message}}
      }`,{input:updateInput});
      if(updated.customerUpdate?.userErrors?.length){
        throw new Error('SHOPIFY_CUSTOMER_UPDATE_ERROR: '+updated.customerUpdate.userErrors.map(x=>x.message).join('; '));
      }
    }
    await setCustomerEmailMarketingState(customer.id,'SUBSCRIBED');
  }

  return customer;
}



const INVENTORY_SYNONYMS={
  'pla+':['pla plus','pla+','pla pro','pla enhanced'],
  'pla':['polylactic','filament'],
  'petg':['pet-g','pet g'],
  'abs':['acrylonitrile','filament'],
  'asa':['weather resistant','outdoor filament'],
  'tpu':['flexible','flex','rubber','soft filament'],
  'cf':['carbon','carbon fibre','carbon fiber'],
  'silk':['shiny','glossy','metallic look'],
  'matte':['matt','flat finish'],
  'transparent':['clear','see through','translucent'],
  'translucent':['transparent','semi transparent','see through'],
  'rainbow':['multicolour','multi colour','multicolor','gradient'],
  'wood':['wooden','wood look'],
  'gold':['golden'],
  'silver':['grey metallic','gray metallic'],
  'vacuum':['vacuum bag','storage bag','seal bag','filament storage'],
  'bag':['pouch','storage bag','vacuum bag'],
  'dryer':['filament dryer','dry box','drybox','dehydrator'],
  'desiccant':['silica gel','moisture absorber'],
  'nozzle':['hotend nozzle','printer nozzle'],
  'glue':['adhesive','glue stick','bed adhesive'],
  'build plate':['bed plate','print bed','build surface'],
  'spool':['reel','filament roll']
};

let inventoryCatalogCache={at:0,items:[]};

function normaliseInventoryText(v){
  return String(v||'').toLowerCase()
    .replace(/[\u2010-\u2015]/g,'-')
    .replace(/[^a-z0-9+\- ]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function expandInventoryTerms(text){
  const base=normaliseInventoryText(text);
  const stop=new Set(['do','you','have','is','are','there','any','stock','stocks','available','availability','in','the','a','an','of','for','please','show','me','got','need','want','buy','purchase','price','cost','how','much','can','i','get','looking']);
  const raw=base.split(/\s+/).filter(Boolean).filter(x=>!stop.has(x)).slice(0,12);
  const expanded=new Set(raw);
  for(const [key,values] of Object.entries(INVENTORY_SYNONYMS)){
    if(base.includes(key)||values.some(v=>base.includes(v))){
      expanded.add(key);
      values.forEach(v=>normaliseInventoryText(v).split(/\s+/).forEach(t=>expanded.add(t)));
    }
  }
  return [...expanded].filter(Boolean).slice(0,24);
}

function levenshtein(a,b){
  a=String(a||''); b=String(b||'');
  if(a===b)return 0;
  if(!a.length)return b.length;
  if(!b.length)return a.length;
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let prev=row[0]; row[0]=i;
    for(let j=1;j<=b.length;j++){
      const tmp=row[j];
      row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
      prev=tmp;
    }
  }
  return row[b.length];
}

function inventoryScore(haystack,terms){
  const h=normaliseInventoryText(haystack);
  const words=h.split(/\s+/).filter(Boolean);
  let score=0;
  for(const t0 of terms){
    const t=normaliseInventoryText(t0);
    if(!t)continue;
    if(h===t)score+=14;
    else if(h.includes(t))score+=8;
    else if(words.some(w=>w===t))score+=7;
    else if(words.some(w=>w.startsWith(t)||t.startsWith(w)))score+=4;
    else if(t.length>=4&&words.some(w=>Math.abs(w.length-t.length)<=2&&levenshtein(w,t)<=2))score+=3;
  }
  return score;
}

async function fullInventoryCatalog(){
  if(inventoryCatalogCache.items.length&&Date.now()-inventoryCatalogCache.at<120000){
    return inventoryCatalogCache.items;
  }

  const items=[];
  let after=null;
  for(let page=0;page<10;page++){
    const data=await gql(
      'query FullHotendInventory($after:String){ products(first:100,after:$after,query:"status:active",sortKey:TITLE){ pageInfo{hasNextPage endCursor} nodes{ id title handle status productType tags featuredImage{url} variants(first:100){ nodes{ id title sku inventoryQuantity availableForSale price image{url} selectedOptions{name value} } } } } }',
      {after}
    );

    const conn=data.products||{};
    for(const p of conn.nodes||[]){
      for(const v of p.variants?.nodes||[]){
        const options=(v.selectedOptions||[]).map(o=>String(o.name||'')+' '+String(o.value||'')).join(' ');
        items.push({
          product:p.title,
          variant:v.title,
          sku:v.sku||null,
          inventory:Number(v.inventoryQuantity||0),
          available:!!v.availableForSale,
          price:String(v.price||''),
          url:'https://hotend.co.nz/products/'+p.handle,
          image_url:v.image?.url||p.featuredImage?.url||null,
          searchable:[p.title,p.productType,(p.tags||[]).join(' '),v.title,v.sku,options].filter(Boolean).join(' ')
        });
      }
    }
    if(!conn.pageInfo?.hasNextPage)break;
    after=conn.pageInfo.endCursor;
    if(!after)break;
  }

  inventoryCatalogCache={at:Date.now(),items};
  return items;
}

export async function searchLiveInventory(text,{limit=12}={}){
  const terms=expandInventoryTerms(text);
  if(!terms.length)return [];

  let catalog=[];
  try{
    catalog=await fullInventoryCatalog();
  }catch(e){
    console.error('Shopify full inventory search failed:',e.message);
    return [];
  }

  const matches=[];
  for(const item of catalog){
    const score=inventoryScore(item.searchable,terms);
    if(score<=0)continue;
    matches.push({...item,score});
  }

  const wanted=Math.max(1,Math.min(40,Number(limit)||12));
  return matches
    .sort((a,b)=>b.score-a.score||Number(b.available)-Number(a.available)||b.inventory-a.inventory||a.product.localeCompare(b.product))
    .slice(0,wanted)
    .map(({score,searchable,...x})=>x);
}

