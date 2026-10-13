(function(){
  'use strict';
  if(window.__sellerWarningReadPersistV20)return;
  window.__sellerWarningReadPersistV20=true;
  const KEY='SE_SELLER_READ_WARNINGS_V20';
  function readMap(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch(e){return {};}}
  function writeMap(m){try{localStorage.setItem(KEY,JSON.stringify(m));}catch(e){}}
  function sellerId(){try{return String((typeof currentSeller==='function'&&currentSeller()?.id)||(S.currentUser?.sellerId)||'');}catch(e){return '';}}
  function apply(){
    try{
      const sid=sellerId(); if(!sid||typeof S==='undefined')return;
      const map=readMap(), ids=map[sid]||{};
      (S.warnings||[]).forEach(w=>{
        if(w && ids[String(w.id)]){w.read=true;w.readAt=w.readAt||ids[String(w.id)].readAt||nowISO();w.readBy=w.readBy||ids[String(w.id)].readBy||S.currentUser?.id||null;}
      });
    }catch(e){}
  }
  window.seRememberSellerWarningReadV20=function(w){
    if(!w?.id)return;
    const sid=String(w.sellerId||sellerId()||''); if(!sid)return;
    const map=readMap(); map[sid]=map[sid]||{};
    map[sid][String(w.id)]={readAt:w.readAt||nowISO(),readBy:w.readBy||S.currentUser?.id||null};
    writeMap(map);
  };
  window.seApplySellerWarningReadV20=apply;
  apply();
  /* Re-apply after any render/cloud hydration so a temporary remote snapshot
     cannot turn an already-read warning back into UNREAD on this device. */
  const oldRender=window.render;
  if(typeof oldRender==='function'&&!window.__sellerWarningRenderWrappedV20){
    window.__sellerWarningRenderWrappedV20=true;
    window.render=function(){apply();return oldRender.apply(this,arguments);};
  }
  const oldOpen=window.seOpenSellerWarning;
  if(typeof oldOpen==='function'&&!window.__sellerWarningOpenWrappedV20){
    window.__sellerWarningOpenWrappedV20=true;
    window.seOpenSellerWarning=function(id){
      const w=(S.warnings||[]).find(x=>String(x?.id||'')===String(id||'')&&String(x?.sellerId||'')===sellerId());
      if(w&&!w.read){w.read=true;w.readAt=nowISO();w.readBy=S.currentUser?.id||null;window.seRememberSellerWarningReadV20(w);try{save();}catch(e){}}
      const result=oldOpen.apply(this,arguments);
      apply();
      return result;
    };
  }
})();
