
(function(){
  'use strict';
  function badgeLedger(){
    const sid=currentSeller()?.id||S.currentUser?.sellerId||'guest';
    S.badgeLedgers=S.badgeLedgers&&typeof S.badgeLedgers==='object'?S.badgeLedgers:{};
    return S.badgeLedgers[sid]||(S.badgeLedgers[sid]={freeLimit:3,price:3,credits:0,placedProductIds:[],purchases:[]});
  }
  function addBadgeCredits(quantity,amount,source,response,referenceId){
    const st=badgeLedger(),gatewayId=response?.razorpay_payment_id||response?.gatewayPaymentId||null;
    st.purchases=Array.isArray(st.purchases)?st.purchases:[];
    if(gatewayId&&st.purchases.some(x=>String(x.gatewayPaymentId||'')===String(gatewayId)&&x.paymentVerified!==false))return false;
    st.credits=Math.min(100,Number(st.credits||0)+Number(quantity||0));
    st.purchases.unshift({id:referenceId||uid('badgepay'),sellerId:currentSeller()?.id,quantity:Number(quantity),amount:Number(amount),source:source||'RAZORPAY_TEST',paymentStatus:'SUCCESS',paymentVerified:true,gatewayPaymentId:gatewayId,razorpayOrderId:response?.razorpay_order_id||response?.razorpayOrderId||null,date:nowISO()});
    save();
    return true;
  }
  window.openBadgeCredits=function(){
    const st=badgeLedger(),max=Math.max(0,100-Number(st.credits||0));
    if(!max)return toast('Badge credit limit reached');
    document.getElementById('modalRoot').innerHTML=`<div class="modal-bg"><div class="modal"><button class="btn iconbtn close" onclick="closeModal()">×</button><h2>Buy Badge Credits</h2><p class="muted">₹3 per placement · Credits sync to Supabase after verified payment.</p><div class="field"><label>Quantity</label><input id="badgeQty" type="number" min="1" max="${max}" value="10" oninput="document.getElementById('badgeTotal').textContent=money(Math.max(1,Math.min(${max},Number(this.value)||1))*3)"></div><div class="dash-card"><b>Total: <span id="badgeTotal">${money(30)}</span></b><div class="small muted">Current credits: ${st.credits} · Maximum: 100</div></div><div class="modal-footer"><button class="btn" onclick="buyBadgeCredits('BALANCE')">Pay from Balance</button><button class="btn primary" onclick="buyBadgeCredits('RAZORPAY_TEST')">Pay Online with Cashfree</button></div></div></div>`;
  };
  window.buyBadgeCredits=async function(source){
    const st=badgeLedger(),sid=currentSeller()?.id;if(!sid)return;
    const max=Math.max(0,100-Number(st.credits||0)),q=Math.min(max,Math.max(1,Math.floor(Number(document.getElementById('badgeQty')?.value)||1))),amount=q*3;
    if(!q)return toast('Badge credit limit reached');
    if(source==='BALANCE'){
      if(sellerAvailableBalance(sid)<amount)return toast('Insufficient available balance');
      S.balancePayments=S.balancePayments||[];S.balancePayments.unshift({id:uid('bal'),sellerId:sid,amount,kind:'badgeCredits',source:'BALANCE',status:'SUCCESS',paymentVerified:true,date:nowISO()});
      addBadgeCredits(q,amount,'BALANCE',null,uid('badgepay'));closeModal();toast(q+' badge credits added');render();return;
    }
    if(!systemGuard('payments','Payments are temporarily disabled by Admin'))return;
    const referenceId=uid('badgepay');
    document.getElementById('modalRoot').innerHTML='<div class="modal-bg"><div class="modal" style="text-align:center;padding:34px"><div style="font-size:42px">💳</div><h2>Opening Secure Checkout</h2><p class="muted">Badge credits activate only after verification.</p></div></div>';
    const ok=await startRazorpayCheckout({amount,description:razorpaySafeDescription('Sale Earn - Badge credits'),customerName:S.currentUser?.name||currentSeller()?.name||'',customerEmail:S.currentUser?.email||'',metadata:{kind:'badgeCredits',referenceId,sellerId:sid,quantity:q},onVerified:async(response)=>{
      const added=addBadgeCredits(q,amount,'RAZORPAY_TEST',response,referenceId);
      if(added){closeModal();toast(q+' badge credits verified and synced');render()}
    }});
    if(!ok)closeModal();
  };
})();
