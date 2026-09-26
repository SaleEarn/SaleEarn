
(function(){
  'use strict';
  // A failed third-party script must never leave visitors on a blank loader.
  function showFallback(){
    try{
      const app=document.getElementById('app');
      if(app && !app.innerHTML.trim() && typeof window.render==='function') window.render();
      const loader=document.getElementById('siteLoader');
      if(loader){loader.classList.remove('show');loader.classList.add('hidden');}
    }catch(e){console.warn('Sale Earn safe boot fallback:',e)}
  }
  // Normal boot hides it earlier; this only protects slow/offline preview cases.
  window.setTimeout(showFallback,9000);
  window.addEventListener('error',function(e){
    if(/supabase|checkout|cdn|razorpay/i.test(String(e?.filename||e?.message||''))) window.setTimeout(showFallback,250);
  },true);
})();
