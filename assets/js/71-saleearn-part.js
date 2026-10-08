(function(){
  'use strict';
  /* Admin must never mark a warning READ by opening it. READ belongs to the seller. */
  window.seAdminOpenWarning=function(id){
    try{
      if(typeof adminOnly==='function' && !adminOnly())return;
      const w=(S.warnings||[]).find(x=>String(x?.id||'')===String(id||''));
      if(!w)return toast('Warning not found');

      let sid=String(w.sellerId||'');
      if(!sid && w.userId){
        const u=(S.users||[]).find(x=>String(x.id||'')===String(w.userId||''));
        sid=String(u?.sellerId||'');
      }
      if(!sid){
        toast('Seller ID not found for this warning');
        return;
      }

      /* Opening the warning only opens that seller's Admin detail page.
         It deliberately does NOT modify w.read/readAt/readBy. */
      if(typeof adminNav==='function'){
        adminNav('seller/'+encodeURIComponent(sid));
      }else if(typeof go==='function'){
        go('admin/seller/'+encodeURIComponent(sid));
      }
    }catch(e){
      console.warn('Admin warning seller open:',e);
    }
  };
})();
