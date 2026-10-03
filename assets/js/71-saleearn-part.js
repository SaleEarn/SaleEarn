
/* Inlined from assets/js/70-saleearn-part.js */

(function(){
  'use strict';
  if(window.__warningReadAdminSyncV21)return;
  window.__warningReadAdminSyncV21=true;

  async function pushWarningReadToCloud(w){
    try{
      if(!w || !window.S || !S.currentUser)return;
      /* The app's shared online snapshot contains S.warnings. Save the exact
         updated warning, then flush the normal cloud writer so Admin receives
         the same READ state instead of a device-only copy. */
      if(typeof save==='function')save();
      if(typeof window.pushOnlineState==='function' && typeof ONLINE_READY!=='undefined' && ONLINE_READY){
        for(let i=0;i<8;i++){
          if(typeof ONLINE_LOCAL_DIRTY!=='undefined' && !ONLINE_LOCAL_DIRTY)break;
          try{await window.pushOnlineState();}catch(e){console.warn('Warning read cloud sync:',e)}
          if(typeof ONLINE_LOCAL_DIRTY!=='undefined' && !ONLINE_LOCAL_DIRTY)break;
          await new Promise(r=>setTimeout(r,120));
        }
      }
      /* Tell another open client to refresh its shared snapshot. */
      try{if(typeof broadcastInstantOnlineUpdate==='function')await broadcastInstantOnlineUpdate();}catch(e){}
    }catch(e){console.warn('Warning read sync failed:',e)}
  }

  const oldOpen=window.seOpenSellerWarning;
  if(typeof oldOpen==='function'){
    window.seOpenSellerWarning=async function(id){
      const sid=String((typeof currentSeller==='function'&&currentSeller()?.id)||S.currentUser?.sellerId||'');
      const w=(S.warnings||[]).find(x=>String(x?.id||'')===String(id||'')&&String(x?.sellerId||'')===sid);
      if(w && !w.read){
        w.read=true;
        w.readAt=nowISO();
        w.readBy=S.currentUser?.id||null;
        try{window.seRememberSellerWarningReadV20?.(w)}catch(e){}
        try{render()}catch(e){}
        /* Do not wait for the network before showing READ to the Seller. */
        pushWarningReadToCloud(w);
        return;
      }
      return oldOpen.apply(this,arguments);
    };
  }

  /* When Admin opens Warning Center, force one fresh shared-state read. This
     makes the Seller's READ state visible without requiring a full page reload. */
  const oldAdminNav=window.adminNav;
  if(typeof oldAdminNav==='function'){
    window.adminNav=function(page){
      const out=oldAdminNav.apply(this,arguments);
      if(String(page||'')==='warnings'){
        setTimeout(async()=>{
          try{
            /* pollOnlineState() already renders when the authoritative snapshot
               actually changes. Avoid an unconditional second render here;
               that second full-app repaint was causing visible mobile flicker. */
            if(typeof pollOnlineState==='function')await pollOnlineState(true);
          }catch(e){console.warn('Admin warning refresh:',e)}
        },120);
      }
      return out;
    };
  }

  /* If Admin is already sitting on Warning Center, refresh when the tab comes
     back into view so READ/UNREAD is kept in sync across devices. */
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible' && /^admin\/warnings\/?$/.test(String(route?.()||''))){
      setTimeout(async()=>{try{await pollOnlineState(true);}catch(e){}},80);
    }
  });
})();

