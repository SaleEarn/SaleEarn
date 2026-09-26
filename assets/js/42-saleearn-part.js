
/* ---------- 8) One-time reset: clear ads, subscriptions, messages & all payment/money
   records while keeping products and users intact ---------- */
(function(){
  const FLAG = 'SE_RESET_ADS_SUB_MSG_PAYMENTS_V1';
  try{
    if(localStorage.getItem(FLAG)) return;
    if(typeof S === 'undefined' || !S) return;
    S.ads = [];
    S.subscriptions = [];
    /* Never clear message history automatically during migration/reset. */
    S.balancePayments = [];
    S.payouts = [];
    S.orders = [];
    S.referralUpgrades = [];
    S.adminFinancialLedger = [];
    S.adminCommissionAdjustments = [];
    if(Array.isArray(S.sellerFinanceLedger)) S.sellerFinanceLedger = [];
    S.couponRedemptions = [];
    S.disputes = [];
    S.refunds = [];
    S.serviceRefunds = [];
    if(Array.isArray(S.gatewayPayments)) S.gatewayPayments = [];
    if(S.badgeLedgers && typeof S.badgeLedgers === 'object'){
      Object.values(S.badgeLedgers).forEach(l=>{ l.credits = 0; l.purchases = []; l.placedProductIds = []; });
    }
    if(typeof save === 'function') save();
  }catch(e){ /* ignore */ }
  try{ localStorage.setItem(FLAG,'1'); }catch(e){}
})();
