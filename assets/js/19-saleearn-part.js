
(function(){
 'use strict';
 const baseCurrentSeller=window.currentSeller;
 window.currentSeller=function(){
   if(window.adminSellerPreview && typeof isAdmin==='function' && isAdmin() && S.sellers?.[window.adminSellerPreview]) return S.sellers[window.adminSellerPreview];
   return baseCurrentSeller?baseCurrentSeller():null;
 };

 function sellerOrders(sid){return (S.orders||[]).filter(o=>String(o.sellerId||'')===String(sid));}
 function sellerProductsAll(sid){return (S.products||[]).filter(p=>String(p.sellerId||'')===String(sid));}
 function adminSellerNotice(sid,title,body,type='message'){
   if(!adminOnly())return;
   const s=seller(sid),u=sellerOwnerUser(sid); if(!s)return;
   const text=String(body||'').trim(); if(!text)return toast('Reason/message is required');
   if(type==='warning'){
     S.warnings=S.warnings||[];
     const w={id:uid('warn'),sellerId:sid,userId:u?.id||null,title:String(title||'Admin Notice'),message:text,date:nowISO(),read:false};
     S.warnings.unshift(w); adjustSellerScore(sid,-10,'Admin warning','WARNING:'+w.id,'ADMIN'); logAdminAudit('Sent seller warning',sid,{title:w.title,reason:text});
   }else{
     if(typeof warningMailStore==='function'){
       const m={id:uid('mail'),threadId:uid('thread'),type:'outbox',from:'Sale Earn Admin',fromEmail:'',to:u?.email||s.owner||'Seller',subject:String(title||'Admin Message'),body:text,date:nowISO(),read:false,starred:false,userId:u?.id||null,sellerId:sid};
       warningMailStore().unshift(m); if(warningMailStore().length>500)warningMailStore().length=500;
     }
     logAdminAudit('Sent seller admin message',sid,{title,reason:text});
   }
   save(); toast(type==='warning'?'Warning sent to seller':'Message sent to seller'); render();
 }
 window.adminSellerNotice=adminSellerNotice;

 window.adminEditSellerOrder=function(orderId){
   if(!adminOnly())return;
   const o=(S.orders||[]).find(x=>String(x.id)===String(orderId)); if(!o)return toast('Order not found');
   const p=product(o.productId),sid=o.sellerId;
   const oldStatus=o.status||'SUCCESS',oldAmount=Number(o.amount||0);
   const modal=document.getElementById('modalRoot');
   modal.innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:700px;width:96%;max-height:92vh;overflow:auto"><button class="btn iconbtn close" onclick="closeModal()">×</button><h2>Edit Seller Order</h2><p class="muted">${esc(p?.title||'Deleted product')} · ${esc(o.id)}</p><div class="form-grid"><div class="field"><label>Status</label><select id="aseOrderStatus"><option ${oldStatus==='SUCCESS'?'selected':''}>SUCCESS</option><option ${oldStatus==='PENDING'?'selected':''}>PENDING</option><option ${oldStatus==='CANCELLED'?'selected':''}>CANCELLED</option><option ${oldStatus==='FAILED'?'selected':''}>FAILED</option></select></div><div class="field"><label>Order Amount</label><input id="aseOrderAmount" type="number" step="0.01" min="0" value="${oldAmount}"></div></div><div class="field"><label>Reason / Admin note (required)</label><textarea id="aseOrderReason" maxlength="500" placeholder="Why are you changing this order?"></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="adminSaveSellerOrder('${esc(o.id)}')">Save Changes</button></div></div></div>`;
 };
 window.adminSaveSellerOrder=function(orderId){
   if(!adminOnly())return;
   const o=(S.orders||[]).find(x=>String(x.id)===String(orderId)); if(!o)return;
   const status=document.getElementById('aseOrderStatus')?.value,amount=Number(document.getElementById('aseOrderAmount')?.value),reason=(document.getElementById('aseOrderReason')?.value||'').trim();
   if(!status||!Number.isFinite(amount)||amount<0||!reason)return toast('Status, valid amount and reason are required');
   const before={status:o.status,amount:o.amount};o.status=status;o.amount=r2(amount);o.adminEditedAt=nowISO();o.adminEditedBy=S.currentUser?.id||'ADMIN';o.adminEditReason=reason;
   if(status!=='SUCCESS')o.paymentVerified=false;
   logAdminAudit('Edited seller order',o.id,{sellerId:o.sellerId,before,after:{status,amount:o.amount},reason});
   logProductActivity(o.productId,'Admin edited order',{sellerId:o.sellerId,orderId:o.id,reason,status,amount:o.amount});
   adminSellerNotice(o.sellerId,'Order updated by Admin',`Order ${o.id} was updated by Admin. New status: ${status}. Amount: ${money(o.amount)}. Reason: ${reason}`,'message');
   closeModal();save();toast('Order updated');render();
 };

 window.adminSellerControlPanel=function(sid){
   const s=seller(sid),u=sellerOwnerUser(sid),orders=sellerOrders(sid),live=sellerProductsAll(sid),recycle=(S.deletedProducts||[]).filter(p=>String(p.sellerId||'')===String(sid));
   const success=orders.filter(o=>o.status==='SUCCESS'),gross=success.reduce((a,o)=>a+Number(o.amount||0),0),to=typeof sellerAvailableBalance==='function'?sellerAvailableBalance(sid):0;
   const received=(S.payouts||[]).filter(x=>String(x.sellerId||'')===String(sid)&&['APPROVED','PAID','SUCCESS','RECEIVED'].includes(String(x.status||'').toUpperCase())).reduce((a,x)=>a+Number(x.amount||0),0);
   return `<div class="admin-seller-control-card"><div class="section-head"><div><h3>⚙ Admin Control — @${esc(sid)}</h3><div class="small muted">Admin preview: edit seller money, orders and products here. Every manual change requires a reason and is written to Admin Audit Log.</div></div><span class="admin-pill danger">ADMIN EDIT MODE</span></div>
   <div class="admin-seller-control-grid"><div class="admin-kpi"><span>Total Sales</span><b>${money(gross)}</b><small class="muted">Successful order amount</small></div><div class="admin-kpi"><span>Sales Count</span><b>${success.length}</b><small class="muted">SUCCESS only</small></div><div class="admin-kpi"><span>To Receive</span><b>${money(to)}</b><small class="muted">Available seller balance</small></div><div class="admin-kpi"><span>Received</span><b>${money(received)}</b><small class="muted">Paid payouts</small></div></div>
   <div class="admin-seller-money-form"><div class="field"><label>Money field</label><select id="aseMoneyType"><option value="TO_RECEIVE">To Receive</option><option value="TOTAL">Total</option><option value="RECEIVED">Received</option></select></div><div class="field"><label>Adjustment (+ / −)</label><input id="aseMoneyAmount" type="number" step="0.01" placeholder="₹0.00"></div><div class="field reason-field"><label>Reason (required)</label><input id="aseMoneyReason" maxlength="180" placeholder="Why add or deduct money?"></div><div class="apply-field"><button class="btn primary" onclick="adminApplySellerMoney('${esc(u?.id||'')}','${esc(sid)}')">Apply Money</button></div></div>
   <div class="admin-seller-control-actions"><button class="btn" onclick="adminSellerNotice('${esc(sid)}','Admin Message',prompt('Message to seller:','')||'','message')">✉ Message Seller</button><button class="btn danger" onclick="adminSellerNotice('${esc(sid)}','Admin Warning',prompt('Warning/reason for seller:','')||'','warning')">⚠ Warning + Reason</button><button class="btn" onclick="adminNav('seller/${esc(sid)}')">Open Admin Seller Details</button></div>
   <div class="admin-seller-control-table"><table class="admin-table"><thead><tr><th>Order</th><th>Product</th><th>Customer</th><th>Amount</th><th>Status</th><th>Edit</th></tr></thead><tbody>${orders.slice().sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).map(o=>`<tr><td>${esc(o.id)}</td><td>${esc(product(o.productId)?.title||'Deleted product')}</td><td>${esc(o.customerName||o.customerEmail||o.customerId||'-')}</td><td>${money(o.amount)}</td><td><span class="admin-pill ${o.status==='SUCCESS'?'success':o.status==='CANCELLED'?'danger':'warn'}">${esc(o.status||'-')}</span></td><td><button class="btn" onclick="adminEditSellerOrder('${esc(o.id)}')">Edit</button></td></tr>`).join('')||'<tr><td colspan="6"><div class="admin-empty">No seller orders.</div></td></tr>'}</tbody></table></div>
   <div class="admin-seller-control-table"><table class="admin-table"><thead><tr><th>Product</th><th>Sales</th><th>Price</th><th>Action</th></tr></thead><tbody>${live.map(p=>`<tr><td>${esc(p.title)}</td><td>${productSales(p.id)}</td><td>${money(p.price)}</td><td><button class="btn" onclick="adminNav('product/${esc(p.id)}')">Details</button> <button class="btn" onclick="go('dashboard/edit/${esc(p.id)}')">Edit</button> <button class="btn danger" onclick="adminDeleteProduct('${esc(p.id)}')">Delete</button></td></tr>`).join('')||'<tr><td colspan="4"><div class="admin-empty">No live products.</div></td></tr>'}</tbody></table></div>
   ${recycle.length?`<div class="admin-seller-control-table"><table class="admin-table"><thead><tr><th>Deleted Product</th><th>Deleted At</th><th>Action</th></tr></thead><tbody>${recycle.map(p=>`<tr style="background:#fff1f2"><td><b style="color:#b91c1c">${esc(p.title)}</b><div class="small" style="color:#991b1b">Seller can see this in Recycle Bin</div></td><td>${p.deletedAt?new Date(p.deletedAt).toLocaleString('en-IN'):'-'}</td><td><button class="btn" onclick="adminNav('product/${esc(p.id)}')">Details</button> <button class="btn" onclick="adminRestoreProduct('${esc(p.id)}')">Restore</button> <button class="btn danger" onclick="adminPermanentDelete('${esc(p.id)}')">Delete Forever</button></td></tr>`).join('')}</tbody></table></div>`:''}
   </div>`;
 };
 window.adminApplySellerMoney=function(uid,sid){
   if(!adminOnly())return;
   const type=document.getElementById('aseMoneyType')?.value,amount=Number(document.getElementById('aseMoneyAmount')?.value),reason=(document.getElementById('aseMoneyReason')?.value||'').trim();
   if(!uid||!sid||!['TO_RECEIVE','TOTAL','RECEIVED'].includes(type)||!Number.isFinite(amount)||amount===0||!reason)return toast('Enter amount and a reason');
   S.sellerFinanceLedger=S.sellerFinanceLedger||[];S.sellerFinanceLedger.unshift({id:uidFn(),sellerId:sid,userId:uid,type,amount:r2(amount),note:reason,date:nowISO(),adminId:S.currentUser.id});
   logAdminAudit('Seller money adjustment',sid,{type,amount:r2(amount),reason});
   adminSellerNotice(sid,'Money adjustment by Admin',`Admin ${amount>0?'added':'deducted'} ${money(Math.abs(amount))} in ${type.replace('_',' ')}. Reason: ${reason}`,'message');
   save();toast('Seller money updated');render();
 };

 // Re-wrap the already-installed admin preview shell so the preview always uses the selected seller's data.
 const oldDashShell=window.dashShell;
 if(oldDashShell){
   window.dashShell=function(page,content){
     const out=oldDashShell(page,content);
     if(window.adminSellerPreview && isAdmin()){
       const sid=String(window.adminSellerPreview);
       return out.replace('<div class="dash-content">','<div class="dash-content">'+adminSellerControlPanel(sid));
     }
     return out;
   };
 }

 // Make seller recycle-bin cards clearly red and actionable.
 const oldPMCard=window.productManagerCard;
 if(oldPMCard){
   window.productManagerCard=function(p,type){
     let h=oldPMCard(p,type);
     if(type==='recycle'){
       h=h.replace('class="pm-card ', 'class="pm-card admin-seller-recycle ');
       h=h.replace(/<div class="pm-actions">[\s\S]*?<\/div><\/div>$/, `<div class="pm-actions"><button class="btn" onclick="viewProductActivity('${esc(p.id)}')">Details</button><button class="btn" onclick="go('product/${esc(p.id)}')">View</button><button class="btn primary" onclick="restoreRecycled('${esc(p.id)}')">Restore</button><button class="btn danger" onclick="permanentDeleteItem('${esc(p.id)}','recycle')">Delete Forever</button></div></div>`);
     }
     return h;
   };
 }
})();
