
(function(){
  'use strict';
  const PC_CHECKED='adminChecked';
  const PC_VERIFIED='adminVerified';
  const pcProducts=()=>Array.isArray(S.products)?S.products:[];
  const pcChecked=p=>p?.[PC_CHECKED]===true;
  const pcVerified=p=>p?.[PC_VERIFIED]===true;
  const pcBadgeMarkup=p=>pcVerified(p)?'<span class="product-check-badge verified">✓ Verified</span>':pcChecked(p)?'<span class="product-check-badge checked">✓ Checked</span>':'';
  const pcEscId=id=>esc(encodeURIComponent(String(id||'')));

  window.__pcInFlight=window.__pcInFlight||new Set();
  window.adminProductCheckAction=function(id,kind){
    if(!adminOnly())return;
    if(['approve','reject','pending'].includes(kind)){
      if(window.__pcInFlight.has(id))return; // a decision on this product is already being processed; ignore the duplicate click
      window.__pcInFlight.add(id);
      setTimeout(()=>window.__pcInFlight.delete(id),4000); // safety release in case something below throws
    }
    const p=product(id);if(!p){window.__pcInFlight.delete(id);return toast('Product not found');}
    let decided=false;
    if(kind==='approve'){
      const scan=productSafetyScan(p);
      if(scan.flagged){p.safetyStatus='FLAGGED';p.safetyFlags=scan.reasons;save();window.__pcInFlight.delete(id);return toast('Cannot approve: safety check flagged this product. Review the product and delivery links first.');}
      if(!p.rightsConfirmed){window.__pcInFlight.delete(id);return toast('Seller rights confirmation is missing. Reject or request resubmission.');}
      if(approveProductByAdmin(p)){p.publicLive=true;adminAudit('Approved product after safety review',p.id,{productId:p.id,sellerId:p.sellerId});save();toast('Product approved and is now live on the marketplace.');decided=true;}
    }else if(kind==='reject'){
      rejectProductByAdmin(p,'Rejected during admin safety review');p.publicLive=false;adminAudit('Rejected product after safety review',p.id,{productId:p.id,sellerId:p.sellerId});save();toast('Product rejected and hidden from marketplace.');decided=true;
    }else if(kind==='pending'){
      markProductPendingReview(p,'Returned to admin review');p.publicLive=false;adminAudit('Returned product to pending review',p.id,{productId:p.id,sellerId:p.sellerId});save();toast('Product returned to Pending Review.');decided=true;
    }else if(kind==='checked'){
      if(pcVerified(p))return toast('First move this product back from Verified');
      p[PC_CHECKED]=!pcChecked(p);adminAudit(p[PC_CHECKED]?'Checked product':'Moved product back from Checked',p.id,{productId:p.id});save();toast(p[PC_CHECKED]?'Product marked Checked':'Product moved back from Checked');
    }else if(kind==='verified'){
      p[PC_CHECKED]=true;p[PC_VERIFIED]=!pcVerified(p);adminAudit(p[PC_VERIFIED]?'Verified product':'Moved product back from Verified',p.id,{productId:p.id});save();toast(p[PC_VERIFIED]?'Product marked Verified':'Product moved back to Checked');
    }
    render();
    if(decided){
      window.__pcInFlight.delete(id);
      // Push and broadcast immediately (don't wait for the normal debounce) so other
      // admin tabs, the seller's dashboard and the public marketplace all pick up the
      // correct status right away instead of showing a stale one until the next sync.
      if(typeof pushOnlineState==='function')pushOnlineState();
    }
  };

  function pcCategoryOptions(selected){
    const cats=[...new Set(pcProducts().map(p=>String(p.category||'Other').trim()||'Other'))].sort((a,b)=>a.localeCompare(b));
    return '<option value="ALL">All categories</option>'+cats.map(c=>`<option value="${esc(c)}" ${selected===c?'selected':''}>${esc(c)}</option>`).join('');
  }
  function pcProductCard(p){
    const checked=pcChecked(p),verified=pcVerified(p),sellerData=seller(p.sellerId),approval=p.approvalStatus||'APPROVED',flagged=p.safetyStatus==='FLAGGED';
    const approvalBadge=approval==='PENDING'?'<span class="product-check-badge pending">⏳ Pending Review</span>':approval==='REJECTED'?'<span class="product-check-badge rejected">✕ Rejected</span>':'<span class="product-check-badge approved">✓ Approved</span>';
    const safetyBadge=flagged?'<span class="product-check-badge rejected">⚠ Safety Flag</span>':'<span class="product-check-badge checked">✓ Safety Clear</span>';
    return `<article class="pc-product"><div class="pc-product-image">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.title||'Product')}">`:'🧩'}</div><div class="pc-product-main"><h3 title="${esc(p.title||'Untitled product')}">${esc(p.title||'Untitled product')}</h3><div class="pc-meta">Category: <b>${esc(p.category||'Other')}</b><br>Seller: @${esc(p.sellerId||'-')} · ${esc(sellerData.name||'Seller')}<br>Price: ${money(p.price||0)} · Sales: ${productSales(p.id)}<br>Links: ${(p.links||[]).length} · Status: <b>${esc(productApprovalLabel(p))}</b></div><div class="pc-badges">${approvalBadge}${safetyBadge}${pcBadgeMarkup(p)}</div>${flagged?`<div class="small" style="margin-top:8px;color:#b42318"><b>Flags:</b> ${esc((p.safetyFlags||[]).join(' · '))}</div>`:''}<div class="pc-actions"><button class="btn" onclick="adminNav('product/${pcEscId(p.id)}')">Open Product</button>${approval==='PENDING'?`<button class="btn primary" onclick="adminProductCheckAction('${pcEscId(p.id)}','approve')">Approve</button><button class="btn danger" onclick="adminProductCheckAction('${pcEscId(p.id)}','reject')">Reject</button>`:approval==='APPROVED'?`<button class="btn" onclick="adminProductCheckAction('${pcEscId(p.id)}','pending')">Send to Review</button>`:`<button class="btn primary" onclick="adminProductCheckAction('${pcEscId(p.id)}','pending')">Request Re-review</button>`}<button class="btn" ${verified?'disabled':''} onclick="adminOpenProductSecret('${pcEscId(p.id)}');adminProductCheckAction('${pcEscId(p.id)}','checked')">${verified?'✓ Checked':checked?'Back Checked':'Check'}</button><button class="btn ${verified?'primary':''}" onclick="adminProductCheckAction('${pcEscId(p.id)}','verified')">${verified?'Back Verified':'Verify'}</button></div></div></article>`;
  }

  function pcCounts(){const all=pcProducts();return {total:all.length,pending:all.filter(p=>(p.approvalStatus||'APPROVED')==='PENDING').length,flagged:all.filter(p=>p.safetyStatus==='FLAGGED').length,approved:all.filter(p=>(p.approvalStatus||'APPROVED')==='APPROVED').length,rejected:all.filter(p=>(p.approvalStatus||'APPROVED')==='REJECTED').length,checked:all.filter(pcChecked).length,verified:all.filter(pcVerified).length};}
  function pcSidebar(){
    let side=adminSidebar('product-check');
    const link='<button class="admin-link active" onclick="adminNav(\'product-check\')"><span>✓</span><span class="label">Product Check</span></button>';
    const marker='<div class="admin-nav-title">System</div>';
    if(!side.includes('Product Check'))side=side.replace(marker,link+marker);
    return side;
  }
  function pcPage(){
    if(!adminOnly())return `${header()}<main class="page"></main>`;
    const counts=pcCounts();
    const tab=window.pcTab||'pending',cat=window.pcCategory||'ALL',q=String(window.pcQuery||'').trim().toLowerCase();
    let rows=pcProducts();
    if(tab==='pending')rows=rows.filter(p=>(p.approvalStatus||'APPROVED')==='PENDING');
    if(tab==='flagged')rows=rows.filter(p=>p.safetyStatus==='FLAGGED');
    if(tab==='approved')rows=rows.filter(p=>(p.approvalStatus||'APPROVED')==='APPROVED');
    if(tab==='rejected')rows=rows.filter(p=>(p.approvalStatus||'APPROVED')==='REJECTED');
    if(tab==='checked')rows=rows.filter(pcChecked);
    if(tab==='verified')rows=rows.filter(pcVerified);
    if(cat!=='ALL')rows=rows.filter(p=>String(p.category||'Other')===cat);
    if(q)rows=rows.filter(p=>`${p.title||''} ${p.id||''} ${p.sellerId||''} ${p.category||''}`.toLowerCase().includes(q));
    const tabs=[['pending','Pending Review',counts.pending],['flagged','Safety Flags',counts.flagged],['approved','Approved',counts.approved],['rejected','Rejected',counts.rejected],['checked','Checked',counts.checked],['verified','Verified',counts.verified]];
    const content=`<div class="admin-card"><div class="section-head"><div><h2>Product Safety & Approval</h2><div class="sub">New or edited products stay hidden until Admin approval. Automated checks flag suspicious content and Admin can inspect the delivery links before approval.</div></div><span class="admin-pill success">${counts.total} Products</span></div><div class="pc-tabs">${tabs.map(([id,label,count])=>`<button class="pc-tab ${tab===id?'active':''}" onclick="window.pcTab='${id}';render()">${label}<span>${count}</span></button>`).join('')}</div><div class="pc-toolbar"><input class="input admin-search" value="${esc(window.pcQuery||'')}" placeholder="Search product, seller or ID" oninput="pcFilterList(this)"><select class="input" onchange="window.pcCategory=this.value;render()">${pcCategoryOptions(cat)}</select></div><div class="pc-grid">${rows.map(pcProductCard).join('')||'<div class="pc-empty">No products found in this view.</div>'}</div></div>`;
    return `<div class="admin-shell">${pcSidebar()}<section class="admin-main">${adminTop('Product Check')}<div class="admin-content">${content}</div></section></div>`;
  }

  function pcDetailWithControls(id){
    const p=product(id),html=adminProductDetail(id);
    if(!p)return html;
    const checked=pcChecked(p),verified=pcVerified(p),approval=p.approvalStatus||'APPROVED',flagged=p.safetyStatus==='FLAGGED';
    const controls=`<div class="admin-card" style="margin-bottom:18px"><div class="section-head"><div><h2>Product Safety Review</h2><div class="sub">A product is public only after Admin approval. Delivery remains link-only and must use an approved HTTPS provider.</div></div><div>${approval==='PENDING'?'<span class="admin-pill warn">Pending Review</span>':approval==='REJECTED'?'<span class="admin-pill danger">Rejected</span>':'<span class="admin-pill success">Approved</span>'}</div></div>${flagged?`<div class="admin-card" style="margin:12px 0;background:rgba(220,38,38,.06);border-color:rgba(220,38,38,.25)"><b>⚠ Automated safety flags</b><div class="small muted" style="margin-top:6px">${esc((p.safetyFlags||[]).join(' · ')||'Manual review required')}</div></div>`:''}<div class="admin-actions">${approval==='PENDING'?`<button class="btn primary" onclick="adminProductCheckAction('${pcEscId(p.id)}','approve')">Approve & Publish</button><button class="btn danger" onclick="adminProductCheckAction('${pcEscId(p.id)}','reject')">Reject</button>`:`<button class="btn" onclick="adminProductCheckAction('${pcEscId(p.id)}','pending')">Send to Review</button>`}<button class="btn ${checked&&!verified?'primary':''}" ${verified?'disabled':''} onclick="adminOpenProductSecret('${pcEscId(p.id)}');adminProductCheckAction('${pcEscId(p.id)}','checked')">${verified?'✓ Checked':checked?'Back Checked':'Mark Checked'}</button><button class="btn ${verified?'primary':''}" onclick="adminProductCheckAction('${pcEscId(p.id)}','verified')">${verified?'Back Verified':'Mark Verified'}</button><button class="btn" onclick="adminNav('product-check')">Back to Product Check</button></div></div>`;
    return html.replace('<div class="admin-content">',`<div class="admin-content">${controls}`);
  }

  const pcOriginalProductCard=productCard;
  productCard=function(p){
    let html=pcOriginalProductCard(p);
    const badge=pcBadgeMarkup(p);if(!badge)return html;
    const tpl=document.createElement('template');tpl.innerHTML=html;
    const tagWrap=tpl.content.querySelector('.body > div');
    if(tagWrap)tagWrap.insertAdjacentHTML('beforeend',badge);
    return tpl.innerHTML;
  };

  const pcOriginalRender=window.render;
  window.render=function(){
    const r=route();
    if(r==='admin/product-check'){
      document.getElementById('app').innerHTML=pcPage();
      applyPlatformConfig();
      if(typeof bindAdminScroll==='function')bindAdminScroll();
      return;
    }
    if(r.startsWith('admin/product/')){
      const id=decodeURIComponent(r.split('/')[2]||'');
      document.getElementById('app').innerHTML=pcDetailWithControls(id);
      applyPlatformConfig();
      if(typeof bindAdminScroll==='function')bindAdminScroll();
      return;
    }
    pcOriginalRender();
  };

})();
