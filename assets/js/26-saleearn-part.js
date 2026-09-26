
(function(){
  'use strict';
  if(window.__saleEarnV74AdminNavNoFlicker)return;
  window.__saleEarnV74AdminNavNoFlicker=true;
  const KEY='SE_ADMIN_NAV_SCROLL_V74';
  let saved=0;
  try{saved=Math.max(0,Number(sessionStorage.getItem(KEY)||sessionStorage.getItem('SE_ADMIN_NAV_SCROLL_V73')||0));}catch(e){}
  function nav(){return document.querySelector('body.se-admin .admin-side .as-nav');}
  function capture(){const el=nav();if(!el)return;saved=Math.max(0,Number(el.scrollTop||0));try{sessionStorage.setItem(KEY,String(saved));}catch(e){}}
  function restore(){const el=nav();if(!el)return;el.scrollTop=saved;}
  document.addEventListener('scroll',function(e){if(e.target===nav())capture();},true);
  /* Capture at the last possible moment before the inline navigation handler. */
  document.addEventListener('pointerdown',function(e){const el=e.target.closest?.('body.se-admin .admin-side .as-nav');if(el)capture();},true);
  window.addEventListener('pageshow',restore,{passive:true});
  [0,16,50].forEach(function(ms){setTimeout(restore,ms);});
})();
