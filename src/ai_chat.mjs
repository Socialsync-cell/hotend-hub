import {q} from './db.mjs';
import {sendStaffEscalation,sendStaffChatMessage} from './whatsapp.mjs';
import {searchLiveInventory} from './shopify.mjs';

function clean(v){return String(v??'').trim();}

export async function getChatSettings(){
  return (await q(`SELECT * FROM chat_settings WHERE id=1 LIMIT 1`)).rows[0];
}

export async function updateChatSettings(data){
  const aiMode=['OFF','DRAFT','AUTO'].includes(String(data.ai_mode||'').toUpperCase())
    ?String(data.ai_mode).toUpperCase():'DRAFT';
  const model=clean(data.ai_model)||'gpt-6.1-sol';
  const maxTokens=Math.max(100,Math.min(1200,Number(data.ai_max_output_tokens)||350));
  const whatsappEnabled=String(data.whatsapp_enabled||'')==='on';
  const whatsappStaffPhone=clean(data.whatsapp_staff_phone||data.whatsapp_phone)||null;
  const whatsappTemplateName=clean(data.whatsapp_template_name)||null;
  const whatsappTemplateLanguage=clean(data.whatsapp_template_language)||'en';
  const humanText=clean(data.human_handoff_text)||'I’ll pass this to the Hotend team.';
  return (await q(`UPDATE chat_settings SET
    ai_mode=$1,ai_model=$2,ai_max_output_tokens=$3,whatsapp_enabled=$4,
    whatsapp_staff_phone=$5,whatsapp_template_name=$6,whatsapp_template_language=$7,
    human_handoff_text=$8,updated_at=NOW()
    WHERE id=1 RETURNING *`,[
      aiMode,model,maxTokens,whatsappEnabled,whatsappStaffPhone,whatsappTemplateName,whatsappTemplateLanguage,humanText
    ])).rows[0];
}

export function chatIntegrationStatus(settings){
  return {
    openai:!!process.env.OPENAI_API_KEY,
    whatsappCloud:!!(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID&&process.env.WHATSAPP_VERIFY_TOKEN),
    whatsappHandoff:!!(settings?.whatsapp_enabled&&(settings?.whatsapp_staff_phone||settings?.whatsapp_phone))
  };
}

function responseText(data){
  if(typeof data?.output_text==='string'&&data.output_text.trim())return data.output_text.trim();
  const out=[];
  for(const item of data?.output||[]){
    if(item?.type==='message'){
      for(const part of item.content||[]){
        if(part?.type==='output_text'&&part.text)out.push(part.text);
        else if(typeof part?.text==='string')out.push(part.text);
      }
    }
  }
  return out.join('\n').trim();
}

function needsInventoryLookup(text){
  const s=String(text||'').toLowerCase();
  if(!s)return false;
  if(/\b(stock|available|availability|in stock|out of stock|have you got|do you have|price|cost|buy|purchase|need|looking for|sell|carry|product|link|spool|filament|pla|petg|abs|asa|tpu|silk|matte|rainbow|macaron|cf|carbon|colour|color|sku|vacuum|bag|storage|dryer|dry box|desiccant|nozzle|glue|adhesive|build plate|cleaner|accessory|accessories)\b/.test(s))return true;
  return false;
}

function escalationIntent(text){
  const s=String(text||'').toLowerCase();
  return /\b(human|person|staff|manager|owner|call me|complaint|refund|chargeback|legal|urgent|angry|cancel order)\b/.test(s);
}

function recentAssistantAskedForHuman(messages){
  const recent=[...messages].reverse().slice(0,6);
  return recent.some(m=>
    (m.sender==='AI'||m.sender==='SYSTEM') &&
    /\b(hotend team|team member|human|staff|confirm it|confirm whether|pass this)\b/i.test(String(m.message||''))
  );
}

function confirmationIntent(text){
  const s=String(text||'').trim().toLowerCase();
  return /^(yes|yes please|yep|yeah|ok|okay|sure|please|do it|go ahead|go on|that works|sounds good)[.!]*$/.test(s);
}

function inventorySearchText(messages,latestText){
  const latest=String(latestText||'').trim();
  if(!latest)return latest;

  const customers=[...messages].filter(m=>m.sender==='CUSTOMER');
  const previous=[...customers].reverse().find(m=>String(m.message||'').trim()!==latest);
  const previousText=String(previous?.message||'').trim();

  const lower=latest.toLowerCase().replace(/[?!.]/g,'').trim();
  const colour=lower.replace(/^and\s+/,'').replace(/^what about\s+/,'').replace(/^how about\s+/,'');
  const colours=['black','white','red','blue','green','yellow','orange','purple','pink','grey','gray','gold','silver','brown','beige','natural','clear','transparent'];

  if(colours.includes(colour)&&previousText){
    const materialMatch=previousText.match(/\b(pla\+?|petg|abs|asa|tpu|pc|nylon|hips)\b/i);
    if(materialMatch)return materialMatch[1]+' '+colour+' stock';
  }

  const short=latest.split(/\s+/).length<=2;
  if(!short)return latest;

  const recentCustomer=[...customers]
    .reverse()
    .slice(0,4)
    .reverse()
    .map(m=>m.message)
    .join(' ');

  return (recentCustomer+' '+latest).slice(-600);
}

