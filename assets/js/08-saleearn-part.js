
/* SaleEarn Admin User Delete Control */
(function(){
  function addAdminDeleteTools(){
    const areas = document.querySelectorAll('.admin-card,.admin-table-wrap,.admin-content,.admin-main');
    areas.forEach(area=>{
      if(area.querySelector('.se-delete-user-tool')) return;
      const box=document.createElement('div');
      box.className='se-delete-user-tool';
      box.style.cssText='margin-top:16px;padding:14px;border-radius:14px;background:#fff;border:1px solid #eee;';
      box.innerHTML=`
        <b>Danger Zone - User Account</b>
        <p style="margin:8px 0;color:#666">Admin can permanently delete a user account after confirmation.</p>
        <input id="seDeleteUserId" placeholder="Enter User ID" style="padding:10px;width:100%;border-radius:8px;border:1px solid #ddd">
        <button id="seDeleteUserBtn" style="margin-top:10px;padding:10px 16px;border:0;border-radius:8px;background:#dc2626;color:white;cursor:pointer">
        Delete User
        </button>`;
      area.appendChild(box);
    });
    const btn=document.getElementById('seDeleteUserBtn');
    if(btn && !btn.dataset.ready){
      btn.dataset.ready="1";
      btn.onclick=async()=>{
        const id=document.getElementById('seDeleteUserId').value.trim();
        if(!id) return alert('User ID required');
        if(!confirm('Are you sure? User data will be permanently deleted.')) return;
        alert('Delete request prepared. Connect this button with delete-account Edge Function.');
      };
    }
  }
  setTimeout(addAdminDeleteTools,1500);
})();
