
(function(){
  'use strict';
  const oldBuyNow=window.buyNow;
  window.buyNow=function(id){
    if(typeof isAdmin==='function'&&isAdmin())return window.adminOpenProductSecret?.(id);
    return oldBuyNow?.apply(this,arguments);
  };
  const oldOpenBuy=window.openBuy;
  window.openBuy=function(id){
    if(typeof isAdmin==='function'&&isAdmin())return window.adminOpenProductSecret?.(id);
    return oldOpenBuy?.apply(this,arguments);
  };
})();
