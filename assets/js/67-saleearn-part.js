/* Marketplace metadata display fix: the public catalog row is intentionally
   lightweight. Merge it with the complete local/shared product record whenever
   one is available, while keeping public visibility/moderation fields authoritative. */
(function(){
'use strict';
if(window.__seMarketplaceMetadataDisplayFinal)return;
window.__seMarketplaceMetadataDisplayFinal=true;
const baseProduct=product;
const metadataKeys=['title','description','category','tags','oldPrice','links','linkTitles','fileSizeValue','fileSizeUnit','fileSize','fileCount','faq','coupon','rightsConfirmed','image','badge','featured'];
product=function(id){
  const visible=baseProduct(id);
  if(!visible)return visible;
  /* Once Supabase catalog is ready, its normalized columns are authoritative.
     Never overwrite them with an older shared/local cache. */
  if(SE_PUBLIC_CATALOG_READY&&Array.isArray(SE_PUBLIC_CATALOG))return visible;
  const full=(Array.isArray(S.products)?S.products:[]).find(x=>String(x?.id)===String(id));
  if(!full||full===visible)return visible;
  const merged={...visible};
  for(const key of metadataKeys){
    const current=merged[key],missing=current===undefined||current===null||current===''||(Array.isArray(current)&&current.length===0);
    if(missing&&Object.prototype.hasOwnProperty.call(full,key)){
      try{merged[key]=structuredClone(full[key])}catch{merged[key]=full[key]}
    }
  }
  return merged;
};
})();
