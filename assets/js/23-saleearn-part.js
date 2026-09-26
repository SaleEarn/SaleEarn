
(function(){
  function fixScrollState(){
    try {
      var shell=document.querySelector('body.se-admin .admin-shell');
      var content=document.querySelector('body.se-admin .admin-content');
      if(!shell || !content) return;
      if(content.scrollHeight <= content.clientHeight + 2){
        content.scrollTop=0;
      } else if(content.scrollTop < 0){
        content.scrollTop=0;
      }
    } catch(e) {}
  }
  window.addEventListener('resize', function(){ requestAnimationFrame(fixScrollState); }, {passive:true});
  window.addEventListener('pageshow', function(){ requestAnimationFrame(fixScrollState); }, {passive:true});
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) requestAnimationFrame(fixScrollState); });
})();
