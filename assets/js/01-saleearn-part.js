
/* Global deletion guard must exist before seller/public render wrappers execute.
   It only reads the existing tombstone/status state; it does not mutate data. */
window.seIsDeletedProduct = window.seIsDeletedProduct || function(p){
  if(!p) return false;
  if(String(p.status||'').toLowerCase()==='deleted') return true;
  try{
    if(typeof window.deletedProductIdSet==='function' && window.deletedProductIdSet().has(String(p.id))) return true;
  }catch(_){}
  return false;
};
