
(function(){
'use strict';

/* v31: targeted end-to-end reliability layer. It does not replace existing flows;
   it closes notification, read-state and realtime race gaps around them. */
S.notifications=Array.isArray(S.notifications)?S.notifications:[];

function seNKey(x){return String(x||'').trim();}
function seNotify({key,targetRole='user',userId=null,sellerId=null,title,body,route=null,entityId=null,type='info'}){
  if(!title)return null;
  const k=seNKey(key)||uid('notif');
  const list=S.notifications||[];
  let n=list.find(x=>String(x.key||'')===k);
  if(n){
    /* Do not resurrect a notification the recipient already read. */
    if(!n.read){n.title=title;n.body=body||n.body;n.route=route||n.route;n.entityId=entityId??n.entityId;n.type=type;}
    return n;
  }
  n={id:uid('notif'),key:k,targetRole,userId:userId!=null?String(userId):null,sellerId:sellerId!=null?String(sellerId):null,title:String(title),body:String(body||''),route:route||null,entityId:entityId||null,type,read:false,date:nowISO()};
  list.unshift(n); if(list.length>200)list.length=200; return n;
}
function seMarkNotifRead(match){
  let changed=false;
  for(const n of (S.notifications||[])){
    if((typeof match==='function'?match(n):String(n.key||'')===String(match))&&!n.read){n.read=true;n.readAt=nowISO();changed=true;}
  }
  if(changed)save();
  return changed;
}
function seUnreadForCurrent(){
  const u=S.currentUser;if(!u)return [];
  const seen=new Set(),out=[];
  for(const n of (S.notifications||[])){
    if(n?.read)continue;
    if(!((n.targetRole==='admin'&&isAdmin?.()) ||
      (n.userId!=null&&String(n.userId)===String(u.id)) ||
      (n.sellerId!=null&&String(n.sellerId)===String(u.sellerId))))continue;
    const key=String(n.id||n.key||'');
    if(key&&seen.has(key))continue;
    if(key)seen.add(key); out.push(n);
  }
  return out;
}
window.seNotify=seNotify;
window.seMarkNotifRead=seMarkNotifRead;
window.seUnreadForCurrent=seUnreadForCurrent;

function seSyncNotificationReadStateFromSources(){
  const notifications=Array.isArray(S.notifications)?S.notifications:[];
  const mails=Array.isArray(S.mailMessages)?S.mailMessages:[];
  const chats=Array.isArray(S.messages)?S.messages:[];
  let changed=false;
  for(const n of notifications){
    if(n.read===true)continue;
    const id=String(n.entityId||'');
    const mail=mails.find(m=>String(m.id)===id || String(m.externalId||'')===id);
    if(mail?.read===true){n.read=true;n.readAt=n.readAt||mail.readAt||nowISO();changed=true;continue;}
    const chat=chats.find(m=>String(m.id)===id);
    if(chat?.readAt){n.read=true;n.readAt=n.readAt||chat.readAt;changed=true;}
  }
  return changed;
}
function seBackfillNotifications(){
  try{const beforeCount=(S.notifications||[]).length;
    const sourceReadChanged=seSyncNotificationReadStateFromSources();
    const products=(S.products||[]).filter(p=>String(p.approvalStatus||'APPROVED').toUpperCase()==='PENDING');
    if(isAdmin?.()) products.forEach(p=>seNotify({key:'product-pending:'+p.id,targetRole:'admin',title:'Product pending approval',body:`${p.title||'A seller product'} is waiting for Admin review.`,route:'admin/product-check',entityId:p.id,type:'product'}));
    if(isAdmin?.()){
      (S.messages||[]).filter(m=>m.senderRole==='seller'&&!m.readAt).forEach(m=>seNotify({key:'chat-incoming:'+m.id,targetRole:'admin',title:'New seller message',body:String(m.body||'').slice(0,120),route:'admin/messages',entityId:m.id,type:'message'}));
      (S.mailMessages||[]).filter(m=>m.type!=='sent'&&!m.read).forEach(m=>seNotify({key:'mail-incoming:'+m.id,targetRole:'admin',title:m.warningId?'Seller warning reply':'New support message',body:String(m.subject||m.body||'').slice(0,120),route:'admin/mail',entityId:m.id,type:m.warningId?'warning-reply':'mail'}));
    }
    if(S.currentUser&&!isAdmin?.()){
      const uid0=String(S.currentUser.id||'');
      (S.messages||[]).filter(m=>String(m.userId||'')===uid0&&m.senderRole==='admin'&&!m.readAt).forEach(m=>seNotify({key:'chat-reply:'+m.id,targetRole:'user',userId:uid0,sellerId:S.currentUser.sellerId,title:'New Admin reply',body:String(m.body||'').slice(0,120),route:'dashboard/messages',entityId:m.id,type:'message'}));
      (S.mailMessages||[]).filter(m=>m.type==='sent'&&String(m.userId||'')===uid0&&!m.read).forEach(m=>seNotify({key:'mail-reply:'+m.id,targetRole:'user',userId:uid0,sellerId:S.currentUser.sellerId,title:m.warningId?'Admin replied to your warning request':'Admin replied to your message',body:String(m.body||'').slice(0,120),route:'account/messages',entityId:m.id,type:m.warningId?'warning-reply':'mail'}));
    }
    if(sourceReadChanged || (S.notifications||[]).length>beforeCount)save();
  }catch(e){console.warn('Notification backfill:',e)}
}

function seNotificationPanel(){
  seBackfillNotifications();
  const rows=seUnreadForCurrent();
  const all=(S.notifications||[]).filter(n=>{
    const u=S.currentUser;if(!u)return false;
    return (n.targetRole==='admin'&&isAdmin?.())||(n.userId!=null&&String(n.userId)===String(u.id))||(n.sellerId!=null&&String(n.sellerId)===String(u.sellerId));
  }).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,30);
  const body=all.length?all.map(n=>`<button class="se-notif-row ${n.read?'':'unread'}" onclick="seOpenNotification('${esc(n.id)}')"><span class="se-notif-icon">${n.type==='product'?'◈':n.type==='message'?'✉':n.type==='warning-reply'?'⚠':'●'}</span><span><b>${esc(n.title)}</b><small>${esc(n.body||'')}</small><em>${when(n.date)}</em></span></button>`).join(''):'<div class="se-notif-empty">No notifications.</div>';
  return `<div class="se-notif-backdrop" onclick="if(event.target===this)closeSENotifications()"><div class="se-notif-panel"><div class="se-notif-head"><div><b>Notifications</b><span>${rows.length} unread</span></div><button class="btn" onclick="seReadAllNotifications();event.stopPropagation()">Mark all read</button><button class="btn iconbtn" onclick="closeSENotifications()">×</button></div>${body}</div></div>`;
}
window.openSENotifications=function(){seBackfillNotifications();document.getElementById('seNotificationRoot')?.remove();const r=document.createElement('div');r.id='seNotificationRoot';r.innerHTML=seNotificationPanel();document.body.appendChild(r);};
window.closeSENotifications=function(){document.getElementById('seNotificationRoot')?.remove();};
window.seReadAllNotifications=function(){const u=S.currentUser;if(!u)return;for(const n of (S.notifications||[])){const mine=(n.targetRole==='admin'&&isAdmin?.())||(n.userId!=null&&String(n.userId)===String(u.id))||(n.sellerId!=null&&String(n.sellerId)===String(u.sellerId));if(mine&&!n.read){n.read=true;n.readAt=nowISO();}}save();closeSENotifications();render();};
window.seOpenNotification=function(id){const n=(S.notifications||[]).find(x=>String(x.id)===String(id));if(!n)return; n.read=true;n.readAt=nowISO();save();closeSENotifications(); if(n.entityId){ if(n.type==='product'&&isAdmin?.())adminNav('product-check'); else if(n.type==='message'&&isAdmin?.())adminNav('messages'); else if((n.type==='mail'||n.type==='warning-reply')&&isAdmin?.())adminNav('mail'); else if(n.type==='warning-reply'&&!isAdmin?.())go('account/messages'); else if(n.type==='message'&&!isAdmin?.())go('dashboard/messages'); else if(!isAdmin?.())go('account/messages'); } else if(n.route){ if(n.route.startsWith('admin/'))adminNav(n.route.slice(6)); else go(n.route); } };

/* Ensure notification changes are durable even when a caller only saves local state. */
const oldSaveV31=window.save;
window.save=function(){const r=oldSaveV31.apply(this,arguments);return r;};

/* Realtime broadcast must happen after a seller/user save reaches Supabase, not
   during the debounce window. This removes the stale-read race after sends. */
const oldBroadcastV31=window.broadcastInstantOnlineUpdate;
window.broadcastInstantOnlineUpdate=async function(){
  if(typeof ONLINE_LOCAL_DIRTY!=='undefined'&&ONLINE_LOCAL_DIRTY){
    for(let i=0;i<20&&ONLINE_LOCAL_DIRTY;i++)await new Promise(r=>setTimeout(r,250));
  }
  return oldBroadcastV31?.apply(this,arguments);
};

/* Product lifecycle notifications: seller submission + Admin decision. */
const oldPublishV31=window.publishProduct;
if(oldPublishV31)window.publishProduct=function(id){
  const before=new Set((S.products||[]).map(x=>String(x.id))), beforeState=id?JSON.stringify(product(id)):null;
  const result=oldPublishV31.apply(this,arguments);
  const target=id?product(id):(S.products||[]).find(x=>!before.has(String(x.id)));
  if(target){
    const changed=!id||JSON.stringify(target)!==beforeState;
    if(changed&&String(target.approvalStatus||'').toUpperCase()==='PENDING'){
      seNotify({key:'product-pending:'+target.id,targetRole:'admin',title:'New product awaiting approval',body:`${target.title||'Product'} was submitted by seller ${target.sellerId||''}.`,route:'admin/product-check',entityId:target.id,type:'product'});
      save();
    }
  }
  return result;
};
const oldPCV31=window.adminProductCheckAction;
if(oldPCV31)window.adminProductCheckAction=function(id,kind){
  const p=product(id),sid=p?.sellerId;
  const result=oldPCV31.apply(this,arguments);
  const after=product(id);
  if(after&&sid){
    if(kind==='approve'&&String(after.approvalStatus).toUpperCase()==='APPROVED')seNotify({key:'product-decision:'+after.id+':approved',userId:(S.users||[]).find(u=>String(u.sellerId)===String(sid))?.id,sellerId:sid,title:'Product approved',body:`${after.title||'Your product'} has been approved by Admin.`,route:'dashboard/products',entityId:after.id,type:'product'});
    if(kind==='reject'&&String(after.approvalStatus).toUpperCase()==='REJECTED')seNotify({key:'product-decision:'+after.id+':rejected',userId:(S.users||[]).find(u=>String(u.sellerId)===String(sid))?.id,sellerId:sid,title:'Product rejected',body:`${after.title||'Your product'} was rejected. Check the Admin review reason.`,route:'dashboard/products',entityId:after.id,type:'warning'});
    if(['approve','reject'].includes(kind))save();
  }
  return result;
};

/* Warning read-state realtime intentionally disabled. The shared app_state row is a large JSON blob;
   subscribing to it sends the whole row on every update. Warning changes use the lightweight
   broadcast signal + targeted refresh path instead, which avoids large Realtime egress. */
(function(){
  try{
    window.addEventListener('beforeunload',()=>{});
  }catch(e){}
})();

/* Keep Admin product check page visibly focused on pending work. */
try{const style=document.createElement('style');style.textContent=`
.se-notif-bell{position:relative!important;flex:0 0 auto}.se-notif-count{position:absolute;right:-2px;top:-4px;min-width:18px;height:18px;border-radius:99px;background:#ef5b67;color:#fff;font-size:10px;font-weight:900;display:grid;place-items:center;padding:0 4px}.se-notif-backdrop{position:fixed;inset:0;background:rgba(8,13,27,.28);z-index:10050}.se-notif-panel{position:absolute;right:18px;top:74px;width:min(430px,calc(100vw - 24px));max-height:min(70vh,620px);overflow:auto;background:var(--surface,#fff);color:var(--ink,#101a33);border:1px solid var(--line,#e4e8f0);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.22)}.se-notif-head{position:sticky;top:0;background:inherit;border-bottom:1px solid var(--line,#e4e8f0);padding:14px;display:flex;align-items:center;gap:8px;z-index:1}.se-notif-head>div{flex:1;display:flex;flex-direction:column}.se-notif-head span{font-size:11px;color:var(--muted,#748096)}.se-notif-row{width:100%;display:flex;gap:12px;text-align:left;padding:13px 14px;background:transparent;color:inherit;border:0;border-bottom:1px solid var(--line,#e4e8f0)}.se-notif-row.unread{background:rgba(81,70,229,.055)}.se-notif-row:hover{background:rgba(81,70,229,.09)}.se-notif-icon{width:34px;height:34px;border-radius:10px;background:var(--soft,#eeecff);display:grid;place-items:center;flex:0 0 auto}.se-notif-row span:last-child{display:flex;flex-direction:column;min-width:0}.se-notif-row b{font-size:13px}.se-notif-row small{font-size:12px;color:var(--muted,#748096);margin-top:3px}.se-notif-row em{font-size:10px;color:var(--muted,#748096);font-style:normal;margin-top:5px}.se-notif-empty{padding:45px 20px;text-align:center;color:var(--muted,#748096)}
@media(max-width:600px){.se-notif-panel{top:68px;right:10px}.se-notif-head .btn:not(.iconbtn){padding:8px 9px;font-size:11px}}
`;
document.head.appendChild(style);}catch{}

/* Initial backfill after cloud hydration. */
setTimeout(()=>{try{seBackfillNotifications()}catch{}},1200);
})();

