import {q} from './db.mjs';

export function whatsappReady(){
  return !!(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID&&process.env.WHATSAPP_VERIFY_TOKEN);
}

export function verifyWhatsAppWebhook(url){
  const mode=String(url.searchParams.get('hub.mode')||'');
  const token=String(url.searchParams.get('hub.verify_token')||'');
  const challenge=String(url.searchParams.get('hub.challenge')||'');
  if(mode==='subscribe'&&token&&token===process.env.WHATSAPP_VERIFY_TOKEN)return {ok:true,challenge};
  return {ok:false};
}

function digits(v){return String(v||'').replace(/\D/g,'');}

function inboundMessages(body){
  const out=[];
  for(const entry of body?.entry||[]){
    for(const change of entry?.changes||[]){
      const value=change?.value||{};
      const contacts=value.contacts||[];
      for(const m of value.messages||[]){
        const contact=contacts.find(c=>c.wa_id===m.from)||contacts[0]||{};
        let text='';
        if(m.type==='text')text=m.text?.body||'';
        else if(m.type==='button')text=m.button?.text||'';
        else if(m.type==='interactive')text=m.interactive?.button_reply?.title||m.interactive?.list_reply?.title||'';
        else text=`[${m.type||'message'} received]`;
        out.push({
          from:digits(m.from),
          name:String(contact?.profile?.name||'WhatsApp'),
          messageId:String(m.id||''),
          contextId:String(m.context?.id||''),
          timestamp:m.timestamp?new Date(Number(m.timestamp)*1000).toISOString():new Date().toISOString(),
          text:String(text||'').trim()
        });
      }
    }
  }
  return out.filter(x=>x.from&&x.text);
}

