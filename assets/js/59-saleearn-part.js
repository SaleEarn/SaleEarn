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
window.__sePublicSalesReady=!!window.__sePublicSalesReady;
async function v19LoadPublicSales(force=false){
  if(!window.supabaseClient)return false;
  if(window.__sePublicSalesPromise && !force)return window.__sePublicSalesPromise;
  if(window.__sePublicSalesReady && !force)return true;
  const run=(async()=>{
    try{
      const r=await window.supabaseClient.rpc('get_public_product_sales');
      if(r.error)throw r.error;
      const rows=Array.isArray(r.data)?r.data:[];
      v19PublicSales.clear();
      for(const row of rows){
        const id=String(row.product_id??row.productId??'');
        if(id)v19PublicSales.set(id,Math.max(0,Math.floor(Number(row.sales_count??row.salesCount??0))));
      }
      window.__sePublicSalesReady=true;
      window.__sePublicSalesLoaded=true;
      if(Array.isArray(S.products))S.products.forEach(p=>{if(p)v19PublicSales.has(String(p.id))&&(p.sales=v19PublicSales.get(String(p.id)));});
      if(Array.isArray(window.SE_PUBLIC_CATALOG))window.SE_PUBLIC_CATALOG.forEach(p=>{if(p)v19PublicSales.has(String(p.id))&&(p.sales=v19PublicSales.get(String(p.id)));});
      if(typeof window.updateMarketResults==='function'&&route()==='market')window.updateMarketResults();
      return true;
    }catch(e){
      window.__sePublicSalesLoaded=false;
      window.__sePublicSalesReady=false;
      console.warn('Public product sales aggregate unavailable:',e?.message||e);
      return false;
    }finally{window.__sePublicSalesPromise=null;}
  })();
  window.__sePublicSalesPromise=run;
  return run;
}
window.v19LoadPublicSales=v19LoadPublicSales;

async function seHydratePublicSellerStats(force=false){
  if(!window.supabaseClient)return false;
  if(window.__sePublicSellerStatsPromise&&!force)return window.__sePublicSellerStatsPromise;
  if(window.__sePublicSellerStatsReady&&!force)return true;
  const run=(async()=>{
    try{
      const ids=[...new Set((Array.isArray(window.SE_PUBLIC_CATALOG)?window.SE_PUBLIC_CATALOG:[]).map(p=>String(p?.sellerId||'')).filter(Boolean))];
      if(!ids.length){window.__sePublicSellerStatsReady=true;return true;}
      let r=await window.supabaseClient.from('sellers').select('user_id,store_name,status,followers').in('user_id',ids);
      if(r.error){
        r=await window.supabaseClient.from('sellers').select('user_id,store_name,status').in('user_id',ids);
        if(r.error)throw r.error;
      }
      const byId=new Map((Array.isArray(r.data)?r.data:[]).map(x=>[String(x.user_id),x]));
      ids.forEach(id=>{
        const row=byId.get(id); if(!row)return;
        const cur=(S.sellers&&S.sellers[id])||{};
        if(row.followers!=null)cur.followers=Math.max(0,Math.floor(Number(row.followers)||0));
        if(row.store_name)cur.name=row.store_name;
        cur.id=id;
        S.sellers[id]=cur;
      });
      window.__sePublicSellerStatsReady=true;
      try{save();}catch{}
      return true;
    }catch(e){
      window.__sePublicSellerStatsReady=false;
      console.warn('Public seller stats unavailable:',e?.message||e);
      return false;
    }finally{window.__sePublicSellerStatsPromise=null;}
  })();
  window.__sePublicSellerStatsPromise=run;
  return run;
}
window.seHydratePublicSellerStats=seHydratePublicSellerStats;

window.seHydrateAllPublicStats=async function(force=false){
  const results=await Promise.all([v19LoadPublicSales(force),seHydratePublicSellerStats(force)]);
  const ok=results.every(Boolean);
  window.__sePublicStatsReady=ok;
  try{if(!S.currentUser&&ok&&typeof render==='function')render();}catch{}
  return ok;
};
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
if(window.supabaseClient){ window.seHydrateAllPublicStats(false); }
window.v18ReloadProductSales=v18Load;
})();
