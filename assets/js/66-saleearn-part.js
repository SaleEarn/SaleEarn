
/* Inlined from assets/js/65-saleearn-part.js */


(function(){
'use strict';
const ATTEMPT_KEY='saleearn_login_attempts_v23';
function readAttempts(){try{const a=JSON.parse(localStorage.getItem(ATTEMPT_KEY)||'[]');return Array.isArray(a)?a:[]}catch(e){return[]}}
function writeAttempts(a){try{localStorage.setItem(ATTEMPT_KEY,JSON.stringify(a.slice(-300)))}catch(e){}}
function normEmail(e){return String(e||'').trim().toLowerCase()}
window.seRecordLoginAttempt=function(email,error){
 const e=normEmail(email);if(!e)return;
 const a=readAttempts(),now=nowISO(),key=e;
 let row=a.find(x=>x.email===key);
 if(!row){row={id:'attempt_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),email:key,attempts:0,firstAttemptAt:now,lastAttemptAt:now,success:false};a.push(row)}
 row.attempts=Number(row.attempts||0)+1;row.lastAttemptAt=now;row.lastError=String(error||'Sign-in failed').slice(0,180);row.success=false;
 writeAttempts(a);
};
window.seMarkLoginSuccess=function(email){
 const e=normEmail(email);if(!e)return;const a=readAttempts();let changed=false;
 a.forEach(x=>{if(x.email===e&&!x.success){x.success=true;x.successAt=nowISO();changed=true}});if(changed)writeAttempts(a);
};
window.seForgetLoginAttempt=function(email){const e=normEmail(email);if(!e)return;writeAttempts(readAttempts().filter(x=>x.email!==e))};
const originalCompleteAuthUser=window.completeAuthUser;
if(typeof originalCompleteAuthUser==='function'){
 window.completeAuthUser=async function(user,nameFallback='',emailFallback=''){
  const u=await originalCompleteAuthUser.apply(this,arguments);
  try{seMarkLoginSuccess(user?.email||emailFallback||u?.email)}catch(e){}
  return u;
 };
}
function loggedUsers(){
 const remoteReady=typeof window.seAdminLoggedInDirectoryReady==='function'&&window.seAdminLoggedInDirectoryReady();
 const remote=typeof window.seAdminLoggedInUsers==='function'?window.seAdminLoggedInUsers():[];
 if(remoteReady){
  const byId=new Map((S.users||[]).map(u=>[String(u.authId||u.id||''),u]));
  return remote.map(r=>{
   const base=byId.get(String(r.authId||r.id||''));
   return base?{...base,...r,hasLoggedIn:true,lastLoginAt:r.lastLoginAt||base.lastLoginAt||null,firstLoginAt:r.firstLoginAt||base.firstLoginAt||null,lastActiveAt:r.lastActiveAt||base.lastActiveAt||r.lastLoginAt||null}:r;
  }).filter(u=>u&&!u.isAdmin&&String(u.email||'').trim());
 }
 return (S.users||[]).filter(u=>u&&!u.isAdmin&&String(u.email||'').trim()&&u.hasLoggedIn===true);
}
function isFresh(u){const t=new Date(u.firstLoginAt||u.lastLoginAt||0).getTime();return !!t&&(Date.now()-t)<7*86400000}
function isActive(u){const t=new Date(u.lastActiveAt||u.lastLoginAt||u.firstLoginAt||0).getTime();return !!t&&(Date.now()-t)<30*86400000}
function hasSellerActivity(u){const sid=u?.sellerId;return !!sid&&(S.products||[]).some(p=>p&&String(p.sellerId)===String(sid)&&!deletedProductIdSet().has(String(p.id)))}
function hasBuyerActivity(u){const id=String(u?.id||''),auth=String(u?.authId||'');return (S.orders||[]).some(o=>o&&o.status==='SUCCESS'&&([o.customerId,o.buyerId,o.userId].some(v=>String(v||'')===id||String(v||'')===auth)||String(o.customerEmail||o.buyerEmail||'').toLowerCase()===normEmail(u?.email)))}
function escx2(v){return typeof escx==='function'?escx(v):esc(v)}
function attemptRows(){
 const users=loggedUsers(),byEmail=new Map(users.map(u=>[normEmail(u.email),u]));
 /* Login attempts are only for accounts that have NEVER successfully logged in.
    A failed attempt that happened before a later successful login must not keep
    the user in the Login attempts tab. */
 return readAttempts()
   .filter(x=>x&&!x.success&&!byEmail.has(normEmail(x.email)))
   .sort((a,b)=>new Date(b.lastAttemptAt||0)-new Date(a.lastAttemptAt||0))
   .map(x=>({...x,user:null}));
}
function userRows(mode,sub){
 let rows=loggedUsers();
 if(mode==='new')rows=rows.filter(isFresh);
 if(mode==='active'){
  rows=rows.filter(isActive);
  if(sub==='seller')rows=rows.filter(hasSellerActivity);
  else if(sub==='buyer')rows=rows.filter(hasBuyerActivity);
  else if(sub==='none')rows=rows.filter(u=>!hasSellerActivity(u)&&!hasBuyerActivity(u));
 }
 return rows;
}
window.adminUsers=function(){
 if(!adminOnly())return;
 const mode=String(window.seUserMode||'all'),sub=String(window.seUserActiveSub||'all');
 const rows=userRows(mode,sub),attempts=attemptRows();
 const tabs=[['all','All'],['new','New users'],['attempts','Login attempts'],['active','Active users']];
 const activeSubs=[['all','All active'],['seller','Seller'],['buyer','Buyer'],['none','Non-doing']];
 const tableRows=rows.map(u=>{
  const sid=u.sellerId,ss=sid?seller(sid):null, sellerOn=hasSellerActivity(u),buyerOn=hasBuyerActivity(u);
  const type=sellerOn&&buyerOn?'Seller + Buyer':sellerOn?'Seller':buyerOn?'Buyer':'Non-doing';
  return `<tr class="data-row" onclick="adminNav('user/${escx2(u.id)}')"><td><b>${escx2(u.name||'User')}</b><small>${escx2(u.email)}</small></td><td>${u.firstLoginAt?new Date(u.firstLoginAt).toLocaleString('en-IN'):'-'}</td><td>${u.lastLoginAt?new Date(u.lastLoginAt).toLocaleString('en-IN'):'-'}</td><td>${u.lastActiveAt?new Date(u.lastActiveAt).toLocaleString('en-IN'):'-'}</td><td>${ss?escx2(ss.name):'-'}</td><td><span class="admin-pill ${sellerOn||buyerOn?'success':'warn'}">${type}</span></td></tr>`;
 }).join('');
 const attemptTable=attempts.map(x=>`<tr><td><b>${escx2(x.user?.name||'Unmatched account')}</b><small>${escx2(x.email)}</small></td><td>${x.attempts||0}</td><td>${x.firstAttemptAt?new Date(x.firstAttemptAt).toLocaleString('en-IN'):'-'}</td><td>${x.lastAttemptAt?new Date(x.lastAttemptAt).toLocaleString('en-IN'):'-'}</td><td><span class="admin-pill warn">Not signed in</span></td></tr>`).join('');
 const content=mode==='attempts'
  ? `<div class="admin-card"><div class="section-head"><div><h2>Login attempts</h2><p class="sub">Only users who tried to sign in but have never successfully signed in. Once login succeeds, they are removed from this list and appear in the logged-in user lists.</p></div><div class="admin-user-tabs">${tabs.map(x=>`<button class="btn ${mode===x[0]?'primary':''}" onclick="window.seUserMode='${x[0]}';render()">${x[1]}</button>`).join('')}</div></div><div class="as-table-wrap"><table class="admin-table"><thead><tr><th>User / Email</th><th>Attempts</th><th>First attempt</th><th>Last attempt</th><th>Status</th></tr></thead><tbody>${attemptTable||'<tr><td colspan="5"><div class="admin-empty">No unsuccessful login attempts recorded on this browser.</div></td></tr>'}</tbody></table></div></div>`
  : `<div class="admin-card"><div class="section-head"><div><h2>Logged-in Users</h2><p class="sub">Only users who have successfully signed in are shown here.</p></div><div class="admin-user-tabs">${tabs.map(x=>`<button class="btn ${mode===x[0]?'primary':''}" onclick="window.seUserMode='${x[0]}';render()">${x[1]}</button>`).join('')}</div></div>${mode==='active'?`<div class="se-user-subtabs">${activeSubs.map(x=>`<button class="btn ${sub===x[0]?'primary':''}" onclick="window.seUserActiveSub='${x[0]}';render()">${x[1]}</button>`).join('')}</div>`:''}<div class="as-table-wrap"><table class="admin-table"><thead><tr><th>User</th><th>First login</th><th>Last login</th><th>Last active</th><th>Store</th><th>Activity</th></tr></thead><tbody>${tableRows||'<tr><td colspan="6"><div class="admin-empty">No successfully logged-in users in this view.</div></td></tr>'}</tbody></table></div></div>`;
 return adminLayout('users','Users & Sellers',content);
};
const style=document.createElement('style');style.id='se-user-activity-v23-style';style.textContent='.se-user-subtabs{display:flex;gap:8px;flex-wrap:wrap;margin:-2px 0 14px;padding:10px;border:1px solid var(--line,#e6e8ef);border-radius:12px;background:var(--surface,#fff)}.admin-user-tabs{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.admin-table small{display:block;color:var(--muted,#7b8190);margin-top:3px}.admin-pill.warn{background:#fff7df;color:#8a6200;border:1px solid #f0d58b}';document.head.appendChild(style);
try{const a=readAttempts();if(a.length&&!window.__seLoginAttemptsLoaded){window.__seLoginAttemptsLoaded=true}}catch(e){}
})();


