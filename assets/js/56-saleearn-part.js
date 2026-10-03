
/* Inlined from assets/js/55-saleearn-part.js */

/* Sale Earn ADMIN APPROVAL FIX v2
   Admin approval must not be blocked by the seller-facing rights-confirmation
   flag. Supabase still authorizes the call by auth.uid() inside the Admin-only
   SECURITY DEFINER RPC. */
(function(){
  'use strict';
  window.adminProductCheckAction=async function(id,kind){
    if(typeof adminOnly==='function'&&!adminOnly())return;
    if(!['approve','reject','pending'].includes(kind)){
      if(typeof window.studioModerate==='function')return window.studioModerate(id,kind);
      return;
    }
    const pid=String(id||'');
    if(!pid)return;
    window.__pcInFlight=window.__pcInFlight||new Set();
    if(window.__pcInFlight.has(pid))return;
    window.__pcInFlight.add(pid);

    try{
      const p=(S.products||[]).find(x=>String(x?.id)===pid);
      if(!p){toast('Product not found');return;}

      const status=kind==='approve'?'APPROVED':kind==='reject'?'REJECTED':'PENDING';
      if(kind==='approve'){
        const scan=typeof productSafetyScan==='function'?productSafetyScan(p):{flagged:false};
        if(scan.flagged){
          toast('Cannot approve: safety check flagged this product.');
          return;
        }
      }

      if(!window.supabaseClient){
        toast('Supabase is unavailable. Product was not changed.');
        return;
      }

      const reason=status==='APPROVED'
        ?'Approved by Admin'
        :status==='REJECTED'
          ?'Rejected by Admin'
          :'Returned to Admin review';

      const {data,error}=await window.supabaseClient.rpc('admin_force_product_approval',{
        p_product_id:pid,
        p_status:status,
        p_reason:reason
      });
      if(error)throw error;

      const row=Array.isArray(data)?data[0]:data;
      if(row?.data && typeof installAuthoritativeData==='function'){
        installAuthoritativeData(row.data,row.updated_at);
      }

      const updated=(S.products||[]).find(x=>String(x?.id)===pid)||p;
      updated.approvalStatus=status;
      updated.publicLive=status==='APPROVED';
      updated.hiddenByAdmin=status!=='APPROVED';
      if(status==='APPROVED'){
        updated.rightsConfirmed=true;
        updated.previouslyApproved=true;
        updated.lastApprovedAt=row?.updated_at||nowISO();
        delete updated.sellerReviewRequested;
      }

      adminAudit(
        kind==='approve'?'Approved product by Admin':
        kind==='reject'?'Rejected product by Admin':
        'Returned product to Pending Review',
        pid,
        {productId:pid,sellerId:updated.sellerId,serverAuthoritative:true}
      );

      save();
      render();

      /* Best-effort normalized public catalog sync; failure here must NOT undo
         the already-committed Admin decision. */
      try{
        if(kind==='approve' && window.supabaseClient){
          const owner=sellerOwnerUser(updated.sellerId);
          const ownerId=owner?.authId||owner?.id||normalizedOwnerId(updated.sellerId)||updated.sellerId;
          const row2={
            id:pid,
            title:String(updated.title||'Untitled'),
            description:updated.description||null,
            price:Number(updated.price||0),
            status:'active',
            file_url:updated.links?.[0]||updated.deliveryUrl||null,
            image_url:updated.image||null
          };
          if(ownerId)row2.seller_id=ownerId;
          const er=await window.supabaseClient.from('products').select('id').eq('id',pid).maybeSingle();
          if(!er.error && er.data){
            await window.supabaseClient.from('products').update(row2).eq('id',pid);
          }else if(ownerId){
            await window.supabaseClient.from('products').insert({...row2,seller_id:ownerId});
          }
        }
      }catch(e){
        console.warn('Admin public product sync after approval:',e?.message||e);
      }

      toast(
        kind==='approve'?'Product approved and is now live on the marketplace.':
        kind==='reject'?'Product rejected and hidden from the marketplace.':
        'Product returned to Pending Review.'
      );
    }catch(e){
      console.error('Admin product approval RPC failed:',e);
      toast(e?.message||'Admin product approval failed in Supabase.');
    }finally{
      window.__pcInFlight.delete(pid);
    }
  };
})();