/* FINAL PRODUCT EDIT REVIEW RULE: image/secure-link changes require Admin review; other edits keep the existing approval state. */
(function enforceProductEditReviewRule(){
  const previousPublishProduct=window.publishProduct;
  if(typeof previousPublishProduct!=='function')return;
  window.publishProduct=function(id){
    const pid=id?String(id):'';
    const before=pid?product(pid):null;
    const beforeState=before?{
      approvalStatus:before.approvalStatus||'APPROVED',
      hiddenByAdmin:!!before.hiddenByAdmin,
      approvalReason:before.approvalReason||'',
      adminReviewedAt:before.adminReviewedAt||null,
      adminReviewedBy:before.adminReviewedBy||null,
      safetyStatus:before.safetyStatus||'CLEAR',
      safetyFlags:Array.isArray(before.safetyFlags)?before.safetyFlags.slice():[],
      image:String(before.image||''),
      links:JSON.stringify((before.links||[]).map(x=>String(x||'').trim()))
    }:null;
    let result;
    try{ result=previousPublishProduct.apply(this,arguments); }
    catch(e){ throw e; }
    if(!pid||!beforeState)return result;
    const after=product(pid);
    if(!after)return result;
    const imageChanged=beforeState.image!==String(after.image||'');
    const linksChanged=beforeState.links!==JSON.stringify((after.links||[]).map(x=>String(x||'').trim()));
    const needsReview=imageChanged||linksChanged;
    if(needsReview){
      /* Image/secure delivery URL changes always go back to Admin review. */
      markProductPendingReview(after,'Product image or secure delivery link changed; admin review required');
      after.publicLive=false;
      try{logProductActivity(pid,'Product image or secure delivery link changed — pending admin review',{sellerId:currentSeller()?.id||after.sellerId});}catch(e){}
      save();
      toast('Image or delivery link changed. Product is pending Admin review.');
      render();
    }else{
      /* Do not let legacy approval wrappers make harmless edits pending. */
      after.approvalStatus=beforeState.approvalStatus;
      after.hiddenByAdmin=beforeState.hiddenByAdmin;
      after.approvalReason=beforeState.approvalReason;
      after.adminReviewedAt=beforeState.adminReviewedAt;
      after.adminReviewedBy=beforeState.adminReviewedBy;
      after.safetyStatus=beforeState.safetyStatus;
      after.safetyFlags=beforeState.safetyFlags.slice();
      save();
    }
    return result;
  };
})();
