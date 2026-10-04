import {q} from './db.mjs';
import {defaultAutomationEditor} from './automations.mjs';
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export async function dashboard(){
  const [
    customerRow,orderRow,chatRow,shipmentRow,emailRow,abandonedRow,reviewRow,campaignRow,popupRow
  ]=await Promise.all([
    q(`SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE marketing_status='SUBSCRIBED')::int subscribed,COALESCE(SUM(total_spent),0)::numeric(14,2) value FROM customers`),
    q(`SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE created_at_shopify>=NOW()-INTERVAL '30 days')::int last30,COALESCE(SUM(total_price) FILTER (WHERE created_at_shopify>=NOW()-INTERVAL '30 days'),0)::numeric(14,2) revenue30 FROM orders`),
    q(`SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE closed_at IS NULL)::int open FROM chat_sessions`),
    q(`SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE delivered_at IS NULL AND UPPER(status)<>'SUCCESS')::int active,COUNT(*) FILTER (WHERE delivered_at IS NOT NULL OR UPPER(status)='SUCCESS')::int delivered FROM shipments`),
    q(`SELECT COUNT(*) FILTER (WHERE status='SENT')::int sent,COUNT(*) FILTER (WHERE status='FAILED')::int failed,COUNT(*) FILTER (WHERE status='QUEUED')::int queued FROM email_deliveries`),
    q(`SELECT COUNT(*) FILTER (WHERE recovered=FALSE)::int open,COUNT(*) FILTER (WHERE recovered=TRUE)::int recovered FROM abandoned_checkouts`),
    q(`SELECT COUNT(*)::int total,COALESCE(ROUND(AVG(rating)::numeric,2),0)::numeric(4,2) avg_rating FROM product_reviews WHERE approved=TRUE`),
    q(`SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE status='DRAFT')::int drafts,COUNT(*) FILTER (WHERE status='SENDING')::int sending FROM marketing_campaigns`),
    q(`SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE enabled=TRUE) ::int enabled FROM popups`)
  ]);
  const customers=customerRow.rows[0],orders=orderRow.rows[0],chats=chatRow.rows[0],shipments=shipmentRow.rows[0],
    emails=emailRow.rows[0],abandoned=abandonedRow.rows[0],reviews=reviewRow.rows[0],campaigns=campaignRow.rows[0],popups=popupRow.rows[0];

  const recent=(await q(`SELECT * FROM (
      SELECT 'Order' type,COALESCE(order_name,'Order') title,created_at_shopify at,'/customers?id='||COALESCE(customer_id::text,'') href FROM orders WHERE created_at_shopify IS NOT NULL
      UNION ALL
      SELECT 'Chat',reference,last_activity_at,'/chats?id='||id::text FROM chat_sessions
      UNION ALL
      SELECT 'Email',subject,COALESCE(sent_at,created_at),'/marketing' FROM email_deliveries
      UNION ALL
      SELECT 'Review',COALESCE(feedback,'Customer review'),created_at,'/customers?id='||COALESCE(customer_id::text,'') FROM product_reviews
    ) x WHERE at IS NOT NULL ORDER BY at DESC LIMIT 12`)).rows;

  const issues=[];
  if(Number(emails.failed||0)>0)issues.push({title:`${emails.failed} failed email${Number(emails.failed)===1?'':'s'}`,href:'/marketing',text:'Review sender or delivery errors.'});
  const pausedAbandoned=(await q(`SELECT COUNT(*)::int n FROM abandoned_checkout_steps WHERE status='PAUSED'`)).rows[0].n;
  const pausedReviews=(await q(`SELECT COUNT(*)::int n FROM review_schedules WHERE status='PAUSED'`)).rows[0].n;
  if(pausedAbandoned>0)issues.push({title:`${pausedAbandoned} paused abandoned-cart step${pausedAbandoned===1?'':'s'}`,href:'/marketing',text:'These need sender/provider attention before retrying.'});
  if(pausedReviews>0)issues.push({title:`${pausedReviews} paused review request${pausedReviews===1?'':'s'}`,href:'/marketing',text:'These are waiting on email delivery recovery.'});
  if(Number(chats.open||0)>0)issues.push({title:`${chats.open} open chat${Number(chats.open)===1?'':'s'}`,href:'/chats',text:'Customer conversations currently open.'});

  const activity=recent.length?recent.map(x=>`<a class="activity" href="${esc(x.href||'#')}"><span class="atype">${esc(x.type)}</span><div><strong>${esc(x.title||'Activity')}</strong><div class="muted">${esc(x.at||'')}</div></div></a>`).join(''):'<div class="muted">No recent activity yet.</div>';
  const attention=issues.length?issues.map(x=>`<a class="issue" href="${x.href}"><strong>${esc(x.title)}</strong><div class="muted">${esc(x.text)}</div></a>`).join(''):'<div class="good">Nothing currently needs attention.</div>';

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hotend Hub</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.top{background:#0b2748;color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-weight:900;font-size:26px}.brand span{color:#f5b51b}.top nav{display:flex;gap:15px;flex-wrap:wrap;justify-content:flex-end}.top a{color:#fff;text-decoration:none}.wrap{max-width:1280px;margin:auto;padding:26px}.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px}.hero h1{margin:0;color:#0b2748}.hero p{margin:5px 0 0}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.card,.panel,.module{background:#fff;border:1px solid #e5e7eb;border-radius:16px}.card{padding:18px}.n{font-size:30px;font-weight:900;color:#0b2748}.label{color:#667085;margin-top:3px}.sub{font-size:12px;color:#667085;margin-top:5px}.main-grid{display:grid;grid-template-columns:1.35fr .85fr;gap:16px;margin-top:16px}.panel{padding:20px}.panel h2{margin-top:0;color:#0b2748}.modules{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:16px}.module{display:block;color:inherit;text-decoration:none;padding:18px}.module:hover{border-color:#f5b51b;box-shadow:0 5px 20px rgba(11,39,72,.07)}.module h3{margin:0 0 7px;color:#0b2748}.state{display:inline-block;padding:4px 8px;border-radius:999px;background:#dcfce7;color:#166534;font-size:11px;font-weight:900}.state.external{background:#fff3cd;color:#7a5200}.muted{color:#667085;font-size:13px}.activity,.issue{display:flex;gap:12px;color:inherit;text-decoration:none;padding:11px 0;border-bottom:1px solid #eef2f6}.activity:last-child,.issue:last-child{border-bottom:0}.atype{min-width:58px;font-size:11px;font-weight:900;color:#0b2748;background:#eef6ff;border-radius:999px;padding:5px 8px;height:max-content;text-align:center}.issue{display:block}.issue strong{color:#991b1b}.good{background:#ecfdf3;color:#166534;border-radius:10px;padding:12px;font-weight:700}.quick{display:flex;gap:9px;flex-wrap:wrap}.btn{display:inline-block;background:#f5b51b;color:#0b2748;text-decoration:none;border-radius:10px;padding:10px 14px;font-weight:900}.btn.secondary{background:#eef2f6}@media(max-width:920px){.grid{grid-template-columns:1fr 1fr}.main-grid{grid-template-columns:1fr}.modules{grid-template-columns:1fr 1fr}}@media(max-width:580px){.grid,.modules{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}.top nav{justify-content:flex-start}.hero{align-items:flex-start;flex-direction:column}}
  </style></head><body><div class="top"><div class="brand">HOTEND <span>HUB</span></div><nav><a href="/">Dashboard</a><a href="/customers">Customers</a><a href="/reviews-admin">Reviews</a><a href="/automations">Automations</a><a href="/marketing">Marketing</a><a href="/popups">Popups</a><a href="/chats">Chats</a><a href="/chat-settings">Chat Settings</a><a href="/tracking-admin">Tracking</a><a href="/setup">Setup</a><a href="/auth/logout">Log out</a></nav></div>
  <div class="wrap"><div class="hero"><div><h1>Operations Dashboard</h1><p class="muted">Hotend customer, marketing, review, chat and delivery activity in one place.</p></div><div class="quick"><a class="btn" href="/marketing">Create campaign</a><a class="btn secondary" href="/tracking-admin">Check tracking</a></div></div>
  <div class="grid">
    <div class="card"><div class="n">${Number(customers.total||0)}</div><div class="label">Customers</div><div class="sub">${Number(customers.subscribed||0)} marketing subscribers</div></div>
    <div class="card"><div class="n">${Number(orders.last30||0)}</div><div class="label">Orders — last 30 days</div><div class="sub">$ ${Number(orders.revenue30||0).toFixed(2)} order value</div></div>
    <div class="card"><div class="n">${Number(chats.open||0)}</div><div class="label">Open chats</div><div class="sub">${Number(chats.total||0)} conversations total</div></div>
    <div class="card"><div class="n">${Number(shipments.active||0)}</div><div class="label">Active shipments</div><div class="sub">${Number(shipments.delivered||0)} delivered</div></div>
    <div class="card"><div class="n">${Number(abandoned.open||0)}</div><div class="label">Open abandoned checkouts</div><div class="sub">${Number(abandoned.recovered||0)} recovered</div></div>
    <div class="card"><div class="n">${Number(reviews.total||0)}</div><div class="label">Published reviews</div><div class="sub">${Number(reviews.avg_rating||0).toFixed(2)} average rating</div></div>
    <div class="card"><div class="n">${Number(emails.sent||0)}</div><div class="label">Emails sent</div><div class="sub">${Number(emails.failed||0)} failed · ${Number(emails.queued||0)} queued</div></div>
    <div class="card"><div class="n">$ ${Number(customers.value||0).toFixed(2)}</div><div class="label">Imported customer value</div><div class="sub">${Number(orders.total||0)} orders imported</div></div>
  </div>

  <div class="main-grid"><div class="panel"><h2>Recent activity</h2>${activity}</div><div class="panel"><h2>Needs attention</h2>${attention}</div></div>

  <div class="modules">
    <a class="module" href="/customers"><span class="state">Live</span><h3>Customers</h3><p class="muted">Unified customer profiles with orders, reviews, chats, emails, abandoned carts and delivery history.</p></a>
    <a class="module" href="/marketing"><span class="state">Live</span><h3>Marketing</h3><p class="muted">Welcome email, abandoned checkout recovery, review requests, campaigns and unsubscribe handling.</p></a>
    <a class="module" href="/chats"><span class="state">Live</span><h3>Chatbox</h3><p class="muted">Storefront conversations, admin replies, order context and customer handoff.</p></a>
    <a class="module" href="/popups"><span class="state">Live</span><h3>Website Popups</h3><p class="muted">${Number(popups.enabled||0)} enabled popup${Number(popups.enabled||0)===1?'':'s'} · ${Number(popups.total||0)} total.</p></a>
    <a class="module" href="/tracking-admin"><span class="state">Live</span><h3>Courier Tracking</h3><p class="muted">Shopify tracking timeline and NZ Post webhook-ready integration.</p></a>
    <a class="module" href="/tracking-admin"><span class="state external">Carrier credentials</span><h3>Courier APIs</h3><p class="muted">Detailed scans for NZ Post, Freightways and Aramex activate as their API credentials are connected.</p></a>
  </div></div></body></html>`;
}

export function setupPage({status,shopify,grantedScopes=[],message=''}){
  const row=(label,ok,detail='')=>`<div class="setup-row"><div><strong>${esc(label)}</strong>${detail?`<div class="muted">${esc(detail)}</div>`:''}</div><span class="state ${ok?'ok':'bad'}">${ok?'Ready':'Missing'}</span></div>`;
  const connected=shopify&&!shopify.error;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hotend Hub Setup</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.top{background:#0b2748;color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between}.brand{font-weight:900;font-size:26px}.brand span{color:#f5b51b}.wrap{max-width:900px;margin:auto;padding:26px}.panel{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:22px;margin-bottom:18px}.setup-row{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:13px 0;border-bottom:1px solid #eef2f6}.setup-row:last-child{border-bottom:0}.state{font-size:12px;font-weight:900;padding:6px 10px;border-radius:999px}.state.ok{background:#dcfce7;color:#166534}.state.bad{background:#fee2e2;color:#991b1b}.muted{color:#667085;font-size:13px;margin-top:4px}.btn{background:#f5b51b;color:#0b2748;border:0;border-radius:10px;padding:12px 18px;font-weight:900;cursor:pointer}.msg{background:#eef6ff;border:1px solid #bfdbfe;border-radius:12px;padding:12px 14px;margin-bottom:18px;white-space:pre-wrap}.err{background:#fff1f2;border-color:#fecdd3;color:#9f1239}.top a{text-decoration:none}
  </style></head><body><div class="top"><div class="brand">HOTEND <span>HUB</span></div><div><a href="/">Dashboard</a></div></div><div class="wrap"><h1>Setup</h1>
  ${message?`<div class="msg ${message.toLowerCase().includes('failed')?'err':''}">${esc(message)}</div>`:''}
  <div class="panel"><h2>Core connection</h2>
    ${row('Database',status.database)}
    ${row('Shopify store',status.shopifyStore,process.env.SHOPIFY_STORE||'')}
    ${row('Shopify Client ID',status.shopifyClientId,status.shopifyClientId?(String(process.env.SHOPIFY_CLIENT_ID||'').slice(0,6)+'…'+String(process.env.SHOPIFY_CLIENT_ID||'').slice(-4)):'')}
    ${row('Shopify Client Secret',status.shopifyClientSecret)}
    ${row('Shopify API authentication',connected,connected?`${shopify.name} · ${shopify.myshopifyDomain}`:(shopify?.error||''))}
    ${row('Shopify granted scopes',grantedScopes.length>0,grantedScopes.length?grantedScopes.join(', '):'No granted scopes returned')}
  </div>
  <div class="panel"><h2>Shopify connection</h2><p class="muted">Connect Hotend Hub to Shopify once, then the Hub stores the approved access token securely.</p>
  <p><a class="btn" href="/auth/shopify" style="display:inline-block;text-decoration:none">Connect Shopify</a></p></div>
  <div class="panel"><h2>Shopify core sync</h2><p class="muted">Imports customers, marketing consent, orders and order items into Hotend Hub.</p>
  <form method="post" action="/admin/sync-shopify"><button class="btn" type="submit" ${connected?'':'disabled'}>Sync Shopify now</button></form></div>
  <div class="panel"><h2>Live Shopify updates</h2><p class="muted">Registers signed Shopify webhooks so customer consent, orders and fulfillment changes stay synchronized automatically.</p>
  <form method="post" action="/admin/register-webhooks"><button class="btn" type="submit" ${connected?'':'disabled'}>Register Shopify webhooks</button></form></div>
  <div class="panel"><h2>Storefront Hub</h2><p class="muted">One storefront script powers Hotend reviews, chat and active promotional popups.</p>
  <form method="post" action="/admin/install-storefront"><button class="btn" type="submit" ${connected?'':'disabled'}>Install Hotend Hub storefront</button></form></div>
  </div></body></html>`;
}


export async function marketingPage({emailConfig,recentDeliveries=[],message=''}) {
  const stats=(await q(`SELECT
    COUNT(*) FILTER (WHERE marketing_status='SUBSCRIBED')::int AS subscribers
    FROM customers`)).rows[0];

  const emailStats=(await q(`SELECT
    COUNT(*) FILTER (WHERE status='SENT')::int AS sent,
    COUNT(*) FILTER (WHERE status='FAILED')::int AS failed,
    COUNT(*) FILTER (WHERE status='QUEUED')::int AS queued
    FROM email_deliveries`)).rows[0];

  const rows=recentDeliveries.length?recentDeliveries.map(x=>`
    <tr>
      <td>${esc(x.email_type)}</td>
      <td>${esc(x.recipient)}</td>
      <td>${esc(x.subject)}</td>
      <td><span class="state ${x.status==='SENT'?'ok':x.status==='FAILED'?'bad':'wait'}">${esc(x.status)}</span></td>
      <td>${esc(x.sent_at||x.created_at||'')}</td>
      <td class="errtxt">${esc(x.error||'')}</td>
    </tr>`).join(''):`<tr><td colspan="6" class="muted">No Hotend Hub emails have been sent yet.</td></tr>`;

  const ready=!!emailConfig.resendApiKey&&!!emailConfig.from;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hotend Hub Marketing</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.top{background:#0b2748;color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{font-weight:900;font-size:26px}.brand span{color:#f5b51b}.top nav{display:flex;gap:14px;flex-wrap:wrap;justify-content:flex-end}.top a{color:#fff;text-decoration:none}.wrap{max-width:1180px;margin:auto;padding:26px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.card,.panel{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px}.n{font-size:30px;font-weight:900;color:#0b2748}.label{color:#667085;margin-top:4px}.panel{margin-top:18px}.setup-row{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid #eef2f6}.setup-row:last-child{border:0}.state{font-size:12px;font-weight:900;padding:5px 9px;border-radius:999px}.state.ok{background:#dcfce7;color:#166534}.state.bad{background:#fee2e2;color:#991b1b}.state.wait{background:#fff3cd;color:#7a5200}.muted{color:#667085}.errtxt{max-width:320px;color:#991b1b;font-size:12px;word-break:break-word}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #eef2f6;font-size:14px}th{color:#475467}.msg{background:#eef6ff;border:1px solid #bfdbfe;padding:12px 14px;border-radius:10px;margin-bottom:16px}@media(max-width:800px){.grid{grid-template-columns:1fr 1fr}.tablewrap{overflow:auto}.top{align-items:flex-start;flex-direction:column}.top nav{justify-content:flex-start}}@media(max-width:520px){.grid{grid-template-columns:1fr}}
  </style></head><body><div class="top"><div class="brand">HOTEND <span>HUB</span></div><nav><a href="/">Dashboard</a><a href="/customers">Customers</a><a href="/reviews-admin">Reviews</a><a href="/automations">Automations</a><a href="/marketing">Marketing</a><a href="/popups">Popups</a><a href="/chats">Chats</a><a href="/chat-settings">Chat Settings</a><a href="/tracking-admin">Tracking</a><a href="/setup">Setup</a><a href="/auth/logout">Log out</a></nav></div>
  <div class="wrap"><h1>Marketing</h1><p class="muted">Email delivery settings and activity logs only. Automated email content and previews are managed under <a href="/automations">Automations</a>.</p>
    ${message?`<div class="msg">${esc(message)}</div>`:''}
    <div class="grid">
      <div class="card"><div class="n">${Number(stats.subscribers||0)}</div><div class="label">Email subscribers</div></div>
      <div class="card"><div class="n">${Number(emailStats.sent||0)}</div><div class="label">Emails sent</div></div>
      <div class="card"><div class="n">${Number(emailStats.failed||0)}</div><div class="label">Failed emails</div></div>
      <div class="card"><div class="n">${Number(emailStats.queued||0)}</div><div class="label">Queued emails</div></div>
    </div>

    <div class="panel"><h2>Email settings</h2>
      <div class="setup-row"><div><strong>Resend API</strong><div class="muted">Required to send Hotend Hub emails.</div></div><span class="state ${emailConfig.resendApiKey?'ok':'bad'}">${emailConfig.resendApiKey?'Ready':'Missing'}</span></div>
      <div class="setup-row"><div><strong>From address</strong><div class="muted">${esc(emailConfig.from||'EMAIL_FROM not configured')}</div></div><span class="state ${emailConfig.from?'ok':'bad'}">${emailConfig.from?'Ready':'Missing'}</span></div>
      <div class="setup-row"><div><strong>Reply-to</strong><div class="muted">${esc(emailConfig.replyTo||'EMAIL_REPLY_TO not configured')}</div></div><span class="state ${emailConfig.replyTo?'ok':'wait'}">${emailConfig.replyTo?'Ready':'Optional'}</span></div>
      <p class="muted" style="margin-bottom:0">Overall sender status: <strong>${ready?'Ready to send':'Needs configuration'}</strong></p>
    </div>

    <div class="panel"><h2>Email activity log</h2><div class="tablewrap"><table>
      <thead><tr><th>Type</th><th>Recipient</th><th>Subject</th><th>Status</th><th>Date</th><th>Error</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>
  </div></body></html>`;
}

export async function popupsPage({popups=[],message=''}) {
  const logo=process.env.HOTEND_LOGO_URL||'https://cdn.shopify.com/s/files/1/1006/1519/2875/files/hotend-filament-supplies-logo.jpg?v=1791002415';
  const rows=popups.length?popups.map(p=>`<div class="popupcard">
    <div class="popuphead">
      <div><strong>${esc(p.name)}</strong><div class="muted">${esc(p.popup_type)} · ${p.enabled?'Enabled':'Disabled'}${p.starts_at?' · starts '+esc(p.starts_at):''}${p.ends_at?' · ends '+esc(p.ends_at):''}</div></div>
      <span class="status ${p.enabled?'ok':'off'}">${p.enabled?'Live':'Off'}</span>
    </div>
    <form method="post" action="/popups/update">
      <input type="hidden" name="id" value="${p.id}">
      <div class="formgrid">
        <label>Name<input name="name" value="${esc(p.name||'')}"></label>
        <label>Type<select name="popup_type"><option value="NEWSLETTER" ${p.popup_type==='NEWSLETTER'?'selected':''}>NEWSLETTER</option><option value="PROMO" ${p.popup_type==='PROMO'?'selected':''}>PROMO</option><option value="ANNOUNCEMENT" ${p.popup_type==='ANNOUNCEMENT'?'selected':''}>ANNOUNCEMENT</option></select></label>
        <label class="wide">Headline<input name="headline" value="${esc(p.headline||'')}" required></label>
        <label class="wide">Message<textarea name="body_text">${esc(p.body_text||'')}</textarea></label>
        <label>Button text<input name="cta_text" value="${esc(p.cta_text||'')}"></label>
        <label>Side tab text<input name="side_tab_text" value="${esc(p.targeting?.side_tab_text||p.headline||'Hotend offer')}" placeholder="e.g. Get 10% off"></label>
        <label>Promo code<input name="discount_code" value="${esc(p.discount_code||'')}" placeholder="Enter your valid Shopify discount code"></label>
        <label>Logo / image URL<input name="image_url" value="${esc(p.image_url||logo)}"></label>
        <label>Button URL<input name="cta_url" value="${esc(p.cta_url||'')}"></label>
        <label>Start time<input name="starts_at" type="datetime-local"></label>
        <label>End time<input name="ends_at" type="datetime-local"></label>
        <label class="wide check"><input name="enabled" type="checkbox" ${p.enabled?'checked':''}> Enable this popup</label>
      </div>
      <div class="hint">For the marketing signup popup, the promo code above is emailed automatically after a successful subscribed signup. Make sure the same code exists as a valid Shopify discount.</div>
      <p><button class="btn" type="submit">Save popup</button></p>
    </form>
    <div class="actions">
      <form method="post" action="/popups/toggle">
        <input type="hidden" name="id" value="${p.id}">
        <input type="hidden" name="enabled" value="${p.enabled?'false':'true'}">
        <button class="btn secondary" type="submit">${p.enabled?'Disable':'Enable'}</button>
      </form>
      <form method="post" action="/popups/delete" onsubmit="return confirm('Delete this popup?')">
        <input type="hidden" name="id" value="${p.id}">
        <button class="btn danger" type="submit">Delete</button>
      </form>
    </div>
  </div>`).join(''):'<p class="muted">No popups created yet.</p>';

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hotend Hub Popups</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.top{background:#0b2748;color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between}.brand{font-weight:900;font-size:26px}.brand span{color:#f5b51b}.top a{color:#fff;text-decoration:none;margin-left:16px}.wrap{max-width:1050px;margin:auto;padding:26px}.panel,.popupcard{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:22px;margin-bottom:18px}.muted{color:#667085}.btn{background:#f5b51b;color:#0b2748;border:0;border-radius:10px;padding:10px 15px;font-weight:900;cursor:pointer}.btn.secondary{background:#eef2f6}.btn.danger{background:#fee2e2;color:#991b1b}.formgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.formgrid .wide{grid-column:1/-1}.formgrid label{font-weight:700}.formgrid input,.formgrid select,.formgrid textarea{width:100%;margin-top:6px;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font:inherit}.formgrid textarea{min-height:90px}.formgrid .check{display:flex;gap:8px;align-items:center;font-weight:700}.formgrid .check input{width:auto;margin:0}.popuphead{display:flex;justify-content:space-between;gap:12px;margin-bottom:14px}.status{font-size:11px;font-weight:900;padding:5px 9px;border-radius:999px;height:max-content}.status.ok{background:#dcfce7;color:#166534}.status.off{background:#eef2f6;color:#475467}.hint{background:#f8fafc;border-radius:10px;padding:11px;margin-top:12px;color:#667085;font-size:13px}.actions{display:flex;gap:8px}.msg{background:#eef6ff;border:1px solid #bfdbfe;padding:12px 14px;border-radius:10px;margin-bottom:16px}@media(max-width:700px){.formgrid{grid-template-columns:1fr}.formgrid .wide{grid-column:auto}.popuphead{flex-direction:column}}
  </style></head><body><div class="top"><div class="brand">HOTEND <span>HUB</span></div><div><a href="/">Dashboard</a><a href="/marketing">Marketing</a><a href="/popups">Popups</a><a href="/chats">Chats</a><a href="/chat-settings">Chat Settings</a><a href="/tracking-admin">Tracking</a><a href="/customers">Customers</a><a href="/reviews-admin">Reviews</a><a href="/automations">Automations</a><a href="/setup">Setup</a><a href="/auth/logout">Log out</a></div></div>
  <div class="wrap"><h1>Marketing Signup Popup</h1>${message?'<div class="msg">'+esc(message)+'</div>':''}
    <div class="panel">
      <h2>How it works</h2>
      <p class="muted">The signup popup opens when a non-subscribed visitor enters the website. Marketing consent is selected by default but the customer can untick it. Closing the modal moves the offer to a side tab. You can edit the side-tab wording below. Successful subscribed signups are saved to Shopify and Hotend Hub, and the configured promo code is emailed automatically.</p>
    </div>
    <div><h2>Edit popup</h2>${rows}</div>
  </div></body></html>`;
}

export async function chatsPage({sessions=[],selected=null,message=''}) {
  const sessionRows=sessions.length?sessions.map(s=>`
    <a class="session ${selected?.id===s.id?'active':''}" href="/chats?id=${s.id}">
      <div class="session-top"><strong>${esc(s.first_name||s.email||s.reference)}</strong><span class="pill ${s.closed_at?'closed':'open'}">${s.closed_at?'Closed':'Open'}</span></div>
      <div class="muted">${esc(s.reference)} · ${Number(s.message_count||0)} messages</div>
      <div class="preview">${esc((s.last_message||'').slice(0,120))}</div>
    </a>`).join(''):'<div class="muted">No chats yet.</div>';

  const thread=selected?`
    <div class="thread-head">
      <div><h2 style="margin:0">${esc(selected.first_name||selected.email||selected.reference)}</h2>
      <div class="muted">${esc(selected.email||'No email')} · ${esc(selected.reference)} · Marketing: ${esc(selected.marketing_status||'')}</div></div>
      <form method="post" action="/chats/status">
        <input type="hidden" name="id" value="${selected.id}">
        <input type="hidden" name="closed" value="${selected.closed_at?'false':'true'}">
        <button class="btn secondary" type="submit">${selected.closed_at?'Reopen':'Close'}</button>
      </form>
    </div>
    ${selected.needs_human?'<div class="handoff"><strong>Human follow-up requested</strong><div class="muted">AI has marked this conversation for staff attention.</div></div>':''}
    ${selected.ai_summary?`<div class="ai-box"><strong>AI summary</strong><div style="white-space:pre-wrap">${esc(selected.ai_summary)}</div></div>`:''}
    <div class="ai-actions">
      <form method="post" action="/chats/ai-draft"><input type="hidden" name="id" value="${selected.id}"><button class="btn secondary" type="submit">Generate AI draft</button></form>
      <form method="post" action="/chats/summary"><input type="hidden" name="id" value="${selected.id}"><button class="btn secondary" type="submit">Update AI summary</button></form>
      <a class="btn secondary" href="/chat-settings">Chat settings</a>
    </div>
    <div class="messages">
      ${selected.messages.map(m=>`<div class="bubble ${m.sender==='CUSTOMER'?'customer':'hotend'}"><div class="sender">${esc(m.sender)}</div><div>${esc(m.message)}</div><div class="time">${esc(m.created_at)}</div></div>`).join('')}
    </div>
    ${selected.ai_draft?`<div class="ai-box"><strong>AI draft</strong><div class="muted">Review and edit before sending.</div></div>`:''}
    <form method="post" action="/chats/reply" class="reply">
      <input type="hidden" name="id" value="${selected.id}">
      <textarea name="message" required placeholder="Write a reply...">${esc(selected.ai_draft||'')}</textarea>
      <button class="btn" type="submit">Send reply</button>
    </form>
    <div class="orders">
      <h3>Recent orders</h3>
      ${selected.orders?.length?selected.orders.map(o=>`<div class="order"><strong>${esc(o.order_name||'Order')}</strong><span>${esc(o.currency||'')} ${esc(o.total_price||'')}</span><span>${esc(o.fulfillment_status||'')}</span></div>`).join(''):'<div class="muted">No linked orders.</div>'}
    </div>
  `:'<div class="empty">Select a conversation from the left.</div>';

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hotend Hub Chats</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.top{background:#0b2748;color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between}.brand{font-weight:900;font-size:26px}.brand span{color:#f5b51b}.top a{color:#fff;text-decoration:none;margin-left:16px}.wrap{max-width:1200px;margin:auto;padding:24px}.layout{display:grid;grid-template-columns:360px 1fr;gap:16px}.panel{background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden}.sidebar{padding:12px}.session{display:block;color:inherit;text-decoration:none;padding:13px;border-radius:12px;border:1px solid transparent}.session:hover,.session.active{background:#f8fafc;border-color:#e2e8f0}.session-top{display:flex;justify-content:space-between;gap:10px}.muted{color:#667085;font-size:13px}.preview{font-size:13px;margin-top:6px;color:#475467}.pill{font-size:11px;font-weight:800;padding:4px 8px;border-radius:999px}.pill.open{background:#dcfce7;color:#166534}.pill.closed{background:#eef2f6;color:#475467}.main{padding:18px}.thread-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:1px solid #eef2f6;padding-bottom:14px}.messages{display:flex;flex-direction:column;gap:10px;padding:18px 0;max-height:55vh;overflow:auto}.bubble{max-width:78%;padding:11px 13px;border-radius:14px}.bubble.customer{background:#eef6ff;align-self:flex-start}.bubble.hotend{background:#fff3cd;align-self:flex-end}.sender{font-size:11px;font-weight:900;margin-bottom:4px}.time{font-size:10px;color:#667085;margin-top:5px}.reply{display:grid;grid-template-columns:1fr auto;gap:10px}.reply textarea{min-height:80px;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font:inherit}.btn{display:inline-block;background:#f5b51b;color:#0b2748;border:0;border-radius:10px;padding:10px 15px;font-weight:900;cursor:pointer;text-decoration:none}.btn.secondary{background:#eef2f6}.ai-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.ai-actions form{margin:0}.ai-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin:12px 0}.handoff{background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:10px;padding:12px;margin:12px 0}.orders{margin-top:18px;border-top:1px solid #eef2f6;padding-top:14px}.order{display:grid;grid-template-columns:1fr auto auto;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9}.empty{padding:60px 20px;text-align:center;color:#667085}.msg{background:#eef6ff;border:1px solid #bfdbfe;padding:12px 14px;border-radius:10px;margin-bottom:16px}@media(max-width:800px){.layout{grid-template-columns:1fr}.messages{max-height:none}.reply{grid-template-columns:1fr}.bubble{max-width:92%}}
  </style></head><body><div class="top"><div class="brand">HOTEND <span>HUB</span></div><div><a href="/">Dashboard</a><a href="/marketing">Marketing</a><a href="/popups">Popups</a><a href="/chats">Chats</a><a href="/chat-settings">Chat Settings</a><a href="/tracking-admin">Tracking</a><a href="/customers">Customers</a><a href="/reviews-admin">Reviews</a><a href="/automations">Automations</a><a href="/setup">Setup</a><a href="/auth/logout">Log out</a></div></div>
  <div class="wrap"><h1>Chat Inbox</h1>${message?'<div class="msg">'+esc(message)+'</div>':''}<div class="layout">
    <div class="panel sidebar">${sessionRows}</div>
    <div class="panel main">${thread}</div>
  </div></div></body></html>`;
}


function trackingLabel(status){
  const s=String(status||'').toUpperCase();
  if(s==='SUCCESS'||s.includes('DELIVER'))return 'Delivered';
  if(s.includes('OUT_FOR_DELIVERY')||s.includes('OUT FOR DELIVERY'))return 'Out for delivery';
  if(s.includes('IN_TRANSIT')||s.includes('IN TRANSIT')||s.includes('TRANSIT'))return 'In transit';
  if(s.includes('ATTEMPT'))return 'Delivery attempted';
  if(s.includes('FAIL')||s.includes('EXCEPTION')||s.includes('HOLD'))return 'Delivery issue';
  if(s.includes('PICKUP')||s.includes('BOOKED')||s.includes('PENDING')||s.includes('OPEN'))return 'Courier booked for pick up';
  return s?s.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,m=>m.toUpperCase()):'Courier booked for pick up';
}

export async function trackingAdminPage({shipments=[],selected=null,stats={total:0,active:0,delivered:0},carrierConfig={nzPost:false,freightways:false,aramex:false},message=''}) {
  const rows=shipments.length?shipments.map(s=>`
    <a class="shipment ${selected?.id===s.id?'active':''}" href="/tracking-admin?id=${s.id}">
      <div class="shiptop"><strong>${esc(s.order_name||s.tracking_number||'Shipment')}</strong><span class="pill">${esc(trackingLabel(s.status))}</span></div>
      <div class="muted">${esc(s.carrier||'Courier')} · ${esc(s.tracking_number||'No tracking number')}</div>
      <div class="muted">${esc(s.first_name||s.email||'')}</div>
    </a>`).join(''):'<div class="muted">No shipments synced yet.</div>';

  const detail=selected?`
    <div class="detail-head">
      <div><h2 style="margin:0">${esc(selected.order_name||'Shipment')}</h2><div class="muted">${esc(selected.carrier||'Courier')} · ${esc(selected.tracking_number||'')}</div></div>
      <span class="statusbig">${esc(trackingLabel(selected.status))}</span>
    </div>
    <div class="info">
      <div><span>Customer</span><strong>${esc([selected.first_name,selected.last_name].filter(Boolean).join(' ')||selected.email||'')}</strong></div>
      <div><span>Email</span><strong>${esc(selected.email||'')}</strong></div>
      <div><span>Shopify fulfillment</span><strong>${esc(selected.fulfillment_status||'')}</strong></div>
      <div><span>Last update</span><strong>${esc(selected.last_event_at||selected.created_at||'')}</strong></div>
    </div>
    ${selected.tracking_url?`<p><a class="btn" href="${esc(selected.tracking_url)}" target="_blank" rel="noopener">Open courier tracking</a></p>`:''}
    <h3>Tracking timeline</h3>
    <div class="timeline">
      ${selected.events?.length?selected.events.map(e=>`<div class="event"><div class="dot"></div><div><strong>${esc(trackingLabel(e.status))}</strong><div>${esc(e.description||'')}</div><div class="muted">${esc(e.location||'')}${e.location?' · ':''}${esc(e.event_time||e.created_at||'')}</div></div></div>`).join(''):'<div class="muted">No detailed courier scan events are available yet. Shopify fulfillment updates will appear here.</div>'}
    </div>
  `:'<div class="empty">Select a shipment from the left.</div>';

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hotend Hub Tracking</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.top{background:#0b2748;color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between}.brand{font-size:26px;font-weight:900}.brand span{color:#f5b51b}.top a{color:#fff;text-decoration:none;margin-left:16px}.wrap{max-width:1200px;margin:auto;padding:24px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}.card,.panel{background:#fff;border:1px solid #e5e7eb;border-radius:16px}.card{padding:18px}.n{font-size:30px;font-weight:900;color:#0b2748}.muted{color:#667085;font-size:13px}.layout{display:grid;grid-template-columns:380px 1fr;gap:16px}.sidebar{padding:10px}.shipment{display:block;color:inherit;text-decoration:none;padding:13px;border-radius:12px;border:1px solid transparent}.shipment:hover,.shipment.active{background:#f8fafc;border-color:#e2e8f0}.shiptop{display:flex;justify-content:space-between;gap:10px}.pill{font-size:11px;font-weight:800;background:#eef6ff;color:#0b2748;padding:4px 8px;border-radius:999px}.main{padding:20px}.detail-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;border-bottom:1px solid #eef2f6;padding-bottom:14px}.statusbig{background:#dcfce7;color:#166534;padding:7px 11px;border-radius:999px;font-weight:900}.info{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}.info div{background:#f8fafc;border-radius:10px;padding:12px}.info span{display:block;color:#667085;font-size:12px}.btn{display:inline-block;background:#f5b51b;color:#0b2748;text-decoration:none;border:0;border-radius:10px;padding:10px 15px;font-weight:900}.event{display:grid;grid-template-columns:18px 1fr;gap:10px;padding:10px 0}.dot{width:10px;height:10px;border-radius:999px;background:#0b2748;margin-top:5px}.empty{padding:60px 20px;text-align:center;color:#667085}.msg{background:#eef6ff;border:1px solid #bfdbfe;padding:12px 14px;border-radius:10px;margin-bottom:16px}@media(max-width:800px){.layout{grid-template-columns:1fr}.cards{grid-template-columns:1fr}.info{grid-template-columns:1fr}}
  </style></head><body><div class="top"><div class="brand">HOTEND <span>HUB</span></div><div><a href="/">Dashboard</a><a href="/marketing">Marketing</a><a href="/popups">Popups</a><a href="/chats">Chats</a><a href="/chat-settings">Chat Settings</a><a href="/tracking-admin">Tracking</a><a href="/customers">Customers</a><a href="/reviews-admin">Reviews</a><a href="/automations">Automations</a><a href="/setup">Setup</a><a href="/auth/logout">Log out</a></div></div>
  <div class="wrap"><h1>Courier Tracking</h1>${message?'<div class="msg">'+esc(message)+'</div>':''}
    <div class="cards"><div class="card"><div class="n">${Number(stats.total||0)}</div><div class="muted">Total shipments</div></div><div class="card"><div class="n">${Number(stats.active||0)}</div><div class="muted">Active shipments</div></div><div class="card"><div class="n">${Number(stats.delivered||0)}</div><div class="muted">Delivered shipments</div></div></div>
    <div class="panel" style="padding:14px;margin-bottom:16px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <form method="post" action="/admin/sync-tracking"><button class="btn" type="submit">Sync Shopify tracking now</button></form>
        <form method="post" action="/admin/register-nzpost-watches"><button class="btn secondary" type="submit">Register NZ Post live tracking</button></form>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <span class="pill">NZ Post API: ${carrierConfig.nzPost?'Ready':'Missing key'}</span>
        <span class="pill">NZ Couriers/Post Haste API: ${carrierConfig.freightways?'Ready':'Missing credentials'}</span>
        <span class="pill">Aramex API: ${carrierConfig.aramex?'Ready':'Missing credentials'}</span>
      </div>
    </div>
    <div class="layout"><div class="panel sidebar">${rows}</div><div class="panel main">${detail}</div></div>
  </div></body></html>`;
}

export async function publicTrackingPage({shipment=null,searched=false,order='',email='',phone=''}) {
  const timeline=shipment?.events?.length?shipment.events.map(e=>`<div class="event"><div class="dot"></div><div><strong>${esc(trackingLabel(e.status))}</strong><div>${esc(e.description||'')}</div><div class="muted">${esc(e.location||'')}${e.location?' · ':''}${esc(e.event_time||e.created_at||'')}</div></div></div>`).join(''):'<div class="muted">No detailed scan events available yet.</div>';
  const result=shipment?`
    <div class="result">
      <div class="result-head"><div><div class="muted">Order</div><h2>${esc(shipment.order_name||'')}</h2></div><span class="status">${esc(trackingLabel(shipment.status))}</span></div>
      <div class="meta"><div><span>Courier</span><strong>${esc(shipment.carrier||'')}</strong></div><div><span>Tracking number</span><strong>${esc(shipment.tracking_number||'')}</strong></div></div>
      <h3>Tracking updates</h3>${timeline}
      ${shipment.tracking_url?`<p><a class="btn secondary" href="${esc(shipment.tracking_url)}" target="_blank" rel="noopener">View on courier website</a></p>`:''}
    </div>
  `:searched?'<div class="notfound">We could not match that order number with those contact details. Check your order number and email or phone number, then try again.</div>':'';

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Track your Hotend order</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:900px;margin:40px auto;padding:0 18px}.brand{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:18px;text-align:center}.brand img{display:block;margin:auto;max-width:110px;width:28%;height:auto}.panel,.result{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;margin-top:16px}.lookup{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}.choice{display:flex;gap:8px;align-items:center;margin:14px 0 6px}.choice button{border:0;background:transparent;color:#0b2748;font-weight:800;cursor:pointer;padding:0 0 4px;border-bottom:2px solid transparent}.choice button.active{border-bottom-color:#f5b51b}.field{display:none}.field.active{display:block}label{display:block;font-weight:700;margin:12px 0}input{width:100%;margin-top:6px;border:1px solid #cbd5e1;border-radius:10px;padding:12px;font:inherit}.btn{display:inline-block;background:#f5b51b;color:#0b2748;text-decoration:none;border:0;border-radius:10px;padding:12px 18px;font-weight:900;cursor:pointer}.btn.secondary{background:#0b2748;color:#fff}.muted{color:#667085;font-size:13px}.hint{background:#f8fafc;border-radius:10px;padding:11px 13px;margin-top:12px;color:#667085;font-size:12px}.result-head{display:flex;justify-content:space-between;gap:15px;align-items:flex-start}.result-head h2{margin:3px 0}.status{background:#dcfce7;color:#166534;padding:7px 11px;border-radius:999px;font-weight:900}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}.meta div{background:#f8fafc;border-radius:10px;padding:12px}.meta span{display:block;color:#667085;font-size:12px}.event{display:grid;grid-template-columns:18px 1fr;gap:10px;padding:10px 0;border-bottom:1px solid #eef2f6}.dot{width:10px;height:10px;border-radius:999px;background:#0b2748;margin-top:5px}.notfound{background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:12px;padding:14px;margin-top:16px}@media(max-width:700px){.lookup,.meta{grid-template-columns:1fr}.wrap{margin-top:18px}.panel,.result{padding:18px}}
  </style>
  <script>
    function setContact(type){
      const email=document.getElementById('email-field');
      const phone=document.getElementById('phone-field');
      const eb=document.getElementById('use-email');
      const pb=document.getElementById('use-phone');
      const usePhone=type==='phone';
      email.classList.toggle('active',!usePhone);
      phone.classList.toggle('active',usePhone);
      eb.classList.toggle('active',!usePhone);
      pb.classList.toggle('active',usePhone);
      email.querySelector('input').disabled=usePhone;
      phone.querySelector('input').disabled=!usePhone;
      if(usePhone)phone.querySelector('input').focus(); else email.querySelector('input').focus();
    }
    document.addEventListener('DOMContentLoaded',()=>setContact(${phone&&!email?"'phone'":"'email'"}));
  </script></head><body><div class="wrap">
    <div class="brand"><img src="https://cdn.shopify.com/s/files/1/1006/1519/2875/files/hotend-filament-supplies-logo.jpg?v=1791002415" alt="Hotend Filament Supplies"></div>
    <div class="panel">
      <h1>Track your order</h1>
      <p class="muted">Enter your Hotend order number and verify it with the email address or phone number used for your order.</p>
      <form method="get" action="/track">
        <div class="lookup">
          <div>
            <label>Order number<input name="order" value="${esc(order)}" required placeholder="#1234" autocomplete="off"></label>
            <div class="hint">You can enter the number with or without the # symbol.</div>
          </div>
          <div>
            <div class="choice"><span class="muted">Verify with:</span><button id="use-email" type="button" onclick="setContact('email')">Email</button><span class="muted">or</span><button id="use-phone" type="button" onclick="setContact('phone')">Phone</button></div>
            <label id="email-field" class="field active">Email address<input type="email" name="email" value="${esc(email)}" placeholder="you@example.com" autocomplete="email"></label>
            <label id="phone-field" class="field">Phone number<input type="tel" name="phone" value="${esc(phone)}" placeholder="021 123 4567" autocomplete="tel"></label>
          </div>
        </div>
        <p><button class="btn" type="submit">Track order</button></p>
      </form>
    </div>
    ${result}
  </div></body></html>`;
}

export async function customersPage({customers=[],selected=null,stats={total:0,subscribed:0,buyers:0,lifetime_value:0},search='',message=''}) {
  const list=customers.length?customers.map(c=>`
    <a class="customer ${selected?.customer?.id===c.id?'active':''}" href="/customers?id=${c.id}${search?'&q='+encodeURIComponent(search):''}">
      <div class="customer-top"><strong>${esc([c.first_name,c.last_name].filter(Boolean).join(' ')||c.email||'Customer')}</strong><span class="tag ${c.marketing_status==='SUBSCRIBED'?'ok':'neutral'}">${esc(c.marketing_status)}</span></div>
      <div class="muted">${esc(c.email||'No email')}</div>
      <div class="muted">${Number(c.order_count||0)} orders · ${Number(c.review_count||0)} reviews · ${Number(c.chat_count||0)} chats</div>
    </a>`).join(''):'<div class="muted">No customers found.</div>';

  const profile=selected?(()=>{
    const c=selected.customer;
    const orders=selected.orders.length?selected.orders.map(o=>`<tr><td>${esc(o.order_name||'')}</td><td>${esc(o.currency||'')} ${esc(o.total_price||'')}</td><td>${esc(o.financial_status||'')}</td><td>${esc(o.fulfillment_status||'')}</td><td>${esc(o.created_at_shopify||'')}</td></tr>`).join(''):'<tr><td colspan="5" class="muted">No orders.</td></tr>';
    const reviews=selected.reviews.length?selected.reviews.map(r=>`<div class="entry"><strong>${esc(r.product_title||r.shopify_product_id)}</strong><div>${'★'.repeat(Number(r.rating||0))}${'☆'.repeat(Math.max(0,5-Number(r.rating||0)))}</div><div>${esc(r.feedback||'')}</div>${r.requested_materials?'<div class="muted">Requested materials: '+esc(r.requested_materials)+'</div>':''}${r.requested_colours?'<div class="muted">Requested colours: '+esc(r.requested_colours)+'</div>':''}</div>`).join(''):'<div class="muted">No reviews.</div>';
    const chats=selected.chats.length?selected.chats.map(s=>`<a class="entry link" href="/chats?id=${s.id}"><strong>${esc(s.reference)}</strong><div>${esc((s.last_message||'').slice(0,140))}</div><div class="muted">${s.closed_at?'Closed':'Open'} · ${esc(s.last_activity_at||'')}</div></a>`).join(''):'<div class="muted">No chats.</div>';
    const emails=selected.emails.length?selected.emails.map(e=>`<div class="entry"><strong>${esc(e.subject)}</strong><div class="muted">${esc(e.email_type)} · ${esc(e.status)} · ${esc(e.sent_at||e.created_at||'')}</div>${e.error?'<div class="error">'+esc(e.error)+'</div>':''}</div>`).join(''):'<div class="muted">No email activity.</div>';
    const abandoned=selected.abandoned.length?selected.abandoned.map(a=>`<div class="entry"><strong>${esc(a.currency||'')} ${esc(a.total_price||'')}</strong><div class="muted">${a.recovered?'Recovered':'Open'} · ${esc(a.created_at_shopify||'')}</div></div>`).join(''):'<div class="muted">No abandoned checkouts.</div>';
    const shipments=selected.shipments.length?selected.shipments.map(s=>`<a class="entry link" href="/tracking-admin?id=${s.id}"><strong>${esc(s.order_name||'Shipment')} · ${esc(s.carrier||'Courier')}</strong><div>${esc(s.tracking_number||'')}</div><div class="muted">${esc(trackingLabel(s.status))} · ${esc(s.last_event_at||'')}</div></a>`).join(''):'<div class="muted">No shipments.</div>';
    return `
      <div class="profile-head"><div><h2 style="margin:0">${esc([c.first_name,c.last_name].filter(Boolean).join(' ')||'Customer')}</h2><div class="muted">${esc(c.email||'No email')} · ${esc(c.shopify_customer_id||'')}</div></div><span class="tag ${c.marketing_status==='SUBSCRIBED'?'ok':'neutral'}">${esc(c.marketing_status)}</span></div>
      <div class="facts"><div><span>Orders</span><strong>${Number(c.total_orders||0)}</strong></div><div><span>Total spent</span><strong>$${Number(c.total_spent||0).toFixed(2)}</strong></div><div><span>Opt-in level</span><strong>${esc(c.marketing_opt_in_level||'—')}</strong></div><div><span>Updated</span><strong>${esc(c.updated_at||'')}</strong></div></div>
      <h3>Orders</h3><div class="tablewrap"><table><thead><tr><th>Order</th><th>Total</th><th>Payment</th><th>Fulfillment</th><th>Date</th></tr></thead><tbody>${orders}</tbody></table></div>
      <h3>Shipments</h3>${shipments}
      <h3>Reviews</h3>${reviews}
      <h3>Chats</h3>${chats}
      <h3>Email activity</h3>${emails}
      <h3>Abandoned checkouts</h3>${abandoned}
    `;
  })():'<div class="empty">Select a customer from the left.</div>';

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hotend Hub Customers</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.top{background:#0b2748;color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between}.brand{font-size:26px;font-weight:900}.brand span{color:#f5b51b}.top a{color:#fff;text-decoration:none;margin-left:16px}.wrap{max-width:1280px;margin:auto;padding:24px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}.card,.panel{background:#fff;border:1px solid #e5e7eb;border-radius:16px}.card{padding:18px}.n{font-size:30px;font-weight:900;color:#0b2748}.muted{color:#667085;font-size:13px}.layout{display:grid;grid-template-columns:390px 1fr;gap:16px}.sidebar{padding:10px}.search{display:flex;gap:8px;margin-bottom:10px}.search input{flex:1;border:1px solid #cbd5e1;border-radius:9px;padding:10px}.btn{background:#f5b51b;color:#0b2748;border:0;border-radius:9px;padding:10px 14px;font-weight:900;cursor:pointer}.customer{display:block;color:inherit;text-decoration:none;padding:13px;border-radius:12px;border:1px solid transparent}.customer:hover,.customer.active{background:#f8fafc;border-color:#e2e8f0}.customer-top,.profile-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.tag{font-size:11px;font-weight:900;padding:4px 8px;border-radius:999px}.tag.ok{background:#dcfce7;color:#166534}.tag.neutral{background:#eef2f6;color:#475467}.main{padding:20px}.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.facts div{background:#f8fafc;border-radius:10px;padding:12px}.facts span{display:block;color:#667085;font-size:12px}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #eef2f6;font-size:13px}.entry{display:block;padding:10px 0;border-bottom:1px solid #eef2f6}.entry.link{color:inherit;text-decoration:none}.entry.link:hover{background:#f8fafc}.error{color:#991b1b;font-size:12px;margin-top:4px}.empty{padding:60px 20px;text-align:center;color:#667085}.msg{background:#eef6ff;border:1px solid #bfdbfe;padding:12px 14px;border-radius:10px;margin-bottom:16px}@media(max-width:900px){.layout{grid-template-columns:1fr}.cards,.facts{grid-template-columns:1fr 1fr}}@media(max-width:560px){.cards,.facts{grid-template-columns:1fr}}
  </style></head><body><div class="top"><div class="brand">HOTEND <span>HUB</span></div><div><a href="/">Dashboard</a><a href="/customers">Customers</a><a href="/reviews-admin">Reviews</a><a href="/automations">Automations</a><a href="/marketing">Marketing</a><a href="/popups">Popups</a><a href="/chats">Chats</a><a href="/chat-settings">Chat Settings</a><a href="/tracking-admin">Tracking</a><a href="/setup">Setup</a><a href="/auth/logout">Log out</a></div></div>
  <div class="wrap"><h1>Customers</h1>${message?'<div class="msg">'+esc(message)+'</div>':''}
    <div class="cards"><div class="card"><div class="n">${Number(stats.total||0)}</div><div class="muted">Customers</div></div><div class="card"><div class="n">${Number(stats.subscribed||0)}</div><div class="muted">Email subscribers</div></div><div class="card"><div class="n">${Number(stats.buyers||0)}</div><div class="muted">Customers with orders</div></div><div class="card"><div class="n">$ ${Number(stats.lifetime_value||0).toFixed(2)}</div><div class="muted">Imported customer value</div></div></div>
    <div class="layout"><div class="panel sidebar"><form class="search" method="get" action="/customers"><input name="q" value="${esc(search)}" placeholder="Search name or email"><button class="btn" type="submit">Search</button></form>${list}</div><div class="panel main">${profile}</div></div>
  </div></body></html>`;
}


export async function reviewsAdminPage({reviews=[],stats={summary:{},products:[],materialSuggestions:[],colourSuggestions:[]},status='all',rating='',search='',message=''}) {
  const s=stats.summary||{};
  const total=Number(s.total||0);
  const bars=[5,4,3,2,1].map(n=>{
    const key={5:'five',4:'four',3:'three',2:'two',1:'one'}[n];
    const count=Number(s[key]||0);
    const pct=total?Math.round(count*100/total):0;
    return `<div class="barrow"><span>${n}★</span><div class="bar"><div style="width:${pct}%"></div></div><strong>${count}</strong></div>`;
  }).join('');

  const rows=reviews.length?reviews.map(r=>{
    const back='/reviews-admin?'+new URLSearchParams({status,rating,q:search}).toString();
    return `<div class="review">
      <div class="reviewtop"><div><strong>${esc(r.product_title||r.shopify_product_id||'Product')}</strong><div class="stars">${'★'.repeat(Number(r.rating||0))}${'☆'.repeat(Math.max(0,5-Number(r.rating||0)))}</div></div><span class="pill ${r.approved?'ok':'hidden'}">${r.approved?'Approved':'Hidden'}</span></div>
      <div class="muted">${esc(r.variant_title||'')}${r.variant_title?' · ':''}${esc(r.order_name||'')} · ${esc([r.first_name,r.last_name].filter(Boolean).join(' ')||r.email||'Customer')}</div>
      ${r.feedback?`<p>${esc(r.feedback)}</p>`:''}
      ${r.requested_materials?`<div class="suggest"><strong>Requested materials:</strong> ${esc(r.requested_materials)}</div>`:''}
      ${r.requested_colours?`<div class="suggest"><strong>Requested colours:</strong> ${esc(r.requested_colours)}</div>`:''}
      <div class="actions">
        ${r.customer_id?`<a class="btn secondary" href="/customers?id=${r.customer_id}">Customer</a>`:''}
        <form method="post" action="/reviews-admin/moderate">
          <input type="hidden" name="id" value="${r.id}">
          <input type="hidden" name="approved" value="${r.approved?'false':'true'}">
          <input type="hidden" name="back" value="${esc(back)}">
          <button class="btn ${r.approved?'danger':''}" type="submit">${r.approved?'Hide review':'Approve review'}</button>
        </form>
      </div>
    </div>`;
  }).join(''):'<div class="muted">No reviews match these filters.</div>';

  const products=stats.products?.length?stats.products.map(p=>`<tr><td>${esc(p.product_title)}</td><td>${Number(p.review_count||0)}</td><td>${Number(p.avg_rating||0).toFixed(2)}</td></tr>`).join(''):'<tr><td colspan="3" class="muted">No product review data yet.</td></tr>';
  const mats=stats.materialSuggestions?.length?stats.materialSuggestions.map(x=>`<div class="idea"><span>${esc(x.value)}</span><strong>${Number(x.mentions||0)}</strong></div>`).join(''):'<div class="muted">No material suggestions yet.</div>';
  const cols=stats.colourSuggestions?.length?stats.colourSuggestions.map(x=>`<div class="idea"><span>${esc(x.value)}</span><strong>${Number(x.mentions||0)}</strong></div>`).join(''):'<div class="muted">No colour suggestions yet.</div>';

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hotend Hub Reviews</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.top{background:#0b2748;color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{font-size:26px;font-weight:900}.brand span{color:#f5b51b}.top nav{display:flex;gap:14px;flex-wrap:wrap;justify-content:flex-end}.top a{color:#fff;text-decoration:none}.wrap{max-width:1280px;margin:auto;padding:24px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card,.panel{background:#fff;border:1px solid #e5e7eb;border-radius:16px}.card{padding:18px}.n{font-size:30px;font-weight:900;color:#0b2748}.muted{color:#667085;font-size:13px}.layout{display:grid;grid-template-columns:1.25fr .75fr;gap:16px;margin-top:16px}.panel{padding:20px}.filters{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;margin-bottom:16px}.filters input,.filters select{border:1px solid #cbd5e1;border-radius:9px;padding:10px;font:inherit}.btn{display:inline-block;background:#f5b51b;color:#0b2748;border:0;border-radius:9px;padding:9px 13px;font-weight:900;text-decoration:none;cursor:pointer}.btn.secondary{background:#eef2f6}.btn.danger{background:#fee2e2;color:#991b1b}.review{padding:16px 0;border-bottom:1px solid #eef2f6}.review:last-child{border-bottom:0}.reviewtop{display:flex;justify-content:space-between;gap:12px}.stars{color:#d99500;letter-spacing:1px}.pill{font-size:11px;font-weight:900;padding:4px 8px;border-radius:999px}.pill.ok{background:#dcfce7;color:#166534}.pill.hidden{background:#eef2f6;color:#475467}.suggest{background:#f8fafc;padding:8px 10px;border-radius:9px;margin:7px 0;font-size:13px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.actions form{margin:0}.barrow{display:grid;grid-template-columns:32px 1fr 35px;gap:8px;align-items:center;margin:7px 0}.bar{height:9px;background:#eef2f6;border-radius:999px;overflow:hidden}.bar div{height:100%;background:#f5b51b}.ideas{display:grid;grid-template-columns:1fr 1fr;gap:16px}.idea{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #eef2f6}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #eef2f6;font-size:13px}.msg{background:#eef6ff;border:1px solid #bfdbfe;padding:12px 14px;border-radius:10px;margin-bottom:16px}@media(max-width:900px){.cards{grid-template-columns:1fr 1fr}.layout{grid-template-columns:1fr}.filters{grid-template-columns:1fr 1fr}.ideas{grid-template-columns:1fr}}@media(max-width:560px){.cards,.filters{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}.top nav{justify-content:flex-start}}
  </style></head><body><div class="top"><div class="brand">HOTEND <span>HUB</span></div><nav><a href="/">Dashboard</a><a href="/customers">Customers</a><a href="/reviews-admin">Reviews</a><a href="/automations">Automations</a><a href="/marketing">Marketing</a><a href="/popups">Popups</a><a href="/chats">Chats</a><a href="/chat-settings">Chat Settings</a><a href="/tracking-admin">Tracking</a><a href="/setup">Setup</a><a href="/auth/logout">Log out</a></nav></div>
  <div class="wrap"><h1>Reviews</h1>${message?'<div class="msg">'+esc(message)+'</div>':''}
    <div class="cards">
      <div class="card"><div class="n">${total}</div><div class="muted">Total reviews</div></div>
      <div class="card"><div class="n">${Number(s.avg_rating||0).toFixed(2)}</div><div class="muted">Average rating</div></div>
      <div class="card"><div class="n">${Number(s.approved||0)}</div><div class="muted">Approved</div></div>
      <div class="card"><div class="n">${Number(s.hidden||0)}</div><div class="muted">Hidden</div></div>
    </div>
    <div class="layout">
      <div class="panel"><h2>Review moderation</h2>
        <form class="filters" method="get" action="/reviews-admin">
          <input name="q" value="${esc(search)}" placeholder="Search product, customer or review">
          <select name="status"><option value="all" ${status==='all'?'selected':''}>All status</option><option value="approved" ${status==='approved'?'selected':''}>Approved</option><option value="hidden" ${status==='hidden'?'selected':''}>Hidden</option></select>
          <select name="rating"><option value="">All ratings</option>${[5,4,3,2,1].map(n=>`<option value="${n}" ${String(rating)===String(n)?'selected':''}>${n} stars</option>`).join('')}</select>
          <button class="btn" type="submit">Filter</button>
        </form>${rows}
      </div>
      <div>
        <div class="panel"><h2>Rating breakdown</h2>${bars}</div>
        <div class="panel" style="margin-top:16px"><h2>Product summary</h2><div class="tablewrap"><table><thead><tr><th>Product</th><th>Reviews</th><th>Avg</th></tr></thead><tbody>${products}</tbody></table></div></div>
      </div>
    </div>
    <div class="panel" style="margin-top:16px"><h2>What customers want next</h2><div class="ideas"><div><h3>Materials</h3>${mats}</div><div><h3>Colours</h3>${cols}</div></div></div>
  </div></body></html>`;
}


export async function automationsPage({rules=[],message=''}) {
  const byKey=Object.fromEntries(rules.map(r=>[r.key,r]));
  const welcome=byKey['welcome-story']||{enabled:true,config:{}};
  const abandoned=byKey['abandoned-cart']||{enabled:true,config:{delays_days:[1,5,10]}};
  const review=byKey['post-purchase-review']||{enabled:true,config:{delay_days:7}};
  const transcript=byKey['chat-transcript']||{enabled:true,config:{idle_minutes:10}};
  const delays=Array.isArray(abandoned.config?.delays_days)?abandoned.config.delays_days:[1,5,10];

  const defaults={
    'welcome-story':defaultAutomationEditor('welcome-story'),
    'abandoned-cart':defaultAutomationEditor('abandoned-cart'),
    'post-purchase-review':defaultAutomationEditor('post-purchase-review'),
    'chat-transcript':defaultAutomationEditor('chat-transcript')
  };
  const status=r=>`<span class="state ${r.enabled?'ok':'off'}">${r.enabled?'Enabled':'Disabled'}</span>`;
  const editor=(key,r)=>`<div class="editor" id="editor-${key}">
    <label>Email subject<input name="email_subject" value="${esc(r.config?.email_subject||defaults[key].subject)}"></label>
    <label>Email HTML<textarea name="email_html" spellcheck="false">${esc(r.config?.email_html||defaults[key].html)}</textarea></label>
    <div class="token-note">Edit the HTML directly. Keep the <code>{{...}}</code> placeholders you need for customer/order-specific values.</div>
  </div>`;
  const buttons=(key,label)=>`<div class="actions">
    <button class="btn" type="submit">Save ${label}</button>
    <button class="btn secondary" type="button" onclick="toggleEditor('${key}',this)">Edit email</button>
    <a class="btn preview" href="/automations/preview.pdf?key=${encodeURIComponent(key)}" target="_blank" rel="noopener">Preview PDF</a>
    <button class="btn test" type="submit" formaction="/automations/test-send" formmethod="post">Send test</button>
  </div>`;

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hotend Hub Automations</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.top{background:#0b2748;color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{font-size:26px;font-weight:900}.brand span{color:#f5b51b}.top nav{display:flex;gap:14px;flex-wrap:wrap;justify-content:flex-end}.top a{color:#fff;text-decoration:none}.wrap{max-width:1040px;margin:auto;padding:24px}.panel{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin-bottom:16px}.head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.muted{color:#667085;font-size:13px}.state{font-size:11px;font-weight:900;padding:5px 9px;border-radius:999px}.state.ok{background:#dcfce7;color:#166534}.state.off{background:#eef2f6;color:#475467}.fields{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}.fields label,.editor label{font-weight:700}.fields input,.editor input,.editor textarea{width:100%;margin-top:6px;border:1px solid #cbd5e1;border-radius:9px;padding:10px;font:inherit}.editor{display:none;margin-top:16px;padding:14px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px}.editor.open{display:grid;gap:12px}.editor textarea{min-height:280px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.45}.toggle{display:flex;align-items:center;gap:8px;margin-top:14px}.btn{background:#f5b51b;color:#0b2748;border:0;border-radius:9px;padding:10px 14px;font-weight:900;cursor:pointer;text-decoration:none;display:inline-block;font-size:14px}.btn.secondary{background:#eef2f6}.btn.preview{background:#0b2748;color:#fff}.btn.test{background:#e7f4ec;color:#166534}.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}.msg{background:#eef6ff;border:1px solid #bfdbfe;padding:12px 14px;border-radius:10px;margin-bottom:16px}.note{background:#f8fafc;border-radius:10px;padding:12px;margin-top:12px;font-size:13px}.token-note{color:#667085;font-size:12px}.token-note code{background:#eef2f6;border-radius:5px;padding:2px 5px}@media(max-width:700px){.fields{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}.top nav{justify-content:flex-start}.actions .btn{flex:1 1 44%;text-align:center}}
  </style><script>function toggleEditor(key,btn){const el=document.getElementById('editor-'+key);const open=el.classList.toggle('open');btn.textContent=open?'Hide editor':'Edit email';if(open)el.querySelector('textarea')?.focus();}</script></head><body><div class="top"><div class="brand">HOTEND <span>HUB</span></div><nav><a href="/">Dashboard</a><a href="/customers">Customers</a><a href="/reviews-admin">Reviews</a><a href="/automations">Automations</a><a href="/marketing">Marketing</a><a href="/popups">Popups</a><a href="/chats">Chats</a><a href="/chat-settings">Chat Settings</a><a href="/tracking-admin">Tracking</a><a href="/setup">Setup</a><a href="/auth/logout">Log out</a></nav></div>
  <div class="wrap"><h1>Automations</h1><p class="muted">Control automated emails, edit their HTML, preview the saved version as PDF, and send a test to ${esc(process.env.EMAIL_REPLY_TO||'info@hotend.co.nz')}.</p>${message?'<div class="msg">'+esc(message)+'</div>':''}

    <form class="panel" method="post" action="/automations/update">
      <input type="hidden" name="key" value="welcome-story">
      <div class="head"><div><h2 style="margin:0">Our Story welcome email</h2><p class="muted">Sent once when a Shopify customer becomes an email subscriber.</p></div>${status(welcome)}</div>
      <label class="toggle"><input type="checkbox" name="enabled" ${welcome.enabled?'checked':''}> Enable this automation</label>
      <div class="note">Current trigger: immediately after a customer changes to <strong>SUBSCRIBED</strong>.</div>
      ${editor('welcome-story',welcome)}
      ${buttons('welcome-story','welcome automation')}
    </form>

    <form class="panel" method="post" action="/automations/update">
      <input type="hidden" name="key" value="abandoned-cart">
      <div class="head"><div><h2 style="margin:0">Abandoned checkout recovery</h2><p class="muted">Sends recovery emails only to customers with marketing consent and stops future steps when the checkout is recovered.</p></div>${status(abandoned)}</div>
      <label class="toggle"><input type="checkbox" name="enabled" ${abandoned.enabled?'checked':''}> Enable this automation</label>
      <div class="fields">
        <label>Email 1 delay (days)<input type="number" min="0" step="1" name="delay1" value="${Number(delays[0]??1)}"></label>
        <label>Email 2 delay (days)<input type="number" min="0" step="1" name="delay2" value="${Number(delays[1]??5)}"></label>
        <label>Email 3 delay (days)<input type="number" min="0" step="1" name="delay3" value="${Number(delays[2]??10)}"></label>
      </div>
      <div class="note">Existing scheduled steps keep their current due dates. New abandoned checkouts use these updated delays.</div>
      ${editor('abandoned-cart',abandoned)}
      ${buttons('abandoned-cart','abandoned checkout automation')}
    </form>

    <form class="panel" method="post" action="/automations/update">
      <input type="hidden" name="key" value="post-purchase-review">
      <div class="head"><div><h2 style="margin:0">Review request</h2><p class="muted">Schedules a product review request after a newly fulfilled Shopify order.</p></div>${status(review)}</div>
      <label class="toggle"><input type="checkbox" name="enabled" ${review.enabled?'checked':''}> Enable this automation</label>
      <div class="fields"><label>Delay after fulfillment (days)<input type="number" min="0" step="1" name="delay_days" value="${Number(review.config?.delay_days??7)}"></label></div>
      <div class="note">Historical fulfilled orders are still not backfilled automatically.</div>
      ${editor('post-purchase-review',review)}
      ${buttons('post-purchase-review','review automation')}
    </form>

    <form class="panel" method="post" action="/automations/update">
      <input type="hidden" name="key" value="chat-transcript">
      <div class="head"><div><h2 style="margin:0">Chat transcript email</h2><p class="muted">Sent when an AI chat closes after inactivity. Transcript speakers display as <strong>You</strong>, <strong>Hotend</strong> and <strong>System</strong>.</p></div>${status(transcript)}</div>
      <label class="toggle"><input type="checkbox" name="enabled" ${transcript.enabled?'checked':''}> Enable transcript email</label>
      <div class="fields"><label>Close after inactivity (minutes)<input type="number" min="1" step="1" name="idle_minutes" value="${Number(transcript.config?.idle_minutes??10)}"></label></div>
      ${editor('chat-transcript',transcript)}
      ${buttons('chat-transcript','transcript automation')}
    </form>
  </div></body></html>`;
}

export async function chatSettingsPage({settings={},integration={},message=''}) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hotend Hub Chat Settings</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fffcf7;color:#172033;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.top{background:#0b2748;color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{font-size:26px;font-weight:900}.brand span{color:#f5b51b}.top nav{display:flex;gap:14px;flex-wrap:wrap;justify-content:flex-end}.top a{color:#fff;text-decoration:none}.wrap{max-width:920px;margin:auto;padding:24px}.panel{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.wide{grid-column:1/-1}label{font-weight:700}input,select,textarea{width:100%;margin-top:6px;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font:inherit}textarea{min-height:90px}.check{display:flex;align-items:center;gap:8px}.check input{width:auto;margin:0}.btn{background:#f5b51b;color:#0b2748;border:0;border-radius:10px;padding:11px 15px;font-weight:900;cursor:pointer}.state{display:inline-block;font-size:11px;font-weight:900;padding:5px 9px;border-radius:999px}.state.ok{background:#dcfce7;color:#166534}.state.bad{background:#fee2e2;color:#991b1b}.muted{color:#667085;font-size:13px}.msg{background:#eef6ff;border:1px solid #bfdbfe;padding:12px 14px;border-radius:10px;margin-bottom:16px}@media(max-width:700px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}.top{align-items:flex-start;flex-direction:column}.top nav{justify-content:flex-start}}
  </style></head><body><div class="top"><div class="brand">HOTEND <span>HUB</span></div><nav><a href="/">Dashboard</a><a href="/customers">Customers</a><a href="/reviews-admin">Reviews</a><a href="/automations">Automations</a><a href="/marketing">Marketing</a><a href="/popups">Popups</a><a href="/chats">Chats</a><a href="/chat-settings">Chat Settings</a><a href="/tracking-admin">Tracking</a><a href="/setup">Setup</a><a href="/auth/logout">Log out</a></nav></div>
  <div class="wrap"><h1>Chatbox v2</h1>${message?'<div class="msg">'+esc(message)+'</div>':''}
    <div class="panel"><h2>Integration status</h2>
      <p><span class="state ${integration.openai?'ok':'bad'}">OpenAI: ${integration.openai?'Ready':'Missing API key'}</span></p>
      <p><span class="state ${integration.whatsappHandoff?'ok':'bad'}">Staff WhatsApp bridge: ${integration.whatsappHandoff?'Ready':'Not configured'}</span></p>
      <p><span class="state ${integration.whatsappCloud?'ok':'bad'}">WhatsApp Cloud API: ${integration.whatsappCloud?'Ready':'Missing Meta credentials'}</span></p>
      <p class="muted">Customers stay inside the website chat. When AI escalates, Hotend Hub alerts your staff WhatsApp; replying directly to that alert sends the reply back into the website conversation.</p>
    </div>

    <form class="panel" method="post" action="/chat-settings/update">
      <h2>AI support</h2>
      <div class="grid">
        <label>AI mode
          <select name="ai_mode">
            <option value="OFF" ${settings.ai_mode==='OFF'?'selected':''}>Off</option>
            <option value="DRAFT" ${settings.ai_mode==='DRAFT'?'selected':''}>Draft replies for staff</option>
            <option value="AUTO" ${settings.ai_mode==='AUTO'?'selected':''}>Automatic customer replies</option>
          </select>
        </label>
        <label>Model<input name="ai_model" value="${esc(settings.ai_model||'gpt-6-luna')}"></label>
        <label>Maximum reply tokens<input type="number" min="100" max="1200" name="ai_max_output_tokens" value="${Number(settings.ai_max_output_tokens||350)}"></label>
        <label class="wide">Human handoff message<textarea name="human_handoff_text">${esc(settings.human_handoff_text||'I’ll pass this to the Hotend team.')}</textarea></label>
      </div>

      <h2 style="margin-top:28px">Human escalation to staff WhatsApp</h2>
      <div class="grid">
        <label class="wide check"><input type="checkbox" name="whatsapp_enabled" ${settings.whatsapp_enabled?'checked':''}> Send human-escalation alerts to my WhatsApp</label>
        <label>Staff WhatsApp number<input name="whatsapp_staff_phone" value="${esc(settings.whatsapp_staff_phone||settings.whatsapp_phone||'')}" placeholder="6427..."></label>
        <label>Template name (optional)<input name="whatsapp_template_name" value="${esc(settings.whatsapp_template_name||'')}" placeholder="human_handoff_alert"></label>
        <label>Template language<input name="whatsapp_template_language" value="${esc(settings.whatsapp_template_language||'en')}" placeholder="en"></label>
        <div class="wide muted">If Meta allows a normal service-window message, Hotend Hub sends the full chat alert directly. Outside that window, an approved WhatsApp template can be used as fallback. Customers never see a WhatsApp button.</div>
      </div>
      <p><button class="btn" type="submit">Save Chatbox settings</button></p>
    </form>
  </div></body></html>`;
}
