
(function(){
  'use strict';

  /* =========================================================
     SALE EARN v7 — CANONICAL MONEY ENGINE
     One formula is used by seller dashboard, payouts and admin.
     ========================================================= */

  const V7_PAID = ["APPROVED","PAID","SUCCESS","RECEIVED"];
  const v7Upper = x => String(x?.status||"PENDING").trim().toUpperCase();
  const v7Money = n => Math.round((Number(n)||0)*100)/100;
  const v7Num = n => { const v=Number(n); return Number.isFinite(v)?v:0; };

  function v7FinanceSum(sid,type){
    return (S.sellerFinanceLedger||[])
      .filter(x=>String(x?.sellerId||"")===String(sid) && String(x?.type||"")===type && !x?.voided)
      .reduce((a,x)=>a+v7Num(x.amount),0);
  }

  function v7PayoutPaid(x){
    return V7_PAID.includes(v7Upper(x));
  }

  function v7PayoutPending(x){
    return ["PENDING","UNDER REVIEW","ON HOLD","PROCESSING"].includes(v7Upper(x));
  }

  function v7OrderNet(o){
    if(o?.netSellerAmount!==undefined && o?.netSellerAmount!==null && o?.netSellerAmount!==""){
      return Math.max(0,v7Num(o.netSellerAmount));
    }
    const gross=v7Num(o?.amount);
    const rate=Math.min(.99,Math.max(0,v7Num(o?.platformFeeRate??.20)));
    return v7Money(gross*(1-rate));
  }

  /* Single source of truth. */
  window.sellerLedger=function(sid){
    const orders=(S.orders||[]).filter(o =>
      o && String(o.sellerId)===String(sid) &&
      v7Upper(o)==="SUCCESS" &&
      o.paymentVerified!==false
    );

    const gross=v7Money(orders.reduce((a,o)=>a+v7Num(o.amount),0));
    const orderEarned=v7Money(orders.reduce((a,o)=>a+v7OrderNet(o),0));

    /* Admin adjustments:
       TOTAL       = seller earnings adjustment
       TO_RECEIVE  = direct available-balance adjustment
       RECEIVED    = received/payout-history adjustment
    */
    const earningsAdj=v7Money(v7FinanceSum(sid,"TOTAL"));
    const availableAdj=v7Money(v7FinanceSum(sid,"TO_RECEIVE"));
    const receivedAdj=v7Money(v7FinanceSum(sid,"RECEIVED"));

    const earned=v7Money(orderEarned+earningsAdj);

    const payouts=(S.payouts||[]).filter(x=>x&&String(x.sellerId)===String(sid));
    const paid=v7Money(
      payouts.filter(v9PayoutPaid).reduce((a,x)=>a+v7Num(x.amount),0)+receivedAdj
    );
    const pending=v7Money(
      payouts.filter(v9PayoutPending).reduce((a,x)=>a+v7Num(x.amount),0)
    );

    const balanceSpent=v7Money(
      (S.balancePayments||[])
      .filter(x=>String(x?.sellerId||"")===String(sid)
        && String(x?.source||"").toUpperCase()==="BALANCE"
        && String(x?.status||"").toUpperCase()==="SUCCESS"
        && x?.paymentVerified!==false)
      .reduce((a,x)=>a+v7Num(x.amount),0)
    );

    const legacyAds=v7Money(
      (S.ads||[])
      .filter(x=>String(x?.sellerId||"")===String(sid)
        && !x?.paymentSource
        && String(x?.status||"").toUpperCase()!=="CANCELLED")
      .reduce((a,x)=>a+v7Num(x.cost),0)
    );

    const legacySubs=v7Money(
      (S.subscriptions||[])
      .filter(x=>String(x?.sellerId||"")===String(sid)
        && !x?.paymentSource)
      .reduce((a,x)=>a+v7Num(x.amount),0)
    );

    const spent=v7Money(balanceSpent+legacyAds+legacySubs);
    const raw=v7Money(earned-paid-pending-spent+availableAdj);

    return {
      sid:String(sid||""),
      orders,
      sales:orders.length,
      gross,
      fee:v7Money(gross-orderEarned),
      earningsAdj,
      availableAdj,
      receivedAdj,
      earned,
      paid,
      pending,
      spent,
      raw,
      available:Math.max(0,raw),
      deficit:raw<0?v7Money(-raw):0
    };
  };

  window.sellerEarnings=function(sid){ return window.sellerLedger(sid).earned; };
  window.sellerAvailableBalance=function(sid){ return window.sellerLedger(sid).available; };

  /* Keep overview and payout page numerically identical. */
  const v7OriginalDashOverview=window.dashOverview;
  window.dashOverview=function(){
    const sid=currentSeller()?.id;
    if(!sid) return v7OriginalDashOverview();
    const L=sellerLedger(sid);
    const days=[...Array(7)].map((_,i)=>{
      const d=new Date(); d.setDate(d.getDate()-(6-i)); return d;
    });
    const vals=days.map(d=>L.orders
      .filter(o=>new Date(o.date||0).toDateString()===d.toDateString())
      .reduce((a,o)=>a+v7Num(o.amount),0)
    );
    const max=Math.max(1,...vals);
    return dashShell("overview",
      `<div class="metric-grid">
        <div class="metric"><div class="metric-top"><span>₹</span><span class="metric-label total">Total</span></div>
          <h2>${money(L.gross)}</h2><div>Gross product sales before platform fee</div></div>
        <div class="metric orange"><div class="metric-top"><span>◷</span><span class="metric-label receive">To Receive</span></div>
          <h2>${money(L.available)}</h2><div>Net seller balance available for payout</div></div>
        <div class="metric green"><div class="metric-top"><span>✓</span><span class="metric-label received">Received</span></div>
          <h2>${money(L.paid)}</h2><div>All payouts recorded as paid/received</div></div>
        <div class="metric pink"><div class="metric-top"><span>▣</span><span class="metric-label sales">Sales</span></div>
          <h2>${L.sales}</h2><div>Successful orders</div></div>
      </div>
      ${L.deficit>0?`<div class="warning-card"><b>⚠ Money review required</b><div class="small" style="margin-top:5px">Paid, pending or spent money is ${money(L.deficit)} more than seller earnings. Payouts are blocked until Admin reviews the ledger.</div></div>`:""}
      <div class="dash-card"><div class="section-head"><div><h3>Last 7 days Sales</h3><p>Live from the same canonical seller ledger.</p></div><button class="btn" onclick="go('dashboard/orders')">Analysis →</button></div>
        <div class="chart">${vals.map((v,i)=>`<div class="bar-wrap"><b class="small">${v?money(v):""}</b><div class="bar" style="height:${Math.max(3,v/max*155)}px"></div><div class="bar-label">${days[i].toLocaleDateString("en-IN",{day:"2-digit",month:"2-digit"})}</div></div>`).join("")}</div>
      </div>
      <div class="dash-card"><h3>⚡ Power Actions</h3><div class="power-grid">
        <button class="power" onclick="startNewProduct()"><span class="picon">＋</span><span><b>New Asset</b><small class="muted">List a digital product</small></span></button>
        <button class="power" onclick="go('dashboard/settings')"><span class="picon">♙</span><span><b>Store Profile</b><small class="muted">Update identity & store</small></span></button>
        <button class="power" onclick="go('dashboard/subscription')"><span class="picon">♕</span><span><b>Subscriptions</b><small class="muted">Change listing plans</small></span></button>
      </div></div>`
    );
  };

  const v7OriginalDashPayouts=window.dashPayouts;
  window.dashPayouts=function(){
    const sid=currentSeller()?.id;
    if(!sid) return v7OriginalDashPayouts();
    const L=sellerLedger(sid);
    const minPayout=Math.max(30,Number(advState().payoutMin||30));
    const maxPayout=Number(advState().payoutMax||0);
    return dashShell("payouts",
      `<div class="dash-card" style="background:#111a2d;color:#fff">
        <div style="display:flex;justify-content:space-between"><h3>Your Earnings Overview</h3><span class="pill" style="background:#143d3a;color:#1ac18a">Secure Wallet</span></div>
        <div class="metric-grid" style="margin-top:20px">
          <div class="metric" style="background:#1d293c;color:#fff;border:0"><span class="metric-label total">Lifetime Earnings</span><h2 style="color:#69a8ff">${money(L.earned)}</h2></div>
          <div class="metric" style="background:#1d293c;color:#fff;border:0"><span class="metric-label receive">Available To Receive</span><h2 style="color:#ffb31a">${money(L.available)}</h2></div>
          <div class="metric" style="background:#1d293c;color:#fff;border:0"><span class="metric-label received">Already Received</span><h2 style="color:#6be0ae">${money(L.paid)}</h2></div>
        </div>
      </div>
      ${L.deficit>0?`<div class="warning-card"><b>⚠ Payout temporarily blocked</b><div class="small" style="margin-top:5px">Your ledger has a ${money(L.deficit)} shortfall. Admin must review it before another payout can be paid.</div></div>`:""}
      <div class="dash-card"><h3>Request Payout</h3>
        <p class="small muted">Available To Receive: <b>${money(L.available)}</b> · Minimum: ${money(minPayout)}${maxPayout?` · Maximum: ${money(maxPayout)}`:""}</p>
        <div class="field"><label>Amount (${S.settings.currency})</label><input id="poAmt" type="number" min="${minPayout}" ${maxPayout?`max="${maxPayout}"`:""} placeholder="Minimum payout ${money(minPayout)}"></div>
        <div class="field"><label>Payout UPI ID</label><input id="poUpi" value="${esc(currentSeller().upi||"")}" placeholder="yourname@upi"></div>
        <div class="field"><label>Note to Admin (Optional)</label><input id="poNote" maxlength="50" placeholder="e.g. Urgent payout"></div>
        <button class="btn primary" style="width:100%" ${L.deficit>0?'disabled':''} onclick="requestPayout()">₹ Request Payout</button>
        <div class="small muted" style="text-align:center;margin-top:10px">Payout will be received within 24 hours after admin approval.</div>
      </div>
      <div class="dash-card" style="padding:0;overflow:hidden"><h3 style="padding:18px;margin:0">Payout Requests</h3><div class="se-scroll-panel"><table class="dash-table"><thead><tr><th>Requested</th><th>Approved / Paid</th><th>Status</th><th>Date</th><th>Note</th></tr></thead><tbody>
        ${[...(S.payouts||[])].filter(x=>String(x.sellerId)===String(sid)).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).map(x=>`<tr><td>${money(x.amount)}</td><td>${V7_PAID.includes(v7Upper(x))?money(x.amount):"—"}</td><td><span class="status ${v7Upper(x)==="CANCELLED"?'cancelled':(['PENDING','PROCESSING','UNDER REVIEW','ON HOLD'].includes(v7Upper(x))?'pending':'success')}">${esc(x.status||'PENDING')}</span></td><td>${x.date?new Date(x.date).toLocaleString('en-IN'):'-'}</td><td>${esc(x.note||"")}${x.utr?`<div class="small muted">Ref: ${esc(x.utr)}</div>`:""}${x.cancelReason?`<div class="small muted">Reason: ${esc(x.cancelReason)}</div>`:""}</td></tr>`).join("")||`<tr><td colspan="5">No payout requests yet.</td></tr>`}</tbody></table></div></div>`
    );
  };

  /* Admin money overview uses exactly the same ledger. */
  window.adminMoneyOverview=function(){
    const rows=Object.values(S.sellers||{}).map(ss=>({id:ss.id,name:ss.name||ss.owner||ss.id,l:sellerLedger(ss.id)}));
    const total=k=>v7Money(rows.reduce((a,x)=>a+x.l[k],0));
    const bad=rows.filter(x=>x.l.deficit>0).length;
    return adminLayout('money','Admin Money Overview',
      `<div class="admin-kpis">
        <div class="admin-kpi"><span>All Users To Receive</span><b>${money(total('available'))}</b></div>
        <div class="admin-kpi"><span>All Users Received</span><b>${money(total('paid'))}</b></div>
        <div class="admin-kpi"><span>Seller Net Earnings</span><b>${money(total('earned'))}</b></div>
        <div class="admin-kpi"><span>Ledger problems</span><b style="color:${bad?'#ef5b67':'#17b77d'}">${bad||'None'}</b></div>
      </div>
      <div class="admin-card"><div class="section-head"><div><h2>Seller-wise Money</h2><div class="sub">Same ledger used by Seller Overview and Payouts.</div></div></div>
      <div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>Seller</th><th>Sales</th><th>To Receive</th><th>Pending</th><th>Received</th><th>Net Earnings</th><th>Check</th></tr></thead><tbody>
      ${rows.map(x=>`<tr class="data-row" onclick="adminNav('seller/${esc(x.id)}')"><td><b>@${esc(x.id)}</b><div>${esc(x.name)}</div></td><td>${x.l.sales}</td><td>${money(x.l.available)}</td><td>${money(x.l.pending)}</td><td>${money(x.l.paid)}</td><td>${money(x.l.earned)}</td><td>${x.l.deficit>0?`<span class="admin-pill danger">Short ${money(x.l.deficit)}</span>`:'<span class="admin-pill success">OK</span>'}</td></tr>`).join("")||'<tr><td colspan="7"><div class="admin-empty">No seller data.</div></td></tr>'}
      </tbody></table></div></div>`
    );
  };

  /* Admin order correction: amount/status changes also repair the seller-net fields. */
  window.adminSaveSellerOrder=function(orderId){
    if(!adminOnly())return;
    const o=(S.orders||[]).find(x=>String(x.id)===String(orderId));
    if(!o)return toast('Order not found');
    const status=String(document.getElementById('aseOrderStatus')?.value||'').toUpperCase();
    const amount=v7Money(document.getElementById('aseOrderAmount')?.value);
    const reason=(document.getElementById('aseOrderReason')?.value||'').trim();
    if(!['SUCCESS','PENDING','CANCELLED','FAILED'].includes(status)||!Number.isFinite(amount)||amount<0||!reason){
      return toast('Status, valid amount and reason are required');
    }
    const before={status:o.status,amount:v7Num(o.amount),netSellerAmount:o.netSellerAmount,platformFeeRate:o.platformFeeRate};
    o.status=status;
    o.amount=amount;
    o.adminEditedAt=nowISO();
    o.adminEditedBy=S.currentUser?.id||'ADMIN';
    o.adminEditReason=reason;

    if(status==='SUCCESS'){
      const rate=Math.min(.99,Math.max(0,v7Num(o.platformFeeRate??effectivePlatformFeeRate(o.sellerId,o.date||nowISO()))));
      o.platformFeeRate=rate;
      o.platformFee=v7Money(amount*rate);
      o.netSellerAmount=v7Money(amount-o.platformFee);
      o.paymentVerified=true;
    }else{
      o.platformFee=v7Money(amount*v7Num(o.platformFeeRate??.20));
      o.netSellerAmount=v7Money(amount-o.platformFee);
      o.paymentVerified=false;
    }

    logAdminAudit('Edited seller order',o.id,{
      sellerId:o.sellerId,before,
      after:{status:o.status,amount:o.amount,netSellerAmount:o.netSellerAmount,platformFeeRate:o.platformFeeRate},
      reason
    });
    logProductActivity(o.productId,'Admin edited order',{
      sellerId:o.sellerId,orderId:o.id,reason,status,amount:o.amount,netSellerAmount:o.netSellerAmount
    });
    adminSellerNotice(o.sellerId,'Order updated by Admin',
      `Order ${o.id} was updated by Admin. New status: ${status}. Amount: ${money(o.amount)}. Seller net: ${money(o.netSellerAmount)}. Reason: ${reason}`,
      'message'
    );
    closeModal();save();toast('Order updated safely');render();
  };

  /* Money adjustment is append-only and has explicit validation. */
  window.adminApplySellerMoney=function(uid,sid){
    if(!adminOnly())return;
    const type=document.getElementById('aseMoneyType')?.value;
    const amount=v7Money(document.getElementById('aseMoneyAmount')?.value);
    const reason=(document.getElementById('aseMoneyReason')?.value||'').trim();
    if(!uid||!sid||!['TO_RECEIVE','TOTAL','RECEIVED'].includes(type)||!Number.isFinite(amount)||amount===0||reason.length<3){
      return toast('Enter a non-zero amount and a clear reason');
    }
    const L=sellerLedger(sid);
    if(type==='RECEIVED' && amount<0 && Math.abs(amount)>L.paid){
      return toast('Cannot deduct more Received money than recorded');
    }
    if(type==='TO_RECEIVE' && amount<0 && Math.abs(amount)>L.available){
      return toast('Cannot deduct more than current Available To Receive');
    }
    if(type==='TOTAL' && amount<0 && Math.abs(amount)>L.earned){
      return toast('Cannot deduct more than current Net Earnings');
    }
    S.sellerFinanceLedger=Array.isArray(S.sellerFinanceLedger)?S.sellerFinanceLedger:[];
    S.sellerFinanceLedger.unshift({
      id:uidFn(),sellerId:sid,userId:uid,type,
      amount,date:nowISO(),adminId:S.currentUser.id,note:reason,
      source:'ADMIN_ADJUSTMENT',voided:false
    });
    logAdminAudit('Seller money adjustment',sid,{type,amount,reason});
    adminSellerNotice(sid,'Money adjustment by Admin',
      `Admin ${amount>0?'added':'deducted'} ${money(Math.abs(amount))} in ${type.replace('_',' ')}. Reason: ${reason}`,
      'message'
    );
    save();toast('Seller money updated safely');render();
  };

  /* Seller IDs / User IDs are identity keys, not editable finance fields.
     This prevents an Admin profile edit from orphaning orders/payouts. */
  const v7ProfileEditor=window.adminProfileEditor;
  if(v7ProfileEditor){
    window.adminProfileEditor=function(u,ss){
      let h=v7ProfileEditor(u,ss);
      h=h.replace(
        /<div class="field"><label>User ID<\/label><input id="seAdminUserId"([^>]*)>/,
        '<div class="field"><label>User ID <span class="small muted">(locked)</span></label><input id="seAdminUserId"$1 readonly disabled>'
      );
      h=h.replace(
        /<div class="field"><label>Seller ID<\/label><input id="seAdminSellerId"([^>]*)>/,
        '<div class="field"><label>Seller ID <span class="small muted">(locked)</span></label><input id="seAdminSellerId"$1 readonly disabled>'
      );
      h=h.replace(
        'Changing User ID or Seller ID updates the connected products, orders, payouts and seller records automatically. Use full URLs beginning with http:// or https://.',
        'User ID and Seller ID are locked because they are financial identity keys. Admin can safely edit the name, email, store details and public links. Use full URLs beginning with http:// or https://.'
      );
      return h;
    };
  }

  /* Hard-stop identity changes even if an old browser has the fields enabled. */
  const v7OldSaveProfile=window.adminSaveUserProfile;
  if(v7OldSaveProfile){
    window.adminSaveUserProfile=function(oldUserId){
      const u=(S.users||[]).find(x=>String(x.id)===String(oldUserId));
      if(!u)return toast('User not found');
      const currentUid=String(u.id);
      const currentSid=String(u.sellerId||'');
      const typedUid=String(document.getElementById('seAdminUserId')?.value||currentUid);
      const typedSid=String(document.getElementById('seAdminSellerId')?.value||currentSid);
      if(typedUid!==currentUid||typedSid!==currentSid){
        return toast('User ID / Seller ID are locked. Edit profile details without changing identity keys.');
      }
      return v7OldSaveProfile(oldUserId);
    };
  }

  /* Replace seller-control KPI calculations with canonical ledger values. */
  const v7OldSellerControl=window.adminSellerControlPanel;
  if(v7OldSellerControl){
    window.adminSellerControlPanel=function(sid){
      let h=v7OldSellerControl(sid);
      const L=sellerLedger(sid);
      const doc=document.createElement('template');doc.innerHTML=h;
      const card=doc.content.querySelector('.admin-seller-control-card');
      if(card){
        const kpis=card.querySelectorAll('.admin-seller-control-grid .admin-kpi');
        if(kpis[0]) kpis[0].querySelector('b')?.replaceChildren(document.createTextNode(money(L.gross)));
        if(kpis[2]) kpis[2].querySelector('b')?.replaceChildren(document.createTextNode(money(L.available)));
        if(kpis[3]) kpis[3].querySelector('b')?.replaceChildren(document.createTextNode(money(L.paid)));
        const sub=card.querySelector('.section-head .small.muted');
        if(sub) sub.textContent='Canonical ledger. Every money edit requires a reason and is recorded in Admin Audit Log.';
      }
      return doc.innerHTML;
    };
  }

  /* Admin payout payment remains blocked on a real ledger shortfall. */
  const v7OldConfirmPaid=window.adminConfirmPayoutPaid;
  if(v7OldConfirmPaid){
    window.adminConfirmPayoutPaid=function(id){
      const p=(S.payouts||[]).find(x=>String(x.id)===String(id));
      if(p){
        const L=sellerLedger(p.sellerId);
        if(L.deficit>0)return toast('Blocked: seller ledger is short by '+money(L.deficit));
      }
      return v7OldConfirmPaid(id);
    };
  }

  /* One-time UI note so Admin knows exactly what the numbers mean. */
  const v7OldAdminUserDetail=window.adminUserDetail;
  if(v7OldAdminUserDetail){
    window.adminUserDetail=function(id){
      let h=v7OldAdminUserDetail(id);
      /* Lock identity keys in the rendered admin editor too. */
      h=h.replace(
        /<div class="field"><label>User ID<\/label><input id="seAdminUserId"([^>]*)>/,
        '<div class="field"><label>User ID <span class="small muted">(locked)</span><\/label><input id="seAdminUserId"$1 readonly disabled>'
      );
      h=h.replace(
        /<div class="field"><label>Seller ID<\/label><input id="seAdminSellerId"([^>]*)>/,
        '<div class="field"><label>Seller ID <span class="small muted">(locked)</span><\/label><input id="seAdminSellerId"$1 readonly disabled>'
      );
      h=h.replace(
        'Changing User ID or Seller ID updates the connected products, orders, payouts and seller records automatically. Use full URLs beginning with http:// or https://.',
        'User ID and Seller ID are locked because they are financial identity keys. Admin can safely edit the name, email, store details and public links. Use full URLs beginning with http:// or https://.'
      );
      const u=(S.users||[]).find(x=>String(x.id)===String(id));
      const sid=u?.sellerId;
      if(!sid)return h;
      const L=sellerLedger(sid);
      const tpl=document.createElement('template');tpl.innerHTML=h;
      const content=tpl.content.querySelector('.admin-content');
      if(content){
        content.insertAdjacentHTML('afterbegin',
          `<div class="admin-card" style="border-color:${L.deficit?'#ef5b67':'#26334d'}">
            <div class="section-head"><div><h2>Canonical Money Snapshot</h2><div class="sub">This is the same calculation used on Seller Overview and Payouts.</div></div>
            <span class="admin-pill ${L.deficit?'danger':'success'}">${L.deficit?'LEDGER REVIEW':'LEDGER OK'}</span></div>
            <div class="admin-stat-row">
              <div class="admin-stat"><b>${money(L.gross)}</b><span class="small muted">Gross Sales</span></div>
              <div class="admin-stat"><b>${money(L.earned)}</b><span class="small muted">Net Earnings</span></div>
              <div class="admin-stat"><b>${money(L.available)}</b><span class="small muted">To Receive</span></div>
              <div class="admin-stat"><b>${money(L.paid)}</b><span class="small muted">Received</span></div>
              <div class="admin-stat"><b>${money(L.pending)}</b><span class="small muted">Pending Payouts</span></div>
              <div class="admin-stat"><b>${money(L.spent)}</b><span class="small muted">Spent From Balance</span></div>
            </div>
            ${L.deficit?`<div class="warning-card" style="margin-top:14px"><b>Do not pay this seller yet.</b><div class="small" style="margin-top:5px">Ledger shortfall: ${money(L.deficit)}. Review order/payout history first.</div></div>`:''}
          </div>`
        );
      }
      return tpl.innerHTML;
    };
  }

})();
