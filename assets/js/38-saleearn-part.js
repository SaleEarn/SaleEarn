
(function(){
  'use strict';
  function marketplacePackage(){
    const c=ensurePlatformConfig();
    c.ads=c.ads||{};c.ads.packages=Array.isArray(c.ads.packages)?c.ads.packages:[];
    let p=c.ads.packages.find(x=>String(x.id)==='marketplace');
    if(!p){
      p={id:'marketplace',name:'Marketplace Boost',price:12,days:1,impressionLimit:0,clickLimit:0,placement:'Marketplace',approval:false,active:true};
      c.ads.packages.push(p);
    }else{p.name='Marketplace Boost';p.price=12;p.days=1;p.placement='Marketplace';p.active=p.active!==false;}
    return p;
  }
  function adConflict(productId,placement){
    const now=Date.now();
    return (S.ads||[]).find(a=>String(a.productId)===String(productId)&&String(a.sellerId)===String(currentSeller()?.id||'')&&String(a.placement||a.type||'')===String(placement||'')&&a.status!=='CANCELLED'&&(!a.endDate||new Date(a.endDate).getTime()>now));
  }
  const oldOpenAd=window.openAdCampaign;
  window.openAdCampaign=function(){
    marketplacePackage();
    const result=oldOpenAd?.apply(this,arguments);
    const el=document.getElementById('adType');
    if(el&&!el.querySelector('option[value="marketplace"]')){
      el.insertAdjacentHTML('beforeend','<option value="marketplace" data-price="12">Marketplace Boost · ₹12/day</option>');
    }
    if(el&&!el.dataset.marketplaceBoostBound){
      el.dataset.marketplaceBoostBound='1';
      el.addEventListener('change',function(){
        if(this.value==='marketplace'){
          const days=document.getElementById('adDays');
          if(days)days.value='1';
          const total=document.getElementById('adTotal');
          if(total)total.textContent=money(12);
        }
      });
    }
    return result;
  };
  const oldCreateAd=window.createAd;
  window.createAd=function(){
    const productId=document.getElementById('adProduct')?.value||'';
    const packageId=document.getElementById('adType')?.value||'';
    const p=marketplacePackage()&&ensurePlatformConfig().ads.packages.find(x=>String(x.id)===String(packageId));
    const placement=p?.placement||p?.name||packageId;
    const conflict=productId&&adConflict(productId,placement);
    if(conflict){
      toast('This product is already boosted in '+placement+'. Choose another placement or wait until it ends.');
      return;
    }
    return oldCreateAd?.apply(this,arguments);
  };
})();
