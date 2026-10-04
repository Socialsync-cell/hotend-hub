import {q} from './db.mjs';

export async function listPopups(){
  return (await q(`SELECT * FROM popups ORDER BY id DESC LIMIT 100`)).rows;
}

export async function createPopup(data){
  const headline=String(data.headline||'').trim();
  if(!headline)throw new Error('Headline is required');
  const r=await q(`INSERT INTO popups(
    name,popup_type,headline,body_text,image_url,cta_text,cta_url,discount_code,enabled,targeting,starts_at,ends_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
    RETURNING *`,[
      String(data.name||headline).trim(),
      String(data.popup_type||'PROMO').trim(),
      headline,
      String(data.body_text||'').trim()||null,
      String(data.image_url||'').trim()||null,
      String(data.cta_text||'').trim()||null,
      String(data.cta_url||'').trim()||null,
      String(data.discount_code||'').trim()||null,
      String(data.enabled||'')==='on',
      JSON.stringify({show_once_per_session:true}),
      data.starts_at?new Date(data.starts_at):null,
      data.ends_at?new Date(data.ends_at):null
    ]);
  return r.rows[0];
}

export async function togglePopup(id,enabled){
  const r=await q(`UPDATE popups SET enabled=$2 WHERE id=$1 RETURNING *`,[Number(id),!!enabled]);
  return r.rows[0]||null;
}

export async function deletePopup(id){
  await q(`DELETE FROM popups WHERE id=$1`,[Number(id)]);
}


export async function updatePopup(id,data){
  const current=(await q(`SELECT * FROM popups WHERE id=$1 LIMIT 1`,[Number(id)])).rows[0];
  if(!current)throw new Error('Popup not found');

  const targeting={...(current.targeting&&typeof current.targeting==='object'?current.targeting:{})};
  targeting.side_tab_text=String(data.side_tab_text||'').trim()||'Hotend offer';

  const r=await q(`UPDATE popups SET
    name=$2,popup_type=$3,headline=$4,body_text=$5,image_url=$6,cta_text=$7,cta_url=$8,
    discount_code=$9,enabled=$10,starts_at=$11,ends_at=$12,targeting=$13::jsonb
    WHERE id=$1 RETURNING *`,[
      Number(id),
      String(data.name||current.name).trim(),
      String(data.popup_type||current.popup_type||'NEWSLETTER').trim(),
      String(data.headline||current.headline).trim(),
      String(data.body_text||'').trim()||null,
      String(data.image_url||'').trim()||null,
      String(data.cta_text||'').trim()||null,
      String(data.cta_url||'').trim()||null,
      String(data.discount_code||'').trim()||null,
      String(data.enabled||'')==='on',
      data.starts_at?new Date(data.starts_at):null,
      data.ends_at?new Date(data.ends_at):null,
      JSON.stringify(targeting)
    ]);
  return r.rows[0];
}
