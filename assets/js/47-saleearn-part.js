
(function(){
'use strict';
/* v14: remove the single-admin-slot lock. Admin access remains Supabase admin_users verified. */
window.seAdminSessionId='';
window.seAdminSessionActive=true;
async function adminRpc(name,args){
  if(!window.supabaseClient)throw new Error('Secure admin backend is not connected');
  const {data,error}=await window.supabaseClient.rpc(name,args||{});
  if(error)throw error;
  return data;
}
async function ensureAdminSession(){
  return !!isAdmin();
}
window.saleEarnAdminSessionReady=ensureAdminSession;
window.claimSaleEarnAdminSession=async()=>!!isAdmin();
window.releaseSaleEarnAdminSession=async function(signOut=true){
  if(signOut){try{await supabaseClient.auth.signOut()}catch(e){}S.currentUser=null;try{save()}catch(e){}go('home')}
};

/* Admin routes no longer wait for a one-admin session slot. */
const oldAdminOnlyV14=window.adminOnly;
window.adminOnly=function(){
  if(!S.currentUser){openAuth('signin','admin');return false}
  if(!isAdmin()){toast('Admin access required');return false}
  return true;
};

/* Admin-only verified sale increase. This is an audited adjustment, not a fake order. */
const baseLedgerV14=window.sellerLedger;
window.sellerLedger=function(sid){
  const L=baseLedgerV14(sid);
  const adjustments=(S.sellerFinanceLedger||[]).filter(x=>String(x?.sellerId||'')===String(sid)&&x?.type==='SALE_ADJUSTMENT'&&!x?.voided);
  const grossAdj=adjustments.reduce((a,x)=>a+Number(x.grossAmount??x.amount??0),0);
  const netAdj=adjustments.reduce((a,x)=>a+Number(x.netAmount??(Number(x.grossAmount??x.amount??0)*0.8)),0);
  if(!grossAdj)return L;
  return {...L,gross:Math.round((L.gross+grossAdj)*100)/100,fee:Math.round((L.fee+(grossAdj-netAdj))*100)/100,earned:Math.round((L.earned+netAdj)*100)/100,available:Math.max(0,Math.round((L.available+netAdj)*100)/100),raw:Math.round((L.raw+netAdj)*100)/100,sales:Number(L.sales||0)+adjustments.length,adminSaleAdjustments:adjustments};
};
window.sellerEarnings=sid=>window.sellerLedger(sid).earned;
window.sellerAvailableBalance=sid=>window.sellerLedger(sid).available;

window.adminIncreaseSellerSale=async function(uid){
  if(!window.adminOnly())return;
  const u=(S.users||[]).find(x=>String(x.id)===String(uid)),sid=u?.sellerId;
  const amount=Number(document.getElementById('v11SaleAmount')?.value||0);
  const note=(document.getElementById('v11SaleNote')?.value||'').trim();
  const commissionPctRaw=document.getElementById('v11SaleCommission')?.value;
  const commissionPct=commissionPctRaw===''||commissionPctRaw==null?Math.round((typeof effectivePlatformFeeRate==='function'?effectivePlatformFeeRate(sid):0.20)*100):Number(commissionPctRaw);
  if(!sid)return toast('Seller not found');
  if(!Number.isFinite(amount)||amount<=0||amount>1000000)return toast('Sale amount must be between ₹0.01 and ₹10,00,000');
  if(!Number.isFinite(commissionPct)||commissionPct<0||commissionPct>100)return toast('Commission % must be between 0 and 100');
  if(note.length<3)return toast('Reason is required');
  try{
    let serverRow=null;
    if(window.supabaseClient){serverRow=await adminRpc('admin_add_sale_adjustment',{p_seller_id:u.authId||u.id,p_gross_amount:amount,p_note:note,p_commission_pct:commissionPct});}
    const gross=Number(serverRow?.gross_amount??amount),net=Number(serverRow?.seller_net_amount??Math.round(gross*(1-commissionPct/100)*100)/100);
    S.sellerFinanceLedger=S.sellerFinanceLedger||[];
    S.sellerFinanceLedger.unshift({id:String(serverRow?.id||('saleadj_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7))),sellerId:sid,userId:uid,type:'SALE_ADJUSTMENT',grossAmount:gross,netAmount:net,amount:gross,note,date:serverRow?.created_at||nowISO(),adminId:S.currentUser.id,serverAuthoritative:!!serverRow});
    adminAudit('Admin increased seller sales',sid,{grossAmount:gross,netAmount:net,note,serverAuthoritative:!!serverRow});
    save();toast('Seller sale increased by '+money(gross)+' · Receive '+money(net));render();
  }catch(e){console.error('Admin sale adjustment:',e);toast(e?.message||'Sale increase failed. No local change was applied.');}
};

const oldAdminUserDetailV14=window.adminUserDetail;
window.adminUserDetail=function(id){
  const html=oldAdminUserDetailV14(id),u=(S.users||[]).find(x=>String(x.id)===String(id));
  if(!u?.sellerId)return html;
  const t=document.createElement('template');t.innerHTML=html;const root=t.content.querySelector('.admin-content');
  const card=document.createElement('div');card.className='admin-card';
  const defaultPct=Math.round((typeof effectivePlatformFeeRate==='function'?effectivePlatformFeeRate(u?.sellerId):0.20)*100);
  card.innerHTML=`<div class="section-head"><div><h2>Admin Sale Control</h2><p class="sub">Admin-only audited adjustment. It adds a verified sale adjustment without rewriting historical orders. Commission defaults to this seller's plan rate (${defaultPct}%) — set it to 0 for a no-commission manual credit or test entry.</p></div><span class="admin-pill danger">ADMIN ONLY</span></div><div class="finance-adjust-grid"><div class="field"><label>Increase Sale (Gross)</label><input id="v11SaleAmount" type="number" min="0.01" max="1000000" step="0.01" placeholder="₹100"></div><div class="field"><label>Commission % (0 = no commission)</label><input id="v11SaleCommission" type="number" min="0" max="100" step="0.01" value="${defaultPct}"></div><div class="field"><label>Reason (required)</label><input id="v11SaleNote" maxlength="240" placeholder="Manual sale correction"></div><div class="admin-stat-row"><div class="admin-stat"><b id="v11SalePreview">₹0.00</b><span class="small muted" id="v11SalePreviewLabel">Seller Receive (${100-defaultPct}%)</span></div></div><button class="btn primary" onclick="adminIncreaseSellerSale('${esc(id)}')">Increase Seller Sale</button></div>`;
  root?.appendChild(card);return t.innerHTML;
};
function v11UpdateSalePreview(){
  const n=Math.max(0,Number(document.getElementById('v11SaleAmount')?.value||0));
  const pctRaw=document.getElementById('v11SaleCommission')?.value;
  const pct=Math.min(100,Math.max(0,Number(pctRaw===''||pctRaw==null?0:pctRaw)));
  const p=document.getElementById('v11SalePreview');if(p)p.textContent=money(Math.round(n*(1-pct/100)*100)/100);
  const lbl=document.getElementById('v11SalePreviewLabel');if(lbl)lbl.textContent=`Seller Receive (${Math.round((100-pct)*100)/100}%)`;
}
document.addEventListener('input',e=>{if(e.target?.id==='v11SaleAmount'||e.target?.id==='v11SaleCommission')v11UpdateSalePreview();});

async function loadServerSaleAdjustments(){
  if(!window.supabaseClient||!S.currentUser||!isAdmin())return;
  try{
    /* admin_sale_adjustments is protected. Read it through the admin-only RPC so
       the browser never needs a broad table grant and never emits a 403 when the
       table itself is intentionally hidden behind RLS. */
    const {data,error}=await window.supabaseClient.rpc('admin_get_sale_adjustments');
    if(error)throw error;if(!Array.isArray(data))return;
    S.sellerFinanceLedger=S.sellerFinanceLedger||[];const byId=new Map(S.sellerFinanceLedger.map(x=>[String(x.id),x]));
    data.forEach(x=>{const local=byId.get(String(x.id));const sellerUser=(S.users||[]).find(u=>String(u.authId||u.id)===String(x.seller_id));const row={id:String(x.id),sellerId:sellerUser?.sellerId||x.seller_id,userId:sellerUser?.id||x.seller_id,type:'SALE_ADJUSTMENT',grossAmount:Number(x.gross_amount),netAmount:Number(x.seller_net_amount),amount:Number(x.gross_amount),note:x.note,date:x.created_at,adminId:x.created_by,serverAuthoritative:true};if(local)Object.assign(local,row);else S.sellerFinanceLedger.push(row)});save();
  }catch(e){console.warn('Server sale adjustments unavailable:',e?.message||e)}
}
if(window.supabaseClient)setTimeout(()=>loadServerSaleAdjustments(),1800);
})();
