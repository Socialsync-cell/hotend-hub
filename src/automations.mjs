import {q} from './db.mjs';

export async function listAutomationRules(){
  return (await q(`SELECT * FROM automation_rules ORDER BY id`)).rows;
}

export async function updateAutomationRule(key,{enabled,config}){
  const r=await q(`UPDATE automation_rules
    SET enabled=$2,config=$3::jsonb,updated_at=NOW()
    WHERE key=$1
    RETURNING *`,[String(key),!!enabled,JSON.stringify(config||{})]);
  return r.rows[0]||null;
}

export async function automationRule(key){
  return (await q(`SELECT * FROM automation_rules WHERE key=$1 LIMIT 1`,[String(key)])).rows[0]||null;
}

export async function automationEnabled(key){
  const row=await automationRule(key);
  return !!row?.enabled;
}

export function applyAutomationTokens(value,vars={}){
  return String(value??'').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,(_,key)=>
    Object.prototype.hasOwnProperty.call(vars,key)?String(vars[key]??''):''
  );
}

export async function renderAutomationEmail(key,{fallbackSubject='',fallbackHtml='',vars={}}={}){
  const row=await automationRule(key);
  const config=row?.config||{};
  const def=defaultAutomationEditor(key);
  const subjectSource=String(config.email_subject||'').trim()||def.subject||fallbackSubject;
  const custom=String(config.email_html||'').trim();
  const htmlSource=custom||def.html||fallbackHtml;
  return {
    subject:applyAutomationTokens(subjectSource,vars),
    html:applyAutomationTokens(htmlSource,vars),
    custom:!!custom
  };
}

export function defaultAutomationEditor(key){
  const commonStart=`<!doctype html><html><body style="margin:0!important;padding:0!important;background:#f4f6f6;font-family:Arial,Helvetica,sans-serif;color:#1c3a52">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f4f6f6;padding:22px 10px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:700px;background:#ffffff;margin:0 auto">
  <tr><td>{{brand_header}}</td></tr><tr><td style="padding:20px 28px 24px">`;
  const commonEnd=`</td></tr>
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
  <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#ffffff">
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
  </table></td></tr></table></td></tr></table></body></html>`;

  const title=(heading,copy)=>`<div style="font-size:22px;font-weight:800;line-height:1.3;margin-bottom:9px">${heading}</div><div style="color:#657d7a;font-size:12px;line-height:1.65">${copy}</div>`;
  const card=(label,body)=>`<div style="background:#f5f7f7;border:1px solid #d7dfdf;border-left:5px solid #3fc2c2;padding:12px 14px;margin:16px 0"><div style="color:#1c3a52;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.45px;margin-bottom:6px">${label}</div><div style="color:#718581;font-size:10px;line-height:1.55">${body}</div></div>`;
  const button=(href,label)=>`<p style="margin:24px 0;text-align:center"><a href="${href}" style="display:inline-block;background:#1c3a52;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.5px">${label}</a></p>`;

  if(key==='abandoned-cart'){
    return {
      subject:'{{step_subject}}',
      html:commonStart+
        title('{{heading}}','Hi {{first_name}}, {{intro}}')+
        card('Saved items','{{items_html}}')+
        button('{{recovery_url}}','RETURN TO YOUR CHECKOUT')+
        '<div style="color:#718581;font-size:9px;line-height:1.55">If you already completed your order, you can ignore this email.</div>'+
        commonEnd
    };
  }

  if(key==='post-purchase-review'){
    return {
      subject:'How did your Hotend order {{order_name}} go?',
      html:commonStart+
        title('How did your filament go, {{first_name}}?','We\'d value your feedback on order <strong>{{order_name}}</strong>.')+
        card('Your order','{{items_html}}')+
        '<div style="color:#718581;font-size:10px;line-height:1.55">You can also tell us which <strong>materials</strong> or <strong>colours</strong> you would like Hotend to stock next.</div>'+
        button('{{review_url}}','LEAVE A REVIEW')+
        commonEnd
    };
  }

  if(key==='chat-transcript'){
    return {
      subject:'Your Hotend support chat transcript',
      html:commonStart+
        title('Your Hotend chat transcript','Hi {{first_name}}, here is a copy of your recent support conversation.')+
        card('Conversation','{{transcript_html}}')+
        commonEnd
    };
  }

  return {
    subject:'Welcome to Hotend - our story',
    html:commonStart+
      title('Welcome to Hotend, {{first_name}}.','Here’s the story behind why we started Hotend and what we’re building for New Zealand makers.')+
      '<div style="color:#5f7774;font-size:11px;line-height:1.72">'+
        '<p style="margin:16px 0">Every great print starts with an idea. But finding the right filament to bring that idea to life wasn’t always easy here in New Zealand.</p>'+
        '<p style="margin:16px 0">We started Hotend because we wanted to change that.</p>'+
        '<h2 style="color:#1c3a52;font-size:16px;line-height:1.3;margin:24px 0 8px">More colours, more possibilities</h2>'+
        '<p style="margin:12px 0">When you’re planning a project, colour matters. Whether you’re making something practical, a gift, or a model you’ve spent hours designing, you want the finished print to look the way you imagined it.</p>'+
        '<p style="margin:12px 0">But finding a wide range of filament colours in New Zealand was difficult. Too often, getting the colour you wanted meant searching through multiple stores, settling for a different shade, or looking overseas.</p>'+
        '<p style="margin:12px 0">We believed Kiwi makers deserved more choice, closer to home.</p>'+
        '<h2 style="color:#1c3a52;font-size:16px;line-height:1.3;margin:24px 0 8px">Making creativity more affordable</h2>'+
        '<p style="margin:12px 0">The price of filament was another frustration. Printing involves experimenting, adjusting designs, and sometimes starting again. When filament is expensive, every failed print feels a little more painful, and trying something new becomes a bigger decision.</p>'+
        '<p style="margin:12px 0">We wanted to make filament more affordable so that people could spend more time creating, learning, and enjoying their printers.</p>'+
        '<h2 style="color:#1c3a52;font-size:16px;line-height:1.3;margin:24px 0 8px">Less waiting to get started</h2>'+
        '<p style="margin:12px 0">Ordering from overseas could open up more options, but it came with a trade-off: long delivery times.</p>'+
        '<p style="margin:12px 0">When you’re excited about a project—or run out of filament halfway through—waiting weeks for an order to arrive can bring everything to a halt.</p>'+
        '<p style="margin:12px 0">That helped shape our vision for Hotend: a local business focused on bringing more filament options to New Zealand, with fair prices and without the long wait that comes with ordering internationally.</p>'+
        '<h2 style="color:#1c3a52;font-size:16px;line-height:1.3;margin:24px 0 8px">Built around the reasons we began</h2>'+
        '<p style="margin:12px 0">Hotend started with three simple goals: <strong style="color:#1c3a52">more colour choice, more affordable filament, and easier local access.</strong></p>'+
        '<p style="margin:12px 0">Those goals continue to guide what we’re building. We want choosing filament to be an enjoyable part of your next project, with fewer compromises along the way.</p>'+
        '<p style="margin:18px 0 4px">Thank you for being part of our story. We’re excited to see what you create.</p>'+
      '</div>'+
      button('{{shop_url}}','SHOP HOTEND FILAMENT')+
      commonEnd
  };
}

export async function automationEditorValues(key){
  const row=await automationRule(key);
  const def=defaultAutomationEditor(key);
  const cfg=row?.config||{};
  return {
    subject:String(cfg.email_subject||def.subject),
    html:String(cfg.email_html||def.html)
  };
}
