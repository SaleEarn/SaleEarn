
(function(){
  'use strict';

  function inputValue(id){return String(document.getElementById(id)?.value||'').trim()}
  function profileLinkRows(t){
    const rows=Array.isArray(t?.links)&&t.links.length?t.links:[{title:'',url:''}];
    return rows.map(x=>`<div class="se-admin-profile-link" data-se-admin-link><div class="field"><label>Link title</label><input class="seAdminLinkTitle" maxlength="100" value="${esc(x.title||'')}" placeholder="Telegram, Portfolio..."></div><div class="field"><label>Link URL</label><input class="seAdminLinkUrl" maxlength="400" value="${esc(x.url||'')}" placeholder="https://..."></div><button type="button" class="btn danger" onclick="this.closest('[data-se-admin-link]').remove()">Remove</button></div>`).join('')
  }
  window.addAdminProfileLink=function(){
    const box=document.getElementById('seAdminProfileLinks');
    if(!box)return;
    if(box.children.length>=12)return toast('Maximum 12 links');
    box.insertAdjacentHTML('beforeend',profileLinkRows({links:[{title:'',url:''}]}));
  };

  function rewriteReferences(oldUser,newUser,oldSeller,newSeller){
    const userKeys=['id','userId','customerId','buyerId','ownerId','memberId'];
    const sellerKeys=['sellerId','storeId'];
    const rewrite=row=>{
      if(!row||typeof row!=='object')return;
      userKeys.forEach(k=>{if(k!=='id'&&row[k]===oldUser)row[k]=newUser});
      sellerKeys.forEach(k=>{if(row[k]===oldSeller)row[k]=newSeller});
      if(row.createdBy===oldUser)row.createdBy=newUser;
      if(row.updatedBy===oldUser)row.updatedBy=newUser;
    };
    ['users','products','orders','payouts','ads','referrals','warnings','devices','disputes','refunds','couponRedemptions','downloadEvents','gatewayPayments','messages','messageThreads','serviceRefunds','sellerFinanceLedger','securityEvents','notifications'].forEach(k=>Array.isArray(S[k])&&S[k].forEach(rewrite));
    if(S.currentUser?.id===oldUser)S.currentUser.id=newUser;
  }

  window.adminSaveUserProfile=function(oldUserId){
    if(!adminOnly())return;
    const u=(S.users||[]).find(x=>String(x.id)===String(oldUserId));
    if(!u)return toast('User not found');
    const oldUid=String(u.id),oldSid=String(u.sellerId||'');
    const newUid=inputValue('seAdminUserId')||oldUid;
    const newSid=inputValue('seAdminSellerId')||oldSid;
    const reserved=['ADMIN','SALEEARN','SUPPORT','ROOT','SYSTEM'];
    if(!newUid||reserved.includes(newUid.toUpperCase()))return toast('This User ID is reserved');
    if((S.users||[]).some(x=>x!==u&&String(x.id).toLowerCase()===newUid.toLowerCase()))return toast('User ID already exists');
    if(oldSid){
      if(!newSid||reserved.includes(newSid.toUpperCase()))return toast('This Seller ID is reserved');
      if(newSid!==oldSid&&S.sellers?.[newSid])return toast('Seller ID already exists');
    }
    const newName=inputValue('seAdminUserName')||u.name||newUid;
    const newEmail=inputValue('seAdminEmail');
    const newUserAbout=inputValue('seAdminUserAbout').slice(0,5000);
    const ss=oldSid?S.sellers?.[oldSid]:null;
    const newStoreName=inputValue('seAdminStoreName')||ss?.name||'Seller Store';
    const newOwner=inputValue('seAdminStoreOwner')||newName;
    const newStoreBio=inputValue('seAdminStoreBio').slice(0,5000);
    const newSupport=inputValue('seAdminSupport').slice(0,300);
    const newAbout=inputValue('seAdminAbout').slice(0,5000);
    const newPolicies=inputValue('seAdminPolicies').slice(0,5000);
    const newVideo=safeHttpUrl(inputValue('seAdminVideo'));
    const newInstagram=safeHttpUrl(inputValue('seAdminInstagram'));
    const newYoutube=safeHttpUrl(inputValue('seAdminYoutube'));
    const newWebsite=safeHttpUrl(inputValue('seAdminWebsite'));
    const links=[...document.querySelectorAll('[data-se-admin-link]')].map(row=>({title:String(row.querySelector('.seAdminLinkTitle')?.value||'').trim().slice(0,100),url:safeHttpUrl(String(row.querySelector('.seAdminLinkUrl')?.value||'').trim())})).filter(x=>x.title&&x.url).slice(0,12);

    if(oldUid!==newUid||oldSid!==newSid)rewriteReferences(oldUid,newUid,oldSid,newSid||oldSid);
    u.id=newUid;u.userId=newUid;u.name=newName;u.email=newEmail;u.bio=newUserAbout;u.about=newUserAbout;
    if(oldSid&&ss){
      if(oldSid!==newSid){delete S.sellers[oldSid];ss.id=newSid;S.sellers[newSid]=ss;}
      ss.name=newStoreName;ss.owner=newOwner;ss.bio=newStoreBio;ss.support=newSupport;
      S.storeThemes=S.storeThemes||{};
      const oldTheme=S.storeThemes[oldSid]||{};
      if(oldSid!==newSid)delete S.storeThemes[oldSid];
      S.storeThemes[newSid]={...oldTheme,about:newAbout,policies:newPolicies,video:newVideo,instagram:newInstagram,youtube:newYoutube,website:newWebsite,links};
      if(S.badgeLedgers?.[oldSid]&&oldSid!==newSid){S.badgeLedgers[newSid]=S.badgeLedgers[oldSid];delete S.badgeLedgers[oldSid]}
    }
    adminAudit('Updated user and seller profile',newUid,{oldUserId:oldUid,newUserId:newUid,oldSellerId:oldSid||null,newSellerId:newSid||null});
    save();toast('User and seller profile updated');
    adminNav('user/'+encodeURIComponent(newUid));
  };

  function adminProfileEditor(u,ss){
    const t=ss?storeTheme(ss.id):{};
    return `<div class="admin-card se-admin-profile-editor"><div class="section-head"><div><h2>Edit User & Seller Profile</h2><div class="sub">Admin can update the account identity, seller store About section and all public links.</div></div><span class="admin-pill warn">Admin control</span></div><div class="se-admin-profile-note">Changing User ID or Seller ID updates the connected products, orders, payouts and seller records automatically. Use full URLs beginning with http:// or https://.</div><div class="se-admin-profile-grid"><div class="field"><label>User name</label><input id="seAdminUserName" maxlength="120" value="${esc(u.name||'')}" placeholder="User name"></div><div class="field"><label>User ID</label><input id="seAdminUserId" maxlength="80" value="${esc(u.id||'')}" placeholder="User ID"></div><div class="field"><label>Email</label><input id="seAdminEmail" type="email" maxlength="180" value="${esc(u.email||'')}" placeholder="email@example.com"></div><div class="field"><label>User About</label><input id="seAdminUserAbout" maxlength="5000" value="${esc(u.bio||u.about||'')}" placeholder="Short user about"></div>${ss?`<div class="field"><label>Seller ID</label><input id="seAdminSellerId" maxlength="100" value="${esc(ss.id||'')}" placeholder="Seller ID"></div><div class="field"><label>Store name</label><input id="seAdminStoreName" maxlength="160" value="${esc(ss.name||'')}" placeholder="Store name"></div><div class="field"><label>Store owner</label><input id="seAdminStoreOwner" maxlength="160" value="${esc(ss.owner||u.name||'')}" placeholder="Owner name"></div><div class="field"><label>Support contact</label><input id="seAdminSupport" maxlength="300" value="${esc(ss.support||'')}" placeholder="Email, Telegram or support detail"></div><div class="field se-admin-profile-wide"><label>Store bio</label><textarea id="seAdminStoreBio" maxlength="5000" placeholder="Store description">${esc(ss.bio||'')}</textarea></div><div class="field se-admin-profile-wide"><label>Public About section</label><textarea id="seAdminAbout" maxlength="5000" placeholder="What should visitors know about this seller?">${esc(t.about||'')}</textarea></div><div class="field se-admin-profile-wide"><label>Store policies</label><textarea id="seAdminPolicies" maxlength="5000" placeholder="Refund, usage or delivery policies">${esc(t.policies||'')}</textarea></div><div class="field"><label>Introduction video URL</label><input id="seAdminVideo" maxlength="400" value="${esc(t.video||'')}" placeholder="https://youtube.com/watch?v=..."></div><div class="field"><label>Website URL</label><input id="seAdminWebsite" maxlength="400" value="${esc(t.website||'')}" placeholder="https://..."></div><div class="field"><label>Instagram URL</label><input id="seAdminInstagram" maxlength="400" value="${esc(t.instagram||'')}" placeholder="https://instagram.com/..."></div><div class="field"><label>YouTube URL</label><input id="seAdminYoutube" maxlength="400" value="${esc(t.youtube||'')}" placeholder="https://youtube.com/..."></div><div class="field se-admin-profile-wide"><label>Public About links</label><div id="seAdminProfileLinks" class="se-admin-profile-links">${profileLinkRows(t)}</div><button type="button" class="btn" style="margin-top:9px" onclick="addAdminProfileLink()">＋ Add link</button></div>`:'<div class="field se-admin-profile-wide"><div class="admin-empty">This account has no seller store yet.</div></div>'}</div><div class="se-admin-profile-actions"><span class="small muted">Changes are saved through the existing state sync.</span><button class="btn primary" onclick="adminSaveUserProfile('${esc(u.id)}')">Save User & Seller Profile</button></div></div>`;
  }

  const originalAdminUserDetail=adminUserDetail;
  adminUserDetail=function(id){
    const u=(S.users||[]).find(x=>String(x.id)===String(id));
    const html=originalAdminUserDetail(id);
    if(!u)return html;
    const ss=u.sellerId?seller(u.sellerId):null;
    const tpl=document.createElement('template');tpl.innerHTML=html;
    tpl.content.querySelector('.admin-content')?.insertAdjacentHTML('beforeend',adminProfileEditor(u,ss));
    return tpl.innerHTML;
  };

  window.pcFilterList=function(input){
    window.pcQuery=input.value||'';
    const q=window.pcQuery.trim().toLowerCase();
    document.querySelectorAll('.pc-grid .pc-product').forEach(card=>{
      const text=String(card.textContent||'').toLowerCase();
      card.hidden=!!q&&!text.includes(q);
    });
  };
  window.orderLiveSearch=function(input){
    window.orderSearch=input.value||'';
    const q=window.orderSearch.trim().toLowerCase();
    document.querySelectorAll('.dash-table tbody tr').forEach(row=>{
      row.hidden=!!q&&!String(row.textContent||'').toLowerCase().includes(q);
    });
  };
})();
