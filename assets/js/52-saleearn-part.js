
(function(){
  'use strict';
  if(window.__seAdminModerationGuardV2)return; window.__seAdminModerationGuardV2=true;
  const legacy=window.studioModerate;
  window.studioModerate=async function(id,action){
    if(typeof adminOnly==='function'&&!adminOnly())return;
    const pid=String(id||'');
    if((action==='approve'||action==='reject'||action==='pending')&&typeof window.adminProductCheckAction==='function')return window.adminProductCheckAction(pid,action);
    if(typeof legacy==='function')return legacy.apply(this,arguments);
  };
})();
