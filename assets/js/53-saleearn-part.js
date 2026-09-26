
(function(){
  setTimeout(function(){
    if(document.body.classList.contains('se-admin') && !document.body.classList.contains('se-admin-ready')){
      document.body.classList.add('se-admin-ready');
    }
  },3500);
})();
