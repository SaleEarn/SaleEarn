/* Sale Earn Admin Studio. Based on the original Low-Load marketplace. */
(function(){
'use strict';
const $=id=>document.getElementById(id),cfg=()=>ensurePlatformConfig();
const paths={grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',sliders:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',box:'M12 3 3 8v9l9 5 9-5V8z M3 8l9 5 9-5 M12 13v9 M7.5 5.5l9 5',orders:'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h3',wallet:'M3 6h17v14H3z M3 6V4h14v2 M15 11h6v5h-6z',arrow:'M5 12h14 M13 6l6 6-6 6',chart:'M4 19V5 M4 19h16 M8 15l4-5 4 2 4-7',star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z M8 12l3 3 5-6',clock:'M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',tag:'M3 3h8l10 10-8 8L3 11z M7 7h.01',globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',mail:'M4 5h16v14H4z M4 7l8 6 8-6',menu:'M4 6h16 M4 12h16 M4 18h16',exit:'M9 4H4v16h5 M12 12h9 M17 8l4 4-4 4',trash:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',bolt:'m13 2-9 12h7l-1 8 10-13h-7z',check:'M5 12l4 4L19 6',refresh:'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 3 M18 18A8 8 0 0 1 5 15'};
const icon=k=>`<svg class="as-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[k]||paths.grid}"/></svg>`;
const initials=x=>String(x||'Admin').split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
let panel='website',mobileOpen=false,liveChannel=null,liveStarted=false,liveRevision=0,signalPending=false,liveDirty=false,flushTimer=null,publishing=false,liveWake=null;
let syncState='idle',syncText='Checking connection',lastSignalTime=0,dirtyFields=false;
let statusPendingTimer=null,statusHoldTimer=null,statusHoldUntil=0;
function status(state,text){
 state=String(state||'idle');text=String(text||'');
 if(state===syncState&&text===syncText){
  document.querySelectorAll('.as-sync').forEach(e=>{if(e.dataset.state!==state)e.dataset.state=state;});
  return;
 }
 /* Keep the admin save indicator stable: very short background syncs should not
    flash "Saving" over and over, and a completed state stays visible briefly. */
 if(state==='saving'){
  clearTimeout(statusPendingTimer);
  statusPendingTimer=setTimeout(()=>{
   syncState='saving';syncText=text;
   document.querySelectorAll('.as-sync').forEach(e=>{e.dataset.state='saving';e.innerHTML='<i class="as-dot"></i><span>'+esc(text)+'</span>';});
  },300);
  return;
 }
 clearTimeout(statusPendingTimer);
 if(state==='live'&&Date.now()<statusHoldUntil){
  clearTimeout(statusHoldTimer);
  statusHoldTimer=setTimeout(()=>status(state,text),Math.max(0,statusHoldUntil-Date.now()));
  return;
 }
 syncState=state;syncText=text;
 if(state==='live')statusHoldUntil=Date.now()+650;
 document.querySelectorAll('.as-sync').forEach(e=>{
  if(e.dataset.state===state&&e.querySelector('span')?.textContent===text)return;
  e.dataset.state=state;e.innerHTML='<i class="as-dot"></i><span>'+esc(text)+'</span>';
 });
}
function when(v){const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});}
function human(k){k=String(k);if(/^[A-Z_]+$/.test(k))k=k.toLowerCase().replaceAll('_',' ');return k.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase());}

