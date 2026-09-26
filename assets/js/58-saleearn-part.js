
(function(){
'use strict';

/* v25: Product deletion + genuine/manual sales separation.
   - Supabase products.status is the authoritative deletion flag.
   - "deleted" rows stay available to the Admin recycle bin; public queries
     only see status=active.
   - Real seller sales are successful verified orders only.
   - Admin displayed-sales overrides are presentation-only and never money. */

const SE_ADMIN_UUID='19424c7c-8624-4aa2-b2fb-002a0f57b8ed';

const seIsDeletedProduct = window.seIsDeletedProduct;

async function seLoadRealProductSalesCounts(force=false){
  if(!window.supabaseClient) return false;
  if(window.__seRealSalesLoaded && !force) return true;
  window.__seRealSalesLoaded=true;
  try{
    const {data,error}=await window.supabaseClient.rpc('get_public_product_sales');
    if(error) throw error;
    const map=new Map();
    (Array.isArray(data)?data:[]).forEach(r=>{
      const id=String(r?.product_id??'');
      if(id) map.set(id,Math.max(0,Math.floor(Number(r?.sales_count||0))));
    });
    window.__seRealProductSales=map;
    (S.products||[]).forEach(p=>{
      if(p&&!seIsDeletedProduct(p)) p.sales=map.get(String(p.id))??0;
    });
    return true;
  }catch(e){
    window.__seRealSalesLoaded=false;
    console.warn('Real product sales aggregate unavailable:',e?.message||e);
    return false;
  }
}
window.seLoadRealProductSalesCounts=seLoadRealProductSalesCounts;

/* Product sales shown publicly = max(real genuine sales, Admin display target).
   The manual target never becomes a seller order or seller earning. */
window.productSales=function(id){
  const pid=String(id);
  const p=(S.products||[]).find(x=>String(x?.id)===pid);
  if(!p || seIsDeletedProduct(p)) return 0;

  const realMap=window.__seRealProductSales;
  const real=realMap instanceof Map
    ? Math.max(0,Math.floor(Number(realMap.get(pid)??0)))
    : Math.max(0,Math.floor(Number(p.sales||0)));

  const ov=Array.isArray(S.productSaleOverrides)
    ? S.productSaleOverrides.find(x=>String(x?.productId)===pid)
    : null;
  const manualTarget=ov&&Number.isFinite(Number(ov.salesCount))
    ? Math.max(0,Math.floor(Number(ov.salesCount))) : 0;

  return Math.max(real,manualTarget);
};

/* A deleted product must disappear from local cart/saved state immediately. */
const seOriginalTombstone=window.tombstoneProduct;
window.tombstoneProduct=function(id){
  if(seOriginalTombstone) seOriginalTombstone(id);
  const pid=String(id);
  if(Array.isArray(S.cart))S.cart=S.cart.filter(x=>String(x)!==pid);
  if(Array.isArray(S.saved))S.saved=S.saved.filter(x=>String(x?.productId)!==pid);
  if(Array.isArray(S.ads))S.ads=S.ads.filter(x=>String(x?.productId)!==pid);
  if(Array.isArray(SE_PUBLIC_CATALOG))SE_PUBLIC_CATALOG=SE_PUBLIC_CATALOG.filter(x=>String(x?.id)!==pid);
};

/* Keep seller recycle actions cloud-safe: logical delete, not hard delete. */
window.moveToRecycle=async function(id,type){
  const p=type==='live'?product(id):(S.drafts||[]).find(x=>String(x.id)===String(id));
  if(!p)return;
  const sid=currentSeller()?.id;
  if(type==='live' && String(p.sellerId)!==String(sid))return toast('You can only delete your own product');
  S.deletedProducts=Array.isArray(S.deletedProducts)?S.deletedProducts:[];
  if(type==='live'){
    S.deletedProducts=S.deletedProducts.filter(x=>String(x.id)!==String(id));
    S.deletedProducts.unshift({...p,recycledFrom:'live',recycledAt:nowISO(),deletedAt:nowISO(),deletedBy:S.currentUser?.id||null,status:'deleted'});
    S.products=(S.products||[]).filter(x=>String(x.id)!==String(id));
    if(Array.isArray(S.cart))S.cart=S.cart.filter(x=>String(x)!==String(id));
    adjustSellerScore(p.sellerId,-2,'Product deleted','DELETE:'+id+':'+Date.now(),'SELLER');
  }else{
    S.deletedProducts.unshift({...p,recycledFrom:'drafts',recycledAt:nowISO(),deletedAt:nowISO(),deletedBy:S.currentUser?.id||null,status:'deleted'});
    S.drafts=(S.drafts||[]).filter(x=>String(x.id)!==String(id));
  }
  tombstoneProduct(id);
  logProductActivity(id,type==='live'?'Moved to Recycle Bin':'Draft moved to Recycle Bin',{sellerId:sid});
  save();closeModal();render();
  if(type==='live'){
    const ok=await hideProductRowFromPublicCloud(id);
    save();render();
    toast(ok?'Product removed from public view and sent to Admin Deleted':'Product hidden locally; cloud deletion needs retry');
  }else toast('Moved to Recycle Bin');
};

window.bulkMoveSelected=async function(){
  const ids=window.pmBulkIds||selectedPM(),sid=currentSeller()?.id;
  if(!sid||!ids.length)return;
  S.deletedProducts=Array.isArray(S.deletedProducts)?S.deletedProducts:[];
  const items=[];
  ids.forEach(id=>{
    const p=(S.products||[]).find(x=>String(x.id)===String(id)&&String(x.sellerId)===String(sid))
      ||(S.drafts||[]).find(x=>String(x.id)===String(id)&&String(x.sellerId)===String(sid));
    if(!p)return;
    const live=(S.products||[]).some(x=>String(x.id)===String(id)&&String(x.sellerId)===String(sid));
    S.deletedProducts.unshift({...p,recycledFrom:live?'live':'drafts',recycledAt:nowISO(),deletedAt:nowISO(),deletedBy:S.currentUser?.id||null,status:'deleted'});
    if(live){S.products=S.products.filter(x=>String(x.id)!==String(id));items.push(p);adjustSellerScore(p.sellerId,-2,'Product deleted','DELETE:'+id+':'+Date.now(),'SELLER');}
    else S.drafts=S.drafts.filter(x=>String(x.id)!==String(id));
    tombstoneProduct(id);
  });
  window.pmBulkIds=[];
  closeModal();save();render();toast('Selected products hidden. Syncing…');
  for(const p of items) await hideProductRowFromPublicCloud(p.id);
  save();render();toast('Selected products moved to Admin Deleted');
};

/* Stronger local visibility rule for every normal product query. */
const seOriginalProduct=window.product;
window.product=function(id){
  const p=seOriginalProduct?seOriginalProduct(id):null;
  if(!p || seIsDeletedProduct(p)) return null;
  return p;
};

/* Cart cleanup is cheap and runs only on render, not on scroll/poll. */
const seOriginalRender=window.render;
if(seOriginalRender && !window.__seRenderDeletionGuard){
  window.__seRenderDeletionGuard=true;
  window.render=function(){
    if(Array.isArray(S.cart)){
      const before=S.cart.length;
      S.cart=S.cart.filter(id=>!!window.product(id));
      if(S.cart.length!==before){try{sePersist?.()}catch{}}
    }
    return seOriginalRender.apply(this,arguments);
  };
}

/* Genuine sales only: ignore SALE_ADJUSTMENT records in seller money.
   Other explicit money adjustments (TO_RECEIVE/TOTAL/RECEIVED) remain intact. */
const seMoneyOrderSuccess=o=>{
  const st=String(o?.status||'').toUpperCase();
  return !!o && ['SUCCESS','PAID','APPROVED','COMPLETED'].includes(st) &&
    o.paymentVerified!==false &&
    String(o?.saleSource||o?.source||'real_order').toLowerCase()!=='admin_manual';
};
const seFinanceSum=(sid,type)=>{
  return (S.sellerFinanceLedger||[])
    .filter(x=>String(x?.sellerId||'')===String(sid)&&String(x?.type||'')===String(type)&&!x?.voided&&x?.type!=='SALE_ADJUSTMENT')
    .reduce((a,x)=>a+Number(x?.amount||0),0);
};
window.sellerLedger=function(sid){
  const orders=(S.orders||[]).filter(o=>String(o?.sellerId||'')===String(sid)&&seMoneyOrderSuccess(o));
  const gross=Math.round(orders.reduce((a,o)=>a+Number(o.amount||0),0)*100)/100;
  const orderEarned=Math.round(orders.reduce((a,o)=>{
    const n=o?.netSellerAmount!=null?Number(o.netSellerAmount):Number(o.amount||0)*(1-Number(o.platformFeeRate??.20));
    return a+(Number.isFinite(n)?n:0);
  },0)*100)/100;
  const earningsAdj=Math.round(seFinanceSum(sid,'TOTAL')*100)/100;
  const availableAdj=Math.round(seFinanceSum(sid,'TO_RECEIVE')*100)/100;
  const receivedAdj=Math.round(seFinanceSum(sid,'RECEIVED')*100)/100;
  const payouts=(S.payouts||[]).filter(x=>String(x?.sellerId||'')===String(sid));
  const paid=Math.round((payouts.filter(x=>['APPROVED','PAID','SUCCESS','RECEIVED'].includes(String(x?.status||'').toUpperCase())).reduce((a,x)=>a+Number(x.amount||0),0)+receivedAdj)*100)/100;
  const pending=Math.round(payouts.filter(x=>['PENDING','UNDER REVIEW','ON HOLD','PROCESSING'].includes(String(x?.status||'').toUpperCase())).reduce((a,x)=>a+Number(x.amount||0),0)*100)/100;
  const spent=Math.round((
    (S.balancePayments||[]).filter(x=>String(x?.sellerId||'')===String(sid)&&String(x?.source||'').toUpperCase()==='BALANCE'&&String(x?.status||'').toUpperCase()==='SUCCESS'&&x?.paymentVerified!==false).reduce((a,x)=>a+Number(x.amount||0),0)
    +(S.ads||[]).filter(x=>String(x?.sellerId||'')===String(sid)&&!x?.paymentSource&&String(x?.status||'').toUpperCase()!=='CANCELLED').reduce((a,x)=>a+Number(x.cost||0),0)
    +(S.subscriptions||[]).filter(x=>String(x?.sellerId||'')===String(sid)&&!x?.paymentSource).reduce((a,x)=>a+Number(x.amount||0),0)
  )*100)/100;
  const earned=Math.round((orderEarned+earningsAdj)*100)/100;
  const raw=Math.round((earned-paid-pending-spent+availableAdj)*100)/100;
  return {sid:String(sid||''),orders,sales:orders.length,gross,fee:Math.max(0,Math.round((gross-orderEarned)*100)/100),earningsAdj,availableAdj,receivedAdj,earned,paid,pending,spent,raw,available:Math.max(0,raw),deficit:raw<0?Math.round(-raw*100)/100:0};
};
window.sellerEarnings=sid=>window.sellerLedger(sid).earned;
window.sellerAvailableBalance=sid=>window.sellerLedger(sid).available;

/* Hide the old "Increase Seller Sale" control because manual sales are no
   longer financial events. Product detail has the correct display-only control. */
const seOldAdminUserDetail=window.adminUserDetail;
if(seOldAdminUserDetail && !window.__seManualSaleControlRemoved){
  window.__seManualSaleControlRemoved=true;
  window.adminUserDetail=function(id){
    const html=seOldAdminUserDetail(id);
    const t=document.createElement('template');t.innerHTML=html;
    [...t.content.querySelectorAll('.admin-card')].forEach(card=>{
      const txt=(card.textContent||'').toLowerCase();
      if(txt.includes('admin sale control') || txt.includes('increase seller sale')) card.remove();
    });
    return t.innerHTML;
  };
}

/* The legacy seller-level "Increase Seller Sale" action is intentionally
   disabled: a manual/display sale must never become seller money. Genuine
   seller money changes remain in the separate audited money controls. */
window.adminIncreaseSellerSale=async function(){
  if(typeof adminOnly==='function'&&!adminOnly())return false;
  if(typeof toast==='function')toast('Manual sales are display-only. Open the product and use Sales Display Control.');
  return false;
};

/* Make the product-level admin sales control explicit and safe. */
const seOldAdminSetProductSales=window.adminSetProductSales;
if(seOldAdminSetProductSales && !window.__seSafeProductSalesControl){
  window.__seSafeProductSalesControl=true;
  window.adminSetProductSales=async function(productId){
    if(!adminOnly())return;
    const p=(S.products||[]).find(x=>String(x.id)===String(productId));
    if(!p || seIsDeletedProduct(p))return toast('Deleted product cannot receive a sales adjustment');
    const result=await seOldAdminSetProductSales(productId);
    // Re-load the tiny public aggregate only when Admin actually changes a display value.
    try{await seLoadRealProductSalesCounts(true)}catch{}
    return result;
  };
}

/* Public sales aggregate is loaded once, not polled. */
if(window.supabaseClient){
  setTimeout(()=>{try{seLoadRealProductSalesCounts(false)}catch{}},50);
}

/* One final guard before checkout: ask Supabase for the authoritative status.
   A deleted product cannot be purchased even if an old tab still has stale UI. */
const seOriginalContinuePayment=window.continuePayment;
if(seOriginalContinuePayment && !window.__seCheckoutDeletedGuard){
  window.__seCheckoutDeletedGuard=true;
  window.continuePayment=async function(id){
    if(window.supabaseClient){
      try{
        const r=await window.supabaseClient.from('products').select('id,status').eq('id',String(id)).maybeSingle();
        if(r.data && String(r.data.status||'').toLowerCase()!=='active'){
          window.pendingBuy=null; closeModal(); toast('This product is no longer available.');
          if(Array.isArray(S.cart))S.cart=S.cart.filter(x=>String(x)!==String(id));
          return;
        }
        if(r.error && !r.data){
          // Do not silently bypass a failed authorization/status read.
          toast('Could not verify product availability. Please try again.');
          return;
        }
      }catch(e){
        toast('Could not verify product availability. Please try again.');
        return;
      }
    }
    return seOriginalContinuePayment.apply(this,arguments);
  };
}

/* Public catalog should never trust a cached deleted product. */
if(typeof window.updateMarketResults==='function'){
  const seOldMarket=window.updateMarketResults;
  window.updateMarketResults=function(){
    if(Array.isArray(S.products))S.products=S.products.filter(p=>!seIsDeletedProduct(p));
    return seOldMarket.apply(this,arguments);
  };
}

/* Refresh genuine sales before the next explicit page render without polling. */
window.__seSalesSeparationReady=true;
})();
