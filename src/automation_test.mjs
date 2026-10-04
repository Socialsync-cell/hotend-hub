import {automationEditorValues,applyAutomationTokens} from './automations.mjs';
import {sendEmail,brandEmailHeader} from './email.mjs';

function sampleItemTable(){
  const pla='https://cdn.shopify.com/s/files/1/1006/1519/2875/files/02253967bf8248580f7ebcf51d12cc94.png?v=1786317336';
  const petg='https://cdn.shopify.com/s/files/1/1006/1519/2875/files/Transparent_1dc9cd7e-5ea2-4a85-aab9-102e0bc119f6.png?v=1786316586';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #dce4e3;table-layout:fixed">
    <tr>
      <td style="width:23%;background:#1c3a52;color:#fff;padding:10px;font-size:8px;font-weight:700;text-transform:uppercase">SKU</td>
      <td style="width:62%;background:#1c3a52;color:#fff;padding:10px;font-size:8px;font-weight:700;text-transform:uppercase">Product</td>
      <td align="center" style="width:15%;background:#1c3a52;color:#fff;padding:10px 5px;font-size:8px;font-weight:700;text-transform:uppercase">Qty</td>
    </tr>
    <tr>
      <td style="padding:10px;border-bottom:1px solid #dce4e3;font-size:9px">FI-PSW-5152</td>
      <td style="padding:8px;border-bottom:1px solid #dce4e3">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="58" valign="top" style="width:58px;padding-right:8px"><img src="${pla}" width="50" height="50" alt="PLA+ Silk White" style="display:block;width:50px;height:50px;object-fit:cover;border:1px solid #e1e7e6;border-radius:5px"></td>
          <td valign="top"><strong style="color:#1c3a52">PLA+ Silk White</strong><div style="color:#3fc2c2;font-size:8px;margin-top:3px">White</div></td>
        </tr></table>
      </td>
      <td align="center" style="padding:10px;border-bottom:1px solid #dce4e3;font-weight:800">1</td>
    </tr>
    <tr>
      <td style="padding:10px;font-size:9px">FI-PT-5183</td>
      <td style="padding:8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="58" valign="top" style="width:58px;padding-right:8px"><img src="${petg}" width="50" height="50" alt="PETG Transparent" style="display:block;width:50px;height:50px;object-fit:cover;border:1px solid #e1e7e6;border-radius:5px"></td>
          <td valign="top"><strong style="color:#1c3a52">PETG Transparent</strong><div style="color:#3fc2c2;font-size:8px;margin-top:3px">Transparent</div></td>
        </tr></table>
      </td>
      <td align="center" style="padding:10px;font-weight:800">2</td>
    </tr>
  </table>`;
}

function sampleVars(key){
  const base={
    first_name:'Alex',
    brand_header:brandEmailHeader(),
    shop_url:'https://hotend.co.nz/collections/all'
  };
  if(key==='abandoned-cart')return {...base,
    step_subject:'Your Hotend filament is still waiting',
    heading:'Your filament is still waiting',
    intro:'Looks like you left a few items behind. No rush — your saved Hotend checkout is ready whenever you are.',
    items_html:sampleItemTable(),
    recovery_url:'https://hotend.co.nz/cart',
    step:'1'
  };
  if(key==='post-purchase-review')return {...base,
    order_name:'#1234',
    review_url:'https://hotend-hub.onrender.com/review?token=preview',
    items_html:sampleItemTable()
  };
  if(key==='chat-transcript')return {...base,
    reference:'CHAT-PREVIEW',
    transcript_html:'<div style="padding:10px 0;border-bottom:1px solid #eef2f7"><strong>You</strong><div>Do you have White ABS in stock?</div></div><div style="padding:10px 0;border-bottom:1px solid #eef2f7"><strong>Hotend</strong><div>Yes, I can check the current stock for you.</div></div>'
  };
  return base;
}

export async function sendAutomationTestEmail(key,to){
  const editor=await automationEditorValues(key);
  const vars=sampleVars(key);
  const subject=applyAutomationTokens(editor.subject,vars);
  const html=applyAutomationTokens(editor.html,vars);
  return sendEmail({
    emailType:'AUTOMATION_TEST',
    to,
    subject:'[TEST] '+subject,
    html,
    metadata:{automation:key,test:true}
  });
}
