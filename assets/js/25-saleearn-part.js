
(function(){
  'use strict';
  if(window.__saleEarnV73AdminLeftSidebarFix)return;
  window.__saleEarnV73AdminLeftSidebarFix=true;
  const KEY='SE_ADMIN_NAV_SCROLL_V73';
  let saved=0;
  try{saved=Math.max(0,Number(sessionStorage.getItem(KEY)||0));}catch(e){}

  function nav(){return document.querySelector('body.se-admin .admin-side .as-nav');}
  function capture(){
    const el=nav();
    if(!el)return;
    saved=Math.max(0,Number(el.scrollTop||0));
    try{sessionStorage.setItem(KEY,String(saved));}catch(e){}
  }
  function restore(){
    const el=nav();
    if(!el)return;
    const value=Math.max(0,Number(saved||0));
    el.scrollTop=value;
    requestAnimationFrame(function(){
      const again=nav();
      if(again)again.scrollTop=value;
    });
  }

  document.addEventListener('scroll',function(e){
    if(e.target===nav())capture();
  },true);
  document.addEventListener('pointerdown',function(e){
    const el=e.target.closest?.('body.se-admin .admin-side .as-nav');
    if(el)capture();
  },true);
  document.addEventListener('click',function(e){
    const el=e.target.closest?.('body.se-admin .admin-side .as-nav');
    if(!el)return;
    capture();
    [0,16,50,120,250,500].forEach(function(ms){setTimeout(restore,ms);});
  },true);
  window.addEventListener('hashchange',function(){[0,50,150,400].forEach(function(ms){setTimeout(restore,ms);});},{passive:true});
  window.addEventListener('popstate',function(){[0,50,150,400].forEach(function(ms){setTimeout(restore,ms);});},{passive:true});
  [0,50,150,400,800].forEach(function(ms){setTimeout(restore,ms);});
})();
