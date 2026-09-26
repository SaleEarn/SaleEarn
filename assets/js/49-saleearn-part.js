
(function(){
'use strict';

/* v15: one seller-facing reason/warning stream for Admin actions. */
function v15PushSellerReason(sid,title,reason,meta={}){
  if(!adminOnly()||!sid)return false;
  const text=String(reason||'').trim().slice(0,2000);
  if(text.length<3)return false;
  const s=seller(sid),u=sellerOwnerUser(sid);
  if(!s)return false;
  S.warnings=Array.isArray(S.warnings)?S.warnings:[];
  const w={
    id:uid('warn'), sellerId:String(sid), userId:u?.id||null,
    productId:meta.productId||null, productTitle:meta.productTitle||null,
    title:String(title||'Admin action'), message:text,
    action:String(meta.action||title||'Admin action'),
    createdBy:S.currentUser?.id||'ADMIN', adminId:S.currentUser?.id||'ADMIN',
    severity:String(meta.severity||'info'), date:nowISO(), read:false,
    adminReason:true, metadata:meta
  };
  S.warnings.unshift(w);
  if(S.warnings.length>500)S.warnings.length=500;
  return true;
}
window.v15PushSellerReason=v15PushSellerReason;

/* Any existing Admin notice that is a message also becomes a seller warning/reason entry. */
const v15OldNotice=window.adminSellerNotice;
window.adminSellerNotice=function(sid,title,body,type='message'){
  const ok=v15OldNotice?v15OldNotice(sid,title,body,type):false;
  if(type!=='warning')v15PushSellerReason(sid,title,body,{action:title});
  return ok;
};

/* Admin sale increase -> seller warning/reason. */
const v15OldSale=window.adminIncreaseSellerSale;
if(v15OldSale){
  window.adminIncreaseSellerSale=async function(uid){
    if(!adminOnly())return;
    const u=(S.users||[]).find(x=>String(x.id)===String(uid)),sid=u?.sellerId;
    const before=(S.sellerFinanceLedger||[]).length;
    const reason=(document.getElementById('v11SaleNote')?.value||'').trim();
    if(reason.length<3)return toast('Reason is required');
    const result=await v15OldSale(uid);
    const changed=(S.sellerFinanceLedger||[]).length>before;
    if(changed&&sid){v15PushSellerReason(sid,'Admin increased sale',reason,{action:'SALE_CHANGE',grossAmount:Number(document.getElementById('v11SaleAmount')?.value||0)});save();}
    return result;
  };
}

/* Product displayed-sales change -> seller warning/reason. */
const v15OldSetSales=window.adminSetProductSales;
if(v15OldSetSales){
  window.adminSetProductSales=async function(productId){
    const p=product(productId); if(!p||!adminOnly())return;
    const safe=String(productId).replace(/[^a-zA-Z0-9_-]/g,'');
    const reason=(document.getElementById('v13SalesNote_'+safe)?.value||'').trim();
    if(reason.length<3)return toast('Reason is required');
    const before=(S.productSaleOverrides||[]).find(x=>String(x.productId)===String(productId))?.salesCount;
    const result=await v15OldSetSales(productId);
    const after=(S.productSaleOverrides||[]).find(x=>String(x.productId)===String(productId))?.salesCount;
    if(Number(after)!==Number(before)||Number.isFinite(Number(after))){
      v15PushSellerReason(p.sellerId,'Product sales display changed',reason,{action:'SALES_DISPLAY_CHANGE',productId:p.id,productTitle:p.title,salesCount:Number(after)});
      save();
    }
    return result;
  };
}

/* Product delete: require a reason and send the same reason to seller Warnings. */
const v15OldDeleteNow=window.adminDeleteProductNow;
if(v15OldDeleteNow){
  window.adminDeleteProductNow=function(id){
    if(!adminOnly())return;
    const p=product(id); if(!p)return;
    const reason=String(prompt('Enter the reason for deleting this product:','Product removed by Admin')||'').trim();
    if(reason.length<3)return toast('Reason is required');
    const before=(S.products||[]).some(x=>String(x.id)===String(id));
    const r=v15OldDeleteNow(id);
    const removed=before&&!product(id);
    if(removed){v15PushSellerReason(p.sellerId,'Product deleted by Admin',reason,{action:'PRODUCT_DELETE',productId:p.id,productTitle:p.title});logAdminAudit('Product delete reason sent to seller',id,{reason,sellerId:p.sellerId});save();}
    return r;
  };
}
const v15OldPermanentDelete=window.adminPermanentDeleteProduct;
if(v15OldPermanentDelete){
  window.adminPermanentDeleteProduct=function(id){
    if(!adminOnly())return;
    const p=product(id);if(!p)return;
    const reason=String(prompt('Enter the reason for permanent deletion:','Product permanently removed by Admin')||'').trim();
    if(reason.length<3)return toast('Reason is required');
    /* Original function asks for its own reason too; temporarily provide the same text. */
    const oldPrompt=window.prompt; let first=true;
    try{window.prompt=function(){if(first){first=false;return reason;}return oldPrompt.apply(window,arguments)};return v15OldPermanentDelete(id)}finally{window.prompt=oldPrompt}
  };
}

/* Ad / subscription cancellation: reason is required and copied to seller Warnings. */
const v15OldCancelService=window.adminCancelService;
if(v15OldCancelService){
  window.adminCancelService=function(type,id){
    if(!adminOnly())return;
    const list=type==='ad'?S.ads:S.subscriptions, x=list?.find(z=>String(z.id)===String(id));
    if(!x)return;
    const reason=String(prompt(`Reason for cancelling this ${type}:`,'Cancelled by Admin')||'').trim();
    if(reason.length<3)return toast('Reason is required');
    const sid=x.sellerId;
    const before=x.status;
    const r=v15OldCancelService(type,id);
    if(before!=='CANCELLED'&&x.status==='CANCELLED'){
      x.adminCancelReason=reason;
      v15PushSellerReason(sid,type==='ad'?'Ad cancelled by Admin':'Subscription cancelled by Admin',reason,{action:type.toUpperCase()+'_CANCEL',refId:id});
      logAdminAudit('Admin cancellation reason sent to seller',id,{type,sellerId:sid,reason});save();
    }
    return r;
  };
}

/* Add an explicit Admin price-change control to Product Details. */
window.v15SetProductPrice=function(productId){
  if(!adminOnly())return;
  const p=product(productId);if(!p)return;
  const price=Number(document.getElementById('v15Price_'+String(productId).replace(/[^a-zA-Z0-9_-]/g,''))?.value);
  const reason=String(document.getElementById('v15PriceReason_'+String(productId).replace(/[^a-zA-Z0-9_-]/g,''))?.value||'').trim();
  if(!Number.isFinite(price)||price<0||price>100000000)return toast('Enter a valid price');
  if(reason.length<3)return toast('Reason is required');
  const old=Number(p.price||0);p.price=Math.round(price*100)/100;p.adminPriceEditedAt=nowISO();p.adminPriceEditedBy=S.currentUser?.id||'ADMIN';p.adminPriceEditReason=reason;
  logAdminAudit('Admin changed product price',p.id,{sellerId:p.sellerId,oldPrice:old,newPrice:p.price,reason});
  logProductActivity(p.id,'Admin changed product price',{sellerId:p.sellerId,oldPrice:old,newPrice:p.price,reason});
  v15PushSellerReason(p.sellerId,'Product price changed by Admin',reason,{action:'PRICE_CHANGE',productId:p.id,productTitle:p.title,oldPrice:old,newPrice:p.price});
  save();toast('Product price updated');render();
};
const v15OldProductDetail=window.adminProductDetail;
if(v15OldProductDetail){
  window.adminProductDetail=function(id){
    const html=v15OldProductDetail(id),p=product(id);if(!p)return html;
    const safe=String(id).replace(/[^a-zA-Z0-9_-]/g,'');
    const t=document.createElement('template');t.innerHTML=html;const root=t.content.querySelector('.admin-content');
    if(root)root.insertAdjacentHTML('beforeend',`<div class="admin-card" style="margin-top:18px"><div class="section-head"><div><h2>Admin Price Control</h2><div class="sub">Change this product price. Seller receives the reason in Warnings.</div></div><span class="admin-pill danger">ADMIN ONLY</span></div><div class="form-grid"><div class="field"><label>New Price</label><input id="v15Price_${safe}" type="number" min="0" step="0.01" value="${Number(p.price||0)}"></div><div class="field"><label>Reason (required)</label><input id="v15PriceReason_${safe}" maxlength="500" placeholder="Why is the price being changed?"></div></div><button class="btn primary" onclick="v15SetProductPrice('${esc(id)}')">Save Price Change</button></div>`);
    return t.innerHTML;
  };
}

/* Payout cancellation reason -> same seller warning stream. */
const v15OldConfirmCancel=window.adminConfirmCancelPayout;
if(v15OldConfirmCancel){
  window.adminConfirmCancelPayout=function(id){
    if(!adminOnly())return;
    const p=(S.payouts||[]).find(x=>String(x.id)===String(id));if(!p)return;
    const reason=String(document.getElementById('poCancelReason')?.value||'').trim();
    const r=v15OldConfirmCancel(id);
    if(p.status==='CANCELLED'&&reason.length>=3){
      v15PushSellerReason(p.sellerId,'Payout cancelled by Admin',reason,{action:'PAYOUT_CANCEL',payoutId:p.id,amount:Number(p.amount||0)});
      save();
    }
    return r;
  };
}

/* Admin Warnings page: clearer single place for manual warning/reason messages. */
const v15OldWarnings=window.adminWarnings;
if(v15OldWarnings){
  window.adminWarnings=function(){
    let html=v15OldWarnings();
    const t=document.createElement('template');t.innerHTML=html;
    const root=t.content.querySelector('.admin-content');
    if(root){
      const card=document.createElement('div');card.className='admin-card';
      card.innerHTML=`<div class="section-head"><div><h2>Send Warning / Reason</h2><div class="sub">Use this once for any seller notice. It appears in the seller's Warnings → Reason section.</div></div><span class="admin-pill warn">SELLER NOTICE</span></div><div class="form-grid"><div class="field"><label>Seller/User ID</label><input id="v15WarnSid" placeholder="seller id or user id"></div><div class="field"><label>Title</label><input id="v15WarnTitle" maxlength="120" value="Admin Warning / Reason"></div></div><div class="field"><label>Warning / Reason message</label><textarea id="v15WarnMsg" maxlength="2000" placeholder="Write the reason that the seller should see..."></textarea></div><button class="btn primary" onclick="v15SendManualWarning()">Send to Seller Warnings</button>`;
      root.insertBefore(card,root.firstChild);
    }
    return t.innerHTML;
  };
}
window.v15SendManualWarning=function(){
  if(!adminOnly())return;
  const raw=(document.getElementById('v15WarnSid')?.value||'').trim(),title=(document.getElementById('v15WarnTitle')?.value||'Admin Warning / Reason').trim(),msg=(document.getElementById('v15WarnMsg')?.value||'').trim();
  if(!raw||msg.length<3)return toast('Seller/User ID and message are required');
  let sid=raw;if(!S.sellers[sid]){const u=(S.users||[]).find(x=>String(x.id)===String(raw));if(u?.sellerId)sid=u.sellerId;else return toast('User/Seller ID not found');}
  if(!v15PushSellerReason(sid,title,msg,{action:'MANUAL_WARNING'}))return toast('Could not send warning');
  logAdminAudit('Sent manual seller warning/reason',sid,{title,reason:msg});save();toast('Warning/reason sent to seller');render();
};

/* Checkout coupon UX: Apply and Cancel are explicit; price resets to original on cancel. */
const v15OldOpenBuy=window.openBuy;
if(v15OldOpenBuy){
  window.openBuy=function(id){
    v15OldOpenBuy(id);
    setTimeout(()=>{
      const p=product(id),x=window.pendingBuy;if(!p||!x)return;
      const modal=document.getElementById('modalRoot');if(!modal)return;
      const couponRow=modal.querySelector('#buyCoupon')?.closest('.field');
      if(couponRow&&x.couponCode){
        let info=couponRow.querySelector('[data-v15-coupon-info]');
        if(!info){info=document.createElement('div');info.setAttribute('data-v15-coupon-info','1');info.className='small';info.style.marginTop='7px';couponRow.appendChild(info);}
        info.textContent=`Applied: ${x.couponCode} · Discount ${money(Number(x.discount||0))}`;
      }
    },0);
  };
}
window.cancelCheckoutCoupon=window.cancelCheckoutCoupon||function(){};

/* Label Admin-generated notices as Reason inside the seller Warnings page. */
const v15OldDashWarnings=window.dashWarnings;
if(v15OldDashWarnings){
  window.dashWarnings=function(){
    let html=v15OldDashWarnings();
    html=html.replace(/<p>\$\{esc\(w\.message\|\|'\'\)\}<\/p>/g,'<p><b>Reason:</b> \${esc(w.message||\'\')}</p>');
    return html;
  };
}

})();
