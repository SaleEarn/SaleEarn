
(function(){
  'use strict';

  /* ---------- 1) Tags: max 3 tags, max 14 words per tag ---------- */
  const seTagLimitPrev = window.saveStep1;
  window.saveStep1 = function(editId){
    const tagText = (document.getElementById('tagInput')?.value || '').trim();
    if(tagText){
      const tagsArr = tagText.split(',').map(x=>x.trim()).filter(Boolean);
      if(tagsArr.length > 3) return toast('Maximum 3 tags allowed');
      const tooLong = tagsArr.find(t => t.split(/\s+/).filter(Boolean).length > 14);
      if(tooLong) return toast('Each tag can have a maximum of 14 words');
    }
    return seTagLimitPrev(editId);
  };

  /* ---------- 2) Admin reject -> ask for a reason ---------- */
  const seOldPCAction = window.adminProductCheckAction;
  window.adminProductCheckAction = function(id, kind){
    if(kind === 'reject'){
      if(!adminOnly()) return;
      if(window.__pcInFlight&&window.__pcInFlight.has(id))return;
      const p = product(id); if(!p) return toast('Product not found');
      const reason = prompt('Reason for rejecting this product (the seller will see this):', '');
      if(reason === null) return;
      window.__pcInFlight=window.__pcInFlight||new Set();window.__pcInFlight.add(id);
      const finalReason = reason.trim() || 'Product does not meet Sale Earn marketplace rules';
      rejectProductByAdmin(p, finalReason);
      adminAudit('Rejected product after safety review', p.id, {productId:p.id, sellerId:p.sellerId, reason:finalReason});
      save();
      toast('Product rejected and hidden from marketplace.');
      render();
      window.__pcInFlight.delete(id);
      if(typeof pushOnlineState==='function')pushOnlineState();
      return;
    }
    return seOldPCAction ? seOldPCAction(id, kind) : undefined;
  };

  /* ---------- 3) Seller reply to a rejected product + admin viewing replies ---------- */
  window.sellerReplyToRejection = function(id){
    const p = product(id); if(!p) return;
    const msg = prompt('Reply to admin about this rejection:', '');
    if(msg === null) return;
    const text = msg.trim(); if(!text) return;
    p.sellerReplies = p.sellerReplies || [];
    p.sellerReplies.push({id: uid('reply'), text, date: nowISO(), by:'seller'});
    p.adminUnseenReply = true;
    save();
    toast('Reply sent to admin');
    render();
  };
  window.adminViewProductReplies = function(id){
    const p = product(id); if(!p) return;
    const replies = p.sellerReplies || [];
    const body = replies.length ? replies.map(r=>`<div class="security-row"><div><b>Seller</b><div class="small muted">${new Date(r.date).toLocaleString('en-IN')}</div><div>${esc(r.text)}</div></div></div>`).join('') : '<div class="admin-empty">No replies yet.</div>';
    p.adminUnseenReply = false; save();
    document.getElementById('modalRoot').innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal"><button class="btn iconbtn close" onclick="closeModal()">×</button><h2>Seller replies — ${esc(p.title||'')}</h2>${body}<div class="modal-footer"><button class="btn" onclick="closeModal()">Close</button></div></div></div>`;
    render();
  };

  /* ---------- 4) Admin sidebar: red count badge on "Products" (pending + unseen replies) ---------- */
  const seOldAdminSidebar = adminSidebar;
  adminSidebar = function(active){
    let html = seOldAdminSidebar(active);
    const ps = S.products||[];
    const need = ps.filter(p=>(p.approvalStatus||'APPROVED')==='PENDING' || p.adminUnseenReply===true).length;
    if(need>0){
      const badge = `<span style="margin-left:auto;min-width:20px;height:20px;border-radius:999px;background:#ef5b68;color:#fff;font-size:10px;font-weight:900;display:inline-flex;align-items:center;justify-content:center;padding:0 5px">${need}</span>`;
      html = html.replace(/(<button class="admin-link[^>]*onclick="adminNav\('products'\)"[^>]*>)([\s\S]*?)(<\/button>)/,
        (m,a,mid,b)=> a + mid + badge + b);
    }
    return html;
  };

  /* ---------- 5) Admin "Products" page: status badges, filter tabs, approve/reject, replies ---------- */
  window.adminProducts = function(){
    const deletedIds = typeof deletedProductIdSet === 'function' ? deletedProductIdSet() : new Set();
    const liveProducts = (S.products||[]).filter(p=>!deletedIds.has(String(p?.id)));
    const deletedProducts = (S.deletedProducts||[]).slice();
    const tab = window.apTab||'ALL';
    const tabs = [['ALL','All'],['PENDING','Pending'],['APPROVED','Approved'],['REJECTED','Rejected'],['CHECKED','Checked'],['VERIFIED','Verified'],['DELETED','Deleted']];
    const countFor = id => id==='ALL'?liveProducts.length
      : id==='DELETED'?deletedProducts.length
      : id==='CHECKED'?liveProducts.filter(p=>p.adminChecked).length
      : id==='VERIFIED'?liveProducts.filter(p=>p.adminVerified).length
      : liveProducts.filter(p=>(p.approvalStatus||'APPROVED')===id).length;
    if(tab==='DELETED'){
      const rows=deletedProducts.map(p=>`<div class="security-row recycle-row"><div><b>${esc(p.title||'Untitled Product')}</b><div class="small muted">${esc(p.id)} · Seller @${esc(p.sellerId||'-')} · Deleted ${p.deletedAt?new Date(p.deletedAt).toLocaleString('en-IN'):'-'}</div></div><div class="admin-actions"><button class="btn" onclick="adminRestoreProduct('${esc(p.id)}')">Restore</button><button class="btn danger" onclick="adminPermanentDelete('${esc(p.id)}')">Delete Forever</button></div></div>`).join('')||'<div class="admin-empty">No deleted products.</div>';
      return adminLayout('products','Products',`<div class="admin-card"><div class="section-head"><div><h2>Product Management</h2><div class="sub">Deleted products are hidden from the marketplace and kept here until Admin restores or permanently deletes them.</div></div></div><div class="pc-tabs">${tabs.map(([id,label])=>`<button class="pc-tab ${tab===id?'active':''}" onclick="window.apTab='${id}';render()">${label}<span>${countFor(id)}</span></button>`).join('')}</div><div style="margin-top:14px">${rows}</div></div>`);
    }
    let list = liveProducts;
    if(tab==='CHECKED') list = liveProducts.filter(p=>p.adminChecked);
    else if(tab==='VERIFIED') list = liveProducts.filter(p=>p.adminVerified);
    else if(tab!=='ALL') list = liveProducts.filter(p=>(p.approvalStatus||'APPROVED')===tab);
    list = list.slice().sort((a,b)=>{
      const ap=(a.approvalStatus||'APPROVED')==='PENDING'?1:0, bp=(b.approvalStatus||'APPROVED')==='PENDING'?1:0;
      if(bp!==ap)return bp-ap;
      return new Date(b.createdAt||b.savedAt||0).getTime()-new Date(a.createdAt||a.savedAt||0).getTime();
    });
    const badge = p => {const st=p.approvalStatus||'APPROVED';if(st==='PENDING')return '<span class="product-check-badge pending">⏳ Pending</span>';if(st==='REJECTED')return '<span class="product-check-badge rejected">✕ Rejected</span>';if(p.adminVerified)return '<span class="product-check-badge verified">✓ Verified</span>';if(p.adminChecked)return '<span class="product-check-badge checked">✓ Checked</span>';return '<span class="product-check-badge approved">✓ Approved</span>';};
    const rows=list.map(p=>{const st=p.approvalStatus||'APPROVED';const replyBtn=p.adminUnseenReply?`<button class="btn danger" onclick="event.stopPropagation();adminViewProductReplies('${esc(p.id)}')">💬 New reply</button>`:((p.sellerReplies||[]).length?`<button class="btn" onclick="event.stopPropagation();adminViewProductReplies('${esc(p.id)}')">💬 Replies</button>`:'');const approveReject=st==='PENDING'?`<button class="btn primary" onclick="event.stopPropagation();adminProductCheckAction('${esc(p.id)}','approve')">Approve</button> <button class="btn danger" onclick="event.stopPropagation();adminProductCheckAction('${esc(p.id)}','reject')">Reject</button>`:'';return `<tr class="data-row" onclick="adminNav('product/${esc(p.id)}')"><td><b>${esc(p.title)}</b><div class="small muted">${esc(p.id)}</div></td><td>@${esc(p.sellerId)}</td><td>${productSales(p.id)}</td><td>${money(p.price)}</td><td>${badge(p)}</td><td onclick="event.stopPropagation()">${approveReject} ${replyBtn} <button class="btn danger" onclick="adminDeleteProduct('${esc(p.id)}')">Delete</button></td></tr>`;}).join('');
    return adminLayout('products','Products',`<div class="admin-card"><div class="section-head"><div><h2>Product Management</h2><div class="sub">Open any product to inspect seller, sales, files and secure delivery URL.</div></div></div><div class="pc-tabs">${tabs.map(([id,label])=>`<button class="pc-tab ${tab===id?'active':''}" onclick="window.apTab='${id}';render()">${label}<span>${countFor(id)}</span></button>`).join('')}</div><table class="admin-table"><thead><tr><th>Product</th><th>Seller</th><th>Sales</th><th>Price</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows||'<tr><td colspan="6"><div class="admin-empty">No products.</div></td></tr>'}</tbody></table></div>`);
  };

  /* ---------- 6) Seller dashboard: status badge + reply button on each live product ---------- */
  const seOldPMCard = productManagerCard;
  productManagerCard = function(p, type){
    let html = seOldPMCard(p, type);
    if(type === 'live'){
      const st = p.approvalStatus || 'APPROVED';
      let badgeHtml = st==='PENDING' ? '<span class="product-check-badge pending">⏳ Pending Review</span>'
        : st==='REJECTED' ? '<span class="product-check-badge rejected">✕ Rejected</span>'
        : p.adminVerified ? '<span class="product-check-badge verified">✓ Verified</span>'
        : p.adminChecked ? '<span class="product-check-badge checked">✓ Checked</span>'
        : '<span class="product-check-badge approved">✓ Approved</span>';
      let extra = `<div class="pm-approval-status" style="margin-top:6px">${badgeHtml}`;
      if(st==='REJECTED'){
        extra += `<div class="small" style="color:#b42318;margin-top:4px"><b>Reason:</b> ${esc(p.approvalReason||'Not specified')}</div><button class="btn" style="margin-top:6px" onclick="sellerReplyToRejection('${esc(p.id)}')">↩ Reply to Admin</button>`;
      }
      extra += '</div>';
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      tpl.content.querySelector('.pm-info')?.insertAdjacentHTML('beforeend', extra);
      html = tpl.innerHTML;
    }
    return html;
  };

  /* ---------- 7) Seller dashboard sidebar: red badges for Products (rejected) and Warnings ---------- */
  const seOldDashShell = dashShell;
  dashShell = function(page, content){
    let html = seOldDashShell(page, content);
    const s = currentSeller ? currentSeller() : null;
    if(!s) return html;
    const rejectedCount = (S.products||[]).filter(p=>p.sellerId===s.id && (p.approvalStatus||'APPROVED')==='REJECTED').length;
    const warnCount = (S.warnings||[]).filter(w=>w.sellerId===s.id && !w.read).length;
    if(rejectedCount>0){
      html = html.replace(/(<button class="dash-link[^"]*" onclick="go\('dashboard\/products'\)">.*?)(<\/button>)/,
        (m,a,b)=> a + `<span class="count">${rejectedCount}</span>` + b);
    }
    if(warnCount>0){
      html = html.replace(/(<button class="dash-link[^"]*" onclick="go\('dashboard\/warnings'\)">.*?)(<\/button>)/,
        (m,a,b)=> a + `<span class="count">${warnCount}</span>` + b);
    }
    return html;
  };
})();
