
(function(){
'use strict';

/* v9: one order-success definition for all financial views. */
window.v9OrderSuccess=function(o){
  if(!o) return false;
  const st=String(o.status||'').toUpperCase();
  return o.paymentVerified!==false && ['SUCCESS','PAID','APPROVED','COMPLETED'].includes(st) && !['CANCELLED','FAILED','REFUNDED'].includes(st);
};
window.v9OrderNet=function(o){
  const gross=Number(o?.amount||0);
  if(!Number.isFinite(gross)||gross<=0)return 0;
  if(o?.netSellerAmount!=null && Number.isFinite(Number(o.netSellerAmount))) return Number(o.netSellerAmount);
  const rate=Number(o?.platformFeeRate??0.20);
  return Math.max(0,gross*(1-Math.min(1,Math.max(0,rate))));
};

/* v9 must not depend on v7 IIFE-local helpers. Keep these helpers local to v9. */
function v9FinanceSum(sid,type){
  return (S.sellerFinanceLedger||[])
    .filter(x=>String(x?.sellerId||'')===String(sid) && String(x?.type||'')===type && !x?.voided)
    .reduce((a,x)=>a+(Number(x?.amount)||0),0);
}
function v9PayoutPaid(x){
  return ['APPROVED','PAID','SUCCESS','RECEIVED'].includes(String(x?.status||'PENDING').trim().toUpperCase());
}
function v9PayoutPending(x){
  return ['PENDING','UNDER REVIEW','ON HOLD','PROCESSING'].includes(String(x?.status||'PENDING').trim().toUpperCase());
}

/* Replace the money ledger with a version that counts every verified completed sale,
   not only one exact status spelling. */
window.sellerLedger=function(sid){
  const orders=(S.orders||[]).filter(o=>String(o?.sellerId||'')===String(sid)&&v9OrderSuccess(o));
  const gross=orders.reduce((a,o)=>a+Number(o.amount||0),0);
  const orderEarned=orders.reduce((a,o)=>a+v9OrderNet(o),0);
  const earningsAdj=Number(v9FinanceSum(sid,'TOTAL')||0);
  const availableAdj=Number(v9FinanceSum(sid,'TO_RECEIVE')||0);
  const receivedAdj=Number(v9FinanceSum(sid,'RECEIVED')||0);
  const earned=gross?Math.round((orderEarned+earningsAdj)*100)/100:Math.round(earningsAdj*100)/100;
  const payouts=(S.payouts||[]).filter(x=>String(x?.sellerId||'')===String(sid));
  const paid=Math.round((payouts.filter(v9PayoutPaid).reduce((a,x)=>a+Number(x.amount||0),0)+receivedAdj)*100)/100;
  const pending=Math.round(payouts.filter(v9PayoutPending).reduce((a,x)=>a+Number(x.amount||0),0)*100)/100;
  const balanceSpent=(S.balancePayments||[]).filter(x=>String(x?.sellerId||'')===String(sid)&&String(x?.source||'').toUpperCase()==='BALANCE'&&String(x?.status||'').toUpperCase()==='SUCCESS'&&x?.paymentVerified!==false).reduce((a,x)=>a+Number(x.amount||0),0);
  const legacyAds=(S.ads||[]).filter(x=>String(x?.sellerId||'')===String(sid)&&!x?.paymentSource&&String(x?.status||'').toUpperCase()!=='CANCELLED').reduce((a,x)=>a+Number(x.cost||0),0);
  const legacySubs=(S.subscriptions||[]).filter(x=>String(x?.sellerId||'')===String(sid)&&!x?.paymentSource).reduce((a,x)=>a+Number(x.amount||0),0);
  const spent=Math.round((balanceSpent+legacyAds+legacySubs)*100)/100;
  const raw=Math.round((earned-paid-pending-spent+availableAdj)*100)/100;
  return {sid:String(sid||''),orders,sales:orders.length,gross:Math.round(gross*100)/100,fee:Math.round((gross-orderEarned)*100)/100,earningsAdj:Math.round(earningsAdj*100)/100,availableAdj:Math.round(availableAdj*100)/100,receivedAdj:Math.round(receivedAdj*100)/100,earned:Math.round(earned*100)/100,paid, pending,spent,raw,available:Math.max(0,Math.round(raw*100)/100),deficit:raw<0?Math.round(-raw*100)/100:0};
};
window.sellerEarnings=sid=>window.sellerLedger(sid).earned;
window.sellerAvailableBalance=sid=>window.sellerLedger(sid).available;

/* Overview now uses the exact same verified-sale definition. */
const v9OldDashOverview=window.dashOverview;
window.dashOverview=function(){
  const sid=currentSeller()?.id;
  if(!sid)return v9OldDashOverview();
  const L=sellerLedger(sid);
  const days=[...Array(7)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return d;});
  const vals=days.map(d=>L.orders.filter(o=>new Date(o.date||0).toDateString()===d.toDateString()).reduce((a,o)=>a+Number(o.amount||0),0));
  const max=Math.max(1,...vals);
  return dashShell('overview',`<div class="metric-grid"><div class="metric"><div class="metric-top"><span>₹</span><span class="metric-label total">Total</span></div><h2>${money(L.gross+Number(L.earningsAdj||0))}</h2><div>All verified product sales, incl. Admin adjustments</div></div><div class="metric orange"><div class="metric-top"><span>◷</span><span class="metric-label receive">To Receive</span></div><h2>${money(L.available)}</h2><div>Net seller balance available for payout</div></div><div class="metric green"><div class="metric-top"><span>✓</span><span class="metric-label received">Received</span></div><h2>${money(L.paid)}</h2><div>All paid/received payouts</div></div><div class="metric pink"><div class="metric-top"><span>▣</span><span class="metric-label sales">Sales</span></div><h2>${L.sales}</h2><div>Verified completed sales</div></div></div>${L.deficit?`<div class="warning-card"><b>⚠ Money review required</b><div class="small">Ledger shortfall: ${money(L.deficit)}. New payouts are blocked until Admin reviews it.</div></div>`:''}<div class="dash-card"><div class="section-head"><div><h3>Last 7 days Sales</h3><p>Every verified completed sale is included.</p></div><button class="btn" onclick="go('dashboard/orders')">Analysis →</button></div><div class="chart">${vals.map((v,i)=>`<div class="bar-wrap"><b class="small">${v?money(v):''}</b><div class="bar" style="height:${Math.max(3,v/max*155)}px"></div><div class="bar-label">${days[i].toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit'})}</div></div>`).join('')}</div></div>`);
};

/* v10 coupon backend: use Supabase RPCs directly. The old coupon-service Edge Function
   was returning HTTP 400, and its admin/list calls also kept the global save indicator busy. */
async function v9CouponServer(action,payload={}){
  if(!window.supabaseClient?.rpc)throw new Error('Secure coupon database is not connected');
  let fn=null,args={};
  if(action==='validate'){
    fn='public_validate_coupon';
    args={
      p_code:String(payload.code||'').trim().toUpperCase(),
      p_context:String(payload.context||'PRODUCT').toUpperCase(),
      p_product_id:payload.product_id?String(payload.product_id):null,
      p_base_amount:payload.base_amount==null?null:Number(payload.base_amount),
      p_placement:payload.placement?String(payload.placement):null
    };
  }else if(action==='redeem'){
    fn='public_redeem_coupon';
    args={
      p_coupon_id:String(payload.coupon_id||''),
      p_code:String(payload.code||'').trim().toUpperCase(),
      p_context:String(payload.context||'PRODUCT').toUpperCase()
    };
  }else if(action==='admin_disable'){
    fn='admin_disable_coupon';
    args={p_coupon_id:String(payload.coupon_id||'')};
  }else if(action==='list'){
    fn='admin_list_coupons';
    args={};
  }else throw new Error('Unsupported coupon action');
  const {data,error}=await window.supabaseClient.rpc(fn,args);
  if(error)throw new Error(error.message||error.details||'Coupon operation failed');
  if(action==='list')return {ok:true,coupons:Array.isArray(data)?data:[]};
  if(data&&data.ok===false)throw new Error(data.message||'Coupon operation failed');
  return data?.ok===undefined ? (data||{ok:true}) : data;
}
window.cancelCheckoutCoupon=function(){
 const p=product(window.pendingBuy?.id); if(!p)return;
 window.pendingBuy={...window.pendingBuy,couponId:"",couponCode:"",discount:0,amount:Number(p.price),couponServerValidated:false};
 toast('Coupon cancelled · original price restored'); openBuy(p.id);
};
window.applyCheckoutCoupon=async function(){
  const p=product(window.pendingBuy?.id); if(!p)return;
  const input=document.getElementById('buyCoupon');
  const btn=input?.parentElement?.querySelector('button');
  const code=String(input?.value||'').trim().toUpperCase();
  const show=(msg,ok=false)=>{
    let row=input?.closest('.field');
    if(row){let box=row.querySelector('[data-coupon-result]');if(!box){box=document.createElement('div');box.setAttribute('data-coupon-result','1');box.className='small';box.style.marginTop='7px';row.appendChild(box);}box.textContent=msg;box.style.fontWeight='700';box.style.color=ok?'#2dd4bf':'#ff7b7b';}
    toast(msg);
  };
  if(!code){show('Enter a coupon code');return;}
  if(btn){btn.disabled=true;btn.textContent='Checking…';}
  try{
    const r=await v9CouponServer('validate',{code,product_id:String(p.id),context:'PRODUCT',base_amount:Number(p.price||0)});
    const base=Number(r.base_amount??p.price??0),discount=Math.max(0,Number(r.discount||0)),final=Number(r.final_amount);
    if(!Number.isFinite(base)||!Number.isFinite(discount)||!Number.isFinite(final)||final<0||final>base)throw new Error('Invalid discount returned by secure coupon server');
    window.pendingBuy={...window.pendingBuy,couponId:String(r.coupon_id||''),couponCode:String(r.code||code),discount,amount:final,couponServerValidated:true};
    show(`✓ Coupon applied · ${money(discount)} off · Pay ${money(final)}`,true); openBuy(p.id);
  }catch(e){
    window.pendingBuy={...window.pendingBuy,couponId:'',couponCode:'',discount:0,amount:Number(p.price||0),couponServerValidated:false};
    show(`✕ ${e?.message||'Wrong or unavailable coupon code'}`); openBuy(p.id);
  }finally{const b=document.getElementById('buyCoupon')?.parentElement?.querySelector('button');if(b){b.disabled=false;b.textContent='Apply';}}
};
window.applyCartCoupon=async function(){
  const p=product(S.cart?.[0]); if(!p)return toast('Cart is empty');
  const el=document.getElementById('cartCouponCode'),code=(el?.value||'').trim().toUpperCase(); if(!code)return toast('Enter a coupon code');
  try{const r=await v9CouponServer('validate',{code,product_id:p.id,context:'PRODUCT',base_amount:Number(p.price||0)});window.cartCoupon={productId:p.id,couponId:r.coupon_id,code:r.code,discount:Number(r.discount||0),finalAmount:Number(r.final_amount||p.price)};toast(`Coupon valid for ${esc(p.title||'this item')}`);buyNow(p.id);}catch(e){toast(e?.message||'Coupon is invalid or unavailable');}
};
window.applyServiceCoupon=async function(){
  const x=window.pendingService;if(!x)return;
  const code=(document.getElementById('serviceCoupon')?.value||'').trim().toUpperCase(); if(!code)return toast('Enter a coupon code');
  const context=x.kind==='subscription'?'SUBSCRIPTION':x.kind==='ad'?'ADS':'PRODUCT';
  try{
    const r=await v9CouponServer('validate',{code,product_id:x.meta?.productId||null,context,base_amount:Number(x.meta?.baseAmount??x.amount),placement:x.meta?.type||null});
    const final=Number(r.final_amount),discount=Math.max(0,Number(r.discount||0));
    const meta={...(x.meta||{}),couponId:r.coupon_id,couponCode:r.code,discount,baseAmount:Number(r.base_amount),finalAmount:final};
    window.pendingService={...x,couponId:r.coupon_id,couponCode:r.code,discount,amount:final,baseAmount:Number(r.base_amount),meta};
    toast(`Coupon applied · ${money(discount)} off`);servicePaymentPanel(x.kind,final,meta);
  }catch(e){toast(e?.message||'Coupon is invalid or unavailable');}
};
const v9OldTestPay=window.testPay;
window.testPay=async function(){
  const p=product(window.pendingBuy?.id);if(!p)return;
  if(window.pendingBuy?.couponCode){try{const r=await v9CouponServer('validate',{code:window.pendingBuy.couponCode,product_id:p.id,context:'PRODUCT',base_amount:Number(p.price||0)});window.pendingBuy={...window.pendingBuy,couponId:r.coupon_id,couponCode:r.code,discount:Number(r.discount||0),amount:Number(r.final_amount),couponServerValidated:true};}catch(e){return toast(e?.message||'Coupon could not be revalidated. Checkout stopped.');}}
  return v9OldTestPay();
};
const v9OldApplyServicePayment=window.applyServicePayment;
if(v9OldApplyServicePayment){
  window.applyServicePayment=async function(x,source){
    if(x?.meta?.couponCode){try{const r=await v9CouponServer('redeem',{code:x.meta.couponCode,coupon_id:x.meta.couponId,product_id:x.meta.productId||null,context:x.kind==='subscription'?'SUBSCRIPTION':x.kind==='ad'?'ADS':'PRODUCT'});if(r?.redeemed===false)throw new Error(r.message||'Coupon redemption failed');}catch(e){toast(e?.message||'Coupon redemption failed');return false;}}
    return v9OldApplyServicePayment(x,source);
  };
}

/* Admin Coupon: direct RPC only. Never call the broken coupon-service Edge Function
   and never queue the heavyweight legacy snapshot save for a coupon-only change. */
const v9OldCreateCoupon=window.createCoupon;
window.createCoupon=async function(){
  if(!adminOnly())return;
  const code=(document.getElementById('cpCode')?.value||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'');
  const scope=document.getElementById('cpScope')?.value||'PRODUCT';
  const placement=scope==='ADS'?(document.getElementById('cpPlacement')?.value||'Homepage'):null;
  const type=document.getElementById('cpType')?.value;
  const value=Number(document.getElementById('cpValue')?.value||0);
  const maxUses=Math.max(1,Number(document.getElementById('cpMax')?.value||1));
  const ex=document.getElementById('cpExpiry')?.value;
  if(!code||!value)return toast('Enter coupon code and value');
  if(type==='percent'&&(value<=0||value>100))return toast('Percent discount must be between 0 and 100%');
  const btn=[...document.querySelectorAll('button')].find(b=>b.getAttribute('onclick')==='createCoupon()'),oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    const adminAuthId=String(S.currentUser?.authId||S.currentUser?.id||'');
    if(adminAuthId!=='19424c7c-8624-4aa2-b2fb-002a0f57b8ed')throw new Error('Admin verification failed');
    const rpc=await window.supabaseClient.rpc('admin_create_coupon',{p_code:code,p_scope:scope,p_placement:placement,p_type:type,p_value:value,p_max_uses:maxUses,p_expires_at:ex?new Date(ex+'T23:59:59').toISOString():null});
    if(rpc.error)throw new Error(rpc.error.message||rpc.error.details||'Coupon save failed');
    const c=rpc.data?.coupon||rpc.data;if(!c?.id)throw new Error('Coupon was not returned by the database');
    const coupon={id:String(c.id),code:c.code,scope:c.scope,placement:c.placement,type:c.type,value:Number(c.value),maxUses:Number(c.max_uses),used:Number(c.used||0),active:!!c.active,expiresAt:c.expires_at,createdAt:c.created_at,createdBy:c.created_by};
    S.coupons=S.coupons||[];S.coupons=S.coupons.filter(x=>String(x.code||'').toUpperCase()!==String(coupon.code||'').toUpperCase());S.coupons.unshift(coupon);
    adminAudit('Created secure coupon',code,{scope,placement,type,value,maxUses});
    sePersist();dirtyFields=false;liveDirty=false;status('live','Saved & live');
    render();toast('Coupon saved successfully');
  }catch(e){console.error('Admin coupon save failed:',e);toast(e?.message||'Could not save coupon');}
  finally{if(btn){btn.disabled=false;btn.textContent=oldText||'Create Coupon';}}
};

window.disableCoupon=async function(id){
  if(!adminOnly())return;

  const coupon=(S.coupons||[]).find(c=>String(c.id)===String(id));
  if(!coupon)return toast('Coupon not found');

  if(!confirm('Permanently delete this coupon? It will never be usable again.'))return;

  try{
    if(!window.supabaseClient?.rpc) throw new Error('Supabase connection is unavailable');

    const {error}=await window.supabaseClient.rpc('admin_delete_coupon',{
      p_coupon_id:String(id)
    });
    if(error)throw error;

    S.coupons=(S.coupons||[]).filter(c=>String(c.id)!==String(id));

    const row=document.querySelector('[data-coupon-id="'+CSS.escape(String(id))+'"]');
    if(row) row.remove();
    else render();

    toast('Coupon permanently deleted and disabled');
  }catch(e){
    console.error('Admin coupon delete failed:',e);
    toast(e?.message||'Could not permanently delete coupon');
  }
};

/* Admin Money In = seller receive amount, not gross order amount. */
const v9OldAdminCommission=window.adminCommission;
window.adminCommission=function(){
  let html=v9OldAdminCommission();
  const days=Number(window.adminCommissionDays||0),cutoff=days>0?Date.now()-days*86400000:0;
  const moneyIn=(S.orders||[]).filter(o=>v9OrderSuccess(o)&&(!cutoff||new Date(o.date||0).getTime()>=cutoff)).reduce((a,o)=>a+v9OrderNet(o),0);
  const tpl=document.createElement('template');tpl.innerHTML=html;
  const kpis=[...tpl.content.querySelectorAll('.admin-kpi')];
  const k=kpis.find(x=>x.querySelector('span')?.textContent.trim()==='Money In');
  if(k){const b=k.querySelector('b');if(b)b.textContent=money(moneyIn);const sm=k.querySelector('small');if(sm)sm.textContent='All sellers receive amount after platform fee';}
  return tpl.innerHTML;
};

/* Server coupon status badge in Admin UI.
   IMPORTANT: never start a new list request on every render. The previous
   implementation fetched -> render -> fetched again, which caused the coupon
   page to flicker and repeatedly rebuild the DOM. */
let __seCouponListRoute='', __seCouponListLoaded=false, __seCouponListBusy=false;
const v9OldAdminCoupons=window.adminCoupons;
window.adminCoupons=function(){
  const html=v9OldAdminCoupons();
  const r=route();
  if(r!=='admin/coupons'){
    __seCouponListRoute='';
    __seCouponListLoaded=false;
    __seCouponListBusy=false;
    return html;
  }
  if(window.supabaseClient && !__seCouponListBusy && !(__seCouponListLoaded && __seCouponListRoute===r)){
    __seCouponListBusy=true;
    __seCouponListRoute=r;
    v9CouponServer('list').then(res=>{
      if(!Array.isArray(res.coupons))return;
      const next=JSON.stringify(res.coupons);
      const prev=JSON.stringify(S.coupons||[]);
      S.coupons=res.coupons;
      __seCouponListLoaded=true;
      /* Persist silently; do NOT touch global Saving changes state. */
      try{sePersist();}catch(e){}
      /* One refresh only when server data actually differs. */
      if(next!==prev && route()==='admin/coupons') render();
    }).catch(e=>console.warn('Admin coupon list refresh failed:',e?.message||e))
      .finally(()=>{__seCouponListBusy=false;});
  }
  return html;
};

})();
