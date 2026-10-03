
/* Inlined from assets/js/54-saleearn-part.js */

/* Sale Earn ADMIN PRODUCT RPC CONTROL v1
   Admin product mutations are routed through Supabase SECURITY DEFINER RPCs.
   Normal users/sellers never receive these elevated database capabilities.
   Required RPCs:
     - admin_set_product_approval(p_product_id,p_status,p_reason)
     - admin_set_product_visibility(p_product_id,p_hidden)
     - admin_restore_product(p_product_id)
     - admin_delete_product(p_product_id,p_permanent)
*/
(function(){
  'use strict';
  if(window.__seAdminProductRpcControlV1)return;
  window.__seAdminProductRpcControlV1=true;

  const RPC={
    approval:'admin_force_product_approval',
    visibility:'admin_set_product_visibility',
    restore:'admin_restore_product',
    delete:'admin_delete_product'
  };

  function rpcError(error,fallback){
    console.error('Sale Earn Admin RPC failed:',error);
    return new Error(error?.message||fallback||'Admin product action failed in Supabase.');
  }

  async function callAdminProductRpc(name,args){
    if(typeof adminOnly==='function'&&!adminOnly())return {ok:false,error:new Error('Admin access required')};
    if(!window.supabaseClient)return {ok:false,error:new Error('Supabase is unavailable')};
    try{
      const {data,error}=await window.supabaseClient.rpc(name,args||{});
      if(error)throw error;
      const row=Array.isArray(data)?data[0]:data;
      return {ok:true,row,data};
    }catch(error){
      return {ok:false,error:rpcError(error,`Supabase Admin RPC ${name} failed.`)};
    }
  }

  /* Hide/unhide is an Admin-only database mutation. */
  window.hideProductRowFromPublicCloud=async function(id,hidden=true){
    const result=await callAdminProductRpc(RPC.visibility,{
      p_product_id:String(id),
      p_hidden:!!hidden
    });
    if(!result.ok){
      toast(result.error.message||'Product visibility could not be changed in Supabase.');
      return false;
    }
    return true;
  };

  /* Permanent delete is performed by the Admin RPC so RLS cannot block the
     Admin while still protecting the table from ordinary users. */
  window.purgeProductFromCloud=async function(p){
    if(!p)return false;
    const result=await callAdminProductRpc(RPC.delete,{
      p_product_id:String(p.id),
      p_permanent:true
    });
    if(!result.ok){
      toast(result.error.message||'Product could not be permanently deleted in Supabase.');
      return false;
    }
    return true;
  };

  /* Restore is also authoritative in Supabase. Local recycle-bin state is
     updated only after the RPC succeeds. */
  window.adminRestoreProductNow=async function(id){
    if(!adminOnly())return;
    const i=(S.deletedProducts||[]).findIndex(p=>String(p.id)===String(id));
    if(i<0)return;

    const result=await callAdminProductRpc(RPC.restore,{
      p_product_id:String(id)
    });
    if(!result.ok){
      toast(result.error.message||'Product could not be restored in Supabase.');
      return;
    }

    const p={...S.deletedProducts[i]};
    delete p.deletedAt; delete p.deletedBy; delete p.recycledAt; delete p.recycledFrom;
    S.productTombstones=(S.productTombstones||[]).filter(t=>String(t.id)!==String(id));
    S.deletedProducts.splice(i,1);
    S.products=S.products||[];
    S.products.unshift(p);
    logAdminAudit('Restored product from Deleted',id,{sellerId:p.sellerId});
    logProductActivity(id,'Restored to Live Products',{sellerId:p.sellerId});
    save(); render();
    toast('Product restored through Supabase Admin RPC.');
  };

  /* Keep the existing confirmation UI, but make the actual hard-delete
     operation use the Admin RPC. */
  window.adminPermanentDeleteProductNow=async function(id){
    if(!adminOnly())return;
    const p=product(id);
    if(!p)return;

    const result=await callAdminProductRpc(RPC.delete,{
      p_product_id:String(id),
      p_permanent:true
    });
    if(!result.ok){
      toast(result.error.message||'Product could not be permanently deleted in Supabase.');
      return;
    }

    tombstoneProduct(id);
    removeProductFromAllCloudState(id);
    S.saved=(S.saved||[]).filter(x=>String(x?.productId)!==String(id));
    S.ads=(S.ads||[]).filter(x=>String(x?.productId)!==String(id));
    adjustSellerScore(p.sellerId,-2,'Product permanently deleted','DELETE:'+id+':'+Date.now(),'ADMIN');
    logAdminAudit('Permanently deleted product',id,{sellerId:p.sellerId});
    logProductActivity(id,'Permanently deleted',{sellerId:p.sellerId});
    save();render();
    toast('Product permanently deleted through Supabase Admin RPC.');
  };

  window.adminPermanentDeleteNow=async function(id){
    if(!adminOnly())return;
    const p=(S.deletedProducts||[]).find(x=>String(x.id)===String(id));
    if(!p)return;

    const result=await callAdminProductRpc(RPC.delete,{
      p_product_id:String(id),
      p_permanent:true
    });
    if(!result.ok){
      toast(result.error.message||'Product could not be permanently deleted in Supabase.');
      return;
    }

    tombstoneProduct(id);
    removeProductFromAllCloudState(id);
    S.deletedProducts=(S.deletedProducts||[]).filter(x=>String(x.id)!==String(id));
    adjustSellerScore(p.sellerId,-2,'Product permanently deleted','DELETE:'+id+':'+Date.now(),'ADMIN');
    logAdminAudit('Permanently deleted product',id,{sellerId:p.sellerId});
    logProductActivity(id,'Permanently deleted',{sellerId:p.sellerId});
    save();render();
    toast('Product permanently deleted through Supabase Admin RPC.');
  };

  /* Approval/reject/pending already use admin_set_product_approval.
     This guard makes sure Admin actions never fall back to a direct
     products UPDATE/DELETE for the elevated operations. */
  window.saleEarnAdminProductRpcHealth=function(){
    return {
      enabled:true,
      approval:RPC.approval,
      visibility:RPC.visibility,
      restore:RPC.restore,
      delete:RPC.delete
    };
  };
})();