/* ---------- Sale Earn Mail Center ---------- */
let mailTab='inbox',mailSelected=null;
function mailStore(){
  S.mailMessages=Array.isArray(S.mailMessages)?S.mailMessages:[];
  return S.mailMessages;
}
function mailSeed(){
  const a=mailStore();
  if(a.length)return;
  a.push({id:uid('mail'),type:'system',from:'Sale Earn',fromEmail:cfg().branding?.contactEmail||'',to:S.currentUser?.email||'',subject:'Welcome to Sale Earn Mail Center',body:'Your internal Sale Earn messages will appear here. Authentication OTP emails are delivered by Supabase Auth to the user’s email inbox.',date:nowISO(),read:false,starred:false});
}
function mailDetailModal(m){
 const isSent=m.type==='sent';
 const sender=isSent?(m.from||'Administrator'):(m.from||'Sale Earn');
 const recipient=isSent?(m.to||''):(m.to||S.currentUser?.email||'');
 const dateText=(()=>{try{return new Date(m.date).toLocaleString('en-IN')}catch(e){return '—'}})();
 const body=String(m.body||m.message||'').replace(/\n/g,'<br>');
 document.getElementById('modalRoot').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal mail-read-modal" role="dialog" aria-modal="true" aria-label="Mail details">
   <button class="btn iconbtn close" onclick="closeModal()" aria-label="Close">×</button>
   <div class="mail-read-head">
     <div class="mail-avatar large">${esc(initials(isSent?m.to:m.from))}</div>
     <div class="mail-read-meta"><div class="mail-read-kicker">${isSent?'Sent mail':'Received mail'}</div><h2>${esc(m.subject||'(No subject)')}</h2><div class="muted small">${isSent?'To: '+esc(recipient):'From: '+esc(sender)} · ${esc(dateText)}</div></div>
   </div>
   <div class="mail-read-info"><div><b>From</b><span>${esc(sender)}${m.fromEmail?` · ${esc(m.fromEmail)}`:''}</span></div><div><b>To</b><span>${esc(recipient)}</span></div>${m.type==='contact'&&m.userId?`<div><b>User ID</b><span>${esc(m.userId)}</span></div>`:''}</div>
   ${m.warningId?`<div class="mail-context"><b>Warning message</b><span>${esc(m.warningId)}</span>${m.productId?`<button class="btn" onclick="closeModal();adminNav('product/${esc(m.productId)}')">Open product</button>`:''}</div>`:''}
   <div class="mail-read-body">${body||'<span class="muted">No message content.</span>'}</div>
   <div class="modal-footer mail-read-actions">
     <button class="btn" onclick="closeModal()">Close</button>
     ${!isSent?`<button class="btn primary" onclick="closeModal();mailReply('${esc(m.id)}')">↩ Reply</button>`:`<button class="btn" onclick="closeModal();mailEdit('${esc(m.id)}')">✎ Edit</button>`}
     <button class="btn" onclick="mailToggleStar('${esc(m.id)}');closeModal()">${m.starred?'★ Starred':'☆ Star'}</button>
     <button class="btn danger" onclick="closeModal();mailDelete('${esc(m.id)}')">Delete</button>
   </div>
 </div></div>`;
}
window.mailOpen=async function(id){
 const m=mailStore().find(x=>String(x.id)===String(id));
 if(!m)return toast('Mail not found');
 mailSelected=m.id;
 const wasRead=m.read===true;
 if(!wasRead){
   if(m.type==='contact'&&m.externalId&&window.supabaseClient){
     const {error}=await window.supabaseClient.from('contact_messages').update({read:true}).eq('id',String(m.externalId)).eq('read',false);
     if(error){
       console.warn('Contact read update failed:',error?.message||error);
       toast('Mail opened. Read status could not be synced.');
     }else{
       m.read=true;
       m.readAt=nowISO();
       sePersist();
       try{seMarkNotifRead(n=>String(n.entityId||'')===String(m.id));}catch(e){}
     }
   }else{
     m.read=true;
     m.readAt=nowISO();
     sePersist();
     try{await Promise.resolve(save());}catch(e){console.warn('Mail read sync failed:',e?.message||e);}
     try{seMarkNotifRead(n=>String(n.entityId||'')===String(m.id));}catch(e){}
   }
   /* Render only after the read state is committed, so 5 → 4 happens immediately and stays in sync. */
   render();
 }
 mailDetailModal(m);
};
window.mailBack=function(){mailSelected=null;render();};
window.mailTab=function(tab){mailTab=tab;mailSelected=null;render();};
window.mailDelete=async function(id){if(!adminOnly())return;const m=mailStore().find(x=>x.id===id);if(m?.type==='contact'&&m.externalId&&window.supabaseClient){try{await window.supabaseClient.from('contact_messages').delete().eq('id',m.externalId);}catch(e){console.warn('Contact delete failed:',e)}}S.mailMessages=mailStore().filter(x=>x.id!==id);mailSelected=null;save();render();};
window.mailToggleStar=async function(id){if(!adminOnly())return;const m=mailStore().find(x=>x.id===id);if(!m)return;m.starred=!m.starred;if(m.type==='contact'&&m.externalId&&window.supabaseClient){try{await window.supabaseClient.from('contact_messages').update({starred:m.starred}).eq('id',m.externalId);}catch(e){console.warn('Contact star update failed:',e)}}save();render();};
window.mailCompose=function(){
  if(!adminOnly())return;
  const users=(S.users||[]).filter(u=>u.email).map(u=>`<option value="${esc(u.email)}">${esc(u.name||u.email)} — ${esc(u.email)}</option>`).join('');
  document.getElementById('modalRoot').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal mail-compose-modal"><button class="btn iconbtn close" onclick="closeModal()">×</button><div class="mail-compose-head"><span class="mail-big-icon">✉</span><div><h2 style="margin:0">Compose message</h2><p class="muted" style="margin:4px 0 0">Send an internal message to a Sale Earn user.</p></div></div><div class="field"><label>Recipient</label><select id="mailTo"><option value="">Choose a user</option>${users}</select></div><div class="field"><label>Subject</label><input id="mailSubject" maxlength="160" placeholder="Message subject"></div><div class="field"><label>Message</label><textarea id="mailBody" maxlength="5000" placeholder="Write your message..."></textarea></div><div class="mail-compose-note">This Mail Center stores messages inside Sale Earn. Supabase Auth OTP emails continue to use the SMTP sender configured in Supabase.</div><div class="modal-footer"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="mailSend()">Send message</button></div></div></div>`;
};
window.mailSend=function(){
  if(!adminOnly())return;
  const to=String($('mailTo')?.value||'').trim(),subject=String($('mailSubject')?.value||'').trim(),body=String($('mailBody')?.value||'').trim();
  if(!to||!subject||!body)return toast('Recipient, subject and message are required.');
  const user=(S.users||[]).find(u=>String(u.email||'').toLowerCase()===to.toLowerCase());
  const m={id:uid('mail'),type:'sent',from:S.currentUser?.name||'Administrator',fromEmail:S.currentUser?.email||'',to,subject,body,date:nowISO(),read:true,starred:false,userId:user?.id||null};
  mailStore().unshift(m);if(mailStore().length>500)mailStore().length=500;save();closeModal();mailTab='sent';mailSelected=m.id;render();toast('Message saved in Sent.');
};
window.mailReply=function(id){if(!adminOnly())return;const src=mailStore().find(x=>x.id===id);if(!src)return toast('Message not found');document.getElementById('modalRoot').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal mail-compose-modal"><button class="btn iconbtn close" onclick="closeModal()">×</button><div class="mail-compose-head"><span class="mail-big-icon">↩</span><div><h2 style="margin:0">Reply to ${esc(src.from||'User')}</h2><p class="muted" style="margin:4px 0 0">${esc(src.subject||'Support message')}</p></div></div><div class="field"><label>Subject</label><input id="mailReplySubject" maxlength="160" value="${esc(/^re:/i.test(src.subject||'')?src.subject:'Re: '+(src.subject||'Support message'))}"></div><div class="field"><label>Reply</label><textarea id="mailReplyBody" maxlength="5000" placeholder="Write your reply..."></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="mailSendReply('${esc(id)}')">Send Reply</button></div></div></div>`};
window.mailSendReply=function(id){if(!adminOnly())return;const src=mailStore().find(x=>x.id===id),subject=String(document.getElementById('mailReplySubject')?.value||'').trim(),body=String(document.getElementById('mailReplyBody')?.value||'').trim();if(!src||!subject||!body)return toast('Subject and reply are required');const m={id:uid('mail'),threadId:src.threadId||uid('thread'),inReplyTo:src.id,type:'sent',from:S.currentUser?.name||'Sale Earn Admin',fromEmail:S.currentUser?.email||'',to:src.fromEmail||'',subject,body,date:nowISO(),read:true,starred:false,userId:src.userId||null,sellerId:src.sellerId||null,warningId:src.warningId||null,productId:src.productId||null};mailStore().unshift(m);src.read=true;if(mailStore().length>500)mailStore().length=500;save();closeModal();mailTab='sent';mailSelected=m.id;render();toast('Reply sent to user')};
window.mailEdit=function(id){if(!adminOnly())return;const m=mailStore().find(x=>x.id===id);if(!m)return toast('Message not found');if(m.type!=='sent')return toast('Only messages you sent can be edited');document.getElementById('modalRoot').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal mail-compose-modal"><button class="btn iconbtn close" onclick="closeModal()">×</button><div class="mail-compose-head"><span class="mail-big-icon">✎</span><div><h2 style="margin:0">Edit message</h2><p class="muted" style="margin:4px 0 0">To: ${esc(m.to||'')}</p></div></div><div class="field"><label>Subject</label><input id="mailEditSubject" maxlength="160" value="${esc(m.subject||'')}"></div><div class="field"><label>Message</label><textarea id="mailEditBody" maxlength="5000">${esc(m.body||'')}</textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="mailSaveEdit('${esc(id)}')">Save changes</button></div></div></div>`};
window.mailSaveEdit=function(id){if(!adminOnly())return;const m=mailStore().find(x=>x.id===id);if(!m)return toast('Message not found');const subject=String(document.getElementById('mailEditSubject')?.value||'').trim(),body=String(document.getElementById('mailEditBody')?.value||'').trim();if(!subject||!body)return toast('Subject and message are required');m.subject=subject;m.body=body;m.edited=true;m.editedAt=nowISO();save();closeModal();render();toast('Message updated')};
function mailPanel(){
  mailSeed();
  if(String(route()||"")==='admin/mail'){startContactAdminRealtime();if(!CONTACT_ADMIN_INITIAL_LOADED)loadContactMessagesForAdmin();}else{stopContactAdminPolling();stopContactAdminRealtime();}
  const all=mailStore().slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  const selected=mailSelected?all.find(x=>x.id===mailSelected):null;
  const unread=all.filter(x=>!x.read&&x.type!=='sent').length;
  const inbox=all.filter(x=>x.type!=='sent');
  const sent=all.filter(x=>x.type==='sent');
  const active=mailTab==='sent'?sent:inbox;
  const rows=active.map(m=>`<div class="mail-row ${m.read?'':'unread'} ${selected?.id===m.id?'selected':''}" role="button" tabindex="0" onclick="adminOpenMailV6('${esc(m.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();adminOpenMailV6('${esc(m.id)}')}"><span class="mail-avatar">${esc(initials(m.type==='sent'?m.to:m.from))}</span><span class="mail-row-main"><strong>${esc(m.type==='sent'?'To: '+m.to:(m.from||'Sale Earn'))}</strong><span>${esc(m.subject||'(No subject)')}</span><small>${esc(String(m.body||'').replace(/\s+/g,' ').slice(0,95))}</small></span><span class="mail-row-side"><button class="mail-open-btn btn" onclick="event.stopPropagation();adminOpenMailV6('${esc(m.id)}')" aria-label="Open mail">Open</button><button class="mail-star ${m.starred?'on':''}" onclick="event.stopPropagation();mailToggleStar('${esc(m.id)}')" aria-label="Star">${m.starred?'★':'☆'}</button><small>${when(m.date)}</small></span></div>`).join('')||`<div class="mail-empty"><div class="mail-empty-icon">✉</div><h3>No messages</h3><p>${mailTab==='sent'?'Sent messages will appear here.':'Your inbox is clear.'}</p></div>`;
  const detail=`<div class="mail-list"><div class="mail-list-head"><div><b>${mailTab==='sent'?'Sent':'Inbox'}</b><span class="mail-count">${active.length}</span></div><button class="btn primary" onclick="mailCompose()">+ Compose</button></div>${rows}</div>`;
  return adminLayout('mail','Mail Center',`${titleBlock('COMMUNICATION','Mail Center','A clean internal message center for Sale Earn users and admin communication.')}<div class="mail-shell"><aside class="mail-sidebar"><button class="mail-compose-btn" onclick="mailCompose()">✎ Compose</button><button class="mail-nav" onclick="loadContactMessagesForAdmin(true).then(()=>render())">↻ Refresh inbox</button><button class="mail-nav ${mailTab==='inbox'?'active':''}" onclick="mailTab('inbox')">✉ Inbox ${unread?`<span>${unread}</span>`:''}</button><button class="mail-nav ${mailTab==='sent'?'active':''}" onclick="mailTab('sent')">↗ Sent <span>${sent.length}</span></button><div class="mail-info-card"><strong>SMTP connected</strong><p>Auth OTP delivery is handled securely by Supabase SMTP.</p><small>${esc(cfg().branding?.emailSenderName||'Sale Earn')}</small></div></aside><section class="mail-main">${detail}</section></div>`);
}
window.mailPanel=mailPanel;
window.studioMenu=function(){mobileOpen=!mobileOpen;document.body.classList.toggle('as-menu-open',mobileOpen);};
const groups=[['WORKSPACE',[['','grid','Overview'],['control','sliders','Website controls'],['products','box','Products'],['users','users','Users & sellers'],['orders','orders','Orders'],['messages','mail','Messages']]],['BUSINESS',[['sales','chart','Sales & earnings'],['payouts','wallet','Withdrawals'],['commission','tag','Commissions'],['coupons','tag','Coupons'],['analytics','chart','Analytics'],['money','wallet','Money overview']]],['TRUST & GROWTH',[['reviews','star','Reviews'],['smartreviews','star','Review insights'],['warnings','bell','Warnings'],['risk','shield','Risk center'],['ranking','chart','Seller rankings'],['growth','bolt','Seller growth']]],['SYSTEM',[['mail','mail','Mail Center'],['audit','clock','Activity log'],['security','shield','Security'],['emergency','bolt','Emergency controls'],['deleted','trash','Recycle bin'],['system','sliders','System health']]]];
window.adminSidebar=function(active){return `<aside class="admin-side"><a class="as-logo" href="#home" title="Open Sale Earn Home"><span class="logo-mark">SE</span><span>${esc(siteName())}<small>ADMIN STUDIO</small></span></a><nav class="as-nav" aria-label="Admin navigation">${groups.map(([g,items])=>`<div class="admin-nav-title">${g}</div>${items.map(([id,ic,label])=>`<button class="admin-link ${active===id?'active':''}" onclick="adminNav('${id}')" ${active===id?'aria-current="page"':''}>${icon(ic)}<span class="label">${label}</span>${id==='payouts'&&(S.payouts||[]).some(x=>x.status==='PENDING')?`<span class="as-count">${S.payouts.filter(x=>x.status==='PENDING').length}</span>`:id==='mail'&&mailStore().some(x=>x.type!=='sent'&&!x.read)?`<span class="as-count">${mailStore().filter(x=>x.type!=='sent'&&!x.read).length}</span>`:id==='messages'&&(S.messages||[]).some(x=>x.senderRole==='seller'&&!x.readAt)?`<span class="as-count">${(S.messages||[]).filter(x=>x.senderRole==='seller'&&!x.readAt).length}</span>`:id==='warnings'&&(S.warnings||[]).some(x=>x.resolutionRequested&&!x.resolutionReviewed)?`<span class="as-count">${(S.warnings||[]).filter(x=>x.resolutionRequested&&!x.resolutionReviewed).length}</span>`:''}</button>`).join('')}`).join('')}</nav><div class="as-side-footer"><button class="admin-link" onclick="go('home')">${icon('globe')}<span class="label">Visit marketplace</span>${icon('arrow')}</button><div class="as-account"><span class="as-avatar">${esc(initials(S.currentUser?.name))}</span><div style="flex:1"><strong>${esc(S.currentUser?.name||'Administrator')}</strong><small>Administrator · TEST</small></div><button class="btn" aria-label="Sign out" onclick="signout()">${icon('exit')}</button></div></div></aside>`;};
window.adminTop=function(title){return `<div class="admin-top"><button class="btn as-menu" aria-label="Toggle admin navigation" onclick="studioMenu()">${icon('menu')}</button><div class="as-breadcrumb"><span>Workspace</span><span>/</span><b>${esc(title)}</b></div><div class="admin-search-wrap"><input id="adminGlobalSearch" class="admin-search" aria-label="Search users, products and orders" placeholder="Search anything…" oninput="adminSearchLive(this.value)" onkeydown="if(event.key==='Enter')adminSearch(this.value)" autocomplete="off"><div id="adminSearchResults" class="admin-search-results hidden"></div></div><div class="as-top-actions"><div class="as-sync" data-state="${syncState}" role="status"><i class="as-dot"></i><span>${esc(syncText)}</span></div><button class="btn" onclick="studioPublishNow()" title="Sync saved changes now" aria-label="Sync saved changes now">${icon('refresh')}</button><button class="btn" onclick="go('home')">${icon('globe')}<span class="as-preview-label">View website</span></button><button class="btn" onclick="seAdminPwChange()" title="Change Admin password" aria-label="Change Admin password">🔐 Password</button><span class="as-avatar">${esc(initials(S.currentUser?.name))}</span></div></div>`;};
window.adminLayout=function(active,title,content){if(!adminOnly())return `${header()}<main class="page"></main>`;return `<div class="admin-shell">${adminSidebar(active)}<div class="as-mobile-shade" onclick="studioMenu()"></div><section class="admin-main">${adminTop(title)}<div class="admin-content">${content}</div></section></div>`;};
const titleBlock=(label,title,desc)=>`<div class="as-page-title"><div><div class="as-eyebrow">${esc(label)}</div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div><div class="as-date">${new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'long',year:'numeric'})}</div></div>`;
window.adminPage=function(){
 const orders=S.orders||[],paid=orders.filter(o=>o.status==='SUCCESS'),gross=paid.reduce((n,o)=>n+Number(o.amount||0),0),pending=(S.payouts||[]).filter(x=>x.status==='PENDING').length;
 const metric=(label,value,note,ic,dest)=>`<button class="admin-kpi" style="text-align:left" onclick="adminNav('${dest}')"><div class="as-metric-top">${label}${icon(ic)}</div><b>${value}</b><div class="as-metric-note">${note}</div></button>`;
 const rows=orders.slice(0,5).map(o=>{const p=product(o.productId);return `<tr class="data-row" onclick="adminNav('order/${o.id}')"><td><div class="as-title-cell"><span class="as-avatar">${icon('box')}</span><div><b>${esc(p?.title||'Product removed')}</b><small>${esc(o.id)}</small></div></div></td><td>${esc(o.customerName||'Customer')}</td><td>${money(o.amount)}</td><td><span class="as-status ${o.status==='SUCCESS'?'good':o.status==='PENDING'?'wait':'bad'}">${esc(o.status==='SUCCESS'?'Completed':human(o.status||'Pending').toLowerCase())}</span></td><td>${when(o.date)}</td></tr>`;}).join('');
 const quick=(ic,name,desc,target)=>`<button class="as-shortcut" onclick="studioOpenControl('${target}')"><span class="as-queue-icon">${icon(ic)}</span><div><strong>${name}</strong><small>${desc}</small></div></button>`;
 return adminLayout('','Overview',`${titleBlock('YOUR WORKSPACE','Your marketplace, at a glance.','Manage your store, people and settings. Everything in one place.')}<div class="admin-kpis">${metric('Total sales',money(gross),'All-time orders','wallet','sales')}${metric('Orders',String(orders.length),paid.length+' completed orders','orders','orders')}${metric('Published products',String((S.products||[]).filter(p=>!deletedProductIdSet().has(String(p?.id))).length),'Across '+Object.keys(S.sellers||{}).length+' seller stores','box','products')}${metric('Total users',String(S.users.length),'Registered marketplace members','users','users')}</div><div class="as-cols"><div class="admin-card"><div class="section-head"><div><h2>Recent orders</h2><div class="sub" style="margin:0!important">The latest activity across your marketplace.</div></div><button class="btn" onclick="adminNav('orders')">View all ${icon('arrow')}</button></div><div class="as-table-wrap"><table class="admin-table"><thead><tr><th>Product / order</th><th>Customer</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows||'<tr><td colspan="5"><div class="admin-empty">No orders yet. New orders will appear here.</div></td></tr>'}</tbody></table></div></div><div class="admin-card"><h2>Needs your attention</h2><p class="sub">A short list of things to review.</p>${[['wallet','Withdrawal requests',pending,'Pending payout review','payouts'],['shield','Product review',(S.products||[]).filter(p=>p.approvalStatus==='PENDING').length,'Listings waiting for approval','products'],['bell','Seller warnings',(S.warnings||[]).length,'Review account restrictions','warnings']].map(([ic,t,n,d,r])=>`<div class="as-list-row"><span class="as-queue-icon">${icon(ic)}</span><div><strong>${t}</strong><p>${d}</p></div><button class="as-count" onclick="adminNav('${r}')" aria-label="Open ${t}">${n}</button></div>`).join('')}<div class="as-note" style="margin-bottom:0"><strong>${icon('bolt')} Payments are live</strong>Checkout is connected to your configured payment gateway.</div></div></div><div class="as-shortcuts">${quick('sliders','Make it yours','Brand, homepage and announcements.','website')}${quick('bolt','Manage access','Enable features and set marketplace limits.','features')}${quick('wallet','Business settings','Plans, fees and withdrawal limits.','finance')}</div><div class="as-cols" style="margin-top:22px"><div class="admin-card"><div class="section-head"><div><h2>Marketplace controls</h2><div class="sub" style="margin:0!important">Changes apply here immediately, then sync to online visitors.</div></div><button class="btn" onclick="studioOpenControl('features')">All controls ${icon('arrow')}</button></div>${[['sellerRegistration','Seller registration','Allow new sellers to join'],['productUpload','Product publishing','Allow sellers to publish new listings'],['reviews','Product reviews','Allow reviews on marketplace products']].map(([k,t,d])=>`<div class="as-list-row"><div><strong>${t}</strong><p>${d}</p></div><button class="as-toggle" role="switch" aria-label="${t}" aria-checked="${cfg().features[k]!==false}" onclick="adminSetFeature('${k}',${cfg().features[k]===false})"></button></div>`).join('')}</div><div class="admin-card"><div class="section-head"><h2>Recent admin activity</h2><button class="btn" onclick="adminNav('audit')">View log</button></div>${(S.adminAuditLog||[]).slice(0,4).map(a=>`<div class="as-audit"><i class="as-dot"></i><div><strong>${esc(a.action||'Updated settings')}</strong><small>${when(a.date)} · ${esc(a.targetId||'Platform')}</small></div></div>`).join('')||'<div class="admin-empty">Your admin changes will appear here.</div>'}</div></div>`);
};
const legacyControls=window.adminControlCenter;
const sections={website:['Website CMS / Branding','Global Announcement'],homepage:['Homepage Section Manager'],features:['Feature Control Center'],finance:['Commission Control','Category Commission','Payment Control','Payout / Withdrawal Control'],plans:['Subscription Plans'],growth:['Advertising Packages','Referral Control'],rules:['Marketplace Rules','Seller-Specific Override'],history:['Configuration History / Rollback','Exports','Security Architecture']};
const labels={website:'Website',homepage:'Homepage',features:'Features',finance:'Finance',plans:'Plans',growth:'Growth',rules:'Rules',history:'History & export'};
const subtitles={website:'Update your brand and homepage content. Use Save & publish to apply all fields together.',homepage:'Choose what visitors see and arrange homepage sections in the order you want.',features:'Control supported website features. Unimplemented backend workflows are marked clearly.',finance:'Control future transaction settings. Historical orders are never recalculated.',plans:'Create, edit and archive the plans shown to sellers.',growth:'Manage advertising packages and referral settings.',rules:'Set marketplace limits and individual seller overrides.',history:'Review configuration changes, restore snapshots and export reports.'};
function normalizeSections(){const c=cfg();c.sections=(c.sections||[]).filter(x=>x.id!=='new');}
window.studioOpenControl=function(id){if(dirtyFields&&!confirm('Leave this form without saving your edits?'))return;dirtyFields=false;panel=sections[id]?id:'website';adminNav('control');if(route()==='admin/control')render();};
window.adminControlCenter=function(){
 normalizeSections();const raw=legacyControls();const template=document.createElement('template');template.innerHTML=raw;
 const cards=[...template.content.querySelectorAll('.admin-content > .admin-card')];
 let content=cards.filter(c=>{const h=String(c.querySelector('h2')?.textContent||'').trim();return (sections[panel]||[]).some(label=>h===label||h.startsWith(label+' ·')||h.includes(label));}).map(c=>c.outerHTML).join('');
 if(panel==='website')content=content.replace("adminControlSave('branding');adminControlSave('cms')","studioSaveWebsite()").replace('Save Website Controls','Save & publish website');
 if(panel==='plans'&&!content.trim())content='<div class="admin-card"><div class="section-head"><div><h2>Subscription Plans · 3 Plans</h2><div class="sub">Exactly three subscription plans are configured. If this message appears, refresh once to reload the configuration.</div></div></div><div class="admin-empty">Subscription plan editor is loading…</div></div>';
 if(panel==='homepage')content+=`<div class="admin-card"><h2>Homepage FAQ & testimonials</h2><div class="sub">FAQ: [{"question":"…","answer":"…"}]. Testimonials: [{"name":"…","quote":"…"}]. Use real, approved content only.</div><div class="form-grid"><div class="field"><label for="studioFaq">FAQ content (JSON)</label><textarea id="studioFaq">${esc(JSON.stringify(cfg().cms.faq||[],null,2))}</textarea></div><div class="field"><label for="studioTestimonials">Testimonials (JSON)</label><textarea id="studioTestimonials">${esc(JSON.stringify(cfg().cms.testimonials||[],null,2))}</textarea></div></div><button class="btn primary" onclick="studioSaveHomeContent()">Save & publish content</button></div>`;
 const tabs=Object.keys(sections).map(k=>`<button class="${panel===k?'active':''}" onclick="studioOpenControl('${k}')" ${panel===k?'aria-current="page"':''}>${labels[k]}</button>`).join('');
 return adminLayout('control','Website controls',`${titleBlock('CONTROL CENTER','Your website. Your rules.','Brand, features and business settings — organized, not overwhelming.')}<nav class="as-settings-tabs" aria-label="Settings categories">${tabs}</nav><div class="as-settings-heading"><p>${subtitles[panel]}</p><span class="as-status wait">PAYMENTS · TEST ONLY</span></div>${content}`);
};
function history(reason,before){const h=cfg().configHistory||[];h.unshift({version:Date.now(),date:nowISO(),adminId:S.currentUser?.id,reason,config:structuredClone({...before,configHistory:[]})});cfg().configHistory=h.slice(0,5);}
function commit(reason,mutate,confirmNeeded=false){if(!adminOnly())return;const run=()=>{const before=structuredClone({...cfg(),configHistory:[]});mutate();history(reason,before);adminAudit(reason,'PLATFORM_CONFIG');dirtyFields=false;save();render();};if(confirmNeeded){window.studioConfirmedAction=run;adminConfirm('Publish this change?',reason+'. This affects future actions across the marketplace.','studioConfirmedAction()','Confirm & publish');}else run();}
const value=id=>$(id)?.value??'';const number=(id,min=0,max=1e12)=>{const n=Number(value(id));if(!Number.isFinite(n)||n<min||n>max)throw Error('Enter a valid value for '+($(id)?.previousElementSibling?.textContent||id));return n;};
window.studioSaveWebsite=function(){
 if(!adminOnly())return;const name=value('acBrandName').trim(),color=value('acPrimary').trim(),color2=value('acSecondary').trim(),image=value('acHeroImage').trim();
 if(!name||name.length>80)return toast('Website name must be 1–80 characters.');
 if(!/^#[0-9a-f]{6}$/i.test(color)||!/^#[0-9a-f]{6}$/i.test(color2))return toast('Use six-digit colors, for example #6354da.');
 if(image&&!/^https:\/\//i.test(image))return toast('Use an HTTPS hero image URL.');
 const brand={websiteName:name,primaryColor:color,secondaryColor:color2,font:value('acFont'),footerCopyright:value('acFooterCopy'),contactEmail:value('acContactEmail'),contactInfo:value('acContactInfo'),emailSenderName:value('acSenderName')};
 const cms={heroTitle:value('acHeroTitle'),heroSubtitle:value('acHeroSubtitle'),heroImage:image,ctaText:value('acCta'),footer:value('acCmsFooter')};
 commit('Updated website branding and content',()=>{Object.assign(cfg().branding,brand);Object.assign(cfg().cms,cms);});
};
window.studioSaveHomeContent=function(){try{const faq=JSON.parse(value('studioFaq')),testimonials=JSON.parse(value('studioTestimonials'));if(!Array.isArray(faq)||!Array.isArray(testimonials)||faq.length>30||testimonials.length>30||faq.some(x=>typeof x.question!=='string'||typeof x.answer!=='string')||testimonials.some(x=>typeof x.name!=='string'||typeof x.quote!=='string'))throw Error('Use the example JSON format, up to 30 entries.');commit('Updated homepage FAQ and testimonials',()=>Object.assign(cfg().cms,{faq,testimonials}));}catch(e){toast(e.message);}};
const oldControlSave=window.adminControlSave;
window.adminControlSave=function(section){
 if(!adminOnly())return;
 if(section==='branding'||section==='cms')return studioSaveWebsite();
 if(section==='announcement'){
  const a={enabled:$('acAnnEnabled').checked,title:value('acAnnTitle').slice(0,160),message:value('acAnnMessage').slice(0,2000),startDate:value('acAnnStart'),endDate:value('acAnnEnd'),audience:value('acAnnAudience')};
  if(a.startDate&&a.endDate&&a.startDate>a.endDate)return toast('End date must be after start date.');
  return commit('Updated website announcement',()=>Object.assign(cfg().announcement,a));
 }
 if(section==='payment'){try{const min=number('acPayMin'),max=number('acPayMax'),timeout=number('acPayTimeout',1,120);if(max<min)throw Error('Maximum payment must be at least the minimum.');const methods=[...document.querySelectorAll('[data-payment-method]:checked')].map(x=>x.value);if(!methods.length)throw Error('Choose at least one test payment method.');const p={gatewayStatus:value('acGatewayStatus'),mode:'TEST',currency:value('acCurrency'),timeoutMinutes:timeout,minPayment:min,maxPayment:max,methods,autoVerify:true,manualVerify:false};return commit('Updated test payment controls',()=>Object.assign(cfg().payment,p),true);}catch(e){return toast(e.message);}}
 if(section==='payout'){try{const min=number('acPMin'),max=number('acPMax');if(max<min)throw Error('Maximum must be at least the minimum.');return commit('Updated test withdrawal limits',()=>Object.assign(cfg().payout,{min,max}),true);}catch(e){return toast(e.message);}}
 if(section==='commission'){try{for(const id of ['acDef','acNew','acPrem','acPromo','acTemp','acMin','acMax'])number(id,0,100);}catch(e){return toast(e.message);}}
 if(section==='rules'){try{if(number('acMaxPrice')<number('acMinPrice'))throw Error('Maximum price must be at least the minimum.');number('acUploadLimit',1,10000);number('acFileSize',1,100000);}catch(e){return toast(e.message);}}
 dirtyFields=false;return oldControlSave(section);
};
window.adminAdPackageSave=function(id){if(!adminOnly())return;const p=cfg().ads.packages.find(x=>x.id===id);if(!p)return;try{const get=k=>value('ad_'+id+'_'+k),price=number('ad_'+id+'_price'),days=number('ad_'+id+'_days',1,3650),impressionLimit=number('ad_'+id+'_impr'),clickLimit=number('ad_'+id+'_click');commit('Updated advertising package',()=>Object.assign(p,{name:get('name'),price,days,impressionLimit,clickLimit,placement:get('placement'),approval:$('ad_'+id+'_approval').checked,active:$('ad_'+id+'_active').checked}));}catch(e){toast(e.message);}};
window.adminSectionMove=function(id,dir){if(!adminOnly())return;const a=cfg().sections.slice().sort((a,b)=>a.order-b.order),i=a.findIndex(x=>x.id===id),j=i+dir;if(i<0||j<0||j>=a.length)return;commit('Reordered homepage sections',()=>{[a[i],a[j]]=[a[j],a[i]];a.forEach((x,k)=>x.order=k+1);cfg().sections=a;});};
const oldSectionToggle=window.adminSectionToggle,oldFeature=window.adminSetFeature;
window.adminSetFeature=function(k,v){if(!adminOnly())return;const enabled=String(v)==='true';if(k==='maintenanceMode')return commit(enabled?'Enabled maintenance mode':'Disabled maintenance mode',()=>cfg().features[k]=enabled,true);dirtyFields=false;return oldFeature(k,v);};
window.adminSectionToggle=function(id){dirtyFields=false;return oldSectionToggle(id);};
window.filterMeetSellers=function(q){
 const track=document.getElementById('meetSellerTrack');if(!track)return;
 const term=(q||'').trim().toLowerCase();let visible=0;
 track.querySelectorAll('.category-card').forEach(card=>{
  const match=!term||card.dataset.search.includes(term);
  card.style.display=match?'':'none';
  if(match)visible++;
 });
 const empty=document.getElementById('meetSellerEmpty');if(empty)empty.classList.toggle('hidden',visible>0);
};
// Brand and CMS settings apply on every render, including removing stale announcements.
const originalApply=applyPlatformConfig;
window.applyPlatformConfig=function(){
 document.querySelectorAll('.platform-announcement').forEach(e=>e.remove());
 const a=cfg().announcement||{},today=new Date(),start=a.startDate?new Date(a.startDate+'T00:00:00'):null,end=a.endDate?new Date(a.endDate+'T23:59:59'):null;
 const sellerUser=!!S.currentUser?.sellerId,premium=sellerUser&&S.sellers?.[S.currentUser.sellerId]?.plan!=='FREE';
 const eligible=!a.audience||a.audience==='Everyone'||(a.audience==='Buyers'&&!!S.currentUser)||(a.audience==='Sellers'&&sellerUser)||(a.audience==='Premium Sellers'&&premium);
 const enabled=a.enabled;a.enabled=!!enabled&&eligible&&(!start||today>=start)&&(!end||today<=end)&&!route().startsWith('admin');
 originalApply();a.enabled=enabled;
 const c=cfg(),b=c.branding||{},cm=c.cms||{};
 const fonts=['Inter','Arial','Verdana','Georgia','Trebuchet MS','system-ui'];document.body.style.fontFamily=(fonts.includes(b.font)?b.font:'Inter')+',system-ui,sans-serif';
 if(route()==='home'){
  const main=document.querySelector('main.page');if(main){
   const extra=(id,title,body)=>{let e=document.getElementById(id);if(!e){e=document.createElement('section');e.className='section';e.id=id;main.append(e);}e.innerHTML='<div class="container"><div class="section-head"><h2>'+esc(title)+'</h2></div>'+body+'</div>';};
   extra('home-top-sellers','Meet the sellers','<div class="meet-seller-search"><input id="meetSellerSearch" placeholder="Search seller by name or ID..." oninput="filterMeetSellers(this.value)"></div><div class="meet-seller-track" id="meetSellerTrack">'+Object.values(S.sellers||{}).map(s=>`<div class="category-card" data-search="${esc((s.name||'').toLowerCase()+' '+(s.id||'').toLowerCase())}"><h3>${esc(s.name)}</h3><p>${esc(s.bio||'Digital products for creators.')}</p><div class="small muted" style="margin-top:6px">@${esc(s.id)}</div><a class="btn" style="margin-top:14px" href="#seller/${encodeURIComponent(s.id)}">Visit store →</a></div>`).join('')+'</div><div class="meet-seller-empty hidden" id="meetSellerEmpty">No sellers matched your search.</div>');
   extra('home-subscriptions','Start selling, your way','<div class="grid">'+c.plans.filter(x=>x.active&&!x.archived).map(p=>`<div class="category-card"><h3>${esc(p.name)}</h3><p>${money(p.monthly)} / month · ${Number(p.uploadLimit)} products</p><button class="btn" style="margin-top:14px" onclick="startSelling()">Start selling →</button></div>`).join('')+'</div>');
   extra('home-faq','Frequently asked questions',(cm.faq||[]).map(x=>`<details class="faq" style="padding:16px"><summary>${esc(x.question)}</summary><p>${esc(x.answer)}</p></details>`).join(''));
   extra('home-testimonials','From our community','<div class="grid">'+(cm.testimonials||[]).map(x=>`<div class="category-card"><p>${esc(x.quote)}</p><h3>${esc(x.name)}</h3></div>`).join('')+'</div>');
   ['home-trending','home-top-sellers','home-testimonials','home-faq'].forEach(id=>{const e=document.getElementById(id);if(e)e.classList.toggle('is-empty-section',!e.querySelector('.product-card,.category-card,.faq,.seller-card'))});
   const map={hero:'home-hero',categories:'home-categories',trending:'home-trending','top-sellers':'home-top-sellers',subscriptions:'home-subscriptions',testimonials:'home-testimonials',faq:'home-faq'};
   c.sections.slice().sort((a,b)=>a.order-b.order).forEach(sec=>{const el=document.getElementById(map[sec.id]);if(el){el.style.display=sec.enabled===false?'none':'';main.append(el);}});
   const cta=document.querySelector('#home-hero .hero-actions .btn:not(.primary)');if(cta)cta.textContent=cm.ctaText||'Start Selling';
   const art=document.querySelector('#home-hero .hero-art');if(art&&cm.heroImage){try{const u=new URL(cm.heroImage);if(u.protocol==='https:'){const im=document.createElement('img');im.src=u.href;im.alt=cm.heroTitle||'Marketplace';im.style.cssText='width:100%;height:300px;object-fit:cover;border-radius:18px';art.replaceChildren(im);}}catch{}}
  }
 }
 document.querySelectorAll('.footer').forEach(f=>{let p=f.querySelector('.studio-footer');if(!p){p=document.createElement('div');p.className='container studio-footer';p.style.cssText='padding-top:20px;font-size:13px;line-height:1.7';f.append(p);}p.textContent=[cm.footer,b.footerCopyright,b.contactInfo,b.contactEmail].filter(Boolean).join(' · ');});
};
// Enforce the enabled feature on the corresponding existing action, not just its label.
const baseControlOff=window.controlOff;
window.controlOff=function(k){if(k==='payments'&&['DISABLED','MAINTENANCE'].includes(cfg().payment.gatewayStatus))return true;if(k==='referrals'&&cfg().referral.enabled===false)return true;return baseControlOff(k);};
const guardMap={signup:'buyerRegistration',openReview:'reviews',submitReview:'reviews',toggleSaved:'wishlist',applyCheckoutCoupon:'coupons',buySubscription:'subscriptions',openAdCampaign:'ads',createAd:'ads',applyReferral:'referrals',openReferralUpgrade:'referrals',openPayment:'payments',servicePayOnline:'payments'};
for(const [name,key]of Object.entries(guardMap)){const fn=window[name];if(fn)window[name]=function(...args){if(!systemGuard(key,'This feature is disabled by the administrator.'))return;return fn(...args);};}
const originalStart=window.startSelling;window.startSelling=function(){
 if(cfg().features.sellerRegistration===false&&!S.currentUser?.sellerId)return toast('New seller registration is disabled.');
 if(S.currentUser && !S.currentUser.isAdmin && cfg().rules.sellerVerificationRequired && !S.currentUser.sellerVerified){
  document.getElementById('modalRoot').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal auth-box"><button class="btn iconbtn close" onclick="closeModal()">×</button><h2>Seller eligibility check</h2><p class="muted">Before selling, please confirm that you are eligible to use the seller features.</p><label style="display:flex;gap:10px;align-items:flex-start;margin:14px 0"><input id="sellerAgeConfirm" type="checkbox" style="margin-top:4px"><span>I confirm that I am 18 or older and legally eligible to sell the products I list.</span></label><label style="display:flex;gap:10px;align-items:flex-start;margin:14px 0"><input id="sellerInfoConfirm" type="checkbox" style="margin-top:4px"><span>I will provide accurate information and only list products that I have the right or permission to distribute.</span></label><div class="dash-card"><b>What happens next?</b><p class="small muted" style="margin:6px 0 0">Your declaration is recorded for Admin review. Seller verification is not automatic; Admin can verify or keep the account pending.</p></div><div class="modal-footer"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="submitSellerEligibilityDeclaration()">Submit for Review</button></div></div></div>`;return false;
 }
 return originalStart();
};
window.submitSellerEligibilityDeclaration=function(){
 const age=$('sellerAgeConfirm')?.checked,info=$('sellerInfoConfirm')?.checked;if(!age||!info)return toast('Please confirm both seller eligibility statements.');if(!S.currentUser)return closeModal();
 S.currentUser.sellerEligibilityDeclaredAt=nowISO();S.currentUser.sellerEligibilityDeclared=true;S.currentUser.sellerVerified=false;const u=S.users.find(x=>x.id===S.currentUser.id);if(u){u.sellerEligibilityDeclaredAt=S.currentUser.sellerEligibilityDeclaredAt;u.sellerEligibilityDeclared=true;u.sellerVerified=false;}save();adminAudit('Seller eligibility declaration submitted',S.currentUser.id,{sellerId:S.currentUser.sellerId||null});closeModal();toast('Submitted for Admin review.');render();
};
const originalPublish=publishProduct;window.publishProduct=function(id){const c=cfg(),s=currentSeller();if(!s)return;const count=S.products.filter(p=>p.sellerId===s.id).length,plan=c.plans.find(p=>String(p.id).toUpperCase()===String(s.plan).toUpperCase()),override=c.sellerOverrides?.[s.id];const limit=override?.productLimit&&override.productLimit!=='GLOBAL'?Number(override.productLimit):Math.min(Number(c.rules.productUploadLimit||50),Number(plan?.uploadLimit||50));if(!id&&count>=limit)return toast('Product limit reached ('+limit+').');const size=Number(S.draft?.fileSizeValue||0);if(!Number.isFinite(size)||size<=0)return toast('Enter a valid product file size.');return originalPublish(id);};
// Keep test transfer implementation, but fix the legacy wrapper's wrong input ID.
// Captured directly from the original function before the configuration-layer wrapper.
if(window.studioOriginalPayout)window.requestPayout=function(){if(!systemGuard('withdrawals'))return;const amount=Number($('poAmt')?.value),p=cfg().payout,r=cfg().rules;const min=Math.max(Number(p.min||0),Number(r.minWithdrawal||0)),max=Math.min(Number(p.max||1e15),Number(r.maxWithdrawal||1e15));if(!Number.isFinite(amount)||amount<min||amount>max)return toast('Withdrawal must be between '+money(min)+' and '+money(max));S.adminControls=S.adminControls||{};S.adminControls.payoutMin=min;S.adminControls.payoutMax=max;return window.studioOriginalPayout();};
// Admin changes: persist immediately, then broadcast a tiny live signal.
// No separate signal table/RPC is required; visitors fetch the newest shared state only once.
const lowSave=save,lowPush=pushOnlineState;
let __seAdminSavePromise=null;
async function __seWait(ms){return new Promise(r=>setTimeout(r,ms));}
async function __seAdminFlushNow(){
 if(!isAdmin()||!route().startsWith('admin'))return true;
 if(__seAdminSavePromise)return __seAdminSavePromise;
 __seAdminSavePromise=(async()=>{
  seStopped=false;seFailures=0;seRetryAt=0;
  for(let attempt=0;attempt<24;attempt++){
   if(!ONLINE_READY){
    try{await restoreSupabaseSession();}catch{}
    if(!ONLINE_READY){status('error','Cloud unavailable — retry');return false;}
   }
   if(!ONLINE_LOCAL_DIRTY){liveDirty=false;lastSignalTime=Date.now();status('live','Saved & live');return true;}
   if(ONLINE_LOADING||seReadBusy||seWriteBusy){await __seWait(100);continue;}
   try{
    await lowPush();
   }catch(e){console.warn('Admin immediate save failed',e);}
   if(!ONLINE_LOCAL_DIRTY){liveDirty=false;lastSignalTime=Date.now();status('live','Saved & live');try{await broadcastInstantOnlineUpdate();}catch{}return true;}
   if(seStopped){seStopped=false;seRetryAt=0;}
   await __seWait(120);
  }
  status('error','Save failed — click Save/refresh to retry');
  return false;
 })().finally(()=>{__seAdminSavePromise=null;});
 return __seAdminSavePromise;
}
window.save=function(){
 const before=onlineSnapshotKey(onlineSnapshot());
 lowSave();
 if(isAdmin()&&route().startsWith('admin')){
  dirtyFields=false;liveDirty=true;status('saving','Saving changes…');
  clearTimeout(ONLINE_SYNC_TIMER);clearTimeout(flushTimer);
  window.__seAdminImmediateSave=__seAdminFlushNow();
 }
 return before;
};
window.pushOnlineState=async function(){
 await lowPush();
 if(isAdmin()&&liveDirty){
  if(ONLINE_LOCAL_DIRTY){status(seStopped?'error':'saving',seStopped?'Save paused — retry':'Saving changes…');return false;}
  liveDirty=false;lastSignalTime=Date.now();status('live','Saved & live');
  try{await broadcastInstantOnlineUpdate();}catch{}
 }
 return !ONLINE_LOCAL_DIRTY;
};
window.studioPublishNow=async function(){if(!adminOnly())return;if(dirtyFields)return toast('Save the edited form first; its values are not published yet.');seStopped=false;seFailures=0;seRetryAt=0;if(!ONLINE_READY){await restoreSupabaseSession();if(!ONLINE_READY){status('error','Cloud unavailable');return;}}liveDirty=true;if(ONLINE_LOCAL_DIRTY)await pushOnlineState();else{liveDirty=false;lastSignalTime=Date.now();status('live','Saved & live');await broadcastInstantOnlineUpdate();}};
async function consumeSignal(){
 if(!signalPending||document.visibilityState==='hidden'||!ONLINE_READY||navigator.onLine===false)return;
 if(ONLINE_LOADING||seReadBusy||seWriteBusy){clearTimeout(liveWake);liveWake=setTimeout(consumeSignal,500);return;}
 if(ONLINE_LOCAL_DIRTY){clearTimeout(liveWake);liveWake=setTimeout(consumeSignal,1500);return;}
 try{await pollOnlineState(true);if(!ONLINE_LOCAL_DIRTY)signalPending=false;}
 catch(e){console.warn('Live refresh deferred',e);} 
}
async function startLive(){
 if(!SUPABASE_READY||!S.currentUser||!isAdmin())return;
 await startInstantOnlineSync();
 if(!liveDirty)status('live','Live updates ready');
}
const oldRestore=restoreSupabaseSession;window.restoreSupabaseSession=async function(){await oldRestore();if(S.currentUser&&isAdmin())await startLive();};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden'){consumeSignal();if(signalPending)consumeInstantOnlineSignal();}});
window.addEventListener('online',()=>{if(!liveChannel&&S.currentUser&&isAdmin()){liveStarted=false;startLive();}if(S.currentUser)consumeSignal();if(SUPABASE_READY)startInstantOnlineSync();if(signalPending)consumeInstantOnlineSignal();});
document.addEventListener('input',e=>{if(e.target.matches('.admin-content input,.admin-content textarea')){dirtyFields=true;status('idle','Unsaved fields');}});
document.addEventListener('change',e=>{if(e.target.matches('.admin-content select')&&!e.target.hasAttribute('onchange')){dirtyFields=true;status('idle','Unsaved fields');}});
/* Final admin navigation wrapper: restore the REAL scroll container synchronously
   after render, before the browser paints. This removes the visible scrollbar jump/flicker. */
const oldAdminNav=adminNav;window.adminNav=function(r){
  if(dirtyFields&&!confirm('Leave this form without saving your edits?'))return;
  const side=document.querySelector('.admin-side .as-nav');
  const savedScroll=side?Number(side.scrollTop||0):Number(window.__seAdminSidebarScroll||0);
  window.__seAdminSidebarScroll=savedScroll;
  try{sessionStorage.setItem('SE_ADMIN_NAV_SCROLL_V74',String(savedScroll));}catch(e){}
  dirtyFields=false;mobileOpen=false;document.body.classList.remove('as-menu-open');
  const result=oldAdminNav(r);
  const restore=()=>{
    const next=document.querySelector('.admin-side .as-nav');
    if(next){
      next.scrollTop=savedScroll;
      try{next.style.overflowAnchor='none';}catch(e){}
    }
  };
  /* The DOM is replaced synchronously by render(), so restoring here avoids
     the old one/two-frame 0 -> saved-position flicker. */
  restore();
  return result;
};
const originalRender=render;window.render=function(){
 const adminRoute=route().startsWith('admin');
if(adminRoute&&!isAdmin()){document.body.classList.remove('se-admin');return;}
document.body.classList.toggle('se-admin',adminRoute&&isAdmin());if(!adminRoute){mobileOpen=false;document.body.classList.remove('as-menu-open','se-admin-ready');}
 originalRender();
 if(adminRoute&&isAdmin()){requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.classList.add('se-admin-ready')));}
 if(adminRoute&&isAdmin()){
  const root=document.querySelector('.admin-content');
  if(root&&!root.querySelector('.as-page-title')){const title=document.querySelector('.as-breadcrumb b')?.textContent||'Admin';root.insertAdjacentHTML('afterbegin',titleBlock('MANAGEMENT',title,'Manage your marketplace with clear, deliberate actions.'));}
  document.querySelectorAll('.admin-table').forEach(t=>{if(!t.parentElement.classList.contains('as-table-wrap')){const w=document.createElement('div');w.className='as-table-wrap';t.replaceWith(w);w.append(t);}});
  if(route()==='admin/control'){
   const unsupported=['messaging','refunds','disputes','notifications','productAnalytics'];
   document.querySelectorAll('.security-row select[onchange^="adminSetFeature"]').forEach(el=>{const k=el.getAttribute('onchange').match(/adminSetFeature\('([^']+)'/)?.[1],row=el.closest('.security-row');if(!k)return;row.querySelector('b').textContent=human(k);if(unsupported.includes(k)){el.disabled=true;row.classList.add('as-no-support');row.querySelector('.small').textContent='Reserved setting — backend workflow not implemented in this test build.';}else row.querySelector('.small').textContent='Applied immediately on this device; sent to online visitors after cloud save.';});
   const mode=$('acPayMode');if(mode){mode.innerHTML='<option>TEST</option>';mode.disabled=true;}
   const audience=$('acAnnAudience');if(audience)[...audience.options].forEach(o=>{if(o.value==='Specific Users')o.remove();});
   if(panel==='payment'||panel==='finance'){
    const gateway=$('acGatewayStatus')?.closest('.admin-card');if(gateway&&!gateway.querySelector('[data-payment-method]')){const methods=['UPI','Card','Paytm','Net Banking / Wallet'];const div=document.createElement('div');div.className='ac-checks';div.innerHTML=methods.map(m=>`<label class="ac-check"><input type="checkbox" data-payment-method value="${esc(m)}" ${cfg().payment.methods?.includes(m)?'checked':''}>${esc(m)}</label>`).join('');gateway.querySelector('.form-grid').after(div);}
    for(const id of ['acAutoVerify','acManualVerify'])if($(id)){$(id).disabled=true;$(id).closest('label').title='The simulator has no real payment verification.';}
    const po=$('acPSchedule');if(po){po.disabled=true;po.closest('.admin-card').querySelector('h2').insertAdjacentHTML('afterend','<p class="sub">Only minimum/maximum test withdrawal limits are active here. Real transfer scheduling and fees require a backend.</p>');for(const id of ['acPPct','acPFixed','acInstant','acDaily','acWeekly','acManual','acPVerify'])if($(id))$(id).disabled=true;}
   }
  }
  status(syncState,syncText);
 }
};
// Test checkout method switches obey the admin method allowlist.
for(const name of ['selectPay','selectServicePay','selectReferralUpgradePay']){const fn=window[name];if(fn)window[name]=function(btn,type,...args){if(!cfg().payment.methods.includes(type))return toast('This test payment method is disabled.');return fn(btn,type,...args);};}
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&mobileOpen)studioMenu();});
// Active finance settings use the selected product's category, not an arbitrary seller product.
window.planFeeRate=function(plan){const p=cfg().plans.find(x=>String(x.id).toUpperCase()===String(plan).toUpperCase());return Math.max(0,Math.min(1,Number(p?.commissionPct??cfg().commission.defaultPct??20)/100));};
window.effectivePlatformFeeRate=function(sellerId,when,category){const c=cfg(),ss=S.sellers?.[sellerId],own=c.sellerOverrides?.[sellerId]?.commissionPct??ss?.manualCommissionPct;if(own!=null&&Number.isFinite(Number(own)))return Math.max(0,Math.min(1,Number(own)/100));if(category&&c.commission.categoryOverrides?.[category]!=null)return Math.max(0,Math.min(1,Number(c.commission.categoryOverrides[category])/100));const sub=activeSubscriptionAt(sellerId,when);return planFeeRate(sub?.plan||ss?.plan||'FREE');};
const atomicControl=window.adminControlSave;
window.adminControlSave=function(section){
 if(!adminOnly())return;
 try{
 if(section==='commission'){const x={defaultPct:number('acDef',0,100),newSellerPct:number('acNew',0,100),premiumPct:number('acPrem',0,100),promotionalPct:number('acPromo',0,100),temporaryPct:number('acTemp',0,100),fixed:number('acFixed'),min:number('acMin',0,100),max:number('acMax',0,100)};if(x.max<x.min)throw Error('Maximum fee must be at least the minimum.');return commit('Updated commission settings',()=>Object.assign(cfg().commission,x),true);}
 if(section==='rules'){const x={minProductPrice:number('acMinPrice'),maxProductPrice:number('acMaxPrice'),productUploadLimit:number('acUploadLimit',1,10000),maxFileSizeMB:number('acFileSize',1,100000),allowedFileTypes:value('acFileTypes'),minWithdrawal:number('acMinWithdrawal'),maxWithdrawal:number('acMaxWithdrawal'),refundWindowDays:number('acRefundWindow'),orderCancellationWindowHours:number('acCancelWindow'),sellerVerificationRequired:$('acSellerVerify').checked,automaticApproval:$('acAutoApproval').checked,manualApproval:$('acManualApproval').checked};if(x.minProductPrice>x.maxProductPrice||x.minWithdrawal>x.maxWithdrawal)throw Error('Maximum must be at least the minimum.');if(x.manualApproval)x.automaticApproval=false;return commit('Updated marketplace rules',()=>Object.assign(cfg().rules,x));}
 }catch(e){return toast(e.message);}
 return atomicControl(section);
};
window.studioVisibleProducts=function(){
  if(!S.currentUser && !PUBLIC_PRODUCTS_READY)return [];
  const deleted=deletedProductIdSet();
  const source=(SE_PUBLIC_CATALOG_READY&&Array.isArray(SE_PUBLIC_CATALOG))?SE_PUBLIC_CATALOG:(Array.isArray(S.products)?S.products:[]);
  return source.filter(p=>{
    if(!p||deleted.has(String(p.id)))return false;
    if(String(p.status||'').toLowerCase()!=='active')return false;
    if(p.hiddenByAdmin===true)return false;
    const approval=String(p.approvalStatus||'APPROVED').toUpperCase();
    if(approval!=='APPROVED' && p.publicLive!==true)return false;
    if(approval==='REJECTED')return false;
    return true;
  });
};
const preApprovalPublish=window.publishProduct;
window.publishProduct=function(id){const before=new Set(S.products.map(x=>x.id)),beforeProduct=id?JSON.stringify(product(id)):null;const result=preApprovalPublish(id);const target=id?product(id):S.products.find(x=>!before.has(x.id));if(target&&(!id||JSON.stringify(target)!==beforeProduct)&&cfg().features.productApproval!==false&&cfg().rules.manualApproval){target.approvalStatus='PENDING';save();toast('Product submitted for admin approval.');render();}return result;};
const viewDetail=detail;window.detail=function(id){const p=product(id);if(p&&(p.hiddenByAdmin||['PENDING','REJECTED'].includes(p.approvalStatus))&&!isAdmin()&&S.currentUser?.sellerId!==p.sellerId)return notFound();return viewDetail(id);};
const preOpenBuy=openBuy;window.openBuy=function(id){if(!studioVisibleProducts().some(p=>p.id===id)&&!isAdmin())return toast('This product is unavailable.');return preOpenBuy(id);};
window.studioModerate=function(id,action){if(!adminOnly())return;const p=product(id);if(!p)return;if(action==='approve'){p.approvalStatus='APPROVED';p.hiddenByAdmin=false;delete p.sellerReviewRequested;}if(action==='hide')p.hiddenByAdmin=true;if(action==='show')p.hiddenByAdmin=false;adminAudit('Product '+action,id);save();render();};
const legacyProductDetail=adminProductDetail;
window.adminProductDetail=function(id){let html=legacyProductDetail(id);const p=product(id);if(!p)return html;const t=document.createElement('template');t.innerHTML=html;const root=t.content.querySelector('.admin-content');const bar=document.createElement('div');bar.className='as-note';bar.innerHTML=`<strong>Publication controls</strong><div class="admin-actions"><span class="as-status ${p.approvalStatus==='PENDING'?'wait':'good'}">${esc(p.hiddenByAdmin?'Hidden':p.approvalStatus||'Published')}</span><button class="btn primary" onclick="studioModerate('${p.id}','approve')">Approve & publish</button><button class="btn" onclick="studioModerate('${p.id}','${p.hiddenByAdmin?'show':'hide'}')">${p.hiddenByAdmin?'Show product':'Hide product'}</button><button class="btn" onclick="studioEditProduct('${p.id}')">Edit product details</button></div>`;root.prepend(bar);return t.innerHTML;};
window.studioEditProduct=function(id){if(!adminOnly())return;const p=product(id);if(!p)return;window.studioEditingProduct=id;const input=(label,k,v,type='text')=>`<div class="field"><label>${label}</label><input id="studioProduct_${k}" type="${type}" value="${esc(v??'')}"></div>`;$('modalRoot').innerHTML=`<div class="modal-bg"><div class="modal"><button class="btn close" onclick="closeModal()" aria-label="Close">×</button><h2>Edit product</h2><p class="muted">Changes affect this listing, not historical order prices.</p>${input('Title','title',p.title)}<div class="form-grid">${input('Current price','price',p.price,'number')}${input('Original price','oldPrice',p.oldPrice,'number')}</div>${input('Category','category',p.category)}${input('Image URL','image',p.image)}<div class="field"><label>Description</label><textarea id="studioProduct_description">${esc(p.description||'')}</textarea></div><button class="btn primary" onclick="studioSaveProduct()">Save & publish changes</button></div></div>`;};
window.studioSaveProduct=function(){if(!adminOnly())return;const p=product(window.studioEditingProduct);if(!p)return;try{const price=number('studioProduct_price',0),oldPrice=number('studioProduct_oldPrice',0),title=value('studioProduct_title').trim(),image=value('studioProduct_image').trim();if(!title||oldPrice<price)throw Error('Enter a title and a valid original price.');if(image&&!/^https:\/\//.test(image)&&!/^data:image\/(png|jpeg|webp|gif);base64,/.test(image))throw Error('Use an HTTPS or raster image URL.');Object.assign(p,{title,price,oldPrice,category:value('studioProduct_category'),description:value('studioProduct_description'),image});adminAudit('Edited product details',p.id);save();closeModal();render();}catch(e){toast(e.message);}};
// Ad duration and placement now come from the selected configured package.
const originalAdOpen=window.openAdCampaign;
window.openAdCampaign=function(){const r=originalAdOpen();const el=$('adType');if(el){el.innerHTML=cfg().ads.packages.filter(p=>p.active!==false).map(p=>`<option value="${esc(p.id)}" data-price="${Number(p.price)}">${esc(p.name)} · ${money(p.price)}/day</option>`).join('');el.onchange=()=>{const p=cfg().ads.packages.find(p=>p.id===el.value);if(p)$('adDays').value=p.days;updateAdTotal();};el.onchange();}return r;};
window.createAd=function(){if(!systemGuard('ads'))return;const p=cfg().ads.packages.find(x=>x.id===$('adType')?.value),productId=$('adProduct')?.value,days=Number($('adDays')?.value);if(!p||!p.active||!productId||!Number.isInteger(days)||days<1)return toast('Choose an active package and valid duration.');const s=currentSeller();if(product(productId)?.sellerId!==s?.id)return toast('Select your own product.');servicePaymentPanel('ad',Number(p.price)*days,{productId,type:p.placement,rate:Number(p.price),days,packageId:p.id,approvalRequired:p.approval});};
// These fields are intentionally marked as configuration-only until a server workflow exists.
const beforeFinalRender=window.render;
window.render=function(){beforeFinalRender();if(route()==='admin/control'){
 const hints={acSenderName:'Email sender configuration requires a server-side email provider.',acNew:'Reserved segmentation rate. Not applied automatically.',acPrem:'Reserved segmentation rate. Plan fees apply instead.',acPromo:'Reserved segmentation rate.',acTemp:'Reserved segmentation rate.',acFixed:'Fixed fees require a transactional backend.',acMin:'Reserved fee bound; active percentage uses plan/category/seller precedence.',acMax:'Reserved fee bound; active percentage uses plan/category/seller precedence.',acFileTypes:'Delivery is URL-based; server-side file inspection is not available.',acRefundWindow:'Refund processing backend is not implemented.',acCancelWindow:'Timed cancellation backend is not implemented.',acSellerVerify:'Identity verification backend is not implemented.',acBuyerReward:'Fixed referral rewards are not implemented.',acSellerReward:'Fixed referral rewards are not implemented.',acRefMax:'Server-enforced monthly caps are not implemented.',acRefExp:'Server-enforced expiration is not implemented.',acRefEligibility:'Verification eligibility backend is not implemented.'};
 for(const [id,hint]of Object.entries(hints)){const e=$(id);if(e){e.disabled=true;e.title=hint;}}
 const note=$('acDef')?.closest('.admin-card')?.querySelector('.sub');if(note)note.textContent='Future orders: seller override → product category → selected plan → default fee. Historical orders stay unchanged. Disabled fields require backend support.';
 document.querySelectorAll('[id^="pl_"]').forEach(e=>{if(/_(yearly|lifetime|trial|discount|storage)$/.test(e.id)){e.disabled=true;e.title='This build supports monthly plan purchase and listing limits. This field is reserved.';}});
 document.querySelectorAll('[id^="ad_"]').forEach(e=>{if(/_(impr|click|approval)$/.test(e.id)){e.disabled=true;e.title='Impression/click caps and paid ad approval require server tracking.';}});
 }};

const configuredPaymentOpen=window.openPayment;
window.openPayment=function(){const r=configuredPaymentOpen();const methods=cfg().payment.methods||[];if(methods.length&&!methods.includes(window.payMethod)){const next=methods[0],btn=[...document.querySelectorAll('.pay-opt')].find(b=>b.textContent.includes(next));if(btn)selectPay(btn,next);}return r;};
for(const action of ['testPay','completeServiceOnline','completeReferralUpgradeOnline']){const f=window[action];if(f)window[action]=function(...args){if(!systemGuard('payments')||!(cfg().payment.methods||[]).includes(window.payMethod))return toast('Select an enabled test payment method.');return f(...args);};}

/* Normal sidebar scrolling: never persist arbitrary scroll points or restore them on render. */
(function(){
 const priorRender=window.render;
 window.render=function(...args){
   document.body.classList.toggle('se-market',route()==='market');
   return priorRender.apply(this,args);
 };
 // Retain existing product actions/data, but place cart actions in their own row.
 const priorCard=window.productCard;
 window.productCard=function(p){const html=priorCard(p);if(route()!=='market')return html;
  const t=document.createElement('template');t.innerHTML=html;
  const body=t.content.querySelector('.body'),title=t.content.querySelector('h3');
  if(body){body.firstElementChild?.classList.add('market-card-tags');title?.nextElementSibling?.classList.add('market-card-price');
   const actions=body.lastElementChild;actions.classList.add('market-card-actions');
   const cart=t.content.querySelector('.plus');if(cart){cart.setAttribute('aria-label','Add '+String(p.title||'product')+' to cart');cart.title='Add to cart';actions.append(cart);}
  }
  if(title)title.title=String(p.title||'');
  const save=t.content.querySelector('.save-product');if(save)save.setAttribute('aria-label',save.title||'Save product');
  const image=t.content.querySelector('.thumb img');if(image){image.alt=String(p.title||'Product preview');image.loading='lazy';image.decoding='async';}
  return t.innerHTML;
 };
})();

// Wait for the initial Supabase/local-state reconciliation before the first full render.
// This prevents stale cached counts from flashing before the authoritative state arrives.
restoreSupabaseSession().then(()=>{try{if(SUPABASE_READY)startInstantOnlineSync();}catch{}});
})();
