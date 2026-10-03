
/* Inlined from assets/js/27-saleearn-part.js */

(function(){
  if(window.__sellerWarningReadBadgeFixV18)return;
  window.__sellerWarningReadBadgeFixV18=true;
  window.getSellerUnreadWarningCount=function(sellerId){
    return (S.warnings||[]).filter(function(w){
      return String(w?.sellerId||'')===String(sellerId||'') && w?.read!==true;
    }).length;
  };
})();

