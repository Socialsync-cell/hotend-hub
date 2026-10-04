import {q} from './db.mjs';
import {renderAutomationEmail} from './automations.mjs';

function esc(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function required(name){
  const value=process.env[name];
  if(!value)throw new Error(name+'_MISSING');
  return value;
}

export function brandEmailHeader(){
  const logo=String(process.env.HOTEND_LOGO_URL||'').trim();
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#ffffff">
    <tr>
      <td style="padding:18px 28px 10px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="82" valign="middle" style="width:82px">
              ${logo?`<img src="${esc(logo)}" alt="Hotend Filament Supplies" width="64" style="display:block;width:64px;max-width:64px;height:auto">`:`<div style="font-size:18px;font-weight:800;color:#1c3a52">HOTEND</div>`}
            </td>
            <td valign="middle" align="center" style="padding:0 14px;border-left:1px solid #e3ecec;border-right:1px solid #e3ecec">
              <div style="color:#20aeb3;font-size:11px;font-weight:800;letter-spacing:2.1px;text-transform:uppercase;line-height:1.2">BRING IDEAS TO LIFE</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:7px auto 0">
                <tr>
                  <td style="color:#1c3a52;font-size:8px;font-weight:700;padding-right:12px">✉ info@hotend.co.nz</td>
                  <td style="color:#1c3a52;font-size:8px;font-weight:700">◉ www.hotend.co.nz</td>
                </tr>
              </table>
            </td>
            <td width="118" valign="middle" align="right" style="width:118px;padding-left:12px">
              <div style="color:#1c3a52;font-size:15px;font-weight:800;letter-spacing:.6px">HOTEND</div>
              <div style="color:#7c9088;font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-top:4px">Filament Supplies</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr><td style="padding:0 28px"><div style="height:2px;background:#1c3a52;font-size:0;line-height:0">&nbsp;</div></td></tr>
  </table>`;
}

export function brandEmailFooter(){
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#ffffff">
    <tr><td style="padding:0 28px 22px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f7fbfa;border:1px solid #dfeae7;border-left:4px solid #3fc2c2">
        <tr>
          <td valign="middle" style="padding:14px 16px">
            <div style="color:#1c3a52;font-size:11px;font-weight:800;margin-bottom:4px">Need help with your Hotend order?</div>
            <div style="color:#718581;font-size:9px;line-height:1.55;margin-bottom:9px">Our team is here to help with filament, orders, delivery or product questions.</div>
            <a href="https://wa.me/message/I3WJRT6KJV65P1?src=qr" style="display:inline-block;background:#25D366;color:#ffffff;padding:8px 14px;border-radius:5px;font-size:8px;font-weight:700;text-decoration:none">CHAT ON WHATSAPP</a>
          </td>
          <td width="105" valign="middle" align="center" style="width:105px;padding:12px;background:#ffffff;border-left:1px solid #dfeae7">
            <div style="color:#1c3a52;font-size:8px;font-weight:800;margin-bottom:6px">WhatsApp Support</div>
            <a href="https://wa.me/message/I3WJRT6KJV65P1?src=qr"><img src="https://cdn.shopify.com/s/files/1/1006/1519/2875/files/WhatsAPP_QR.png?v=1787091415" width="66" height="66" alt="WhatsApp Support" style="display:block;width:66px;height:66px;margin:0 auto"></a>
            <div style="color:#7c9088;font-size:6.5px;line-height:1.3;margin-top:5px">Scan or click to chat</div>
          </td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 28px"><div style="height:1px;background:#dce4e3;font-size:0;line-height:0">&nbsp;</div></td></tr>
    <tr><td align="center" style="padding:15px 28px 12px">
      <div style="color:#1c3a52;font-size:10px;font-weight:800;margin-bottom:4px">Thank you for supporting a Kiwi business.</div>
      <div style="color:#7c9088;font-size:8px">Hotend • 3D Printing Filament Supplies</div>
      <div style="color:#8b9a97;font-size:7px;line-height:1.45;margin-top:4px">GST Number: 149-065-458 &nbsp;•&nbsp; NZ Business Number: 9429053775979</div>
      <div style="color:#7c9088;font-size:7.5px;line-height:1.6;margin-top:8px">
        <a href="https://hotend.co.nz/policies/privacy-policy" style="color:#7c9088;text-decoration:none">Privacy Policy</a>
        &nbsp;•&nbsp;
        <a href="https://hotend.co.nz/policies/refund-policy" style="color:#7c9088;text-decoration:none">Refund Policy</a>
        &nbsp;•&nbsp;
        <a href="https://hotend.co.nz/policies/shipping-policy" style="color:#7c9088;text-decoration:none">Shipping Policy</a>
        &nbsp;•&nbsp;
        <a href="https://hotend.co.nz/policies/terms-of-service" style="color:#7c9088;text-decoration:none">Terms of Service</a>
      </div>
    </td></tr>
    <tr><td align="center" style="background:#1c3a52;color:#ffffff;padding:8px;font-size:8px;font-weight:700;letter-spacing:.7px">BRING IDEAS TO LIFE • TEAM HOTEND</td></tr>
  </table>`;
}

export function wrapHotendEmail(content){
  return `<!doctype html><html><body style="margin:0!important;padding:0!important;background:#f4f6f6;font-family:Arial,Helvetica,sans-serif;color:#1c3a52">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f4f6f6;padding:22px 10px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:700px;background:#ffffff;margin:0 auto">
          <tr><td>${brandEmailHeader()}</td></tr>
          <tr><td style="padding:20px 28px 24px">${content}</td></tr>
          <tr><td>${brandEmailFooter()}</td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

export function emailConfigStatus(){
  return {
    resendApiKey:!!process.env.RESEND_API_KEY,
    from:process.env.EMAIL_FROM||'',
    replyTo:process.env.EMAIL_REPLY_TO||''
  };
}

export async function sendEmail({customerId=null,campaignId=null,emailType,to,subject,html,metadata={}}){
  const recipient=String(to||'').trim().toLowerCase();
  if(!recipient)throw new Error('EMAIL_RECIPIENT_MISSING');

  const inserted=await q(`INSERT INTO email_deliveries(customer_id,campaign_id,email_type,recipient,subject,status,metadata)
    VALUES($1,$2,$3,$4,$5,'QUEUED',$6::jsonb)
    RETURNING id`,[
      customerId,campaignId,emailType,recipient,subject,JSON.stringify(metadata||{})
    ]);
  const deliveryId=inserted.rows[0].id;

  try{
    const apiKey=required('RESEND_API_KEY');
    const from=required('EMAIL_FROM');
    const payload={
      from,
      to:[recipient],
      subject,
      html
    };
    if(process.env.EMAIL_REPLY_TO)payload.reply_to=process.env.EMAIL_REPLY_TO;

    const r=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{
        'Authorization':'Bearer '+apiKey,
        'Content-Type':'application/json'
      },
      body:JSON.stringify(payload)
    });
    const text=await r.text();
    if(!r.ok)throw new Error('RESEND_'+r.status+': '+text.slice(0,1000));
    const data=JSON.parse(text||'{}');

    await q(`UPDATE email_deliveries
      SET status='SENT',provider_message_id=$2,sent_at=NOW()
      WHERE id=$1`,[deliveryId,data.id||null]);

    await q(`INSERT INTO marketing_events(customer_id,campaign_id,event_type,provider_message_id,metadata)
      VALUES($1,$2,'EMAIL_SENT',$3,$4::jsonb)`,[
        customerId,campaignId,data.id||null,JSON.stringify({email_type:emailType,recipient})
      ]);

    return {ok:true,id:data.id||null,deliveryId};
  }catch(e){
    await q(`UPDATE email_deliveries SET status='FAILED',error=$2 WHERE id=$1`,[
      deliveryId,String(e.message||e).slice(0,2000)
    ]);
    console.error('Email send failed',emailType,recipient,e.message);
    return {ok:false,error:e.message,deliveryId};
  }
}

export async function sendWelcomeStory(customerId){
  const customer=(await q(`SELECT id,email,first_name,marketing_status
    FROM customers WHERE id=$1 LIMIT 1`,[customerId])).rows[0];

  if(!customer?.email)return {ok:false,skipped:'no_email'};
  if(customer.marketing_status!=='SUBSCRIBED')return {ok:false,skipped:'not_subscribed'};

  const already=(await q(`SELECT id,status FROM email_deliveries
    WHERE customer_id=$1 AND email_type='WELCOME_STORY' AND status IN ('QUEUED','SENT')
    LIMIT 1`,[customer.id])).rows[0];
  if(already)return {ok:true,skipped:'already_sent'};

  const name=esc(customer.first_name||'there');
  const fallbackSubject='Welcome to Hotend — bring your ideas to life';
  const fallbackHtml=`<!doctype html>
<html><body style="margin:0;background:#fffcf7;font-family:Arial,sans-serif;color:#172033">
  <div style="max-width:640px;margin:0 auto;padding:30px 20px">
    ${brandEmailHeader()}
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px;margin-top:16px">
      <h1 style="color:#0b2748;margin-top:0">Hi ${name}, welcome to Hotend.</h1>
      <p>Hotend was built for makers who want reliable filament, useful local support and faster access to the materials that keep projects moving.</p>
      <p>We focus on practical filament choices for everyday printing, clear product information, and a growing range of colours and materials for New Zealand makers.</p>
      <h2 style="color:#0b2748">Why customers choose Hotend</h2>
      <ul style="line-height:1.7">
        <li>NZ-owned service and local support.</li>
        <li>A growing filament range for hobby, functional and creative prints.</li>
        <li>Fast local fulfilment options around Waikato.</li>
        <li>Real customer feedback and product reviews built into the Hotend experience.</li>
      </ul>
      <p style="margin:26px 0">
        <a href="https://hotend.co.nz/collections/all" style="background:#f5b51b;color:#0b2748;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:10px;display:inline-block">Shop Hotend filament</a>
      </p>
      <p style="font-size:13px;color:#667085">You are receiving this because you subscribed to Hotend marketing updates. You can change your marketing preferences through Hotend or Shopify customer communications.</p>
    </div>
  </div>
</body></html>`;
  const rendered=await renderAutomationEmail('welcome-story',{
    fallbackSubject,
    fallbackHtml,
    vars:{
      first_name:name,
      brand_header:brandEmailHeader(),
      shop_url:'https://hotend.co.nz/collections/all'
    }
  });

  return sendEmail({
    customerId:customer.id,
    emailType:'WELCOME_STORY',
    to:customer.email,
    subject:rendered.subject,
    html:rendered.html,
    metadata:{automation:'welcome-story'}
  });
}

export async function sendSignupDiscountEmail({customerId=null,to,firstName='',discountCode,popupName=''}) {
  const code=String(discountCode||'').trim();
  if(!code)return {ok:false,skipped:'no_discount_code'};
  const name=esc(firstName||'there');
  const subject='Your Hotend discount code';
  const html=wrapHotendEmail(`
    <div style="font-size:22px;font-weight:800;line-height:1.3;margin-bottom:9px">Thanks for subscribing, ${name}.</div>
    <div style="color:#657d7a;font-size:12px;line-height:1.65">Your Hotend signup discount code is ready.</div>
    <div style="background:#f5f7f7;border:1px solid #d7dfdf;border-left:5px solid #3fc2c2;padding:16px;margin:18px 0;text-align:center">
      <div style="color:#7c9088;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Your code</div>
      <div style="font-size:26px;letter-spacing:2px;font-weight:900;color:#1c3a52;margin-top:6px">${esc(code)}</div>
    </div>
    <p style="margin:24px 0;text-align:center"><a href="https://hotend.co.nz/collections/all" style="display:inline-block;background:#1c3a52;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.5px">SHOP HOTEND FILAMENT</a></p>
    <div style="color:#718581;font-size:9px;line-height:1.55">You received this because you chose to subscribe to Hotend marketing emails.</div>
  `);
  return sendEmail({
    customerId,
    emailType:'SIGNUP_DISCOUNT',
    to,
    subject,
    html,
    metadata:{automation:'popup-signup',popup_name:popupName,discount_code:code}
  });
}

export async function recentEmailDeliveries(limit=50){
  const n=Math.max(1,Math.min(200,Number(limit)||50));
  return (await q(`SELECT ed.id,ed.email_type,ed.recipient,ed.subject,ed.status,ed.error,
      ed.created_at,ed.sent_at,c.first_name,c.last_name
    FROM email_deliveries ed
    LEFT JOIN customers c ON c.id=ed.customer_id
    ORDER BY ed.created_at DESC
    LIMIT $1`,[n])).rows;
}


export function emailPreviewHtml(type='welcome'){
  const t=String(type||'welcome').toLowerCase();
  const shell=(content)=>`<!doctype html><html><body style="margin:0;background:#fffcf7;font-family:Arial,sans-serif;color:#172033">
    <div style="max-width:640px;margin:0 auto;padding:24px 18px">
      ${brandEmailHeader()}
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:26px;margin-top:10px">${content}</div>
    </div>
  </body></html>`;

  if(t==='discount'){
    return shell(`
      <h1 style="color:#0b2748;margin-top:0;text-align:center">Thanks for subscribing, Alex.</h1>
      <p style="text-align:center">Your Hotend signup discount code is:</p>
      <div style="font-size:26px;letter-spacing:2px;font-weight:900;color:#0b2748;background:#fff3cd;border:1px dashed #f5b51b;border-radius:12px;padding:14px;margin:18px auto;max-width:300px;text-align:center">WELCOME10</div>
      <p style="text-align:center"><a href="https://hotend.co.nz/collections/all" style="background:#f5b51b;color:#0b2748;text-decoration:none;font-weight:800;padding:11px 17px;border-radius:10px;display:inline-block">Shop Hotend filament</a></p>`);
  }

  if(t==='transcript'){
    return shell(`
      <h1 style="color:#0b2748;margin-top:0">Your Hotend chat transcript</h1>
      <p>Hi Alex, here is a copy of your recent support conversation.</p>
      <div style="padding:10px 0;border-bottom:1px solid #eef2f7"><strong style="color:#0b2748">You</strong><div style="margin-top:4px">Do you have White ABS in stock?</div></div>
      <div style="padding:10px 0;border-bottom:1px solid #eef2f7"><strong style="color:#0b2748">Hotend</strong><div style="margin-top:4px">I checked the current Hotend stock and found the closest matching ABS options.</div></div>`);
  }

  if(t==='campaign'){
    return shell(`
      <h1 style="color:#0b2748;margin-top:0">Fresh filament colours have landed</h1>
      <p style="line-height:1.7">A sample campaign preview using the same Hotend email branding customers will receive.</p>
      <p><a href="https://hotend.co.nz/collections/all" style="background:#f5b51b;color:#0b2748;text-decoration:none;font-weight:800;padding:11px 17px;border-radius:10px;display:inline-block">Shop now</a></p>
      <p style="font-size:12px;color:#667085;margin-top:26px">You're receiving this because you subscribed to Hotend marketing emails.</p>`);
  }

  return shell(`
    <h1 style="color:#0b2748;margin-top:0">Hi Alex, welcome to Hotend.</h1>
    <p>Hotend was built for makers who want reliable filament, useful local support and faster access to the materials that keep projects moving.</p>
    <h2 style="color:#0b2748">Why customers choose Hotend</h2>
    <ul style="line-height:1.7">
      <li>NZ-owned service and local support.</li>
      <li>A growing filament range for hobby, functional and creative prints.</li>
      <li>Fast local fulfilment options around Waikato.</li>
    </ul>
    <p><a href="https://hotend.co.nz/collections/all" style="background:#f5b51b;color:#0b2748;text-decoration:none;font-weight:800;padding:11px 17px;border-radius:10px;display:inline-block">Shop Hotend filament</a></p>`);
}
