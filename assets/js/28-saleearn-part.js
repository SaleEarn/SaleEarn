
/* ===== FINAL SELLER DASHBOARD MONEY SAFETY GUARD =====
   Keep the seller money cards visible and tied to the canonical ledger.
   This is intentionally the final script so later feature patches cannot
   replace the money calculation with an older/empty value. */
(function(){
  try{
    const moneyNum=n=>Math.round((Number(n)||0)*100)/100;
    const sellerMoneyLedger=function(sid){
      try{
        if(typeof window.sellerLedger==='function') return window.sellerLedger(String(sid));
      }catch(e){ console.warn('sellerLedger read failed',e); }
      return {gross:0,earned:0,available:0,paid:0,pending:0,sales:0,deficit:0,orders:[]};
    };
    window.dashOverview=function(){
      const sellerObj=typeof currentSeller==='function'?currentSeller():null;
      const sid=sellerObj?.id;
      if(!sid){ return typeof dashShell==='function' ? dashShell('overview','<div class="dash-card"><div class="admin-empty">Seller account not found.</div></div>') : ''; }
      const L=sellerMoneyLedger(sid);
      const orders=Array.isArray(L.orders)?L.orders:[];
      const days=[...Array(7)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return d;});
      const vals=days.map(d=>orders.filter(o=>new Date(o?.date||0).toDateString()===d.toDateString()).reduce((a,o)=>a+Number(o?.amount||0),0));
      const max=Math.max(1,...vals);
      return dashShell('overview',`
        <div class="metric-grid">
          <div class="metric"><div class="metric-top"><span>₹</span><span class="metric-label total">Total</span></div><h2>${money(L.gross)}</h2><div>Gross product sales before platform fee</div></div>
          <div class="metric orange"><div class="metric-top"><span>◷</span><span class="metric-label receive">To Receive</span></div><h2>${money(L.available)}</h2><div>Net seller balance available for payout</div></div>
          <div class="metric green"><div class="metric-top"><span>✓</span><span class="metric-label received">Received</span></div><h2>${money(L.paid)}</h2><div>All payouts recorded as paid/received</div></div>
          <div class="metric pink"><div class="metric-top"><span>▣</span><span class="metric-label sales">Sales</span></div><h2>${Number(L.sales||0)}</h2><div>Successful orders</div></div>
        </div>
        ${L.deficit>0?`<div class="warning-card"><b>⚠ Money review required</b><div class="small" style="margin-top:5px">Paid, pending or spent money is ${money(L.deficit)} more than seller earnings. Payouts are blocked until Admin reviews the ledger.</div></div>`:''}
        <div class="dash-card"><div class="section-head"><div><h3>Last 7 days Sales</h3><p>Live from the same canonical seller ledger.</p></div><button class="btn" onclick="go('dashboard/orders')">Analysis →</button></div>
          <div class="chart">${vals.map((v,i)=>`<div class="bar-wrap"><b class="small">${v?money(v):''}</b><div class="bar" style="height:${Math.max(3,v/max*155)}px"></div><div class="bar-label">${days[i].toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit'})}</div></div>`).join('')}</div>
        </div>
        <div class="dash-card"><h3>⚡ Power Actions</h3><div class="power-grid">
          <button class="power" onclick="startNewProduct()"><span class="picon">＋</span><span><b>New Asset</b><small class="muted">List a digital product</small></span></button>
          <button class="power" onclick="go('dashboard/settings')"><span class="picon">♙</span><span><b>Store Profile</b><small class="muted">Update identity & store</small></span></button>
          <button class="power" onclick="go('dashboard/subscription')"><span class="picon">♕</span><span><b>Subscriptions</b><small class="muted">Change listing plans</small></span></button>
        </div></div>`);
    };
  }catch(e){ console.error('Final seller dashboard money guard failed',e); }
})();
