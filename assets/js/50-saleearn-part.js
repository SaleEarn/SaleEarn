
(function(){
'use strict';
/* v30: Supabase is the durable source of truth. The shared JSON row remains a
   compatibility cache for the existing UI, while normalized products/orders/
   payouts stay authoritative where already supported. Realtime Broadcast is
   only a tiny invalidation signal; clients do not poll the full JSON blob often. */
const ADMIN_KEYS=[
 'adminControls','platformConfig','adminAuditLog','adminFinancialLedger',
 'adminCommissionAdjustments','riskAlerts','securityEvents','growthGoals',
 'sellerRankings','badgeLedgers','productActivity','warnings','mailMessages',
 'messages','messageThreads','messageSettings','messagePacks'
];
const PRODUCT_ADMIN_KEYS=[
 'approvalStatus','adminChecked','adminVerified','adminUnseenReply','adminReply',
 'adminNotes','adminWarning','hiddenByAdmin','adminPriceEditedAt',
 'adminPriceEditedBy','adminPriceEditReason','adminSalesOverride',
 'displayedSalesCount','featured','status'
];
const clone=x=>{try{return structuredClone(x)}catch{return JSON.parse(JSON.stringify(x))}};
const mapById=a=>new Map((Array.isArray(a)?a:[]).filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
const isAdm=()=>{try{return !!(typeof isAdmin==='function'&&isAdmin())}catch{return false}};

/* Never let an older seller browser overwrite Admin-owned state. */
const oldGuard=window.seGuardNonAdmin;
window.seGuardNonAdmin=function(sent,remote){
 try{
  if(isAdm())return;
  if(typeof oldGuard==='function')oldGuard(sent,remote);
  const r=remote||{};
  for(const k of ADMIN_KEYS) if(Object.prototype.hasOwnProperty.call(r,k)) sent[k]=clone(r[k]);
  const rp=mapById(r.products),sp=mapById(sent.products);
  for(const [id,rv] of rp){
   const lv=sp.get(id); if(!lv)continue;
   const sellerReviewRequested=lv.sellerReviewRequested===true && String(lv.approvalStatus||'').toUpperCase()==='PENDING';
   for(const k of PRODUCT_ADMIN_KEYS) if(Object.prototype.hasOwnProperty.call(rv,k)){
     /* Seller may submit an explicit image/link review request. In that one
        narrow case the pending state must reach the shared cloud row instead
        of being replaced by the previous Admin-approved state. All other
        Admin-owned fields remain protected from seller edits. */
     if(sellerReviewRequested && ['approvalStatus','hiddenByAdmin','approvalReason','adminReviewedAt','adminReviewedBy','safetyStatus','safetyFlags'].includes(k)) continue;
     lv[k]=clone(rv[k]);
   }
  }
  const arr=Array.isArray(sent.products)?sent.products:[];
  for(const [id,rv] of rp)if(!sp.has(id))arr.push(clone(rv));
  sent.products=arr;
 }catch(e){console.warn('v30 guard:',e)}
};

/* Normalized products are read directly for Admin so pending/new products do not
   disappear when the shared cache is stale. Admin moderation fields stay from the
   shared state because the normalized table intentionally stores marketplace fields. */
window.saleEarnHydrateAdminProducts=async function(){
 if(!isAdm()||!window.supabaseClient)return false;
 try{
  const r=await window.supabaseClient.from('products').select('id,seller_id,title,description,price,status,file_url,image_url,created_at').order('created_at',{ascending:false});
  if(r.error)throw r.error;
  const existing=mapById(S.products);
  const deletedIds=new Set((Array.isArray(S.productTombstones)?S.productTombstones:[]).map(x=>String(x?.id)));
  for(const row of (r.data||[])){
   const id=String(row.id);
   if(deletedIds.has(id))continue;
   const old=existing.get(id)||{};
   const sid=(typeof seLocalSellerFromAuth==='function'&&seLocalSellerFromAuth(row.seller_id))||row.seller_id||old.sellerId||null;
   existing.set(id,{...old,id,title:row.title??old.title??'Untitled',description:row.description??old.description??'',price:Number(row.price??old.price??0),status:old.status||row.status||'active',sellerId:sid,createdAt:old.createdAt||row.created_at||nowISO(),image:old.image||row.image_url||'',links:old.links||((row.file_url?[row.file_url]:[]))});
  }
  S.products=[...existing.values()].filter(p=>!deletedIds.has(String(p?.id)));
  sePersist();
  return true;
 }catch(e){console.warn('v30 product hydration:',e?.message||e);return false}
};

let adminRefreshBusy=false,adminLastRefresh=0,adminRefreshTimer=null;
window.saleEarnAdminCloudRefresh=async function(forceRender=true,force=false){
 if(!isAdm()||!window.supabaseClient)return false;
 if(adminRefreshBusy)return false;
 if(!force && Date.now()-adminLastRefresh<15000)return false;
 /* Never discard an Admin edit. Flush it first, then read the authoritative copy. */
 if(typeof ONLINE_LOCAL_DIRTY!=='undefined'&&ONLINE_LOCAL_DIRTY){
  try{if(typeof pushOnlineState==='function')await pushOnlineState();}catch{}
  if(ONLINE_LOCAL_DIRTY)return false;
 }
 adminRefreshBusy=true;
 try{
  /* Admin refresh first checks only updated_at. The large shared JSON snapshot is
     downloaded only when the server revision actually changed. */
  const meta=await seReadVersion();
  const metaChanged=!!meta && (seVersion!==meta.updated_at || !seExists);
  if(metaChanged){
   const row=await seReadFull();
   if(row?.data&&typeof seSetBase==='function'&&typeof seInstall==='function'){
    seSetBase(row);seInstall(row.data);ONLINE_LOCAL_DIRTY=false;seDirtySince=0;seStopped=false;seFailures=0;seRetryAt=0;seLastCheck=Date.now();seSyncKey=onlineSnapshotKey(row.data);ONLINE_LAST_REMOTE=onlineSnapshotKey(row.data);
   }
  } else {
   seLastCheck=Date.now();
  }
  await window.saleEarnHydrateAdminProducts();
  if(typeof hydrateNormalizedFinancials==='function')await hydrateNormalizedFinancials();
  /* Mail Center has its own Realtime channel. Do not refetch the whole inbox
     on every Admin refresh/navigation; only hydrate it when Mail Center has
     not loaded it yet. Explicit Refresh still uses loadContactMessagesForAdmin(true). */
  try{
   if(String(route()||'')==='admin/mail' && !CONTACT_ADMIN_INITIAL_LOADED){
    const cm=await window.supabaseClient.from('contact_messages').select('id,name,email,subject,message,user_id,created_at,read,starred').order('created_at',{ascending:false}).limit(300);
    if(!cm.error){
     mergeContactMailRows(cm.data||[]);
     CONTACT_ADMIN_INITIAL_LOADED=true;
    }
   }
  }catch(e){console.warn('v30 contact:',e)}
  try{
   const ch=await window.supabaseClient.from('seller_admin_messages').select('id,thread_id,seller_id,seller_user_id,sender_role,sender_user_id,body,created_at,read_at,edited_at').order('created_at',{ascending:true});
   if(!ch.error)S.messages=(ch.data||[]).map(x=>({id:String(x.id),threadId:x.thread_id,sellerId:x.seller_id,sellerUserId:x.seller_user_id,senderRole:x.sender_role,senderUserId:x.sender_user_id,body:x.body||'',date:x.created_at||nowISO(),readAt:x.read_at||null,editedAt:x.edited_at||null,cloud:true}));
  }catch(e){console.warn('v30 chat:',e)}
  adminLastRefresh=Date.now();
  if(forceRender&&typeof window.render==='function')window.render();
  return true;
 }catch(e){console.warn('v30 admin refresh:',e?.message||e);return false}
 finally{adminRefreshBusy=false}
};

/* Admin cloud refresh is now explicit only. Normal navigation, focus, tab visibility,
   and startup do not refetch the full state. Realtime/Broadcast or a manual refresh
   can call saleEarnAdminCloudRefresh when a fresh server snapshot is genuinely needed. */

window.saleEarnAdminDataHealth=()=>({admin:isAdm(),cloudState:!!window.supabaseClient,products:Array.isArray(S.products)?S.products.length:0,orders:Array.isArray(S.orders)?S.orders.length:0,payouts:Array.isArray(S.payouts)?S.payouts.length:0,contacts:Array.isArray(S.mailMessages)?S.mailMessages.length:0,chats:Array.isArray(S.messages)?S.messages.length:0,pendingProducts:(S.products||[]).filter(p=>String(p?.approvalStatus||'').toUpperCase()!=='APPROVED').length,sync:typeof window.saleEarnSyncStatus==='function'?window.saleEarnSyncStatus():null});
})();
