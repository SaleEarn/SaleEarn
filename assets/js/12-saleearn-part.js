
/* Sale Earn Universal Mobile 3-dot Sidebar Drawer */
(function(){
 const specs=[
  {id:'admin',panel:'.admin-shell>.admin-side',host:'.admin-top',label:'Open admin navigation'},
  {id:'dashboard',panel:'.dashboard-shell>.dash-side',host:'.dashboard-shell>.dash-main>.dash-top',label:'Open seller dashboard menu'},
  {id:'account',panel:'.account-layout>.account-nav',host:'.account-head',label:'Open My Account menu'},
  {id:'market',panel:'.market-layout>.sidebar-filter',host:'.market-tools',label:'Open product filters'},
  {id:'mail',panel:'.mail-shell>.mail-sidebar',host:'.mail-shell',label:'Open mail folders'}
 ];
 let current='',lastFocus=null,touchX=null,scheduled=false;
 function mobile(){return matchMedia('(max-width:900px)').matches}
 function shade(){let s=document.querySelector('.se-mobile-drawer-shade');if(!s){s=document.createElement('div');s.className='se-mobile-drawer-shade';s.setAttribute('aria-hidden','true');s.onclick=close;document.body.appendChild(s)}return s}
 function trigger(id){return document.querySelector(`.se-mobile-side-trigger[data-drawer="${id}"]`)}
 function open(id){if(!mobile())return;const spec=specs.find(x=>x.id===id),panel=spec&&document.querySelector(spec.panel);if(!panel)return;close(false);current=id;lastFocus=document.activeElement;document.body.dataset.seMobileDrawer=id;document.body.classList.add('se-mobile-drawer-open');trigger(id)?.setAttribute('aria-expanded','true');panel.setAttribute('aria-hidden','false');panel.inert=false;shade();setTimeout(()=>panel.querySelector('button.active,a.active,[aria-current],button,a,input')?.focus({preventScroll:true}),60)}
 function close(restore=true){if(!current&&!document.body.classList.contains('se-mobile-drawer-open'))return;document.body.classList.remove('se-mobile-drawer-open','as-menu-open');delete document.body.dataset.seMobileDrawer;document.querySelectorAll('.se-mobile-side-trigger').forEach(b=>b.setAttribute('aria-expanded','false'));document.querySelectorAll('[data-se-drawer-panel]').forEach(p=>{const hidden=mobile();p.setAttribute('aria-hidden',hidden?'true':'false');p.inert=hidden});const f=lastFocus;current='';if(restore&&f?.isConnected)setTimeout(()=>f.focus({preventScroll:true}),20)}
 function toggle(id){current===id?close():open(id)}
 function setup(){scheduled=false;shade();for(const s of specs){const panel=document.querySelector(s.panel),host=document.querySelector(s.host);if(!panel||!host)continue;panel.dataset.seDrawerPanel=s.id;panel.setAttribute('aria-hidden',mobile()?'true':'false');panel.inert=mobile();host.classList.add('se-has-side-trigger');let b=host.querySelector(`.se-mobile-side-trigger[data-drawer="${s.id}"]`);if(!b){b=document.createElement('button');b.type='button';b.className='se-mobile-side-trigger';b.dataset.drawer=s.id;b.setAttribute('aria-label',s.label);b.setAttribute('title',s.label);b.setAttribute('aria-controls','se-drawer-'+s.id);b.setAttribute('aria-expanded','false');b.innerHTML='<span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="12" cy="19" r="1.8"></circle></svg></span>';b.onclick=e=>{e.preventDefault();e.stopPropagation();toggle(s.id)};host.prepend(b)}panel.id='se-drawer-'+s.id;if(!panel.dataset.seDrawerBound){panel.dataset.seDrawerBound='1';panel.addEventListener('click',e=>{if(!mobile())return;const action=e.target.closest('button,a,[role=button]');if(action&&!action.classList.contains('se-mobile-side-trigger'))setTimeout(()=>close(false),100)});panel.addEventListener('touchstart',e=>{touchX=e.touches[0]?.clientX??null},{passive:true});panel.addEventListener('touchend',e=>{if(touchX!=null&&(e.changedTouches[0]?.clientX??touchX)-touchX<-55)close();touchX=null},{passive:true})}}
  if(!mobile())close(false)
 }
 function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(setup)}
 window.saleEarnMobileDrawer={open,close,toggle,refresh:setup};
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});window.addEventListener('resize',schedule,{passive:true});window.addEventListener('hashchange',()=>{close(false);setTimeout(setup,40)});
 const mo=new MutationObserver(schedule);mo.observe(document.documentElement,{childList:true,subtree:true});setTimeout(setup,80);
})();

