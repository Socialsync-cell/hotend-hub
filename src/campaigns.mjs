import crypto from 'node:crypto';
import {q} from './db.mjs';
import {sendEmail,wrapHotendEmail} from './email.mjs';

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function campaignHtml(c,customerId){
  const base=String(process.env.PUBLIC_BASE_URL||'https://hotend-hub.onrender.com').replace(/\/$/,'');
  const secret=process.env.APP_SECRET||process.env.SHOPIFY_CLIENT_SECRET||'';
  const token=secret?crypto.createHmac('sha256',secret).update(String(customerId)).digest('hex'):'';
  const unsub=token?`${base}/unsubscribe?customer=${encodeURIComponent(customerId)}&token=${token}`:'https://hotend.co.nz';
  return wrapHotendEmail(`
    ${c.headline?'<div style="font-size:22px;font-weight:800;line-height:1.3;margin-bottom:9px">'+esc(c.headline)+'</div>':''}
    ${c.body_text?'<div style="color:#657d7a;font-size:12px;line-height:1.65;white-space:pre-wrap">'+esc(c.body_text)+'</div>':''}
    ${c.cta_text&&c.cta_url?'<p style="margin:24px 0;text-align:center"><a href="'+esc(c.cta_url)+'" style="display:inline-block;background:#1c3a52;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.5px">'+esc(c.cta_text)+'</a></p>':''}
    <div style="background:#f5f7f7;border:1px solid #d7dfdf;border-left:5px solid #3fc2c2;padding:12px 14px;margin-top:18px;color:#718581;font-size:9px;line-height:1.55">You're receiving this because you subscribed to Hotend marketing emails. <a href="${esc(unsub)}" style="color:#1c3a52">Unsubscribe</a>.</div>
  `);
}

export async function createCampaign(data){
  const name=String(data.name||'').trim();
  const subject=String(data.subject||'').trim();
  if(!name||!subject)throw new Error('Campaign name and subject are required');
  const r=await q(`INSERT INTO marketing_campaigns(name,subject,preheader,headline,body_text,cta_text,cta_url,image_url,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'DRAFT') RETURNING *`,[
    name,subject,String(data.preheader||'').trim()||null,String(data.headline||'').trim()||null,
    String(data.body_text||'').trim()||null,String(data.cta_text||'').trim()||null,
    String(data.cta_url||'').trim()||null,String(data.image_url||'').trim()||null
  ]);
  return r.rows[0];
}

export async function listCampaigns(){
  return (await q(`SELECT mc.*,
    COUNT(cr.id)::int recipient_count,
    COUNT(cr.id) FILTER (WHERE cr.status='SENT')::int sent_count,
    COUNT(cr.id) FILTER (WHERE cr.status='FAILED')::int failed_count,
    COUNT(cr.id) FILTER (WHERE cr.status='PENDING')::int pending_count
    FROM marketing_campaigns mc
    LEFT JOIN campaign_recipients cr ON cr.campaign_id=mc.id
    GROUP BY mc.id
    ORDER BY mc.id DESC LIMIT 100`)).rows;
}

export async function queueCampaign(campaignId){
  const campaign=(await q(`SELECT * FROM marketing_campaigns WHERE id=$1 LIMIT 1`,[campaignId])).rows[0];
  if(!campaign)throw new Error('Campaign not found');
  await q(`INSERT INTO campaign_recipients(campaign_id,customer_id,email)
    SELECT $1,id,email FROM customers
    WHERE marketing_status='SUBSCRIBED' AND email IS NOT NULL AND email<>''
    ON CONFLICT(campaign_id,customer_id) DO NOTHING`,[campaignId]);
  await q(`UPDATE marketing_campaigns SET status='SENDING' WHERE id=$1`,[campaignId]);
  return true;
}

export async function sendCampaignTest(campaignId,to){
  const campaign=(await q(`SELECT * FROM marketing_campaigns WHERE id=$1 LIMIT 1`,[campaignId])).rows[0];
  if(!campaign)throw new Error('Campaign not found');
  return sendEmail({
    campaignId:campaign.id,emailType:'CAMPAIGN_TEST',to,
    subject:'[TEST] '+campaign.subject,
    html:campaignHtml(campaign,0),
    metadata:{test:true}
  });
}

export async function processCampaignQueue(limit=30){
  const rows=(await q(`SELECT cr.*,mc.subject,mc.headline,mc.body_text,mc.cta_text,mc.cta_url
    FROM campaign_recipients cr
    JOIN marketing_campaigns mc ON mc.id=cr.campaign_id
    JOIN customers c ON c.id=cr.customer_id
    WHERE cr.status='PENDING' AND mc.status='SENDING' AND c.marketing_status='SUBSCRIBED'
    ORDER BY cr.id ASC LIMIT $1`,[Math.max(1,Math.min(100,Number(limit)||30))])).rows;
  let sent=0,failed=0;
  for(const row of rows){
    const result=await sendEmail({
      customerId:row.customer_id,campaignId:row.campaign_id,emailType:'CAMPAIGN',
      to:row.email,subject:row.subject,
      html:campaignHtml(row,row.customer_id),
      metadata:{campaign_id:row.campaign_id}
    });
    if(result.ok){
      await q(`UPDATE campaign_recipients SET status='SENT',email_delivery_id=$2,sent_at=NOW() WHERE id=$1`,[row.id,result.deliveryId]);sent++;
    }else{
      await q(`UPDATE campaign_recipients SET status='FAILED',error=$2 WHERE id=$1`,[row.id,String(result.error||'').slice(0,2000)]);failed++;
    }
  }
  const ids=[...new Set(rows.map(x=>x.campaign_id))];
  for(const id of ids){
    const pending=(await q(`SELECT COUNT(*)::int n FROM campaign_recipients WHERE campaign_id=$1 AND status='PENDING'`,[id])).rows[0].n;
    if(!pending)await q(`UPDATE marketing_campaigns SET status='SENT',sent_at=NOW() WHERE id=$1`,[id]);
  }
  return {checked:rows.length,sent,failed};
}
