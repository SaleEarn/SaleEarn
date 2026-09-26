
/* Sale Earn Website Controls — confirmed save/publish fix */
(function(){
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const clone=x=>JSON.parse(JSON.stringify(x));
 const el=id=>document.getElementById(id),val=id=>String(el(id)?.value??''),checked=id=>!!el(id)?.checked;
 let busy=false,last={state:'idle',text:''};
 function show(state,text){
  last={state,text};let box=document.getElementById('seWebsiteSaveStatus');
  if(!box){box=document.createElement('div');box.id='seWebsiteSaveStatus';box.setAttribute('role','status');box.setAttribute('aria-live','polite');document.body.appendChild(box)}
  box.dataset.state=state;box.textContent=text;box.classList.add('show');clearTimeout(show.timer);show.timer=setTimeout(()=>box?.classList.remove('show'),state==='saving'?120000:5000);
  const inline=document.querySelector('[data-se-control-save-state]');if(inline){inline.dataset.state=state;inline.textContent=text}
 }
 function decorate(){
  const b=document.querySelector('button[onclick*="studioSaveWebsite"]');if(b&&!b.parentElement?.querySelector('[data-se-control-save-state]')){const s=document.createElement('span');s.dataset.seControlSaveState='';s.className='se-control-save-state';s.textContent=last.text||'Changes are not saved until you publish.';b.insertAdjacentElement('afterend',s)}
 }
 async function flushCloud(){
  if(typeof ONLINE_READY==='undefined'||!ONLINE_READY||!S.currentUser)return {live:false,reason:'Cloud is not connected'};
  if(typeof navigator!=='undefined'&&navigator.onLine===false)return {live:false,reason:'Internet is offline'};
  if(typeof seStopped!=='undefined'&&seStopped){seStopped=false;seFailures=0;seRetryAt=0}
  for(let i=0;i<4;i++){
   while((typeof seWriteBusy!=='undefined'&&seWriteBusy)||(typeof seReadBusy!=='undefined'&&seReadBusy))await wait(120);
   if(typeof ONLINE_LOCAL_DIRTY!=='undefined'&&!ONLINE_LOCAL_DIRTY)return {live:true};
   try{await pushOnlineState()}catch(e){return {live:false,reason:e?.message||'Cloud save failed'}}
   if(typeof ONLINE_LOCAL_DIRTY==='undefined'||!ONLINE_LOCAL_DIRTY)return {live:true};
   await wait(220*(i+1));
  }
  return {live:false,reason:(typeof seStopped!=='undefined'&&seStopped)?'Cloud sync is paused':'Cloud did not confirm the update'};
 }
 function addHistory(c,before,reason){c.configHistory=Array.isArray(c.configHistory)?c.configHistory:[];c.configHistory.unshift({version:Date.now(),date:new Date().toISOString(),adminId:S.currentUser?.id||'ADMIN',reason,config:{...before,configHistory:[]}});c.configHistory=c.configHistory.slice(0,5)}
 async function persist(reason,mutate){
  if(busy)return show('saving','A save is already running…');
  if(typeof adminOnly==='function'&&!adminOnly())return;
  busy=true;const button=document.querySelector('button[onclick*="studioSaveWebsite"]');if(button){button.disabled=true;button.dataset.oldText=button.textContent;button.textContent='Saving…'}
  try{
   const c=ensurePlatformConfig(),before=clone(c);mutate(c);addHistory(c,before,reason);S.platformConfig=c;
   try{adminAudit(reason,'PLATFORM_CONFIG',{source:'Website Control',confirmedSave:true})}catch{}
   show('saving','Saving locally and publishing online…');save();
   const result=await flushCloud();
   if(result.live){show('live','✓ Saved & live on the website');try{toast('Website controls saved & live')}catch{}}
   else{show('pending','✓ Saved on this device · Online sync pending: '+result.reason);try{toast('Saved locally. Online sync is pending.')}catch{}}
   try{render()}catch{}setTimeout(decorate,40);
  }catch(e){console.error('Website Control save failed',e);show('error','Save failed: '+(e?.message||'Unknown error'));try{toast('Save failed. Your previous settings were kept.')}catch{}}
  finally{busy=false;if(button?.isConnected){button.disabled=false;button.textContent=button.dataset.oldText||'Save & publish website'}}
 }
 window.studioSaveWebsite=async function(){
  const name=val('acBrandName').trim(),primary=val('acPrimary').trim(),secondary=val('acSecondary').trim(),image=val('acHeroImage').trim();
  if(!name||name.length>80)return show('error','Website name must be 1–80 characters.');
  if(!/^#[0-9a-f]{6}$/i.test(primary)||!/^#[0-9a-f]{6}$/i.test(secondary))return show('error','Use six-digit colors, for example #6354da.');
  if(image&&!/^https:\/\//i.test(image))return show('error','Hero image must use an HTTPS URL.');
  const branding={websiteName:name,primaryColor:primary,secondaryColor:secondary,font:val('acFont'),footerCopyright:val('acFooterCopy'),contactEmail:val('acContactEmail'),contactInfo:val('acContactInfo'),emailSenderName:val('acSenderName')};
  const cms={heroTitle:val('acHeroTitle'),heroSubtitle:val('acHeroSubtitle'),heroImage:image,ctaText:val('acCta'),footer:val('acCmsFooter')};
  return persist('Updated website branding and content',c=>{Object.assign(c.branding,branding);Object.assign(c.cms,cms)});
 };
 window.studioSaveHomeContent=async function(){
  try{
   const faq=JSON.parse(val('studioFaq')),testimonials=JSON.parse(val('studioTestimonials'));
   if(!Array.isArray(faq)||!Array.isArray(testimonials)||faq.length>30||testimonials.length>30||faq.some(x=>typeof x?.question!=='string'||typeof x?.answer!=='string')||testimonials.some(x=>typeof x?.name!=='string'||typeof x?.quote!=='string'))throw Error('Use the shown JSON format, up to 30 entries.');
   return persist('Updated homepage FAQ and testimonials',c=>Object.assign(c.cms,{faq,testimonials}));
  }catch(e){show('error',e.message);try{toast(e.message)}catch{}}
 };
 const previousControlSave=window.adminControlSave;
 window.adminControlSave=async function(section){
  if(section==='branding'||section==='cms')return studioSaveWebsite();
  if(section==='announcement'){
   const data={enabled:checked('acAnnEnabled'),title:val('acAnnTitle').slice(0,160),message:val('acAnnMessage').slice(0,2000),startDate:val('acAnnStart'),endDate:val('acAnnEnd'),audience:val('acAnnAudience')};
   if(data.startDate&&data.endDate&&data.startDate>data.endDate)return show('error','End date must be after start date.');
   return persist('Updated website announcement',c=>Object.assign(c.announcement,data));
  }
  return previousControlSave?.(section);
 };
 const mo=new MutationObserver(decorate);mo.observe(document.documentElement,{subtree:true,childList:true});setTimeout(decorate,100);
})();

