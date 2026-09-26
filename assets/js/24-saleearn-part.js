
(function(){
  'use strict';
  if(window.__saleEarnUniversalLeftNavScrollLock)return;
  window.__saleEarnUniversalLeftNavScrollLock=true;

  const KEY='SE_LEFT_NAV_SCROLL_V72';
  const defaults={seller:0,admin:0,account:0};
  let state={...defaults};
  try{
    const saved=JSON.parse(sessionStorage.getItem(KEY)||'{}');
    state={...defaults,...saved};
  }catch(e){}

  function typeOf(el){
    if(!el)return null;
    if(el.matches('.dash-side'))return 'seller';
    if(el.matches('.admin-side'))return 'admin';
    if(el.matches('.account-layout>.account-nav'))return 'account';
    return null;
  }
  function get(type){
    if(type==='seller')return document.querySelector('.dash-side');
    if(type==='admin')return document.querySelector('.admin-side');
    if(type==='account')return document.querySelector('.account-layout>.account-nav');
    return null;
  }
  function save(){
    try{sessionStorage.setItem(KEY,JSON.stringify(state));}catch(e){}
  }
  function capture(el){
    const type=typeOf(el);
    if(!type)return;
    state[type]=Number(el.scrollTop||0);
    save();
  }
  function restore(type){
    const el=get(type);
    if(!el)return;
    const value=Math.max(0,Number(state[type]||0));
    el.scrollTop=value;
    /* Rendering can replace the sidebar a moment later, so restore again. */
    requestAnimationFrame(function(){
      const again=get(type);
      if(again)again.scrollTop=value;
    });
  }
  function restoreAll(){
    ['seller','admin','account'].forEach(function(type){
      if(get(type))restore(type);
    });
  }

  document.addEventListener('scroll',function(e){
    const el=e.target;
    if(el&&el.matches&&el.matches('.dash-side,.admin-side,.account-layout>.account-nav'))capture(el);
  },true);

  /* Capture BEFORE an inline onclick/go()/adminNav() can re-render the page. */
  document.addEventListener('pointerdown',function(e){
    const nav=e.target.closest?.('.dash-side,.admin-side,.account-layout>.account-nav');
    if(nav)capture(nav);
  },true);
  document.addEventListener('click',function(e){
    const nav=e.target.closest?.('.dash-side,.admin-side,.account-layout>.account-nav');
    if(!nav)return;
    const type=typeOf(nav);
    capture(nav);
    [0,16,50,120,250,500].forEach(function(ms){
      setTimeout(function(){restore(type);},ms);
    });
  },true);

  window.addEventListener('hashchange',function(){
    [0,16,50,120,250,500].forEach(function(ms){setTimeout(restoreAll,ms);});
  },{passive:true});
  window.addEventListener('popstate',function(){
    [0,16,50,120,250,500].forEach(function(ms){setTimeout(restoreAll,ms);});
  },{passive:true});

  /* Initial render: do not start any left menu at a different position. */
  [0,50,150,400].forEach(function(ms){setTimeout(restoreAll,ms);});
})();
