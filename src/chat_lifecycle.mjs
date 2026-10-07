import {q} from './db.mjs';
import {sendEmail,brandEmailHeader,wrapHotendEmail} from './email.mjs';
import {renderAutomationEmail,automationRule} from './automations.mjs';

function esc(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function sendTranscript(sessionId){
  const session=(await q(`SELECT s.id,s.reference,s.customer_id,c.email,c.first_name
    FROM chat_sessions s
    LEFT JOIN customers c ON c.id=s.customer_id
    WHERE s.id=$1 LIMIT 1`,[Number(sessionId)])).rows[0];
  if(!session?.email)return {ok:false,skipped:'no_email'};

  const messages=(await q(`SELECT sender,message,created_at
    FROM chat_messages WHERE session_id=$1 ORDER BY id ASC`,[session.id])).rows;
  if(!messages.length)return {ok:false,skipped:'no_messages'};

  const rows=messages.map(m=>{
    const who=m.sender==='CUSTOMER'?'You':((m.sender==='AI'||m.sender==='HOTEND')?'Hotend':'System');
    return `<div style="padding:10px 0;border-bottom:1px solid #eef2f7">
      <div style="font-weight:800;color:#0b2748">${esc(who)}</div>
      <div style="white-space:pre-wrap;line-height:1.5;color:#334155">${esc(m.message)}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">${esc(new Date(m.created_at).toLocaleString('en-NZ',{timeZone:'Pacific/Auckland'}))}</div>
    </div>`;
  }).join('');

  const html=wrapHotendEmail(`
    <div style="font-size:22px;font-weight:800;line-height:1.3;margin-bottom:9px">Your Hotend chat transcript</div>
    <div style="color:#657d7a;font-size:12px;line-height:1.65;margin-bottom:16px">Hi ${esc(session.first_name||'there')}, here is a copy of your recent support conversation.</div>
    <div style="background:#f5f7f7;border:1px solid #d7dfdf;border-left:5px solid #3fc2c2;padding:12px 14px">
      <div style="color:#1c3a52;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.45px;margin-bottom:6px">Conversation</div>
      ${rows}
    </div>
  `);

  const rendered=await renderAutomationEmail('chat-transcript',{
    fallbackSubject:'Your Hotend support chat transcript',
    fallbackHtml:html,
    vars:{
      first_name:esc(session.first_name||'there'),
      transcript_html:rows,
      brand_header:brandEmailHeader(),
      reference:esc(session.reference||'')
    }
  });
  const result=await sendEmail({
    customerId:session.customer_id,
    emailType:'CHAT_TRANSCRIPT',
    to:session.email,
    subject:rendered.subject,
    html:rendered.html,
    metadata:{automation:'chat-transcript',reference:session.reference}
  });

  if(result.ok){
    await q(`UPDATE chat_sessions SET transcript_sent_at=NOW() WHERE id=$1`,[session.id]);
  }
  return result;
}


export async function closeChatNowByReference(reference){
  const ref=String(reference||'').trim();
  if(!ref)return {ok:false,message:'Chat reference missing'};

  const session=(await q(`SELECT id,closed_at,transcript_sent_at
    FROM chat_sessions WHERE reference=$1 LIMIT 1`,[ref])).rows[0];
  if(!session)return {ok:false,message:'Chat not found'};

  const transcriptRule=await automationRule('chat-transcript');

  if(!session.closed_at){
    await q(`INSERT INTO chat_messages(session_id,sender,message)
      VALUES($1,'SYSTEM',$2)`,[
      session.id,
      transcriptRule?.enabled
        ? 'This chat was closed by the customer. A transcript has been emailed to you.'
        : 'This chat was closed by the customer.'
    ]);
    await q(`UPDATE chat_sessions
      SET closed_at=NOW(),close_reason='USER_CLOSED',needs_human=FALSE,last_activity_at=NOW(),ai_draft=NULL
      WHERE id=$1`,[session.id]);
  }

  const shouldSendTranscript=!!transcriptRule?.enabled&&!session.transcript_sent_at;
  if(shouldSendTranscript){
    setImmediate(async()=>{
      try{
        const result=await sendTranscript(session.id);
        if(!result.ok)console.error('User-closed transcript send failed',{sessionId:session.id,error:result.error||result.skipped||'unknown'});
      }catch(e){
        console.error('User-closed transcript send failed',{sessionId:session.id,error:e.message});
      }
    });
  }

  return {ok:true,closed:true,transcript_queued:shouldSendTranscript};
}

export async function processChatLifecycle(){
  const human=(await q(`SELECT s.id
    FROM chat_sessions s
    JOIN LATERAL (
      SELECT sender,created_at
      FROM chat_messages m
      WHERE m.session_id=s.id
      ORDER BY m.id DESC
      LIMIT 1
    ) last ON TRUE
    WHERE s.closed_at IS NULL
      AND s.needs_human=TRUE
      AND last.sender='HOTEND'
      AND last.created_at <= NOW()-INTERVAL '8 minutes'
    LIMIT 100`)).rows;

  const transcriptRule=await automationRule('chat-transcript');
  let humanClosed=0,humanTranscripts=0,humanTranscriptFailed=0;
  for(const row of human){
    await q(`INSERT INTO chat_messages(session_id,sender,message)
      VALUES($1,'SYSTEM',$2)`,[
      row.id,
      transcriptRule?.enabled
        ? 'Human support has ended after 8 minutes without a reply. This chat is now closed and a transcript has been emailed to you.'
        : 'Human support has ended after 8 minutes without a reply. This chat is now closed.'
    ]);
    await q(`UPDATE chat_sessions
      SET needs_human=FALSE,closed_at=NOW(),close_reason='HUMAN_IDLE',last_activity_at=NOW(),ai_draft=NULL
      WHERE id=$1`,[row.id]);
    humanClosed++;
    if(transcriptRule?.enabled){
      try{
        const sent=await sendTranscript(row.id);
        if(sent.ok)humanTranscripts++; else humanTranscriptFailed++;
      }catch(e){
        humanTranscriptFailed++;
        console.error('Human chat transcript send failed',{sessionId:row.id,error:e.message});
      }
    }
  }
  const idleMinutes=Math.max(1,Number(transcriptRule?.config?.idle_minutes||10));
  const ai=(await q(`SELECT s.id
    FROM chat_sessions s
    JOIN LATERAL (
      SELECT sender,created_at
      FROM chat_messages m
      WHERE m.session_id=s.id
      ORDER BY m.id DESC
      LIMIT 1
    ) last ON TRUE
    WHERE s.closed_at IS NULL
      AND s.needs_human=FALSE
      AND last.sender IN ('AI','HOTEND','SYSTEM')
      AND last.created_at <= NOW()-($1 * INTERVAL '1 minute')
    LIMIT 100`,[idleMinutes])).rows;

  let aiClosed=0,transcripts=0,transcriptFailed=0;
  for(const row of ai){
    await q(`INSERT INTO chat_messages(session_id,sender,message)
      VALUES($1,'SYSTEM',$2)`,[
      row.id,
      transcriptRule?.enabled
        ? `This chat has been closed after ${idleMinutes} minutes of inactivity. A transcript has been emailed to you. Please start a new chat if you need more help.`
        : `This chat has been closed after ${idleMinutes} minutes of inactivity. Please start a new chat if you need more help.`
    ]);
    await q(`UPDATE chat_sessions
      SET closed_at=NOW(),close_reason='AI_IDLE',needs_human=FALSE,last_activity_at=NOW()
      WHERE id=$1`,[row.id]);
    aiClosed++;
    if(transcriptRule?.enabled){
      try{
        const sent=await sendTranscript(row.id);
        if(sent.ok)transcripts++; else transcriptFailed++;
      }catch(e){
        transcriptFailed++;
        console.error('Chat transcript send failed',{sessionId:row.id,error:e.message});
      }
    }
  }

  return {humanClosed,humanTranscripts,humanTranscriptFailed,aiClosed,transcripts,transcriptFailed};
}
