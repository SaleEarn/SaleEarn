/* FINAL USER COUNT FIX: Admin Dashboard Total Users must match the logged-in Users list. */
(function(){
  const loggedInUserCount=()=>new Set((S.users||[])
    .filter(u=>u&&!u.isAdmin&&String(u.email||'').trim()&&(u.hasLoggedIn===true))
    .map(u=>String(u.authId||u.id||u.userId||''))
    .filter(Boolean)).size;
  window.saleEarnAdminUserCount=loggedInUserCount;
})();
