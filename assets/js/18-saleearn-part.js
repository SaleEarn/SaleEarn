
/* Final integrity checks: stop public purchase access to rejected/pending products and
   make the policy guard reusable from every purchase route. */
(function(){
  const originalCanShow=window.canShowProduct;
  if(typeof originalCanShow==='function'){
    window.canShowProduct=function(p){
      if(!p)return false;
      const status=String(p.status||'APPROVED').toUpperCase();
      if(p.hiddenByAdmin===true||['REJECTED','PENDING','UNDER_REVIEW','DRAFT'].includes(status))return false;
      const scan=typeof productSafetyScan==='function'?productSafetyScan(p):{flagged:false};
      return !scan.flagged;
    };
  }
  // Keep the support inbox refresh alive only while the admin is viewing Mail Center.
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&typeof route==='function'&&String(route()||'')==='admin/mail'&&typeof loadContactMessagesForAdmin==='function'&&!CONTACT_ADMIN_REALTIME_STARTED)loadContactMessagesForAdmin(true);});
})();
