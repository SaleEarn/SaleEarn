
(function(){
'use strict';
/* Root-cause fix: Admin moderation and notification read-state are committed by
   small, atomic Supabase RPCs. They are no longer dependent on the large shared
   JSON snapshot debounce/realtime merge path. */
const ADMIN_APPROVAL_RPC='admin_set_product_approval';
const NOTIF_READ_RPC='mark_saleearn_notification_read';
const NOTIF_READ_ALL_RPC='mark_saleearn_notifications_read_all';
function installAuthoritativeData(data,updatedAt){
  if(!data||typeof data!=='object')return false;
  if(typeof seSetBase==='function')seSetBase({data,updated_at:updatedAt||nowISO()});
  if(typeof seInstall==='function')seInstall(data);
  else Object.assign(S,data);
  if(typeof onlineSnapshotKey==='function')seSyncKey=onlineSnapshotKey(onlineSnapshot());
  ONLINE_LOCAL_DIRTY=false;seDirtySince=0;seStopped=false;seFailures=0;seRetryAt=0;
  return true;
}
async function authoritativeApproval(id,kind){
  if(!window.supabaseClient)return {ok:false,error:new Error('Supabase is unavailable')};
  const status=kind==='approve'?'APPROVED':kind==='reject'?'REJECTED':'PENDING';
  // Admin moderation must be able to act on pending products. The public product()
  // helper intentionally hides non-approved/non-active products, so using it here
  // incorrectly made pending products look like they did not exist.
  const deletedSet=typeof deletedProductIdSet==='function'?deletedProductIdSet():new Set();
  const p=(S.products||[]).find(x=>String(x?.id)===String(id));
  if(!p || deletedSet.has(String(id)))return {ok:false,error:new Error('Product not found')};
  if(status==='APPROVED'){
    const scan=productSafetyScan(p);
    if(scan.flagged)return {ok:false,error:new Error('Cannot approve: safety check flagged this product. Review the product and delivery links first.')};
    if(!p.rightsConfirmed)return {ok:false,error:new Error('Seller rights confirmation is missing. Reject or request resubmission.')};
  }
  const reason=status==='APPROVED'?'Approved after admin review':status==='REJECTED'?'Rejected during admin safety review':'Returned to admin review';
  try{
    const {data,error}=await window.supabaseClient.rpc(ADMIN_APPROVAL_RPC,{p_product_id:String(id),p_status:status,p_reason:reason});
    if(error)throw error;
    const row=Array.isArray(data)?data[0]:data;
    if(!row?.data)throw new Error('Supabase did not return the updated authoritative state');
    installAuthoritativeData(row.data,row.updated_at);
    /* Approval is authoritative for moderation status; publicLive is the
       separate marketplace-visibility flag. New listings start public while
       Pending. Approve keeps them public; reject/pending removes them. */
    const updated=(S.products||[]).find(x=>String(x?.id)===String(id));
    if(updated){
      updated.approvalStatus=status;
      updated.publicLive=(status==='APPROVED');
      if(status==='APPROVED'){
        updated.hiddenByAdmin=false;
        delete updated.sellerReviewRequested;
      }else if(status==='REJECTED'){
        updated.hiddenByAdmin=true;
        delete updated.sellerReviewRequested;
      }else{
        updated.hiddenByAdmin=false;
      }
    }
    return {ok:true,row,productSnapshot:{...p,approvalStatus:status,publicLive:status==='APPROVED',hiddenByAdmin:status==='REJECTED'}};
  }catch(error){
    console.error('Authoritative product approval failed:',error);
    return {ok:false,error};
  }
}

const previousProductAction=window.adminProductCheckAction;
window.adminProductCheckAction=async function(id,kind){
  if(!adminOnly())return;
  if(!['approve','reject','pending'].includes(kind)){
    return previousProductAction?.apply(this,arguments);
  }
  window.__pcInFlight=window.__pcInFlight||new Set();
  const pid=String(id||'');
  if(window.__pcInFlight.has(pid))return;
  window.__pcInFlight.add(pid);
  try{
    const result=await authoritativeApproval(pid,kind);
    if(!result.ok){toast(result.error?.message||'Product status could not be saved to Supabase. No approval change was applied.');return;}
    const after=(S.products||[]).find(x=>String(x?.id)===String(pid)) || result.productSnapshot || null;
    if(!after)return toast('Product was saved, but the refreshed product record was not found.');
    adminAudit(kind==='approve'?'Approved product after safety review':kind==='reject'?'Rejected product after safety review':'Returned product to pending review',pid,{productId:pid,sellerId:after.sellerId});
    /* Audit/notification is secondary. The moderation decision above is already
       committed in Supabase before this local-only bookkeeping runs. */
    if(kind==='approve' || kind==='reject' || kind==='pending'){
      /* Keep normalized public products synchronized with the moderation decision.
         active = live, pending = hidden. This removes stale browser-state dependence. */
      try{
        const decided=(S.products||[]).find(x=>String(x?.id)===String(pid)) || result.productSnapshot;
        if(decided && window.supabaseClient){
          let existing=null;
          try{
            const er=await window.supabaseClient.from('products').select('id,seller_id').eq('id',String(pid)).maybeSingle();
            if(!er.error)existing=er.data||null;
          }catch{}
          const owner=existing?.seller_id || normalizedOwnerId(decided.sellerId) || sellerOwnerUser(decided.sellerId)?.authId || sellerOwnerUser(decided.sellerId)?.id;
          const syncRow={
            id:String(decided.id),
            title:String(decided.title||'Untitled'),
            description:decided.description||null,
            price:Number(decided.price||0),
            status:kind==='approve'?'active':'pending',
            file_url:decided.links?.[0]||decided.deliveryUrl||null,
            image_url:decided.image||null
          };
          if(owner)syncRow.seller_id=owner;
          const wr=existing
            ? await window.supabaseClient.from('products').update(syncRow).eq('id',String(pid))
            : (owner ? await window.supabaseClient.from('products').insert({...syncRow,seller_id:owner}) : {error:new Error('Seller owner ID could not be resolved')});
          if(wr.error)throw wr.error;
        }
        /* Do not wait for a second full catalog fetch to make the approved item
           visible.  Admin approval is already authoritative in Supabase; update the
           small in-memory public catalog immediately, then refresh it in the
           background.  This also preserves the existing product metadata (category,
           tags, image, links, etc.) that is not part of the normalized public row. */
        const publicRow={...decided, id:String(decided.id), status:'active', approvalStatus:'APPROVED', publicLive:true, hiddenByAdmin:false};
        const publicList=Array.isArray(SE_PUBLIC_CATALOG)?SE_PUBLIC_CATALOG.slice():[];
        const publicIndex=publicList.findIndex(x=>String(x?.id)===String(pid));
        if(kind==='approve'){
          if(publicIndex>=0)publicList[publicIndex]={...publicList[publicIndex],...publicRow};
          else publicList.unshift(publicRow);
        }else{
          if(publicIndex>=0)publicList.splice(publicIndex,1);
        }
        SE_PUBLIC_CATALOG=publicList;
        SE_PUBLIC_CATALOG_READY=true;
        PUBLIC_PRODUCTS_READY=true;
        SE_PUBLIC_CATALOG_PROMISE=null;
        try{await seLoadPublicCatalog(true);}catch(e){console.warn('Public catalog refresh after moderation:',e?.message||e)}
      }catch(e){
        console.warn('Public catalog moderation sync failed:',e?.message||e);
      }

      try{render()}catch{}
      const u=(S.users||[]).find(x=>String(x.sellerId)===String(after.sellerId));
      if(kind==='approve'){
        seNotify({key:'product-decision:'+pid+':approved',userId:u?.id,sellerId:after.sellerId,title:'Product approved',body:`${after.title||'Your product'} has been approved by Admin.`,route:'dashboard/products',entityId:pid,type:'product'});
      }else if(kind==='reject'){
        seNotify({key:'product-decision:'+pid+':rejected',userId:u?.id,sellerId:after.sellerId,title:'Product rejected',body:`${after.title||'Your product'} was rejected. Check the Admin review reason.`,route:'dashboard/products',entityId:pid,type:'warning'});
      }
    }
    save();
    render();
    toast(kind==='approve'?'Product approved and is now live on the marketplace.':kind==='reject'?'Product rejected and hidden from the marketplace.':'Product returned to Pending Review and hidden from the marketplace.');
  }finally{
    window.__pcInFlight.delete(pid);
  }
};

async function authoritativeNotificationRead(id,all=false){
  if(!window.supabaseClient)return {ok:false,error:new Error('Supabase is unavailable')};
  try{
    const rpc=all?NOTIF_READ_ALL_RPC:NOTIF_READ_RPC;
    const args=all?{}:{p_notification_id:String(id||'')};
    const {data,error}=await window.supabaseClient.rpc(rpc,args);
    if(error)throw error;
    const row=Array.isArray(data)?data[0]:data;
    if(!row?.data)throw new Error('Supabase did not return the updated notification state');
    installAuthoritativeData(row.data,row.updated_at);
    return {ok:true};
  }catch(error){
    console.error('Authoritative notification read failed:',error);
    return {ok:false,error};
  }
}
window.seOpenNotification=async function(id){
  const n=(S.notifications||[]).find(x=>String(x.id)===String(id));
  if(!n)return;
  if(!n.read){
    const result=await authoritativeNotificationRead(id,false);
    if(!result.ok){toast('Read status could not be saved. The notification was not marked read.');return;}
  }
  closeSENotifications();
  if(n.entityId){
    /* Admin product notifications should open the exact product, not the
       generic Product Check list. This keeps the notification actionable
       even after the product has already moved out of Pending Review. */
    if(n.type==='product'&&isAdmin?.())adminNav('product/'+encodeURIComponent(String(n.entityId)));
    else if(n.type==='message'&&isAdmin?.())adminNav('messages');
    else if((n.type==='mail'||n.type==='warning-reply')&&isAdmin?.())adminNav('mail');
    else if(n.type==='warning-reply'&&!isAdmin?.())go('account/messages');
    else if(n.type==='message'&&!isAdmin?.())go('dashboard/messages');
    else if(!isAdmin?.())go('account/messages');
  }else if(n.route){
    if(n.route.startsWith('admin/'))adminNav(n.route.slice(6)); else go(n.route);
  }
};
window.seReadAllNotifications=async function(){
  if(!S.currentUser)return;
  const result=await authoritativeNotificationRead(null,true);
  if(!result.ok){toast('Unread count could not be saved. No notifications were marked read.');return;}
  closeSENotifications();render();
};
})();
