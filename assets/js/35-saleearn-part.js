
(function(){
  'use strict';
  function exactProductId(a,b){return String(a||'')===String(b||'')}
  function orderBelongsToViewer(o){
    if(!o)return false;
    if(typeof isAdmin==='function'&&isAdmin())return true;
    const u=S.currentUser;
    if(u)return (!o.customerId||String(o.customerId)===String(u.id)||String(o.customerEmail||'').toLowerCase()===String(u.email||'').toLowerCase());
    return String(window.lastPurchasedOrderId||'')===String(o.id||'');
  }
  function exactOrderForProduct(id){
    const u=S.currentUser,uid=String(u?.id||''),email=String(u?.email||'').toLowerCase();
    return (S.orders||[]).find(o=>o.status==='SUCCESS'&&exactProductId(o.productId,id)&&((u&&(String(o.customerId||'')===uid||String(o.customerEmail||'').toLowerCase()===email))||(!u&&String(window.lastPurchasedOrderId||'')===String(o.id||''))));
  }
  function savedDelivery(o){
    const links=Array.isArray(o?.deliveryLinks)&&o.deliveryLinks.length?o.deliveryLinks.filter(Boolean):(o?.deliveryUrl?[o.deliveryUrl]:[]);
    const titles=Array.isArray(o?.deliveryTitles)?o.deliveryTitles:[];
    return links.map((url,i)=>({url,title:titles[i]||`File ${i+1}`}));
  }
  function purchaseSuccessPage(id){
    const o=(S.orders||[]).find(x=>String(x.id)===String(id));
    if(!o||o.status!=='SUCCESS'||!orderBelongsToViewer(o))return notFound();
    window.lastPurchasedOrderId=o.id;
    const p=product(o.productId),title=o.productTitle||p?.title||'Purchased product',image=o.productImage||p?.image||'';
    const links=savedDelivery(o);
    return `${header()}<main class="page"><div class="container"><div class="success-card"><div class="success-icon">✓</div><h1>Payment Successful</h1><p class="muted">Your verified delivery for this exact product is ready.</p><div class="dash-card" style="text-align:left;margin:18px 0"><div style="display:flex;gap:12px;align-items:center">${image?`<img src="${esc(image)}" alt="${esc(title)}" style="width:78px;height:62px;object-fit:cover;border-radius:10px">`:''}<div><b>${esc(title)}</b><div class="small muted">Product ID: ${esc(o.productId||'-')} · Order ID: ${esc(o.id||'-')}</div></div></div></div><div class="delivery-links">${links.map(x=>`<div class="link-box delivery-link-item"><div><b>${esc(x.title)}</b><small>${esc((()=>{try{return new URL(x.url).hostname}catch{return 'Secure delivery link'}})())}</small></div><button class="btn primary" onclick="window.open('${esc(x.url)}','_blank','noopener')">Open Secret Link</button></div>`).join('')||'<div class="link-box">No saved delivery link is available for this order. Contact seller support instead of opening another product link.</div>'}</div><p class="small muted">Only the delivery snapshot saved with this order is used.</p><div class="hero-actions" style="justify-content:center"><button class="btn" onclick="go('account/orders')">View My Order</button><button class="btn" onclick="go('market')">Continue Shopping</button></div></div></div></main>${footer()}`;
  }

  window.hasPurchased=function(pid){
    /* Admin has free access to every product without creating a fake paid order. */
    if(typeof isAdmin==='function'&&isAdmin())return true;
    return !!exactOrderForProduct(pid);
  };
  window.adminOpenProductSecret=function(id){
    if(!(typeof isAdmin==='function'&&isAdmin())){toast('Admin access required');return;}
    const p=product(id);
    if(!p)return toast('Product not found');
    const links=Array.isArray(p.links)?p.links.filter(Boolean):[];
    const titles=Array.isArray(p.linkTitles)?p.linkTitles:[];
    if(!links.length){toast('No secret delivery link is saved for this product');return;}
    const rows=links.map((url,i)=>`<div class="link-box delivery-link-item"><div><b>${esc(titles[i]||`File ${i+1}`)}</b><small>${esc((()=>{try{return new URL(url).hostname}catch{return 'Delivery link'}})())}</small></div><button class="btn primary" onclick="window.open('${esc(url)}','_blank','noopener')">Open Secret Link</button></div>`).join('');
    document.getElementById('modalRoot').innerHTML=`<div class="modal-bg"><div class="modal" style="max-width:720px"><div class="section-head"><div><h2>Admin Product Access</h2><div class="sub">${esc(p.title||'Product')} · Admin-only free access</div></div><button class="btn iconbtn" onclick="closeModal()">×</button></div><div class="dash-card" style="margin:14px 0"><b>Secret delivery links</b><div class="small muted" style="margin-top:5px">No payment or order is required for Admin.</div></div><div class="delivery-links">${rows}</div><div class="modal-footer"><button class="btn" onclick="closeModal()">Close</button></div></div></div>`;
  };
  window.openPurchasedByProduct=function(id){
    if(typeof isAdmin==='function'&&isAdmin())return adminOpenProductSecret(id);
    const o=exactOrderForProduct(id);
    if(!o)return toast('Purchase not found for this exact product');
    window.lastPurchasedOrderId=o.id;
    openPurchasedAsset(o.id);
  };
  window.openPurchasedAsset=function(orderId){
    const o=(S.orders||[]).find(x=>String(x.id)===String(orderId));
    if(!o||o.status!=='SUCCESS'||!orderBelongsToViewer(o)){toast('Secure file access unavailable');return}
    window.lastPurchasedOrderId=o.id;
    go('success/'+encodeURIComponent(String(o.id)));
  };
  success=purchaseSuccessPage;
})();
