async function seSaveProductSecureRpc(product){
 if(!window.supabaseClient||!product?.id)return false;
 const links=Array.isArray(product.links)?product.links.map(x=>String(x||'').trim()).filter(Boolean):[];
 const titles=Array.isArray(product.linkTitles)?product.linkTitles:[];
 const payload={
  id:String(product.id),title:String(product.title||'').trim(),description:seUnpackProductDescription(product.description).description,
  price:Number(product.price||0),old_price:Number(product.oldPrice||0)||null,
  status:(product.publicLive===true&&product.hiddenByAdmin!==true)?'active':'pending',
  file_url:links[0]||null,image_url:product.image||null,category:product.category||null,
  tags:Array.isArray(product.tags)?product.tags:[],file_size_value:Number(product.fileSizeValue||0)||null,
  file_size_unit:['MB','GB'].includes(String(product.fileSizeUnit||''))?String(product.fileSizeUnit):null,
  file_count:links.length||Number(product.fileCount||0),file_titles:links.map((_,i)=>String(titles[i]||`File ${i+1}`)),
  faq:Array.isArray(product.faq)?product.faq:[],coupon:product.coupon||null,
  metadata:{rightsConfirmed:!!product.rightsConfirmed,badge:product.badge||null,featured:!!product.featured},
  files:links.map((url,i)=>({title:String(titles[i]||`File ${i+1}`),url}))
 };
 try{
  const {data,error}=await supabaseClient.rpc('saleearn_save_product',{p_product:payload});
  if(error)throw error;
  if(data?.ok!==true)throw new Error('Secure save did not return confirmation');
  const check=await supabaseClient.from('products').select('id,category,tags,old_price,file_size_value,file_size_unit,file_count,file_titles,coupon,updated_at').eq('id',String(product.id)).maybeSingle();
  if(check.error)throw check.error;
  const row=check.data||{};
  const expectedTitles=payload.file_titles||[];
  const valid=row.id===String(product.id)
    && String(row.category||'')===String(payload.category||'')
    && JSON.stringify(Array.isArray(row.tags)?row.tags:[])===JSON.stringify(payload.tags||[])
    && Number(row.old_price||0)===Number(payload.old_price||0)
    && Number(row.file_size_value||0)===Number(payload.file_size_value||0)
    && String(row.file_size_unit||'')===String(payload.file_size_unit||'')
    && Number(row.file_count||0)===Number(payload.file_count||0)
    && JSON.stringify(Array.isArray(row.file_titles)?row.file_titles:[])===JSON.stringify(expectedTitles);
  if(!valid)throw new Error('Supabase verification failed: saved product details do not match the seller form');
  try{
    SE_PUBLIC_CATALOG_READY=false;SE_PUBLIC_CATALOG_PROMISE=null;
    await seLoadPublicCatalog(true);
    if(routeNow().startsWith('product/')||routeNow()==='market'||routeNow().startsWith('seller/'))render();
  }catch(e){console.warn('Authoritative product refresh delayed',e)}
  return true;
 }catch(e){
  console.error('Secure product save failed:',e);
  toast('Supabase save failed: '+String(e?.message||'unknown error'));
  return false;
 }
}
window.seSaveProductSecureRpc=seSaveProductSecureRpc;
/* The legacy direct REST writer also tried to insert product_files and received
   403 by design. Product writes now go only through saleearn_save_product RPC. */
window.seSyncPublishedProduct=async function(){return true;};

/* Final product persistence hardening: keep every seller-entered field intact
   through publish, navigation, public-catalog refresh and cloud synchronization. */
