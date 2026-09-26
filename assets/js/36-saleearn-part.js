
(function(){
  'use strict';
  window.applyReferralUpgradePayment=function(x,source){
    if(!x||x.paymentVerified!==true)return false;
    const s=currentSeller(),sid=String(s?.id||'');
    if(!s||!sid)return false;
    const target=Number(x.rate),amount=Number(x.price||0),current=referralRate(s),gatewayId=String(x.gatewayPaymentId||'');
    if(!Number.isFinite(target)||target<6||target>20||!Number.isFinite(amount)||amount<=0){toast('Referral payment details are invalid');return false}
    S.referralUpgrades=Array.isArray(S.referralUpgrades)?S.referralUpgrades:[];
    const existing=gatewayId&&S.referralUpgrades.find(r=>String(r.gatewayPaymentId||'')===gatewayId&&String(r.sellerId||'')===sid&&r.paymentStatus==='SUCCESS');
    if(existing){
      if(referralRate(s)<Number(existing.toRate))s.referralPercent=Number(existing.toRate);
      save();clearInterval(window.paymentTimer);showReferralUpgradeSuccess(Number(existing.toRate),Number(existing.amount||amount),existing.paymentSource||source,Number(existing.fromRate||target-1));return true;
    }
    if(target<=current){if(target===current){toast('Referral rate is already active');return true}toast('Referral level changed. Payment was not applied.');return false}
    if(target!==current+1){toast('Only the next referral level can be activated');return false}
    const fromRate=current,refId=String(x.id||uid('ru'));
    S.referralUpgrades.unshift({id:refId,sellerId:sid,fromRate,toRate:target,amount,paymentSource:source||'RAZORPAY_TEST',paymentStatus:'SUCCESS',paymentVerified:true,gatewayPaymentId:x.gatewayPaymentId||null,razorpayOrderId:x.razorpayOrderId||null,date:nowISO(),levels:[target]});
    s.referralPercent=target;save();clearInterval(window.paymentTimer);showReferralUpgradeSuccess(target,amount,source||'RAZORPAY_TEST',fromRate);return true;
  };
})();
