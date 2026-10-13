(function(){
  'use strict';
  if(window.__seMobileLongTextCollapse)return;
  window.__seMobileLongTextCollapse=true;

  function setupMobileLongText(){
    if(!window.matchMedia || !window.matchMedia('(max-width: 767px)').matches)return;
    const selectors=[
      'body .sub',
      '.dash-card > ul',
      '.admin-card > ul',
      '.account-panel > ul',
      '.warning-card > ul',
      '.detail-info > div:not(.detail-actions):not(.stats):not(.product-description-wrap)'
    ];
    document.querySelectorAll(selectors.join(',')).forEach(function(el){
      if(el.dataset.seMobileCollapseReady==='1')return;
      if(el.closest('button,label,nav,header,footer,.modal-footer,.product-tags,.se-tag-chips'))return;
      if(el.querySelector('input,select,textarea,button,video,audio,iframe,table'))return;
      const text=(el.textContent||'').replace(/\s+/g,' ').trim();
      const minimum=(el.matches('ul,ol')?180:165);
      if(text.length<minimum)return;
      el.dataset.seMobileCollapseReady='1';
      el.classList.add('se-mobile-collapsible');
      requestAnimationFrame(function(){
        if(el.scrollHeight<=el.clientHeight+3){
          el.classList.remove('se-mobile-collapsible');
          delete el.dataset.seMobileCollapseReady;
          return;
        }
        const btn=document.createElement('button');
        btn.type='button';
        btn.className='se-mobile-more-btn';
        btn.textContent='More ↓';
        btn.setAttribute('aria-expanded','false');
        btn.addEventListener('click',function(){
          const expanded=el.classList.toggle('is-expanded');
          btn.textContent=expanded?'Less ↑':'More ↓';
          btn.setAttribute('aria-expanded',expanded?'true':'false');
        });
        el.insertAdjacentElement('afterend',btn);
      });
    });
  }
  let scanTimer=0;
  function scheduleScan(delay){
    clearTimeout(scanTimer);
    scanTimer=setTimeout(function(){setupMobileLongText();},delay||120);
  }
  const oldRender=window.render;
  if(typeof oldRender==='function'){
    window.render=function(){
      const out=oldRender.apply(this,arguments);
      scheduleScan(120);
      return out;
    };
  }
  let lastMobile=window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
  window.addEventListener('resize',function(){
    const now=window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
    if(now!==lastMobile){ lastMobile=now; scheduleScan(160); }
  },{passive:true});
  scheduleScan(120);
})();
