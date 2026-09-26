
(function(){
  'use strict';
  function syncGamesSubcategories(){
    if(typeof route!=='function'||route()!=='market')return;
    const game=document.querySelector('[data-game-filter]');
    const sub=game?.nextElementSibling;
    if(!sub||!sub.classList.contains('subcats'))return;
    const show=window.marketCategory==='Games';
    sub.style.setProperty('display',show?'block':'none','important');
    sub.setAttribute('aria-hidden',show?'false':'true');
  }
  const previousRender=window.render;
  window.render=function(){
    previousRender();
    setTimeout(syncGamesSubcategories,0);
  };
  setTimeout(syncGamesSubcategories,0);
})();
