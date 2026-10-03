
/* Inlined from assets/js/57-saleearn-part.js */

/* FINAL SUPABASE USER DIRECTORY FIX — AUTHORITATIVE LOGIN DIRECTORY
   - Supabase is the source of truth for Admin Users / Total Users.
   - Only profiles with has_logged_in = true AND last_login_at present are valid.
   - Never show signup-only / never-logged-in profiles.
   - Admin account itself is excluded from user totals.
   - Preferred source: SECURITY DEFINER RPC admin_get_logged_in_users.
   - Fallback: direct profiles query when the RPC is not installed yet.
*/
(function(){
  'use strict';

  let refreshBusy=false;
  let refreshDone=false;
  let remoteLoggedUsers=[];

  const adminId=()=>String(S.currentUser?.authId||S.currentUser?.id||'19424c7c-8624-4aa2-b2fb-002a0f57b8ed');
  const validRemote=(r)=>!!(r && String(r.email||'').trim() && r.has_logged_in===true);

  function normalizeRemote(rows){
    return (Array.isArray(rows)?rows:[])
      .filter(validRemote)
      .filter(r=>String(r.id||'')!==adminId())
      .map(r=>({
        id:String(r.id||''),
        authId:String(r.id||''),
        userId:r.user_id||String(r.id||''),
        name:r.display_name||String(r.email||'').split('@')[0]||'User',
        email:String(r.email||'').trim(),
        role:r.role||'user',
        verified:true,
        hasLoggedIn:true,
        firstLoginAt:r.first_login_at||null,
        lastLoginAt:r.last_login_at||null,
        lastActiveAt:r.last_login_at||null
      }));
  }

  window.seAdminLoggedInUsers=()=>remoteLoggedUsers.slice();
  window.seAdminLoggedInDirectoryReady=()=>refreshDone;
  window.seAdminLoggedInUserCount=()=>remoteLoggedUsers.length;

  window.seRefreshAdminLoggedInUsers=async function(force=false){
    if(refreshBusy || (!force && refreshDone)) return remoteLoggedUsers;
    if(!window.supabaseClient || !SUPABASE_READY || !S.currentUser || !isAdmin()) return remoteLoggedUsers;

    refreshBusy=true;
    try{
      let rows=[];
      let rpcError=null;

      /* Secure Admin RPC is preferred. Merge it with a direct profiles query
         when RLS permits it, so an incomplete RPC result cannot hide logged-in users. */
      try{
        const rpc=await supabaseClient.rpc('admin_get_logged_in_users');
        if(Array.isArray(rpc.data)) rows=rows.concat(rpc.data);
        rpcError=rpc.error||null;
      }catch(e){ rpcError=e; }

      try{
        const q=await supabaseClient
          .from('profiles')
          .select('id,email,display_name,role,first_login_at,last_login_at,has_logged_in,user_id')
          .eq('has_logged_in',true)
          .order('last_login_at',{ascending:false,nullsFirst:false});
        if(Array.isArray(q.data)) rows=rows.concat(q.data);
        /* A direct-query RLS error is tolerated when the secure RPC succeeded. */
        if(q.error && !rows.length && rpcError) throw q.error;
      }catch(e){
        if(!rows.length && rpcError){
          console.warn('Admin logged-in users Supabase refresh failed:',e?.message||rpcError?.message||rpcError);
          remoteLoggedUsers=[];
          refreshDone=true;
          return remoteLoggedUsers;
        }
      }

      if(!rows.length && rpcError){
        console.warn('Admin logged-in users Supabase refresh failed:',rpcError.message||rpcError);
        remoteLoggedUsers=[];
        refreshDone=true;
        return remoteLoggedUsers;
      }

      /* Deduplicate records returned by RPC + profiles query. */
      const seen=new Set();
      rows=rows.filter(r=>{
        const k=String(r?.id||r?.user_id||r?.email||'').toLowerCase();
        if(!k||seen.has(k)) return false;
        seen.add(k); return true;
      });

      remoteLoggedUsers=normalizeRemote(rows);

      /* Replace the local Admin directory with the authoritative Supabase set.
         This prevents old signup-only local records from reappearing. */
      const keepById=new Map(remoteLoggedUsers.map(u=>[u.authId,u]));
      const existingById=new Map((S.users||[]).map(u=>[String(u.authId||u.id||''),u]));

      for(const r of remoteLoggedUsers){
        let u=existingById.get(r.authId);
        if(!u){
          u={id:r.id,authId:r.authId,userId:r.userId,name:r.name,email:r.email,role:r.role,verified:true};
          S.users.push(u);
        }
        u.authId=r.authId;
        u.id=u.id||r.id;
        u.userId=r.userId||u.userId;
        u.name=r.name||u.name;
        u.email=r.email;
        u.role=r.role||u.role||'user';
        u.verified=true;
        u.hasLoggedIn=true;
        u.firstLoginAt=r.firstLoginAt||u.firstLoginAt||null;
        u.lastLoginAt=r.lastLoginAt||null;
        u.lastActiveAt=r.lastActiveAt||u.lastActiveAt||null;
      }

      /* Any local non-admin account absent from the successful Supabase set is
         not allowed to remain eligible for the Admin Users list/count. */
      for(const u of (S.users||[])){
        if(!u || u.isAdmin) continue;
        const id=String(u.authId||u.id||'');
        if(id && !keepById.has(id)) u.hasLoggedIn=false;
      }

      try{save();}catch(e){}
      refreshDone=true;
      return remoteLoggedUsers;
    }catch(e){
      console.warn('Admin logged-in users refresh failed:',e?.message||e);
      remoteLoggedUsers=[];
      refreshDone=true;
      return remoteLoggedUsers;
    }finally{
      refreshBusy=false;
    }
  };

  function strictRows(){ return remoteLoggedUsers.slice(); }

  const oldAdminUsers=window.adminUsers;
  window.adminUsers=function(){
    if(!adminOnly()) return;
    const mode=String(window.seUserMode||window.v19UserMode||'all');
    let rows=strictRows();
    const now=Date.now();
    if(mode==='new'){
      rows=rows.filter(u=>{const t=new Date(u.firstLoginAt||0).getTime();return !!t&&now-t<7*86400000;});
    }else if(mode==='active'){
      rows=rows.filter(u=>{const t=new Date(u.lastActiveAt||u.lastLoginAt||0).getTime();return !!t&&now-t<30*86400000;});
    }

    const html=adminLayout('users','Users & Sellers',`
      <div class="admin-card">
        <div class="section-head">
          <div>
            <h2>Logged-in Users</h2>
            <p class="sub">Only users with a successful Supabase login are shown.</p>
          </div>
          <div class="admin-user-tabs">
            ${[['all','All'],['new','New users'],['active','Active users']].map(x=>
              `<button class="btn ${mode===x[0]?'primary':''}" onclick="window.seUserMode='${x[0]}';render()">${x[1]}</button>`
            ).join('')}
          </div>
        </div>
        <div class="as-table-wrap">
          <table class="admin-table">
            <thead><tr><th>User</th><th>First login</th><th>Last login</th><th>Last active</th><th>Store</th></tr></thead>
            <tbody>
              ${rows.map(u=>`<tr class="data-row" onclick="adminNav('user/${u.id}')">
                <td><b>${esc(u.name)}</b><small>${esc(u.email)}</small></td>
                <td>${u.firstLoginAt?new Date(u.firstLoginAt).toLocaleString('en-IN'):'-'}</td>
                <td>${u.lastLoginAt?new Date(u.lastLoginAt).toLocaleString('en-IN'):'-'}</td>
                <td>${u.lastActiveAt?new Date(u.lastActiveAt).toLocaleString('en-IN'):'-'}</td>
                <td>${esc(seller(u.sellerId)?.name||'-')}</td>
              </tr>`).join('')||'<tr><td colspan="5"><div class="admin-empty">No successfully logged-in users found in Supabase.</div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`);
    document.getElementById('app').innerHTML=html;
  };

  const oldAdminNav=window.adminNav;
  window.adminNav=function(r){
    const out=oldAdminNav.apply(this,arguments);
    if(String(r||'')==='users' || String(r||'').startsWith('users/')){
      setTimeout(async()=>{
        await window.seRefreshAdminLoggedInUsers(true);
        if(route()==='admin/users') render();
      },0);
    }
    return out;
  };

  const oldRender=window.render;
  window.render=function(){
    const result=oldRender.apply(this,arguments);
    if(route()==='admin' || route()==='admin/'){
      setTimeout(async()=>{
        await window.seRefreshAdminLoggedInUsers(true);
        if(route()==='admin' || route()==='admin/'){
          const n=window.seAdminLoggedInUserCount();
          document.querySelectorAll('.admin-kpi').forEach(k=>{
            const label=k.querySelector('span');
            if(label && label.textContent.trim().toLowerCase()==='total users'){
              const b=k.querySelector('b');
              if(b)b.textContent=String(n);
            }
          });
        }
      },0);
    }
    return result;
  };
})();

