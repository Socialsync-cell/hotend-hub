function hotendHubClient(){
  const CLIENT_VERSION='20261004-chat10';
  const existingVersion=String(window.__HOTEND_HUB_VERSION__||'');
  if(window.__HOTEND_HUB__&&existingVersion===CLIENT_VERSION)return;
  if(window.__HOTEND_HUB__&&existingVersion!==CLIENT_VERSION){
    document.querySelectorAll('.hh-chat,.hh-chat-btn,.hh-popup-overlay,.hh-popup-tab').forEach(el=>el.remove());
    document.querySelectorAll('style[data-hotend-hub-style]').forEach(el=>el.remove());
  }
  window.__HOTEND_HUB__=true;
  window.__HOTEND_HUB_VERSION__=CLIENT_VERSION;

  const proxy='/apps/hotend-hub';
  const css=`
  .hh-reviews{margin:30px 0;padding:22px;border:1px solid #e5e7eb;border-radius:16px;background:#fff}
  .hh-reviews h3{margin:0 0 8px;color:#0b2748}.hh-stars{color:#f5b51b;letter-spacing:1px}
  .hh-review{padding:14px 0;border-top:1px solid #eef2f6}.hh-review-meta{font-size:13px;color:#667085;margin-top:4px}
  .hh-chat-btn{position:fixed;right:14px;bottom:14px;z-index:2147483000;isolation:isolate;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:8px;width:auto!important;min-width:0!important;border:0;border-radius:999px;background:transparent;color:#0b5260;font-weight:900;padding:11px 16px;box-shadow:0 7px 22px rgba(11,39,72,.16);cursor:pointer;font-size:14px;line-height:1;transition:transform .18s ease,box-shadow .18s ease}.hh-chat-btn::before{content:"";position:absolute;inset:-18px;z-index:-2;border-radius:inherit;background:conic-gradient(from 0deg,transparent 0 58%,rgba(122,55,255,.95) 68%,rgba(0,191,255,.95) 75%,rgba(255,255,255,.95) 79%,transparent 88%);animation:hh-chat-orbit 2.8s linear infinite}.hh-chat-btn::after{content:"";position:absolute;inset:2px;z-index:-1;border-radius:999px;background:#fff}.hh-chat-btn:hover{transform:translateY(-1px);box-shadow:0 10px 28px rgba(11,39,72,.2)}.hh-chat-btn-icon{display:inline-flex;align-items:center;justify-content:center;font-size:20px;line-height:1;color:#0b5260}.hh-chat-btn-label{white-space:nowrap;line-height:1}@keyframes hh-chat-orbit{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.hh-chat-btn::before{animation:none}}
  .hh-chat{position:fixed;right:14px;bottom:68px;z-index:2147483000;width:min(380px,calc(100vw - 24px));max-height:min(620px,calc(100dvh - 92px));background:#fff;border:1px solid #dfe3e8;border-radius:15px;box-shadow:0 14px 45px rgba(0,0,0,.22);overflow:hidden;display:none}
  .hh-chat.open{display:flex;flex-direction:column}.hh-chat-head{background:#0b2748;color:#fff;padding:10px 10px 10px 14px;font-weight:900;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px}.hh-chat-head-title{flex:1;text-align:center;padding-left:58px}.hh-chat-head-controls{display:flex;align-items:center;gap:5px}.hh-chat-head-control{width:28px!important;height:28px!important;min-width:28px!important;padding:0!important;border-radius:8px!important;background:rgba(255,255,255,.12)!important;color:#fff!important;font-size:20px!important;line-height:1!important;font-weight:700!important;display:flex!important;align-items:center!important;justify-content:center!important}.hh-chat-head-control:hover{background:rgba(255,255,255,.2)!important}.hh-chat-body{padding:12px;overflow:hidden;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;flex:1;min-height:0}.hh-chat input,.hh-chat textarea{width:100%;border:1px solid #cbd5e1;border-radius:9px;padding:9px 10px;margin:4px 0;font:inherit;font-size:16px}.hh-chat textarea{min-height:68px;max-height:120px;resize:vertical}.hh-chat button{width:100%;background:#f5b51b;color:#0b2748;border:0;border-radius:9px;padding:10px;font-weight:900;cursor:pointer}.hh-chat small{color:#667085;line-height:1.35}
  
  .hh-chat-body{position:relative;background:#f8fafc}.hh-chat-start{min-height:250px;display:flex;flex-direction:column;justify-content:center;gap:7px}.hh-chat-start input{min-height:46px}.hh-chat-start-btn{min-height:46px}
  .hh-chat-conversation{position:relative;display:flex;flex-direction:column;flex:1;min-height:360px}
  .hh-chat-conversation::before{content:"";position:absolute;inset:0;background-image:url("https://cdn.shopify.com/s/files/1/1006/1519/2875/files/hotend-filament-supplies-logo.jpg?v=1791002415");background-repeat:no-repeat;background-position:center 42%;background-size:210px auto;opacity:.10;pointer-events:none;z-index:0}
  .hh-chat-result{position:relative;z-index:1;display:flex;flex-direction:column;gap:8px;flex:1;min-height:250px;max-height:none;overflow-y:auto;padding:10px 2px 12px;-webkit-overflow-scrolling:touch}
  .hh-chat-msg{max-width:82%;padding:9px 11px;border-radius:14px;line-height:1.35;font-size:14px;white-space:pre-wrap;word-break:break-word;box-shadow:0 1px 2px rgba(15,23,42,.04)}
  .hh-chat-msg.you{align-self:flex-end;background:#f5b51b;color:#0b2748;border-bottom-right-radius:5px}
  .hh-chat-msg.hotend{align-self:flex-start;background:rgba(255,255,255,.94);color:#17324d;border:1px solid #dbe3ea;border-bottom-left-radius:5px}.hh-chat-msg a{color:#0b5cab;text-decoration:underline;text-underline-offset:2px;font-weight:700;overflow-wrap:anywhere}.hh-chat-msg a:hover{text-decoration-thickness:2px}.hh-chat-product{display:flex;align-items:center;gap:8px;margin:7px 0;padding:6px 8px;border:1px solid #dbe3ea;border-radius:10px;background:#fff;max-width:100%}.hh-chat-product img{width:34px;height:34px;object-fit:cover;border-radius:7px;flex:0 0 34px;background:#f3f4f6}.hh-chat-product a{display:block;line-height:1.25;text-decoration:none!important}.hh-chat-product a:hover{text-decoration:underline!important}.hh-chat-typing{align-self:flex-start;color:#667085;font-size:12px;padding:4px 8px;font-style:italic}
  .hh-chat-composer{position:relative;z-index:2;display:grid!important;grid-template-columns:1fr auto;gap:8px!important;align-items:center!important;margin-top:8px!important;background:#fff;border-top:1px solid #e5e7eb;padding:8px 0 0!important}
  .hh-chat-composer textarea{height:40px!important;min-height:40px!important;max-height:40px!important;margin:0!important;padding:9px 11px!important;resize:none!important;overflow-y:auto!important;line-height:20px!important;border-radius:10px!important}
  .hh-chat-composer .hh-chat-send{min-width:72px!important;width:auto!important;height:40px!important;min-height:40px!important;max-height:40px!important;padding:0 14px!important;align-self:center!important;border-radius:10px!important}
  @media(max-width:560px){.hh-chat-result{max-height:300px}.hh-chat-conversation::before{background-size:180px auto}.hh-chat-msg{max-width:88%;font-size:13.5px}.hh-chat-composer .hh-chat-send{min-width:66px!important;padding:0 12px!important}}
  .hh-popup-overlay{position:fixed;inset:0;z-index:2147482998;background:rgba(11,39,72,.42);display:flex;align-items:center;justify-content:center;padding:14px}
  .hh-popup{position:relative;width:min(460px,calc(100vw - 24px));max-height:calc(100dvh - 28px);overflow:auto;background:#fff;border:1px solid #dfe3e8;border-radius:18px;box-shadow:0 22px 70px rgba(0,0,0,.28);padding:22px;text-align:center;-webkit-overflow-scrolling:touch}
  .hh-popup-logo{display:none!important}
  .hh-popup h3{margin:0 0 7px;color:#0b2748;font-size:clamp(24px,4.5vw,32px);line-height:1.08}.hh-popup p{margin:0 0 13px;color:#d9772c;font-size:16px}
  .hh-popup-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.hh-popup input[type=text],.hh-popup input[type=email]{width:100%;border:1px solid #cbd5e1;border-radius:11px;padding:11px 12px;font:inherit;font-size:16px}.hh-popup-email{grid-column:1/-1}
  .hh-popup-consent{display:flex;align-items:flex-start;gap:7px;text-align:left;color:#667085;font-size:12px;line-height:1.35;margin:10px 0}.hh-popup-consent input{margin-top:2px}
  .hh-popup-submit{width:100%;border:0;border-radius:11px;background:#f5b04f;color:#fff;font-size:16px;font-weight:900;padding:12px 16px;cursor:pointer}.hh-popup-submit:disabled{opacity:.65;cursor:wait}
  .hh-popup-result{margin-top:8px;font-size:13px;color:#0b2748;font-weight:700;white-space:pre-wrap}
  .hh-popup-x{position:absolute;right:12px;top:8px;border:0;background:none;color:#667085;font-size:30px;line-height:1;cursor:pointer}
  .hh-popup-tab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147482997;border:0;background:#0b2748;color:#fff;border-radius:12px 0 0 12px;padding:12px 8px;font-size:13px;font-weight:900;cursor:pointer;writing-mode:vertical-rl;box-shadow:0 8px 24px rgba(0,0,0,.18)}
  @media(max-width:560px){
    .hh-popup-overlay{align-items:flex-end;padding:8px}
    .hh-popup{width:min(94vw,430px);max-height:calc(100dvh - 20px);border-radius:16px;padding:18px 14px 14px;margin:0 auto}
    .hh-popup-grid{grid-template-columns:1fr;gap:7px}.hh-popup-email{grid-column:auto}.hh-popup-logo{width:30%;max-width:96px;margin-bottom:8px}.hh-popup h3{font-size:24px}.hh-popup p{font-size:15px;margin-bottom:11px}.hh-popup-consent{font-size:11.5px;margin:9px 0}.hh-popup-submit{font-size:16px;padding:11px 14px}
    .hh-popup-tab{top:auto;bottom:74px;transform:none;writing-mode:horizontal-tb;border-radius:12px 0 0 12px;padding:10px 12px}
    .hh-chat-btn{right:10px;bottom:10px;padding:11px 13px;font-size:13px}
    .hh-chat{left:8px;right:8px;bottom:58px;width:auto;height:min(68dvh,560px);min-height:0;max-height:calc(100dvh - 72px);border-radius:14px}
    .hh-chat.start-mode{height:auto;max-height:calc(100dvh - 88px)}
    .hh-chat-head{padding:9px 10px;font-size:15px}.hh-chat-head-title{padding-left:52px}
    .hh-chat-body{padding:9px;flex:1;display:flex;flex-direction:column;min-height:0}
    .hh-chat.start-mode .hh-chat-body{flex:none}
    .hh-chat-start{flex:1;min-height:0;justify-content:center;gap:6px}
    .hh-chat.start-mode .hh-chat-start{padding:4px 0;justify-content:flex-start}
    .hh-chat-start input{min-height:42px;padding:8px 10px}
    .hh-chat-start-btn{min-height:42px}
    .hh-chat-marketing{font-size:11.5px!important;margin:6px 1px 8px!important}
    .hh-chat-conversation{display:flex;flex-direction:column;flex:1;min-height:0}.hh-chat-result{flex:1;max-height:none!important;min-height:0}.hh-chat textarea{min-height:40px!important}
  }
  `;

  const style=document.createElement('style');
  style.setAttribute('data-hotend-hub-style','1');
  style.textContent=css;
  document.head.appendChild(style);

  const stars=n=>'★'.repeat(Math.max(0,Math.min(5,Number(n)||0)))+'☆'.repeat(5-Math.max(0,Math.min(5,Number(n)||0)));

  async function productReviews(){
    if(!location.pathname.startsWith('/products/'))return;
    if(document.querySelector('[data-hotend-native-reviews="1"]'))return;
    const handle=location.pathname.split('/products/')[1]?.split(/[?#/]/)[0];
    if(!handle)return;
    try{
      const p=await fetch('/products/'+handle+'.js').then(r=>r.json());
      const data=await fetch(proxy+'/reviews?product_id='+encodeURIComponent('gid://shopify/Product/'+p.id)).then(r=>r.json());
      if(!data.ok||!data.count)return;
      const box=document.createElement('section');
      box.className='hh-reviews';
      const h=document.createElement('h3');
      h.textContent='Customer reviews';
      box.appendChild(h);
      const sum=document.createElement('div');
      sum.innerHTML='<span class="hh-stars">'+stars(Math.round(data.average))+'</span> <strong>'+Number(data.average).toFixed(1)+'</strong> · '+data.count+' review'+(data.count===1?'':'s');
      box.appendChild(sum);
      data.reviews.forEach(r=>{
        const row=document.createElement('div');
        row.className='hh-review';
        const s=document.createElement('div');
        s.className='hh-stars';
        s.textContent=stars(r.rating);
        row.appendChild(s);
        const meta=document.createElement('div');
        meta.className='hh-review-meta';
        meta.textContent=r.customer_name||'Verified customer';
        row.appendChild(meta);
        if(r.feedback){
          const t=document.createElement('div');
          t.style.marginTop='7px';
          t.textContent=r.feedback;
          row.appendChild(t);
        }
        box.appendChild(row);
      });
      const themeAnchor=document.querySelector('#hotend-hub-reviews-anchor');
      if(themeAnchor){
        themeAnchor.replaceChildren(box);
      }else{
        const form=document.querySelector('product-form,.product-form,form[action*="/cart/add"]');
        const anchor=form?.closest('.product__info-container,.product-info,.product__info-wrapper')||form;
        if(anchor?.parentNode)anchor.parentNode.insertBefore(box,anchor.nextSibling);
        else document.querySelector('main')?.appendChild(box);
      }
    }catch(e){}
  }

  function chat(){
    const btn=document.createElement('button');
    btn.className='hh-chat-btn';
    btn.type='button';
    btn.innerHTML='<span class="hh-chat-btn-icon" aria-hidden="true">✦</span><span class="hh-chat-btn-label">Ask Hotend</span>';

    const box=document.createElement('div');
    box.className='hh-chat';
    box.innerHTML='<div class="hh-chat-head"><div class="hh-chat-head-title">Hotend Support</div><div class="hh-chat-head-controls"><button class="hh-chat-minimize hh-chat-head-control" type="button" aria-label="Minimize chat">−</button><button class="hh-chat-close-ui hh-chat-head-control" type="button" aria-label="Close chat window">×</button></div></div><div class="hh-chat-body"><div class="hh-chat-start"><div class="hh-chat-start-note" style="display:none;margin:0 0 10px;padding:9px 10px;border-radius:10px;background:#eef6ff;color:#17324d;font-size:12.5px;line-height:1.4"></div><input name="name" placeholder="First name"><input name="email" type="email" placeholder="Email"><label class="hh-chat-marketing" style="display:flex;align-items:flex-start;gap:8px;margin:9px 1px 12px;text-align:left;line-height:1.4;color:#667085;font-size:13px"><input name="opt" type="checkbox" checked style="width:auto;margin:3px 0 0;flex:0 0 auto"><span>I want to receive marketing and promotional emails.</span></label><button class="hh-chat-start-btn" type="button">Start chat</button></div><div class="hh-chat-conversation" style="display:none"><div class="hh-chat-result" style="margin-top:0;font-size:13px"></div><div class="hh-chat-composer" style="display:flex;gap:8px;margin-top:10px"><textarea name="message" placeholder="Ask about stock, colours, orders or printing..." style="min-height:54px"></textarea><button class="hh-chat-send" type="button" style="width:auto;min-width:84px">Send</button></div></div></div>';

    btn.onclick=()=>box.classList.toggle('open');
    box.querySelector('.hh-chat-minimize').onclick=()=>{
      box.classList.remove('open');
    };
    const refKey='hh_chat_ref';
    const nameKey='hh_chat_name';
    const emailKey='hh_chat_email';

    box.querySelector('.hh-chat-close-ui').onclick=()=>{
      const ref=sessionStorage.getItem(refKey)||'';

      // Close the UI immediately so the button always feels responsive.
      box.classList.remove('open');
      sessionStorage.removeItem(refKey);
      sessionStorage.removeItem(nameKey);
      sessionStorage.removeItem(emailKey);
      sessionStorage.removeItem('hh_chat_marketing_opt_in');
      box.querySelector('[name=name]').value='';
      box.querySelector('[name=email]').value='';
      box.querySelector('[name=message]').value='';
      const note=box.querySelector('.hh-chat-start-note');
      note.textContent='Chat closed. Your transcript will be emailed to you. Enter your details to start a new chat.';
      note.style.display='block';
      showStart();
      humanMode=false;
      refreshBusy=false;
      lastThreadSignature='';

      // End the backend session without blocking the close animation/UI.
      if(ref){
        fetch(proxy+'/chat',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({reference:ref,close_chat:true}),
          keepalive:true
        }).catch(()=>{});
      }
    };
    const startView=box.querySelector('.hh-chat-start');
    const conversationView=box.querySelector('.hh-chat-conversation');

    function showConversation(){
      box.classList.remove('start-mode');
      startView.style.display='none';
      conversationView.style.display='flex';
    }

    function showStart(){
      box.classList.add('start-mode');
      startView.style.display='block';
      conversationView.style.display='none';
    }

    if(sessionStorage.getItem(refKey)){
      box.querySelector('[name=name]').value=sessionStorage.getItem(nameKey)||'';
      box.querySelector('[name=email]').value=sessionStorage.getItem(emailKey)||'';
      showConversation();
    }else{
      showStart();
    }
    let lastThreadSignature='';
    const appendLinkedText=(el,value)=>{
      const text=String(value||'');
      const tokenRe=/\[\[PRODUCT\|([^|\]]+)\|(https?:\/\/[^|\]]+)\|([^\]]*)\]\]|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
      let last=0,match;
      while((match=tokenRe.exec(text))){
        if(match.index>last)el.appendChild(document.createTextNode(text.slice(last,match.index)));

        if(match[1]){
          const wrap=document.createElement('span');
          wrap.className='hh-chat-product';

          if(match[3]){
            const img=document.createElement('img');
            img.src=match[3];
            img.alt='';
            img.loading='lazy';
            img.referrerPolicy='no-referrer';
            wrap.appendChild(img);
          }

          const a=document.createElement('a');
          a.href=match[2];
          a.textContent=match[1];
          a.target='_blank';
          a.rel='noopener noreferrer';
          wrap.appendChild(a);
          el.appendChild(wrap);
        }else{
          const href=match[5]||match[6];
          const label=match[4]||href;
          const a=document.createElement('a');
          a.href=href;
          a.textContent=label;
          a.target='_blank';
          a.rel='noopener noreferrer';
          el.appendChild(a);
        }
        last=tokenRe.lastIndex;
      }
      if(last<text.length)el.appendChild(document.createTextNode(text.slice(last)));
    };

    const showThread=(messages,{force=false}={})=>{
      const thread=box.querySelector('.hh-chat-result');
      const items=(messages||[]).slice(-30);
      const signature=items.map(m=>[m.sender||'',m.message||'',m.created_at||''].join('\u0001')).join('\u0002');
      if(!force&&signature===lastThreadSignature)return;
      lastThreadSignature=signature;
      const nearBottom=thread.scrollHeight-thread.scrollTop-thread.clientHeight<80;
      thread.replaceChildren();
      for(const m of items){
        const bubble=document.createElement('div');
        const fromHotend=(m.sender==='HOTEND'||m.sender==='AI'||m.sender==='SYSTEM');
        bubble.className='hh-chat-msg '+(fromHotend?'hotend':'you');
        appendLinkedText(bubble,m.message||'');
        thread.appendChild(bubble);
      }
      if(nearBottom||force)requestAnimationFrame(()=>{thread.scrollTop=thread.scrollHeight;});
    };

    let humanMode=false;
    let refreshBusy=false;
    async function refreshThread(){
      const ref=sessionStorage.getItem(refKey);
      if(!ref)return;
      if(refreshBusy)return;
      refreshBusy=true;
      try{
        const data=await fetch(proxy+'/chat?reference='+encodeURIComponent(ref),{cache:'no-store'}).then(r=>r.json());
        if(!data.ok)return;
        humanMode=!!data.needs_human;
        if(data.closed){
          sessionStorage.removeItem(refKey);
          sessionStorage.removeItem(nameKey);
          sessionStorage.removeItem(emailKey);
          sessionStorage.removeItem('hh_chat_marketing_opt_in');
          box.querySelector('[name=name]').value='';
          box.querySelector('[name=email]').value='';
          box.querySelector('[name=message]').value='';
          const note=box.querySelector('.hh-chat-start-note');
          note.textContent='Your previous chat has ended and a transcript has been emailed to you. Enter your first name and email to start a new chat.';
          note.style.display='block';
          lastThreadSignature='';
          box.querySelector('.hh-chat-result').replaceChildren();
          showStart();
          return;
        }
        showThread(data.messages);
      }catch(e){}finally{refreshBusy=false;}
    }

    box.querySelector('.hh-chat-result').style.whiteSpace='pre-wrap';
    btn.addEventListener('click',refreshThread);

    box.querySelector('.hh-chat-start-btn').onclick=async()=>{
      const name=box.querySelector('[name=name]').value.trim();
      const email=box.querySelector('[name=email]').value.trim();
      const opt=box.querySelector('[name=opt]').checked;
      if(!name){
        box.querySelector('[name=name]').focus();
        return;
      }
      if(!email||!email.includes('@')){
        box.querySelector('[name=email]').focus();
        return;
      }

      const startBtn=box.querySelector('.hh-chat-start-btn');
      startBtn.disabled=true;
      startBtn.textContent='Starting…';
      try{
        const data=await fetch(proxy+'/chat',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            reference:sessionStorage.getItem(refKey)||'',
            name,
            email,
            marketing_opt_in:opt,
            start_only:true
          })
        }).then(r=>r.json());

        if(!data.ok)throw new Error(data.message||'Unable to start chat');
        if(data.reference)sessionStorage.setItem(refKey,data.reference);
        const note=box.querySelector('.hh-chat-start-note');
        if(note)note.style.display='none';
        sessionStorage.setItem(nameKey,name);
        sessionStorage.setItem(emailKey,email);
        sessionStorage.setItem('hh_chat_marketing_opt_in',opt?'1':'0');
        showConversation();
        showThread(data.messages||[],{force:true});
        box.querySelector('[name=message]').focus();
      }catch(e){
        startBtn.disabled=false;
        startBtn.textContent='Start chat';
        const emailInput=box.querySelector('[name=email]');
        emailInput.setCustomValidity('Unable to start chat right now. Please try again.');
        emailInput.reportValidity();
        setTimeout(()=>emailInput.setCustomValidity(''),2500);
      }
    };

    box.querySelector('.hh-chat-send').onclick=async()=>{
      const thread=box.querySelector('.hh-chat-result');
      const input=box.querySelector('[name=message]');
      const message=input.value.trim();
      if(!message)return;

      input.value='';
      const optimistic=document.createElement('div');
      optimistic.className='hh-chat-msg you';
      optimistic.textContent=message;
      thread.appendChild(optimistic);
      const typing=document.createElement('div');
      typing.className='hh-chat-typing';
      typing.textContent='Hotend is typing…';
      thread.appendChild(typing);
      requestAnimationFrame(()=>{thread.scrollTop=thread.scrollHeight;});

      try{
        const data=await fetch(proxy+'/chat',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            reference:sessionStorage.getItem(refKey)||'',
            name:sessionStorage.getItem(nameKey)||'',
            email:sessionStorage.getItem(emailKey)||'',
            message,
            marketing_opt_in:sessionStorage.getItem('hh_chat_marketing_opt_in')==='1'
          })
        }).then(r=>r.json());

        if(data.reference)sessionStorage.setItem(refKey,data.reference);
        if(data.ok){
          showThread(data.messages||[]);
          const quick=[120,260,450,700,1000,1400,1900,2600,3400];
          quick.forEach(ms=>setTimeout(refreshThread,ms));
        }else{
          optimistic.textContent=message+'\nUnable to send.';
        }
      }catch(e){
        optimistic.textContent=message+'\nUnable to send.';
      }
    };
    const messageBox=box.querySelector('[name=message]');
    messageBox.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&!e.shiftKey){
        e.preventDefault();
        box.querySelector('.hh-chat-send').click();
      }
    });
    messageBox.setAttribute('aria-label','Chat message. Press Enter to send, Shift plus Enter for a new line.');

    document.body.append(box,btn);
    const poll=async()=>{
      if(box.classList.contains('open'))await refreshThread();
      setTimeout(poll,humanMode?250:500);
    };
    setTimeout(poll,350);
  }

  async function popup(){
    try{
      if(localStorage.getItem('hh_marketing_subscribed')==='1')return;
      const data=await fetch(proxy+'/config').then(r=>r.json());
      const p=(data?.popups||[]).find(x=>String(x.popup_type||'').toUpperCase()==='NEWSLETTER')||data?.popups?.[0];
      if(!p)return;

      const overlay=document.createElement('div');
      overlay.className='hh-popup-overlay';
      overlay.style.display=sessionStorage.getItem('hh_popup_closed_'+p.id)==='1'?'none':'flex';

      const el=document.createElement('div');
      el.className='hh-popup';

      const h=document.createElement('h3');
      h.textContent=p.headline||'Get 10% OFF your order';
      el.appendChild(h);

      const t=document.createElement('p');
      t.textContent=p.body_text||'Sign up and unlock your instant discount.';
      el.appendChild(t);

      const grid=document.createElement('div');
      grid.className='hh-popup-grid';
      grid.innerHTML='<input name="first_name" type="text" autocomplete="given-name" placeholder="First name"><input name="last_name" type="text" autocomplete="family-name" placeholder="Last name"><input class="hh-popup-email" name="email" type="email" autocomplete="email" placeholder="Email address" required>';
      el.appendChild(grid);

      const consent=document.createElement('label');
      consent.className='hh-popup-consent';
      consent.innerHTML='<input name="marketing_opt_in" type="checkbox" checked> <span>Email me Hotend offers, new filament releases and updates. You can untick this option.</span>';
      el.appendChild(consent);

      const submit=document.createElement('button');
      submit.className='hh-popup-submit';
      submit.type='button';
      submit.textContent=p.cta_text||'Claim discount';
      el.appendChild(submit);

      const result=document.createElement('div');
      result.className='hh-popup-result';
      el.appendChild(result);

      const x=document.createElement('button');
      x.className='hh-popup-x';
      x.type='button';
      x.setAttribute('aria-label','Close signup popup');
      x.textContent='×';
      el.appendChild(x);

      overlay.appendChild(el);

      const tab=document.createElement('button');
      tab.className='hh-popup-tab';
      tab.type='button';
      tab.textContent=String(p.targeting?.side_tab_text||'').trim()||String(p.headline||'').trim()||'Hotend offers';
      tab.style.display=overlay.style.display==='none'?'block':'none';

      const dock=()=>{
        sessionStorage.setItem('hh_popup_closed_'+p.id,'1');
        overlay.style.display='none';
        tab.style.display='block';
      };
      x.onclick=dock;
      overlay.addEventListener('click',e=>{if(e.target===overlay)dock();});
      tab.onclick=()=>{
        overlay.style.display='flex';
        tab.style.display='none';
      };

      submit.onclick=async()=>{
        const email=el.querySelector('[name=email]').value.trim();
        const opt=el.querySelector('[name=marketing_opt_in]').checked;
        result.textContent='';
        if(!email||!email.includes('@')){
          result.textContent='Please enter a valid email address.';
          return;
        }
        submit.disabled=true;
        submit.textContent='Submitting…';
        try{
          const response=await fetch(proxy+'/subscribe',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
              popup_id:p.id,
              first_name:el.querySelector('[name=first_name]').value,
              last_name:el.querySelector('[name=last_name]').value,
              email,
              marketing_opt_in:opt
            })
          }).then(r=>r.json());
          result.textContent=response.message||'Thanks!';
          if(response.subscribed){
            localStorage.setItem('hh_marketing_subscribed','1');
            sessionStorage.removeItem('hh_popup_closed_'+p.id);
            if(response.discount_code&&!response.discount_email_sent){
              result.textContent+='\nCode: '+response.discount_code;
            }
            setTimeout(()=>{overlay.remove();tab.remove();},2600);
          }else{
            submit.disabled=false;
            submit.textContent=p.cta_text||'Claim discount';
          }
        }catch(e){
          result.textContent='Sorry, signup is unavailable right now.';
          submit.disabled=false;
          submit.textContent=p.cta_text||'Claim discount';
        }
      };

      document.body.append(overlay,tab);
    }catch(e){}
  }

  function trackingDeliveredDatePatch(){
    if(location.pathname!='/pages/track-order')return;
    const form=document.getElementById('HotendTrackForm');
    if(!form||form.dataset.hhDeliveredPatch==='1')return;
    form.dataset.hhDeliveredPatch='1';

    form.addEventListener('submit',async()=>{
      await new Promise(r=>setTimeout(r,60));
      const fd=new FormData(form);
      const order=String(fd.get('order')||'').trim();
      const email=String(fd.get('email')||'').trim();
      const phone=String(fd.get('phone')||'').trim();
      if(!order)return;

      const params=new URLSearchParams({order});
      if(email)params.set('email',email);
      else if(phone)params.set('phone',phone);
      else return;

      try{
        const res=await fetch('/apps/hotend-hub/tracking?'+params.toString(),{cache:'no-store'});
        const data=await res.json();
        if(!data.ok)return;
        const meta=document.getElementById('HotendOrderMeta');
        const tiles=meta?[...meta.children]:[];
        if(tiles.length<4)return;
        const orderDate=tiles[0];
        const total=tiles[1];
        const payment=tiles[2];
        const delivered=tiles[3];

        const when=data.order?.delivered_at||data.order?.fulfilled_at||null;

        if(orderDate){
          const l=orderDate.querySelector('span');
          const v=orderDate.querySelector('strong');
          if(l)l.textContent='Order date';
          if(v)v.textContent=data.order?.created_at?new Date(data.order.created_at).toLocaleDateString():'—';
        }

        if(total){
          const l=total.querySelector('span');
          if(l)l.textContent='Total';
        }

        if(payment){
          const l=payment.querySelector('span');
          const v=payment.querySelector('strong');
          if(l)l.textContent='Delivered date';
          if(v)v.textContent=when?new Date(when).toLocaleDateString():'—';
        }

        if(delivered){
          const l=delivered.querySelector('span');
          const v=delivered.querySelector('strong');
          if(l)l.textContent='Payment';
          if(v)v.textContent=(data.order?.financial_status||'—').toString().replace(/_/g,' ').toLowerCase().replace(/\b\w/g,m=>m.toUpperCase());
        }
      }catch(e){}
    });
  }

  const start=()=>{productReviews();chat();popup();trackingDeliveredDatePatch();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
  else start();
}

export function storefrontScript(){
  return '('+hotendHubClient.toString()+')();';
}
