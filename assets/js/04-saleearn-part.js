
(function(){
  "use strict";

  const DEFAULT_SCORE = 70;
  const ADMIN_EMAIL = "mohitghasoliya89@gmail.com";

  function getState(){
    try { return (typeof S !== "undefined" && S) ? S : null; } catch(e){ return null; }
  }
  function persist(){
    try { if(typeof saveState === "function") saveState(); } catch(e){}
    try { if(typeof syncState === "function") syncState(); } catch(e){}
  }
  function audit(action, detail){
    try {
      if(typeof addAuditLog === "function") addAuditLog(action, detail);
    } catch(e){}
  }

  /* ---------- User score ---------- */
  function ensureUserScore(user){
    if(!user || typeof user !== "object") return;
    if(user.isAdmin===true && String(user.authId||user.id||"")==="19424c7c-8624-4aa2-b2fb-002a0f57b8ed"){user.score=100;return;}
    if(!Number.isFinite(Number(user.score))) user.score = DEFAULT_SCORE;
    user.score = Math.max(0, Math.min(100, Number(user.score)));
  }

  window.saleEarnEnsureScores = function(){
    const st = getState();
    if(!st || !Array.isArray(st.users)) return;
    let changed = false;
    st.users.forEach(u=>{
      const before = u.score;
      ensureUserScore(u);
      if(before !== u.score) changed = true;
    });
    if(changed) persist();
  };

  window.saleEarnEditUserScore = async function(userId, score, reason){
    const st = getState();
    if(!st || !Array.isArray(st.users)) return false;
    const user = st.users.find(u=>String(u.id || u.userId)===String(userId));
    const n = Number(score);
    if(!user || !Number.isFinite(n) || n<0 || n>100) return false;
    ensureUserScore(user);
    const old = user.score;
    user.score = Math.max(0, Math.min(100, n));
    user.scoreManual = true;
    user.scoreReason = String(reason || "Admin score update");
    user.scoreUpdatedAt = new Date().toISOString();
    if(user.sellerId && st.sellers?.[user.sellerId]){
      st.sellers[user.sellerId].score=user.score;
      st.sellers[user.sellerId].scoreManual=true;
      st.sellers[user.sellerId].scoreUpdatedAt=user.scoreUpdatedAt;
    }
    if(!Array.isArray(st.scoreHistory)) st.scoreHistory = [];
    st.scoreHistory.unshift({
      id:(typeof uid==='function'?uid('score'):('score_'+Date.now())),
      userId:String(userId), sellerId:user.sellerId||null, oldScore:old, newScore:user.score,
      reason:user.scoreReason, date:user.scoreUpdatedAt, source:"ADMIN"
    });
    audit("USER_SCORE_EDITED", "User "+userId+": "+old+" -> "+user.score);
    persist();
    // Save the shared state immediately so the user's Seller ID page uses the new value.
    try{ if(typeof window.save==='function') window.save(); }catch(e){console.warn('Admin score shared save failed',e)}
    // Also write the normalized profile so the score follows the user's auth/user ID.
    try {
      const authId = user.authId || (seAuthUuid(user.id) ? user.id : null);
      if(typeof supabaseClient !== "undefined" && supabaseClient?.from){
        const payload={score:user.score};
        let wrote=false;
        if(authId){
          const r=await supabaseClient.from("profiles").update(payload).eq("id",String(authId));
          if(r.error)console.warn("Admin user score profile update failed",r.error.message); else wrote=true;
        }
        if(!wrote && user.userId){
          const r=await supabaseClient.from("profiles").update(payload).eq("user_id",String(user.userId));
          if(r.error)console.warn("Admin user score user_id update failed",r.error.message);
          else wrote=true;
        }
      }
    } catch(e){ console.warn("Admin user score cloud sync failed",e); }
    try{ if(typeof window.__seAdminImmediateSave!=='undefined') await window.__seAdminImmediateSave; }catch(e){ console.warn('Admin score shared save wait failed',e); }
    try{ if(typeof SE_PUBLIC_SELLER_MEMO!=='undefined' && user.sellerId) SE_PUBLIC_SELLER_MEMO.delete(String(user.sellerId)); }catch{}
    return true;
  };

  /* ---------- Warnings ---------- */
  window.saleEarnRemoveUserWarning = function(userId, warningId){
    const st = getState();
    if(!st) return false;
    const keys = ["warnings","userWarnings","adminWarnings"];
    for(const key of keys){
      if(!Array.isArray(st[key])) continue;
      const before = st[key].length;
      st[key] = st[key].filter(w=>{
        const uid = w.userId || w.sellerId || w.targetUserId;
        const wid = w.id || w.warningId;
        return !(String(uid)===String(userId) &&
          (warningId == null || String(wid)===String(warningId)));
      });
      if(st[key].length !== before){
        audit("WARNING_REMOVED", "Warning removed for user "+userId);
        persist();
        return true;
      }
    }
    return false;
  };

  /* ---------- Payout cancellation ---------- */
  window.saleEarnCancelPendingPayout = function(payoutId){
    const st = getState();
    if(!st || !Array.isArray(st.payouts)) return false;
    const p = st.payouts.find(x=>String(x.id)===String(payoutId));
    if(!p || String(p.status).toUpperCase()!=="PENDING") return false;
    p.status = "CANCELLED";
    p.cancelledAt = new Date().toISOString();
    p.paymentVerified = false;
    audit("PAYOUT_CANCELLED", "Payout "+payoutId+" cancelled by admin");
    persist();
    return true;
  };

  /* ---------- Status classes ---------- */
  function statusClass(text){
    const s=String(text||"").toUpperCase();
    if(s==="CANCELLED" || s==="CANCELED") return "status-cancelled";
    if(s==="PENDING" || s==="PROCESSING") return "status-pending";
    if(s==="PAID" || s==="APPROVED" || s==="SUCCESS" || s==="RECEIVED") return "status-success";
    return "status-neutral";
  }
  window.saleEarnPayoutStatusClass = statusClass;

  /* ---------- Initialize ---------- */
  function init(){
    window.saleEarnEnsureScores();
    if(typeof restore === "function") restore();
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