async function buildContext(sessionId){
  const session=(await q(`SELECT s.id,s.reference,s.customer_id,s.ai_summary,c.first_name,c.email
    FROM chat_sessions s LEFT JOIN customers c ON c.id=s.customer_id
    WHERE s.id=$1 LIMIT 1`,[Number(sessionId)])).rows[0];
  if(!session)return null;

  const messages=(await q(`SELECT id,sender,message,created_at
    FROM chat_messages WHERE session_id=$1 ORDER BY id DESC LIMIT 30`,[session.id])).rows.reverse();

  const orders=session.customer_id?(await q(`SELECT o.id,o.order_name,o.total_price,o.currency,o.financial_status,o.fulfillment_status,o.created_at_shopify,
      COALESCE(json_agg(json_build_object('carrier',s.carrier,'tracking_number',s.tracking_number,'status',s.status,'last_event_at',s.last_event_at))
        FILTER (WHERE s.id IS NOT NULL),'[]'::json) shipments
    FROM orders o
    LEFT JOIN shipments s ON s.order_id=o.id
    WHERE o.customer_id=$1
    GROUP BY o.id
    ORDER BY o.created_at_shopify DESC
    LIMIT 5`,[session.customer_id])).rows:[];

  return {session,messages,orders};
}

export async function generateAiReply(sessionId,{forceDraft=false,expectedCustomerMessageId=null}={}){
  const aiStartedAt=Date.now();
  const settings=await getChatSettings();
  if(!settings||settings.ai_mode==='OFF')return {ok:false,skipped:'ai_off'};
  if(!process.env.OPENAI_API_KEY)return {ok:false,skipped:'openai_key_missing'};

  const ctx=await buildContext(sessionId);
  if(!ctx)return {ok:false,skipped:'chat_not_found'};
  const latest=[...ctx.messages].reverse().find(m=>m.sender==='CUSTOMER');
  if(!latest)return {ok:false,skipped:'no_customer_message'};
  if(expectedCustomerMessageId&&Number(latest.id)!==Number(expectedCustomerMessageId)){
    return {ok:false,skipped:'stale_customer_message'};
  }

  if(escalationIntent(latest.message) || (confirmationIntent(latest.message)&&recentAssistantAskedForHuman(ctx.messages))){
    await q(`UPDATE chat_sessions SET needs_human=TRUE WHERE id=$1`,[sessionId]);
    let whatsapp=null;
    try{whatsapp=await sendStaffEscalation(sessionId);}catch(e){whatsapp={ok:false,error:e.message};}
    return {ok:false,escalate:true,reply:settings.human_handoff_text,whatsapp};
  }

  const orderContext=ctx.orders.length?JSON.stringify(ctx.orders):'No linked Shopify orders.';
  const inventoryQuery=inventorySearchText(ctx.messages,latest.message);
  let inventoryContext='No live stock lookup was needed for this message.';
  if(needsInventoryLookup(inventoryQuery)){
    try{
      const matches=await searchLiveInventory(inventoryQuery,{limit:30});
      inventoryContext=matches.length
        ? JSON.stringify(matches)
        : 'Live Shopify stock search returned no close product or variant matches.';
    }catch(e){
      inventoryContext='Live Shopify stock lookup failed; do not guess availability.';
      console.error('AI live inventory lookup failed:',e.message);
    }
  }
  const history=ctx.messages.map(m=>`${m.sender}: ${m.message}`).join('\n');

  const instructions=`You are Hotend Filament Supplies customer support for a New Zealand 3D-printing filament store.
Be concise, friendly, commercially useful and conversational.
Reason over the whole recent conversation, not just the last message.
Interpret short follow-ups such as "yes", "and", "stock", "price", "do it", "that one", "need to buy" using the immediately preceding turns.
Never repeat the same clarification question twice. If the customer gives an ambiguous "yes" to a question with two options, ask one sharper either/or question naming those options.
When the customer is clearly shopping, actively use the verified live product/stock context and give the closest useful product matches, price, quantity and link when available.
If the customer asks for an item that is not filament (for example vacuum bags, dryers, nozzles, build-plate accessories or storage products), treat it as a product search too.
If the previous Hotend reply said a team member needs to confirm something and the customer replies "do it", "yes please", "okay", "go ahead" or similar, respond with exactly: HUMAN_HANDOFF.
Do not greet the customer again if a greeting already exists in the conversation.
Do not repeat generic phrases such as "How can I help you?" when the customer has already stated a topic.
If a message is genuinely unclear, ask one short specific clarification question based on the conversation.
Use only verified context supplied by the application for order status, tracking, payment, customer data, prices, stock, discounts, delivery promises and policies.
Never invent stock, prices, coupon validity, courier scans, refunds, order status, delivery times or company policies.
If verified context has no answer and a human is genuinely required, respond with exactly: HUMAN_HANDOFF instead of merely saying a team member is needed.
For technical 3D-printing advice, give conservative general guidance and clearly label exact settings as starting points unless verified product settings are supplied.
Always finish the response as a complete sentence. Prefer 1-4 short sentences unless a product list is genuinely useful.
If the customer asks for a human, complains about payment/refund/legal issues, or the situation looks risky, respond with exactly: HUMAN_HANDOFF.
Do not claim an action was completed unless the verified context says it was completed.`;

  const input=`Customer: ${ctx.session.first_name||'Unknown'} <${ctx.session.email||'no email'}>
Existing summary: ${ctx.session.ai_summary||'None'}
Verified recent Shopify order/tracking context:
${orderContext}

Inventory search query interpreted from the conversation:
${inventoryQuery}

Verified live Shopify product/variant stock context:
${inventoryContext}

When live stock context is present, use it as the source of truth for product availability and quantities. The inventory matcher already includes synonyms, similar words and close-spelling matches. Use the closest semantic/product match, not only exact wording. If several matches are plausible, explain the best 2-3 briefly instead of guessing one. Prefer available products, but mention an out-of-stock exact match when it is useful and suggest the closest in-stock alternative.
For every product you recommend, do NOT print the raw URL. Put the product on its own line using exactly this format:
[[PRODUCT|Product name|https://hotend.co.nz/products/handle|IMAGE_URL]]
Use the verified product URL and image_url from inventory context. If image_url is missing, leave the final field empty. Keep price/stock commentary in normal text before or after the product token.

Recent conversation:
${history}

Write the next Hotend support reply to the customer's latest message.`;

  const openAiStartedAt=Date.now();
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{
      'Authorization':'Bearer '+process.env.OPENAI_API_KEY,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      model:settings.ai_model||'gpt-6.1-sol',
      instructions,
      input,
      max_output_tokens:Math.min(Number(settings.ai_max_output_tokens||260),320)
    })
  });
  const text=await r.text();
  console.log('AI response timing',{sessionId,openai_ms:Date.now()-openAiStartedAt,total_ms:Date.now()-aiStartedAt,status:r.status});
  if(!r.ok)return {ok:false,error:`OPENAI_${r.status}: ${text.slice(0,1200)}`};
  let data={}; try{data=JSON.parse(text)}catch{}
  const reply=responseText(data);
  if(!reply)return {ok:false,error:'OPENAI_EMPTY_RESPONSE'};

  if(reply.trim()==='HUMAN_HANDOFF'){
    await q(`UPDATE chat_sessions SET needs_human=TRUE WHERE id=$1`,[sessionId]);
    let whatsapp=null;
    try{whatsapp=await sendStaffEscalation(sessionId);}catch(e){whatsapp={ok:false,error:e.message};}
    return {ok:false,escalate:true,reply:settings.human_handoff_text,whatsapp};
  }

  if(settings.ai_mode==='AUTO'&&!forceDraft){
    await q(`INSERT INTO chat_messages(session_id,sender,message) VALUES($1,'AI',$2)`,[sessionId,reply]);
    await q(`UPDATE chat_sessions SET last_activity_at=NOW(),ai_last_response_at=NOW(),needs_human=FALSE WHERE id=$1`,[sessionId]);
    return {ok:true,mode:'AUTO',reply};
  }

  await q(`UPDATE chat_sessions SET ai_draft=$2 WHERE id=$1`,[sessionId,reply]);
  return {ok:true,mode:'DRAFT',reply};
}

export async function saveAiSummary(sessionId){
  if(!process.env.OPENAI_API_KEY)return {ok:false,skipped:'openai_key_missing'};
  const settings=await getChatSettings();
  const ctx=await buildContext(sessionId);
  if(!ctx)return {ok:false,skipped:'chat_not_found'};
  const history=ctx.messages.map(m=>`${m.sender}: ${m.message}`).join('\n');
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({
      model:settings?.ai_model||'gpt-6.1-sol',
      instructions:'Summarize this customer support conversation in 3 short bullet points. Include the customer goal, any verified order/tracking facts, and what the Hotend team should do next. Do not invent facts.',
      input:history,
      max_output_tokens:220
    })
  });
  const text=await r.text();
  if(!r.ok)return {ok:false,error:`OPENAI_${r.status}: ${text.slice(0,800)}`};
  let data={}; try{data=JSON.parse(text)}catch{}
  const summary=responseText(data);
  if(!summary)return {ok:false,error:'OPENAI_EMPTY_SUMMARY'};
  await q(`UPDATE chat_sessions SET ai_summary=$2 WHERE id=$1`,[sessionId,summary]);
  return {ok:true,summary};
}