async function graphSend(payload){
  if(!whatsappReady())return {ok:false,skipped:'whatsapp_credentials_missing'};
  const graphStartedAt=Date.now();
  const r=await fetch(`https://graph.facebook.com/v26.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{
    method:'POST',
    headers:{
      'Authorization':'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN,
      'Content-Type':'application/json'
    },
    body:JSON.stringify(payload)
  });
  const raw=await r.text();
  console.log('WhatsApp Graph timing',{ms:Date.now()-graphStartedAt,status:r.status});
  if(!r.ok)return {ok:false,error:`WHATSAPP_${r.status}: ${raw.slice(0,1200)}`};
  let data={}; try{data=JSON.parse(raw)}catch{}
  return {ok:true,id:data?.messages?.[0]?.id||null};
}

export async function sendWhatsAppMessage(to,text){
  const recipient=digits(to);
  if(!recipient)return {ok:false,skipped:'recipient_missing'};
  return graphSend({
    messaging_product:'whatsapp',
    recipient_type:'individual',
    to:recipient,
    type:'text',
    text:{preview_url:false,body:String(text||'').slice(0,4000)}
  });
}

export async function sendStaffEscalation(sessionId){
  const settings=(await q(`SELECT whatsapp_enabled,whatsapp_staff_phone,whatsapp_phone,
      whatsapp_template_name,whatsapp_template_language
    FROM chat_settings WHERE id=1 LIMIT 1`)).rows[0]||{};
  const staff=digits(settings.whatsapp_staff_phone||settings.whatsapp_phone||process.env.WHATSAPP_STAFF_PHONE);
  const envStaff=digits(process.env.WHATSAPP_STAFF_PHONE);
  const escalationEnabled=!!settings.whatsapp_enabled||!!envStaff;
  if(!escalationEnabled||!staff){
    console.error('WhatsApp escalation unavailable',{enabled:escalationEnabled,staffConfigured:!!staff});
    return {ok:false,skipped:'staff_whatsapp_not_configured'};
  }
  if(!whatsappReady()){
    console.error('WhatsApp escalation unavailable',{credentialsReady:false});
    return {ok:false,skipped:'whatsapp_credentials_missing'};
  }

  const session=(await q(`SELECT s.id,s.reference,c.first_name,c.last_name,c.email
    FROM chat_sessions s
    LEFT JOIN customers c ON c.id=s.customer_id
    WHERE s.id=$1 LIMIT 1`,[Number(sessionId)])).rows[0];
  if(!session)return {ok:false,skipped:'chat_not_found'};

  const firstName=String(session.first_name||'Customer').trim()||'Customer';
  const transcriptRows=(await q(`SELECT sender,message FROM chat_messages
    WHERE session_id=$1 ORDER BY id ASC`,[session.id])).rows;
  const transcript=transcriptRows.map(row=>`[${row.sender}] ${String(row.message||'')}`).join('\n\n');
  const intro=[
    'Hotend website chat — human handover',
    'Chat: '+session.reference,
    'Customer: '+firstName,
    'Email: '+(session.email||'No email'),
    '',
    'Full conversation:',
    transcript||'(No messages)'
  ].join('\n');

  // A template can start a business-initiated conversation outside the 24-hour window.
  // A successful text API response alone does not guarantee delivery.
  const templateName=String(settings.whatsapp_template_name||'').trim();
  const sendTemplate=()=>graphSend({
    messaging_product:'whatsapp',
    to:staff,
    type:'template',
    template:{
      name:templateName,
      language:{code:String(settings.whatsapp_template_language||'en')}
    }
  });
  // Never fall back from a rejected template to unapproved free-form text.
  let sent;
  if(templateName){
    // Approved templates have fixed Meta-reviewed content. Do not send unapproved
    // transcript text outside the customer-service window.
    sent=await sendTemplate();
  }else{
    console.warn('WhatsApp escalation template not configured',{sessionId:session.id});
    // Preserve the complete conversation, using several WhatsApp messages if needed.
    // Split at code-point boundaries so no section is silently truncated.
    const characters=Array.from(intro);
    const chunks=[];
    for(let offset=0;offset<characters.length;offset+=3500){
      chunks.push(characters.slice(offset,offset+3500).join(''));
    }
    for(let index=0;index<chunks.length;index++){
      const text=chunks.length===1?chunks[index]:`Hotend handover ${session.reference} (part ${index+1}/${chunks.length})\n${chunks[index]}`;
      sent=await sendWhatsAppMessage(staff,text);
      if(!sent.ok)break;
      await q(`INSERT INTO whatsapp_staff_bridges(session_id,outbound_message_id,staff_phone)
        VALUES($1,$2,$3)`,[session.id,sent.id||null,staff]);
    }
  }

  if(sent.ok){
    if(templateName){
      await q(`INSERT INTO whatsapp_staff_bridges(session_id,outbound_message_id,staff_phone)
        VALUES($1,$2,$3)`,[session.id,sent.id||null,staff]);
    }
    await q(`UPDATE chat_sessions SET whatsapp_notified_at=NOW(),whatsapp_notify_error=NULL WHERE id=$1`,[session.id]);
  }else{
    const err=String(sent.error||sent.skipped||'WhatsApp escalation failed').slice(0,1200);
    console.error('WhatsApp staff escalation failed',{sessionId:session.id,error:err});
    await q(`UPDATE chat_sessions SET whatsapp_notify_error=$2 WHERE id=$1`,[
      session.id,err
    ]);
  }
  return sent;
}

export async function sendStaffChatMessage(sessionId){
  const settings=(await q(`SELECT whatsapp_staff_phone,whatsapp_phone FROM chat_settings WHERE id=1 LIMIT 1`)).rows[0]||{};
  const staff=digits(settings.whatsapp_staff_phone||settings.whatsapp_phone||process.env.WHATSAPP_STAFF_PHONE);
  if(!staff||!whatsappReady())return {ok:false,skipped:'staff_whatsapp_unavailable'};

  const session=(await q(`SELECT s.id,s.reference,c.first_name,c.email
    FROM chat_sessions s
    LEFT JOIN customers c ON c.id=s.customer_id
    WHERE s.id=$1 LIMIT 1`,[Number(sessionId)])).rows[0];
  if(!session)return {ok:false,skipped:'chat_not_found'};

  const last=(await q(`SELECT message FROM chat_messages
    WHERE session_id=$1 AND sender='CUSTOMER'
    ORDER BY id DESC LIMIT 1`,[session.id])).rows[0];
  if(!last?.message)return {ok:false,skipped:'no_customer_message'};

  const firstName=String(session.first_name||'Customer').trim()||'Customer';
  const text=[firstName,String(last.message).slice(0,2200)].join('\n');
  const sent=await sendWhatsAppMessage(staff,text);

  if(sent.ok){
    await q(`INSERT INTO whatsapp_staff_bridges(session_id,outbound_message_id,staff_phone)
      VALUES($1,$2,$3)`,[session.id,sent.id||null,staff]);
  }else{
    console.error('WhatsApp staff message forward failed',{sessionId:session.id,error:sent.error||sent.skipped||'unknown'});
  }
  return sent;
}

async function resolveWebsiteSessionForStaffMessage(m,staff){
  if(m.contextId){
    const bridge=(await q(`SELECT session_id FROM whatsapp_staff_bridges
      WHERE outbound_message_id=$1 AND staff_phone=$2
      ORDER BY id DESC LIMIT 1`,[m.contextId,staff])).rows[0];
    if(bridge)return bridge.session_id;
  }

  const refMatch=m.text.match(/\bCHAT-[A-Z0-9]+\b/i);
  if(refMatch){
    const s=(await q(`SELECT id FROM chat_sessions WHERE reference=$1 LIMIT 1`,[refMatch[0].toUpperCase()])).rows[0];
    if(s)return s.id;
  }

  const recent=(await q(`SELECT b.session_id
    FROM whatsapp_staff_bridges b
    JOIN chat_sessions s ON s.id=b.session_id
    WHERE b.staff_phone=$1
      AND b.created_at > NOW()-INTERVAL '24 hours'
      AND s.closed_at IS NULL
    ORDER BY COALESCE(b.last_staff_reply_at,b.created_at) DESC,b.id DESC
    LIMIT 1`,[staff])).rows[0];
  if(recent)return recent.session_id;

  return null;
}

export async function processWhatsAppWebhook(rawBody){
  let body={};
  try{body=JSON.parse(rawBody.toString('utf8')||'{}')}
  catch{return {ok:false,error:'INVALID_JSON'};}

  // Meta delivery receipts are status events, not inbound chat messages.
  let statusesSeen=0, statusesMatched=0, statusesFailed=0;
  for(const entry of body?.entry||[]){
    for(const change of entry?.changes||[]){
      for(const status of change?.value?.statuses||[]){
        const messageId=String(status?.id||'').trim();
        const state=String(status?.status||'').trim().toLowerCase();
        if(!messageId||!['sent','delivered','read','failed'].includes(state))continue;
        statusesSeen++;
        const issue=Array.isArray(status.errors)?status.errors[0]:null;
        const code=issue?.code==null?null:String(issue.code).slice(0,80);
        const detail=issue?String(issue.title||issue.message||'WhatsApp delivery failed').slice(0,500):null;
        const at=Number(status.timestamp);
        const statusAt=Number.isFinite(at)&&at>0?new Date(at*1000).toISOString():null;
        const saved=await q(`INSERT INTO whatsapp_delivery_events(message_id,session_id,status,status_at,error_code,error_message)
          VALUES($1,(SELECT session_id FROM whatsapp_staff_bridges WHERE outbound_message_id=$1 ORDER BY id DESC LIMIT 1),$2,$3,$4,$5)
          ON CONFLICT(message_id,status) DO UPDATE SET status_at=COALESCE(EXCLUDED.status_at,whatsapp_delivery_events.status_at),
            session_id=COALESCE(EXCLUDED.session_id,whatsapp_delivery_events.session_id),
            error_code=EXCLUDED.error_code,error_message=EXCLUDED.error_message
          RETURNING session_id`,[messageId,state,statusAt,code,detail]);
        if(saved.rows[0]?.session_id)statusesMatched++;
        if(state==='failed'){
          statusesFailed++;
          const failedSessionId=saved.rows[0]?.session_id||null;
          console.error('WhatsApp delivery failed',{sessionId:failedSessionId,code,detail});
          if(failedSessionId){
            await q(`UPDATE chat_sessions SET whatsapp_notify_error=$2
              WHERE id=$1`,[failedSessionId,(code?code+': ':'')+(detail||'WhatsApp delivery failed')]);
          }
        }
      }
    }
  }
  if(statusesSeen)console.log('WhatsApp delivery statuses',{seen:statusesSeen,matched:statusesMatched,failed:statusesFailed});

  const messages=inboundMessages(body);
  const settings=(await q(`SELECT whatsapp_staff_phone,whatsapp_phone FROM chat_settings WHERE id=1 LIMIT 1`)).rows[0]||{};
  const staff=digits(settings.whatsapp_staff_phone||settings.whatsapp_phone||process.env.WHATSAPP_STAFF_PHONE);

  let bridged=0, ignored=0, senderMismatch=0, unmapped=0;
  for(const m of messages){
    if(!staff||m.from!==staff){
      ignored++; senderMismatch++;
      continue;
    }

    const sessionId=await resolveWebsiteSessionForStaffMessage(m,staff);
    if(!sessionId){
      ignored++; unmapped++;
      continue;
    }

    if(/^(close|close chat|end chat)$/i.test(m.text.trim())){
      await q(`INSERT INTO chat_messages(session_id,sender,message,created_at)
        VALUES($1,'SYSTEM',$2,$3)`,[
        sessionId,
        'Human support has ended. Hotend AI is available if you need anything else.',
        m.timestamp
      ]);
      await q(`UPDATE chat_sessions SET last_activity_at=NOW(),needs_human=FALSE,ai_draft=NULL,closed_at=NULL
        WHERE id=$1`,[sessionId]);
      await q(`UPDATE whatsapp_staff_bridges SET last_staff_reply_at=NOW()
        WHERE session_id=$1 AND staff_phone=$2`,[sessionId,staff]);
      bridged++;
      continue;
    }

    await q(`INSERT INTO chat_messages(session_id,sender,message,created_at)
      VALUES($1,'HOTEND',$2,$3)`,[sessionId,m.text,m.timestamp]);
    await q(`UPDATE chat_sessions SET last_activity_at=NOW(),needs_human=TRUE,ai_draft=NULL,closed_at=NULL
      WHERE id=$1`,[sessionId]);
    await q(`UPDATE whatsapp_staff_bridges SET last_staff_reply_at=NOW()
      WHERE session_id=$1 AND staff_phone=$2`,[sessionId,staff]);
    bridged++;
  }

  const newest=messages.length?messages[messages.length-1]:null;
  const receivedToStoredMs=newest?.timestamp?Math.max(0,Date.now()-new Date(newest.timestamp).getTime()):null;
  console.log('WhatsApp webhook',{messages:messages.length,bridged,ignored,senderMismatch,unmapped,received_to_stored_ms:receivedToStoredMs});
  return {ok:true,stored:bridged,bridged,ignored,senderMismatch,unmapped};
}
