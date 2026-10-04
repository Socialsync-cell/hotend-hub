import {q} from './db.mjs';

export async function listChatSessions(limit=100){
  return (await q(`SELECT s.id,s.reference,s.mode,s.marketing_opt_in,s.started_at,s.last_activity_at,s.closed_at,
      c.id customer_id,c.email,c.first_name,c.last_name,
      (SELECT message FROM chat_messages m WHERE m.session_id=s.id ORDER BY m.id DESC LIMIT 1) last_message,
      (SELECT COUNT(*)::int FROM chat_messages m WHERE m.session_id=s.id) message_count
    FROM chat_sessions s
    LEFT JOIN customers c ON c.id=s.customer_id
    ORDER BY (s.closed_at IS NULL) DESC,s.last_activity_at DESC
    LIMIT $1`,[Math.max(1,Math.min(300,Number(limit)||100))])).rows;
}

export async function getChatSession(id){
  const session=(await q(`SELECT s.*,c.email,c.first_name,c.last_name,c.marketing_status
    FROM chat_sessions s LEFT JOIN customers c ON c.id=s.customer_id
    WHERE s.id=$1 LIMIT 1`,[Number(id)])).rows[0];
  if(!session)return null;
  const messages=(await q(`SELECT id,sender,message,created_at
    FROM chat_messages WHERE session_id=$1 ORDER BY id ASC`,[session.id])).rows;
  const orders=session.customer_id?(await q(`SELECT id,order_name,total_price,currency,financial_status,fulfillment_status,created_at_shopify
    FROM orders WHERE customer_id=$1 ORDER BY created_at_shopify DESC LIMIT 10`,[session.customer_id])).rows:[];
  return {...session,messages,orders};
}

export async function replyToChat(id,message){
  const text=String(message||'').trim();
  if(!text)throw new Error('Reply message is required');
  const session=(await q(`SELECT id,closed_at FROM chat_sessions WHERE id=$1 LIMIT 1`,[Number(id)])).rows[0];
  if(!session)throw new Error('Chat not found');
  await q(`INSERT INTO chat_messages(session_id,sender,message) VALUES($1,'HOTEND',$2)`,[session.id,text]);
  await q(`UPDATE chat_sessions SET last_activity_at=NOW(),closed_at=NULL,ai_draft=NULL,needs_human=TRUE WHERE id=$1`,[session.id]);
  return true;
}

export async function setChatClosed(id,closed){
  await q(`UPDATE chat_sessions SET closed_at=CASE WHEN $2 THEN NOW() ELSE NULL END,last_activity_at=NOW() WHERE id=$1`,[Number(id),!!closed]);
}

export async function getChatThreadByReference(reference){
  const session=(await q(`SELECT id,reference,closed_at FROM chat_sessions WHERE reference=$1 LIMIT 1`,[String(reference||'').trim()])).rows[0];
  if(!session)return null;
  const messages=(await q(`SELECT sender,message,created_at FROM chat_messages WHERE session_id=$1 ORDER BY id ASC LIMIT 200`,[session.id])).rows;
  return {...session,messages};
}
