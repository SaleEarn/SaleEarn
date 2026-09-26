
(function(){
 let queued=false;
 function normalize(){queued=false;const box=document.querySelector('#home-hero .hero-actions');if(!box)return;const buttons=[...box.querySelectorAll(':scope>.btn')];const market=buttons[0],sell=buttons[1];if(market){market.id='homeMarketplaceCta';market.dataset.cta='marketplace';if(market.textContent.trim()!=='Explore Marketplace →')market.textContent='Explore Marketplace →';market.onclick=()=>go('market')}if(sell){const label=String(window.ensurePlatformConfig?.().cms?.ctaText||'Start Selling').trim()||'Start Selling';sell.id='homeStartSellingCta';sell.dataset.cta='start-selling';if(sell.textContent.trim()!==label)sell.textContent=label;sell.onclick=()=>window.startSelling()}}
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(normalize)}
 new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true});addEventListener('hashchange',()=>setTimeout(normalize,25));setTimeout(normalize,100);
})();
