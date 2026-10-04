import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import {automationEditorValues,applyAutomationTokens} from './automations.mjs';

function previewHeader(){
  const logo=String(process.env.HOTEND_LOGO_URL||'').trim();
  const img=logo
    ? `<img src="${logo.replace(/"/g,'&quot;')}" alt="Hotend Filament Supplies" width="64" style="display:block;width:64px;max-width:64px;height:auto">`
    : '<div style="font-size:18px;font-weight:800;color:#1c3a52">HOTEND</div>';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#ffffff">
    <tr><td style="padding:18px 28px 10px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="82" valign="middle" style="width:82px">${img}</td>
          <td valign="middle" align="center" style="padding:0 14px;border-left:1px solid #e3ecec;border-right:1px solid #e3ecec">
            <div style="color:#20aeb3;font-size:11px;font-weight:800;letter-spacing:2.1px;text-transform:uppercase;line-height:1.2">BRING IDEAS TO LIFE</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:7px auto 0">
              <tr><td style="color:#1c3a52;font-size:8px;font-weight:700;padding-right:12px">✉ info@hotend.co.nz</td><td style="color:#1c3a52;font-size:8px;font-weight:700">◉ www.hotend.co.nz</td></tr>
            </table>
          </td>
          <td width="118" valign="middle" align="right" style="width:118px;padding-left:12px">
            <div style="color:#1c3a52;font-size:15px;font-weight:800;letter-spacing:.6px">HOTEND</div>
            <div style="color:#7c9088;font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-top:4px">Filament Supplies</div>
          </td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 28px"><div style="height:2px;background:#1c3a52;font-size:0;line-height:0">&nbsp;</div></td></tr>
  </table>`;
}

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
      <td style="padding:10px;border-bottom:1px solid #dce4e3;color:#1c3a52;font-size:9px;font-weight:600">PLA-SW</td>
      <td style="padding:8px;border-bottom:1px solid #dce4e3">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="58" valign="top" style="width:58px;padding-right:8px"><img src="${pla}" width="50" height="50" style="display:block;width:50px;height:50px;object-fit:contain;border:1px solid #e1e7e6;border-radius:5px"></td>
          <td valign="top"><div style="color:#1c3a52;font-size:10px;font-weight:700">PLA Silk</div><div style="color:#3fc2c2;font-size:8px;margin-top:3px">White</div></td>
        </tr></table>
      </td>
      <td align="center" style="padding:10px;border-bottom:1px solid #dce4e3;color:#1c3a52;font-size:11px;font-weight:800">1</td>
    </tr>
    <tr>
      <td style="padding:10px;color:#1c3a52;font-size:9px;font-weight:600">PETG-BLK</td>
      <td style="padding:8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="58" valign="top" style="width:58px;padding-right:8px"><img src="${petg}" width="50" height="50" style="display:block;width:50px;height:50px;object-fit:contain;border:1px solid #e1e7e6;border-radius:5px"></td>
          <td valign="top"><div style="color:#1c3a52;font-size:10px;font-weight:700">PETG</div><div style="color:#3fc2c2;font-size:8px;margin-top:3px">Black</div></td>
        </tr></table>
      </td>
      <td align="center" style="padding:10px;color:#1c3a52;font-size:11px;font-weight:800">2</td>
    </tr>
  </table>`;
}

function sampleVars(key){
  const base={
    first_name:'Alex',
    brand_header:previewHeader(),
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
    transcript_html:`<div style="padding:10px 0;border-bottom:1px solid #eef2f7"><div style="font-weight:800;color:#1c3a52">You</div><div style="margin-top:4px;color:#334155">Do you have White ABS in stock?</div></div>
      <div style="padding:10px 0;border-bottom:1px solid #eef2f7"><div style="font-weight:800;color:#1c3a52">Hotend</div><div style="margin-top:4px;color:#334155">Yes, I can check the current stock for you.</div></div>`
  };
  return base;
}

export async function automationEmailPreviewPdf(key){
  const editor=await automationEditorValues(key);
  const vars=sampleVars(key);
  const html=applyAutomationTokens(editor.html,vars);
  const subject=applyAutomationTokens(editor.subject,vars);

  const browser=await puppeteer.launch({
    executablePath:await chromium.executablePath(),
    headless:chromium.headless,
    args:[...chromium.args,'--disable-dev-shm-usage'],
    defaultViewport:{width:820,height:1100,deviceScaleFactor:1}
  });

  try{
    const page=await browser.newPage();
    await page.setViewport({width:820,height:1100,deviceScaleFactor:1});
    await page.setContent(html,{waitUntil:['domcontentloaded','networkidle0'],timeout:30000});
    await page.emulateMediaType('screen');
    await page.evaluate(async()=>{
      const images=[...document.images];
      await Promise.all(images.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{
        img.addEventListener('load',resolve,{once:true});
        img.addEventListener('error',resolve,{once:true});
      })));
    });
    const pdf=await page.pdf({
      format:'A4',
      printBackground:true,
      preferCSSPageSize:false,
      margin:{top:'10mm',right:'8mm',bottom:'10mm',left:'8mm'},
      displayHeaderFooter:true,
      headerTemplate:'<div></div>',
      footerTemplate:`<div style="width:100%;font-size:7px;color:#94a3b8;text-align:center;padding:0 8mm">Hotend email preview • ${subject.replace(/[<>&"]/g,'')}</div>`
    });
    return Buffer.from(pdf);
  }finally{
    await browser.close();
  }
}
