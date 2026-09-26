
/* Sale Earn Mobile Polish v7 */
(function(){
 const names={admin:['Admin Menu','Manage Sale Earn'],dashboard:['Seller Menu','Store management'],account:['My Account','Profile & purchases'],market:['Marketplace Filters','Browse categories'],mail:['Mail Folders','Messages & communication']};
 let queued=false;
 function enhance(){queued=false;document.querySelectorAll('[data-se-drawer-panel]').forEach(panel=>{const id=panel.dataset.seDrawerPanel;if(panel.querySelector('.se-mobile-drawer-head'))return;const [title,sub]=names[id]||['Options','Choose a section'];const h=document.createElement('div');h.className='se-mobile-drawer-head';h.innerHTML='<span class="se-drawer-mark">SE</span><div><b></b><small></small></div><button type="button" class="se-mobile-drawer-close" aria-label="Close menu">×</button>';h.querySelector('b').textContent=title;h.querySelector('small').textContent=sub;h.querySelector('button').onclick=()=>window.saleEarnMobileDrawer?.close();panel.prepend(h)});document.querySelectorAll('.se-mobile-side-trigger').forEach(b=>{if(b.dataset.polished)return;b.dataset.polished='1';const id=b.dataset.drawer,[title]=names[id]||['Options'];b.setAttribute('aria-label','Open '+title);b.setAttribute('title',title)})}
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(enhance)}
 new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});addEventListener('hashchange',()=>setTimeout(enhance,30));addEventListener('resize',()=>{if(innerWidth>900)window.saleEarnMobileDrawer?.close(false)},{passive:true});setTimeout(enhance,100);
})();