(function(){
'use strict';
if(window.__seProductPersistenceFinal)return;
window.__seProductPersistenceFinal=true;
const previousPublish=window.publishProduct;
if(typeof previousPublish!=='function')return;
const copy=value=>{try{return structuredClone(value)}catch{return JSON.parse(JSON.stringify(value))}};
const sellerFields=['title','category','tags','description','links','linkTitles','fileSizeValue','fileSizeUnit','fileSize','fileCount','faq','oldPrice','price','coupon','rightsConfirmed','image','badge','featured'];
window.publishProduct=function(id){
  try{if(typeof persistProductDraftFromDOM==='function')persistProductDraftFromDOM(true)}catch(e){console.warn('Final product form capture delayed',e)}
  const pid=id?String(id):'';
  const beforeIds=new Set((S.products||[]).map(x=>String(x?.id)));
  const draftBefore=S.draft?copy(S.draft):null;
  const couponInput={
    code:(document.getElementById('pfCouponCode')?.value||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,''),
    value:Number(document.getElementById('pfCouponValue')?.value||0),
    maxUses:Math.max(1,Number(document.getElementById('pfCouponMax')?.value||1)),
    expiresAt:document.getElementById('pfCouponExpiry')?.value||''
  };
  const result=previousPublish.apply(this,arguments);
  /* The base publisher clears S.draft only after all validation succeeds. */
  if(!draftBefore||S.draft!==null)return result;
  const target=pid?product(pid):(S.products||[]).find(x=>x&&!beforeIds.has(String(x.id)));
  if(!target)return result;
  for(const key of sellerFields){
    if(key==='coupon')continue;
    if(Object.prototype.hasOwnProperty.call(draftBefore,key))target[key]=copy(draftBefore[key]);
  }
  target.title=String(target.title||'').trim();
  target.description=seUnpackProductDescription(target.description).description;
  target.tags=Array.isArray(target.tags)?target.tags.map(x=>String(x).trim()).filter(Boolean):[];
  target.links=Array.isArray(target.links)?target.links.map(x=>String(x).trim()).filter(Boolean):[];
  target.linkTitles=Array.isArray(target.linkTitles)?target.linkTitles.slice(0,target.links.length).map((x,i)=>String(x||'').trim()||`File ${i+1}`):target.links.map((_,i)=>`File ${i+1}`);
  target.fileCount=target.links.length||Math.max(1,Number(target.fileCount||1));
  if(target.fileSizeValue&&target.fileSizeUnit)target.fileSize=`${Number(target.fileSizeValue)} ${target.fileSizeUnit}`;
  if(couponInput.code){
    target.coupon={...(target.coupon||{}),id:target.coupon?.id||('pcc_'+target.id),code:couponInput.code,type:'percent',value:couponInput.value,maxUses:couponInput.maxUses,used:Number(target.coupon?.used||0),active:target.coupon?.active!==false,scope:'PRODUCT',sellerId:target.sellerId,productId:target.id,expiresAt:couponInput.expiresAt?new Date(couponInput.expiresAt+'T23:59:59').toISOString():null};
  }
  target.productMetadataSavedAt=new Date().toISOString();
  /* Make the complete product available immediately; the normalized row is then
     updated with the metadata envelope for refreshes and other browsers. */
  try{
    const list=Array.isArray(SE_PUBLIC_CATALOG)?SE_PUBLIC_CATALOG.slice():[];
    const ix=list.findIndex(x=>String(x?.id)===String(target.id));
    const publicCopy=copy(target);
    if(ix>=0)list[ix]={...list[ix],...publicCopy};else list.unshift(publicCopy);
    SE_PUBLIC_CATALOG=list;SE_PUBLIC_CATALOG_READY=true;PUBLIC_PRODUCTS_READY=true;
  }catch(e){console.warn('Public product cache update delayed',e)}
  try{sePersist();save()}catch(e){console.warn('Final product snapshot save delayed',e)}
  Promise.resolve().then(async()=>{
    const saved=await seSaveProductSecureRpc(target);
    if(saved){toast('Product details saved securely to Supabase');}
    try{
      if(typeof ONLINE_LOCAL_DIRTY!=='undefined'&&ONLINE_LOCAL_DIRTY&&typeof pushOnlineState==='function')await pushOnlineState();
    }catch(e){console.warn('Shared snapshot save delayed',e)}
  });
  return result;
};
})();
