
(function(){
'use strict';
/* v18: Product displayed-sales overrides are global across browsers/accounts.
   Read-only public sync; admin remains the only writer. */
function v18Apply(rows){
  if(!Array.isArray(rows)) return;
  S.productSaleOverrides=rows.map(x=>({
    productId:String(x.product_id??x.productId??''),
    salesCount:Math.max(0,Math.floor(Number(x.sales_count??x.salesCount??0))),
    date:x.updated_at||x.created_at||''
  })).filter(x=>x.productId);
  if(Array.isArray(S.products)){
    S.products.forEach(p=>{
      const o=S.productSaleOverrides.find(x=>String(x.productId)===String(p.id));
      if(o) p.displayedSalesCount=o.salesCount;
    });
  }
}
async function v18Load(){
  if(!window.supabaseClient) return;
  try{
    let data=null,error=null;
    const r=await window.supabaseClient.rpc('get_public_product_sales_overrides');
    data=r.data; error=r.error;
    if(error) throw error;
    v18Apply(data||[]);
    try{ save(); }catch(e){}
  }catch(e){
    console.warn('Global product sales sync unavailable:',e?.message||e);
  }
}
const v19PublicSales=window.__sePublicSalesCounts||new Map();
window.__sePublicSalesCounts=v19PublicSales;
async function v19LoadPublicSales(){
  if(!window.supabaseClient||window.__sePublicSalesLoaded)return;
  window.__sePublicSalesLoaded=true;
  try{
    const r=await window.supabaseClient.rpc('get_public_product_sales');
    if(r.error)throw r.error;
    for(const row of (Array.isArray(r.data)?r.data:[])){
      const id=String(row.product_id??row.productId??'');
      if(id)v19PublicSales.set(id,Math.max(0,Math.floor(Number(row.sales_count??row.salesCount??0))));
    }
    if(typeof window.updateMarketResults==='function'&&route()==='market')window.updateMarketResults();
  }catch(e){
    // Optional RPC: if it is not installed yet, keep the existing local/order count.
    console.warn('Public product sales aggregate unavailable:',e?.message||e);
  }
}
const v18OldProductSales=window.productSales;
window.productSales=function(id){
  const p=product(id);
  const aggregate=v19PublicSales.get(String(id));
  const local=Array.isArray(S.productSaleOverrides)?S.productSaleOverrides.find(x=>String(x.productId)===String(id)):null;
  const field=p&&Number.isFinite(Number(p.displayedSalesCount))?Number(p.displayedSalesCount):null;
  const old=v18OldProductSales?Math.max(0,Number(v18OldProductSales(id))||0):0;
  // A zero override from an old/default row must not erase a real sales count.
  // Positive admin overrides remain authoritative.
  if(local&&Number(local.salesCount)>0)return Math.floor(Number(local.salesCount));
  if(field!==null&&field>0)return Math.floor(field);
  if(aggregate!==undefined)return aggregate;
  return old;
};
const v18OldSet=window.adminSetProductSales;
if(v18OldSet){
  window.adminSetProductSales=async function(productId){
    const result=await v18OldSet(productId);
    const safe=String(productId).replace(/[^a-zA-Z0-9_-]/g,'');
    const input=document.getElementById('v13SalesCount_'+safe);
    const count=Math.floor(Number(input?.value||0));
    const p=product(productId);
    if(p&&Number.isFinite(count)) p.displayedSalesCount=count;
    if(typeof window.render==='function') setTimeout(()=>{try{window.render()}catch(e){}},0);
    return result;
  };
}
/* One lightweight startup read only; repeated timed refreshes were removed. */
setTimeout(()=>{const r=typeof routeNow==='function'?routeNow():'';if(r==='market'||r.startsWith('product/')||r.startsWith('admin/'))v18Load();},1200);
window.v18ReloadProductSales=v18Load;
})();
