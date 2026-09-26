
(function(){
  'use strict';
  /* Final override is intentionally placed after legacy v31 wrappers. The old
     wrapper always called save() from markThreadRead(), even when nothing changed.
     Because markThreadRead() runs while rendering Messages, that created a
     render -> save -> sync -> render cycle and the global Saved/Pending status kept
     changing. This version only writes when a real read-state change occurred. */
  window.markThreadRead=function(t,role){
    if(!t?.id)return false;
    let changed=false;
    for(const m of threadMessages(t.id)){
      if(m.senderRole!==role&&!m.readAt){m.readAt=nowISO();changed=true;}
    }
    if(changed){
      for(const n of (S.notifications||[])){
        if(n?.entityId && (S.messages||[]).some(m=>String(m.id)===String(n.entityId)&&String(m.threadId)===String(t.id)) && !n.read){
          n.read=true;
          changed=true;
        }
      }
    }
    return changed;
  };
})();
