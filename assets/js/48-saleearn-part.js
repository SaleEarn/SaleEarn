
(function(){
'use strict';
/* v13: Admin-only exact displayed sales count per product. This does NOT create fake orders or change money. */
/* Local secure RPC helper: v14's adminRpc lives in another IIFE scope, so v13 must not depend on that private binding. */
async function adminRpc(name,args){
  if(!window.supabaseClient) throw new Error('Secure admin backend is not connected');
  const {data,error}=await window.supabaseClient.rpc(name,args||{});
  if(error) throw error;
  return data;
}
S.productSaleOverrides=Array.isArray(S.productSaleOverrides)?S.productSaleOverrides:[];
async function v13LoadOverrides(){
  if(!window.supabaseClient)return;
  try{
    const {data,error}=await window.supabaseClient.rpc('get_public_product_sales_overrides');
    if(error)throw error;
    if(Array.isArray(data)){
      S.productSaleOverrides=data.map(x=>({productId:String(x.product_id),salesCount:Number(x.sales_count||0),note:'',date:x.updated_at||x.created_at||''}));
      save();
    }
  }catch(e){console.warn('Product sales overrides unavailable:',e?.message||e)}
}
window.adminSetProductSales=async function(productId){
  if(!window.adminOnly())return;
  const input=document.getElementById('v13SalesCount_'+String(productId).replace(/[^a-zA-Z0-9_-]/g,''));
  const noteEl=document.getElementById('v13SalesNote_'+String(productId).replace(/[^a-zA-Z0-9_-]/g,''));
  const count=Math.floor(Number(input?.value||0));
  const note=(noteEl?.value||'').trim();
  if(!Number.isFinite(count)||count<0||count>1000000000)return toast('Sales count must be between 0 and 1,000,000,000');
  if(note.length<3)return toast('Reason is required');
  try{
    let row=null;
    if(window.supabaseClient){
      row=await adminRpc('admin_set_product_sales_override',{p_product_id:String(productId),p_sales_count:count,p_note:note});
    }
    const rec={productId:String(productId),salesCount:count,note:note,date:row?.updated_at||row?.created_at||nowISO(),serverAuthoritative:!!row};
    const i=S.productSaleOverrides.findIndex(x=>String(x.productId)===String(productId));
    if(i>=0)S.productSaleOverrides[i]=rec;else S.productSaleOverrides.push(rec);
    adminAudit('Admin changed displayed product sales',String(productId),{salesCount:count,note,serverAuthoritative:!!row});
    save();toast('Product sales display set to '+count);render();
  }catch(e){console.error('Admin product sales override:',e);toast(e?.message||'Could not update product sales');}
};
const oldAdminProductDetailV13=window.adminProductDetail;
window.adminProductDetail=function(id){
  const html=oldAdminProductDetailV13(id);
  const p=product(id);if(!p)return html;
  const safe=String(id).replace(/[^a-zA-Z0-9_-]/g,'');
  const current=productSales(id);
  const card=`<div class="admin-card" style="margin-top:18px"><div class="section-head"><div><h2>Admin Sales Display Control</h2><div class="sub">Admin-only. Set exactly how many sales this product displays. This changes the displayed sales count only; it does not create an order or change seller money.</div></div><span class="admin-pill danger">ADMIN ONLY</span></div><div class="form-grid"><div class="field"><label>Displayed Sales Count</label><input id="v13SalesCount_${safe}" type="number" min="0" max="1000000000" step="1" value="${current}"></div><div class="field"><label>Reason (required)</label><input id="v13SalesNote_${safe}" maxlength="240" placeholder="Sales display correction"></div></div><div class="admin-actions"><button class="btn primary" onclick="adminSetProductSales('${esc(id)}')">Save Sales Count</button><span class="small muted">Current: ${current}</span></div></div>`;
  const t=document.createElement('template');t.innerHTML=html;const root=t.content.querySelector('.admin-content');if(root)root.insertAdjacentHTML('beforeend',card);return t.innerHTML;
};
if(window.supabaseClient)setTimeout(v13LoadOverrides,2300);
function seDeferredPublicSalesLoad(){
  if(typeof window.v19LoadPublicSales === 'function'){
    try{ window.v19LoadPublicSales(); }catch(e){ console.warn('Public sales loader failed:',e); }
    return;
  }
  window.__seV19PublicSalesRetry=(window.__seV19PublicSalesRetry||0)+1;
  if(window.__seV19PublicSalesRetry<20){
    setTimeout(seDeferredPublicSalesLoad,250);
  }else{
    console.warn('Public sales loader was not available; skipping deferred load.');
  }
}
setTimeout(seDeferredPublicSalesLoad,900);
})();
