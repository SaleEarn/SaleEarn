
(function(){
  'use strict';
  const originalDashShell=typeof dashShell==='function'?dashShell:null;

  window.adminOpenSellerDashboard=function(sid){
    if(!adminOnly())return;
    const id=String(sid||'');
    if(!id||!S.sellers?.[id])return toast('Seller store not found');
    window.adminSellerPreview=id;
    window.__adminPreviewReturnRoute=route();
    go('dashboard/overview');
    setTimeout(()=>window.render(),0);
  };

  window.adminExitSellerDashboard=function(){
    window.adminSellerPreview='';
    const back=window.__adminPreviewReturnRoute&&String(window.__adminPreviewReturnRoute).startsWith('admin')?window.__adminPreviewReturnRoute:'admin/users';
    window.__adminPreviewReturnRoute='';
    go(back);
  };

  function adminPreviewDashShell(page,content){
    const s=seller(String(window.adminSellerPreview));
    const nav=(typeof dashItems!=='undefined'?dashItems:[]).map(x=>`<button class="dash-link ${page===x[0]?'active':''}" onclick="go('dashboard/${x[0]}')">${x[1]} <span>${x[2]}</span></button>`).join('');
    const warningCount=(S.warnings||[]).filter(w=>w.sellerId===s.id && !w.read).length;
    return `<div class="dashboard-shell"><aside class="dash-side"><button class="dash-brand dash-brand-link" type="button" onclick="go('market')" title="Open Marketplace"><span class="logo-mark">SE</span><span>Vendor Portal</span></button><button class="dash-link" onclick="adminExitSellerDashboard()">← <span>Exit Admin Preview</span></button><button class="dash-link" onclick="go('seller/${encodeURIComponent(s.id)}')">↗ <span>View Seller Store</span></button><div class="dash-nav-title">MANAGEMENT</div>${nav}<div class="store-mini">${avatar(s)}<div><b class="small">${esc(s.name||'Seller Store')}</b><div class="small muted">${esc(s.owner||'Seller')}</div></div></div><button class="btn upgrade" onclick="go('dashboard/subscription')">♙ Manage Plan</button></aside><section class="dash-main"><div class="dash-top"><h1>${dashTitle(page)}</h1><div style="display:flex;align-items:center;gap:8px"><span class="admin-pill success">ADMIN VIEW</span><div class="plan-badge">◈ &nbsp; ${esc(s.plan||'FREE')}</div>${warningCount?`<button class="btn" onclick="go('dashboard/warnings')">⚠<span class="seller-warning-badge">${warningCount}</span></button>`:''}</div></div><div class="dash-content"><div class="admin-preview-exit"><span>Admin is controlling <b>@${esc(s.id)}</b> seller dashboard.</span><button class="btn" onclick="adminExitSellerDashboard()">Exit Preview</button></div>${content}</div></section></div>`;
  }

  if(originalDashShell){
    dashShell=function(page,content){
      if(window.adminSellerPreview&&isAdmin()){
        const sid=String(window.adminSellerPreview);
        const adminPanel=(page==='overview' && typeof adminSellerControlPanel==='function') ? adminSellerControlPanel(sid) : '';
        return adminPreviewDashShell(page,adminPanel+content);
      }
      return originalDashShell(page,content);
    };
  }

  // If the current route is the seller dashboard after opening preview, refresh it with the preview shell.
  const previousRender=window.render;
  window.render=function(){
    previousRender();
  };
})();
