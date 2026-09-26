
/* Sale Earn V42: only two focused fixes.
   1) A newly opened route starts at the top. Re-renders/state updates do NOT
      force the page back to the top because this runs only on navigation.
   2) Clicking a seller warning marks that warning READ and persists the same
      warning object so the Admin warning list shows READ as well. */
(function(){
  if(window.__saleEarnV42WarningReadScrollFix)return;
  window.__saleEarnV42WarningReadScrollFix=true;

  /* Keep only the left navigation's own scroll position across route changes.
     The main page/content still starts at the top on a new route as before. */
  let seV42LeftNavScroll=0;
  let seV42LeftNavKey='';
  function seV42CaptureLeftNav(){
    try{
      const el=document.querySelector('.dash-side,.admin-side');
      if(!el)return;
      seV42LeftNavScroll=Number(el.scrollTop||0);
      seV42LeftNavKey=el.classList.contains('admin-side')?'admin':'seller';
    }catch(e){}
  }
  function seV42RestoreLeftNav(){
    try{
      const el=document.querySelector(seV42LeftNavKey==='admin'?'.admin-side':'.dash-side');
      if(!el)return;
      el.scrollTop=seV42LeftNavScroll;
    }catch(e){}
  }
  document.addEventListener('scroll',function(e){
    const el=e.target;
    if(el&&el.matches&&el.matches('.dash-side,.admin-side')){
      seV42LeftNavScroll=Number(el.scrollTop||0);
      seV42LeftNavKey=el.classList.contains('admin-side')?'admin':'seller';
    }
  },true);
  function seV42Top(){
    try{ window.scrollTo({top:0,left:0,behavior:'auto'}); }catch(e){ window.scrollTo(0,0); }
    try{
      document.querySelectorAll('.dash-content,.admin-content').forEach(function(el){
        if(el && el.scrollTop) el.scrollTop=0;
        if(el && el.scrollLeft) el.scrollLeft=0;
      });
    }catch(e){}
    requestAnimationFrame(seV42RestoreLeftNav);
  }

  /* Route navigation only. Do not attach this to render(), so normal state,
     realtime, API and UI updates never override the user's manual position. */
  if(typeof go==='function' && !window.__saleEarnV42GoWrapped){
    window.__saleEarnV42GoWrapped=true;
    const seV42Go=go;
    go=function(route){
      const before=routeNow();
      seV42CaptureLeftNav();
      const result=seV42Go.apply(this,arguments);
      if(String(before)!==String(routeNow())) requestAnimationFrame(seV42Top);
      return result;
    };
  }
  window.addEventListener('popstate',function(){requestAnimationFrame(seV42Top)},{passive:true});
  window.addEventListener('hashchange',function(){requestAnimationFrame(seV42Top)},{passive:true});

  /* Seller warning click target used by the existing warning cards. */
  window.seOpenSellerWarning=function(id){
    const w=(S.warnings||[]).find(function(x){return String(x?.id||'')===String(id||'') && String(x?.sellerId||'')===String(currentSeller()?.id||'');});
    if(!w)return;
    if(!w.read){
      w.read=true;
      w.readAt=nowISO();
      w.readBy=S.currentUser?.id||null;
      /* save() keeps the authoritative shared warning snapshot in sync; the
         existing warning sync remains untouched so no unrelated data changes. */
      save();
    }
    render();
  };

  /* Admin-side click target: opening an already-visible warning should keep
     the same READ state. If an unread warning is opened by Admin, it is also
     marked read so both sides stay consistent. */
  window.seAdminOpenWarning=function(id){
    if(typeof adminOnly==='function'&&!adminOnly())return;
    const w=(S.warnings||[]).find(function(x){return String(x?.id||'')===String(id||'');});
    if(!w)return;
    if(!w.read){w.read=true;w.readAt=nowISO();w.readBy=S.currentUser?.id||null;save();}
    render();
  };
})();
