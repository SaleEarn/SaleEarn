
(function(){
'use strict';
/* v6: seller/admin chat is shared by both roles.  The old non-admin guard
   treated chat messages as Admin-owned state, so a seller's new message could
   be discarded before the shared snapshot was written. Merge chat state by id
   instead of letting either side overwrite the other side's messages. */
if(!window.__seMessagesFinalV6){
  window.__seMessagesFinalV6=true;
  const previousGuard=window.seGuardNonAdmin;
  const clone6=x=>{try{return structuredClone(x)}catch{return JSON.parse(JSON.stringify(x))}};
  const mergeById6=(remoteArr,localArr)=>{
    const rm=new Map((Array.isArray(remoteArr)?remoteArr:[]).filter(x=>x&&x.id!=null).map(x=>[String(x.id),clone6(x)]));
    for(const local of (Array.isArray(localArr)?localArr:[])){
      if(!local||local.id==null)continue;
      const key=String(local.id),remote=rm.get(key);
      if(!remote){rm.set(key,clone6(local));continue;}
      const re=Date.parse(remote.editedAt||remote.date||remote.updatedAt||0)||0;
      const le=Date.parse(local.editedAt||local.date||local.updatedAt||0)||0;
      const merged=le>=re?{...remote,...clone6(local)}:{...local,...clone6(remote)};
      const rr=Date.parse(remote.readAt||0)||0,lr=Date.parse(local.readAt||0)||0;
      if(rr||lr)merged.readAt=new Date(Math.max(rr,lr)).toISOString();
      rm.set(key,merged);
    }
    return [...rm.values()].sort((a,b)=>Date.parse(a.date||a.createdAt||0)-Date.parse(b.date||b.createdAt||0));
  };
  window.seGuardNonAdmin=function(sent,remote){
    const localMessages=clone6(sent?.messages||[]);
    const localThreads=clone6(sent?.messageThreads||[]);
    if(typeof previousGuard==='function')previousGuard(sent,remote);
    /* Chat is collaborative state: retain both seller and Admin messages. */
    sent.messages=mergeById6(remote?.messages||[],localMessages);
    sent.messageThreads=mergeById6(remote?.messageThreads||[],localThreads);
    /* Keep Admin-owned controls protected by the existing guard. */
    if(remote?.messageSettings)sent.messageSettings=clone6(remote.messageSettings);
    if(remote?.messagePacks)sent.messagePacks=clone6(remote.messagePacks);
  };
}

/* Make the notification -> Seller Messages path load the latest shared state
   once when the user explicitly opens the notification. This is not polling. */
if(!window.__seMessageNotificationV6 && typeof window.seOpenNotification==='function'){
  window.__seMessageNotificationV6=true;
  const oldOpenNotification=window.seOpenNotification;
  window.seOpenNotification=async function(id){
    const n=(S.notifications||[]).find(x=>String(x.id)===String(id));
    const isSellerMessage=!!n && n.type==='message' && !((typeof isAdmin==='function')&&isAdmin());
    if(isSellerMessage && window.supabaseClient){
      try{
        const {data:rows,error}=await window.supabaseClient.from('seller_admin_messages').select('id,thread_id,seller_id,seller_user_id,sender_role,sender_user_id,body,created_at,read_at,edited_at').order('created_at',{ascending:true});
        if(!error){
          S.messages=(rows||[]).map(x=>({id:String(x.id),threadId:x.thread_id,sellerId:x.seller_id,sellerUserId:x.seller_user_id,senderRole:x.sender_role,senderUserId:x.sender_user_id,body:x.body||'',date:x.created_at||nowISO(),readAt:x.read_at||null,editedAt:x.edited_at||null,cloud:true}));
          try{sePersist();}catch{}
        }
      }catch(e){console.warn('Seller message notification refresh:',e?.message||e)}
    }
    return oldOpenNotification.apply(this,arguments);
  };
}

/* Robust Admin Mail Center Open action. It opens the selected mail directly
   and does not depend on a nested row click or a later wrapper. */
if(!window.__seAdminMailOpenV6){
  window.__seAdminMailOpenV6=true;
  window.adminOpenMailV6=async function(id){
    if(typeof adminOnly==='function'&&!adminOnly())return;
    const m=(S.mailMessages||[]).find(x=>String(x.id)===String(id));
    if(!m)return typeof toast==='function'&&toast('Mail not found');
    try{
      const wasRead=m.read===true;
      if(!m.read){
        if(m.type==='contact'&&m.externalId&&window.supabaseClient){
          const {error}=await window.supabaseClient.from('contact_messages').update({read:true}).eq('id',String(m.externalId)).eq('read',false);
          if(!error){m.read=true;m.readAt=nowISO();try{sePersist?.()}catch(e){}}
        }else{
          m.read=true;m.readAt=nowISO();try{save()}catch(e){console.warn('Mail read save:',e)}
        }
      }
      /* A mail becomes read at the moment it is opened. Re-render once after the
         successful state change so every unread badge changes immediately (5 -> 4)
         without any timer or background refresh. */
      if(!wasRead){
        try{if(typeof seMarkNotifRead==='function')seMarkNotifRead(n=>String(n.entityId||'')===String(m.id));}catch(e){}
        try{if(typeof window.render==='function')window.render();}catch(e){}
      }
      const esc6=typeof esc==='function'?esc:(v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
      const sender=m.type==='sent'?(m.from||'Administrator'):(m.from||'Sale Earn');
      const recipient=m.type==='sent'?(m.to||''):(m.to||S.currentUser?.email||'');
      const dt=(()=>{try{return new Date(m.date).toLocaleString('en-IN')}catch{return '—'}})();
      const body=esc6(String(m.body||m.message||'')).replace(/\n/g,'<br>');
      const root=document.getElementById('modalRoot');
      if(!root)return;
      root.innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal mail-read-modal" role="dialog" aria-modal="true"><button class="btn iconbtn close" onclick="closeModal()">×</button><div class="mail-read-head"><div class="mail-avatar large">✉</div><div class="mail-read-meta"><div class="mail-read-kicker">${m.type==='sent'?'Sent mail':'Received mail'}</div><h2>${esc6(m.subject||'(No subject)')}</h2><div class="muted small">${m.type==='sent'?'To: '+esc6(recipient):'From: '+esc6(sender)} · ${esc6(dt)}</div></div></div><div class="mail-read-info"><div><b>From</b><span>${esc6(sender)}${m.fromEmail?' · '+esc6(m.fromEmail):''}</span></div><div><b>To</b><span>${esc6(recipient)}</span></div></div><div class="mail-read-body">${body||'<span class="muted">No message content.</span>'}</div><div class="modal-footer mail-read-actions"><button class="btn" onclick="closeModal()">Close</button>${m.type!=='sent'?`<button class="btn primary" onclick="closeModal();mailReply('${esc6(m.id)}')">↩ Reply</button>`:''}</div></div></div>`;
      try{if(typeof seMarkNotifRead==='function')seMarkNotifRead(n=>String(n.entityId||'')===String(m.id));}catch(e){}
    }catch(e){console.error('Admin mail open failed:',e);if(typeof toast==='function')toast('Could not open this mail.');}
  };
}
})();
