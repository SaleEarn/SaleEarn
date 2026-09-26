
(function(){
  try{
    sessionStorage.removeItem('SE_SCROLL_STATE_V2');
    sessionStorage.removeItem('SE_ROUTE_VIEW_STATE_V2');
    sessionStorage.removeItem('SE_ADMIN_SIDE_SCROLL');
    sessionStorage.removeItem('SE_ADMIN_CONTENT_SCROLL');
    /* Keep sidebar position across admin navigation. */
  }catch(e){}
})();
