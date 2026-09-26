
(function(){
  const escx=v=>typeof esc==='function'?esc(v):String(v??'');
  function userMoney(id,sid){return sid&&typeof sellerAvailableBalance==='function'?Math.max(0,Number(sellerAvailableBalance(sid)||0)):0}
  window.adminDeleteUser=function(id){
    if(!adminOnly())return;
    const u=(S.users||[]).find(x=>String(x.id)===String(id)); if(!u||u.isAdmin){toast('Admin account cannot be deleted');return;}
    const sid=u.sellerId||null, amount=userMoney(u.id,sid);
    window.__saleEarnDeleteUser=async function(){
      const now=nowISO(), productIds=new Set((S.products||[]).filter(p=>String(p.sellerId)===String(sid)).map(p=>String(p.id)));
      if(amount>0){
        S.adminCommissionAdjustments=S.adminCommissionAdjustments||[];S.adminFinancialLedger=S.adminFinancialLedger||[];
        const entry={id:uid('fin'),type:'USER_DELETE_BALANCE_TRANSFER',userId:u.id,sellerId:sid,amount,date:now,status:'POSTED',reason:'Remaining available seller balance transferred to platform commission'};
        S.adminCommissionAdjustments.unshift(entry);S.adminFinancialLedger.unshift({...entry,source:'USER_DELETION'});
      }
      const before={userId:u.id,sellerId:sid,amount,products:productIds.size};
      S.products=(S.products||[]).filter(p=>!productIds.has(String(p.id)));
      S.deletedProducts=(S.deletedProducts||[]).filter(p=>!productIds.has(String(p.id)));
      S.orders=(S.orders||[]).filter(x=>String(x.customerId)!==String(u.id)&&String(x.sellerId)!==String(sid));
      S.payouts=(S.payouts||[]).filter(x=>String(x.userId||'')!==String(u.id)&&String(x.sellerId||'')!==String(sid));
      S.subscriptions=(S.subscriptions||[]).filter(x=>String(x.userId||'')!==String(u.id)&&String(x.sellerId||'')!==String(sid));
      S.ads=(S.ads||[]).filter(x=>String(x.userId||'')!==String(u.id)&&String(x.sellerId||'')!==String(sid));
      S.referrals=(S.referrals||[]).filter(x=>String(x.userId||'')!==String(u.id)&&String(x.sellerId||'')!==String(sid)&&String(x.referrerId||'')!==String(u.id));
      S.warnings=(S.warnings||[]).filter(x=>String(x.userId||'')!==String(u.id)&&String(x.sellerId||'')!==String(sid));
      S.devices=(S.devices||[]).filter(x=>String(x.userId||'')!==String(u.id));
      S.balancePayments=(S.balancePayments||[]).filter(x=>String(x.userId||'')!==String(u.id)&&String(x.sellerId||'')!==String(sid));
      S.drafts=(S.drafts||[]).filter(x=>String(x.userId||'')!==String(u.id)&&String(x.sellerId||'')!==String(sid));
      S.productActivity=(S.productActivity||[]).filter(x=>String(x.userId||'')!==String(u.id)&&String(x.sellerId||'')!==String(sid)&&!productIds.has(String(x.productId||'')));
      S.notifications=(S.notifications||[]).filter(x=>String(x.userId||'')!==String(u.id)&&String(x.sellerId||'')!==String(sid));
      S.messages=(S.messages||[]).filter(x=>String(x.userId||'')!==String(u.id)&&String(x.senderId||'')!==String(u.id)&&String(x.receiverId||'')!==String(u.id));
      S.disputes=(S.disputes||[]).filter(x=>String(x.userId||'')!==String(u.id)&&String(x.sellerId||'')!==String(sid));
      S.refunds=(S.refunds||[]).filter(x=>String(x.userId||'')!==String(u.id)&&String(x.sellerId||'')!==String(sid));
      S.couponRedemptions=(S.couponRedemptions||[]).filter(x=>String(x.userId||'')!==String(u.id));
      if(S.cart&&Array.isArray(S.cart))S.cart=S.cart.filter(x=>String(x.userId||'')!==String(u.id));
      if(S.saved&&Array.isArray(S.saved))S.saved=S.saved.filter(x=>String(x.userId||'')!==String(u.id));
      if(S.library&&Array.isArray(S.library))S.library=S.library.filter(x=>String(x.userId||'')!==String(u.id));
      if(S.reviews&&typeof S.reviews==='object'){for(const pid of Object.keys(S.reviews)){if(productIds.has(String(pid))){delete S.reviews[pid];continue}if(Array.isArray(S.reviews[pid]))S.reviews[pid]=S.reviews[pid].filter(r=>String(r.userId||r.authorId||r.customerId||'')!==String(u.id));}}
      if(S.follows&&typeof S.follows==='object'&&!Array.isArray(S.follows)){delete S.follows[u.id];delete S.follows[sid];for(const k of Object.keys(S.follows)){if(Array.isArray(S.follows[k]))S.follows[k]=S.follows[k].filter(x=>String(x)!==String(u.id)&&String(x)!==String(sid));}}
      delete S.sellers[sid];
      S.users=S.users.filter(x=>String(x.id)!==String(u.id));
      logAdminAudit('Deleted user and transferred remaining balance',u.id,{sellerId:sid,amount,deleted:before});
      adminAudit('User deletion completed',u.id,{sellerId:sid,amount});
      save();
      let authDelete=false;
      try{if(window.supabaseClient?.rpc){const r=await supabaseClient.rpc('se_admin_delete_user',{target_user_id:u.authId||u.user_id||u.id});authDelete=!r.error;if(r.error)console.warn('Auth deletion RPC unavailable:',r.error.message);}}catch(e){console.warn('Auth deletion skipped:',e)}
      toast(authDelete?'User fully deleted and balance transferred to commission':'User data deleted and balance transferred; Auth account still needs the secure server-side delete RPC');
      render();
    };
    adminConfirm('Delete this user permanently?',`This removes the user's marketplace data, seller/store data, products, orders, payouts and related records. Remaining Available To Receive ${money(amount)} is posted to Admin Commission with a permanent financial audit record. This cannot be undone.`,'window.__saleEarnDeleteUser()','Delete User');
  };
  window.adminUsers=function(){
    const rows=(S.users||[]).filter(u=>u&&!u.isAdmin&&String(u.id||'').trim()&&String(u.email||'').trim());
    return adminLayout('users','Users & Sellers',`<div class="admin-card"><div class="section-head"><div><h2>All Users</h2><div class="sub">Restrict or permanently remove an account. Financial transfers are logged before deletion.</div></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>User</th><th>Email</th><th>Store</th><th>Orders</th><th>Available</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(u=>{const oo=S.orders.filter(x=>x.customerId===u.id),sid=u.sellerId,ss=sid?seller(sid):null,restricted=u.unpublicUntil&&u.unpublicUntil>Date.now(),amt=userMoney(u.id,sid);return `<tr class="data-row"><td onclick="adminNav('user/${escx(u.id)}')"><b>${escx(u.id)}</b><div>${escx(u.name)}</div></td><td>${escx(u.email)}</td><td>${ss?escx(ss.name):'-'}</td><td>${oo.length}</td><td>${money(amt)}</td><td><span class="admin-pill ${restricted?'danger':'success'}">${restricted?'Restricted':'Active'}</span></td><td><div class="admin-actions" onclick="event.stopPropagation()"><button class="btn ${restricted?'primary':''}" onclick="${restricted?`adminRelease('${escx(u.id)}')`:`adminRestrict('${escx(u.id)}')`}">${restricted?'Release':'Restrict'}</button><button class="btn danger" onclick="adminDeleteUser('${escx(u.id)}')">Delete User</button></div></td></tr>`}).join('')||`<tr><td colspan="7"><div class="admin-empty">No users found.</div></td></tr>`}</tbody></table></div></div>`);
  };
})();
