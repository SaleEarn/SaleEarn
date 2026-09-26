
const SUPABASE_URL = "https://ivrfknfpfjhjytbixqcc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_3YyPAERqua80hvH2sbvBnw_5qX8l0w7";
// -------------------- CASHFREE PAYMENT GATEWAY --------------------
// IMPORTANT: Put ONLY the Cashfree App ID (Client ID) here. NEVER put the Secret Key in this HTML.
// The Secret Key belongs in the Supabase Edge Function secrets (CASHFREE_SECRET_KEY).
const CASHFREE_APP_ID = "1418174e1e1f7ceae68cd53dfac4718141";
const CASHFREE_MODE = "production"; // "sandbox" while testing, "production" once your Cashfree account is fully live
const CASHFREE_CREATE_ORDER_FUNCTION = "cashfree-create-order";
const CASHFREE_VERIFY_FUNCTION = "cashfree-verify-payment";

async function callGatewayFunction(functionName, body){
  if(!window.supabaseClient) throw new Error("Supabase client is not ready");
  const {data,error}=await window.supabaseClient.functions.invoke(functionName,{body});
  if(error) throw error;
  return data;
}

function razorpaySafeDescription(value){
  return String(value||"Sale Earn payment")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g," ")
    .replace(/\s+/g," ")
    .trim()
    .slice(0,255) || "Sale Earn payment";
}

async function sendTransactionEmails(order, product){
  try{
    if(!window.supabaseClient || !order || String(order.status||'').toUpperCase()!=='SUCCESS' || order.paymentVerified!==true) return {ok:false,skipped:true};

    const buyerId=String(order.customerId||order.buyerId||order.userId||S.currentUser?.id||'').trim();
    const sellerId=String(order.sellerId||product?.sellerId||'').trim();
    const buyerEmail=String(order.customerEmail||order.buyerEmail||S.currentUser?.email||'').trim();
    const seller=(S.users||[]).find(u=>String(u.id||'')===sellerId || String(u.userId||'')===sellerId || String(u.authId||'')===sellerId || String(u.email||'').toLowerCase()===String(product?.sellerEmail||'').toLowerCase());
    const sellerEmail=String(seller?.email||order.sellerEmail||product?.sellerEmail||'').trim();
    if(!buyerEmail && !sellerEmail) return {ok:false,skipped:true,error:'Buyer and seller email are missing'};

    const siteUrl=String(window.location.origin||'').replace(/\/$/,'');
    const salesUrl=`${siteUrl}/#dashboard/orders`;
    const accessUrl=String((product?.links&&product.links[0])||product?.secretLink||product?.deliveryUrl||product?.downloadUrl||order.deliveryUrl||'').trim();

    const payload={
      type:'product_purchase',
      order:{
        ...order,
        id:order.id, productId:order.productId, productTitle:product?.title||order.productTitle,
        status:'SUCCESS', paymentVerified:true,
        customerId:buyerId, sellerId:sellerId,
        customerName:order.customerName||S.currentUser?.name||'Customer',
        customerEmail:buyerEmail, buyerEmail:buyerEmail, sellerEmail:sellerEmail,
        gatewayPaymentId:order.gatewayPaymentId||'', razorpayOrderId:order.razorpayOrderId||'',
        accessUrl, salesUrl
      },
      buyer:{name:order.customerName||S.currentUser?.name||'Customer',email:buyerEmail,id:buyerId},
      seller:{name:seller?.name||seller?.display_name||product?.sellerName||'Seller',email:sellerEmail,id:sellerId},
      product:{...product,title:product?.title||order.productTitle||'Digital Product',sellerId:sellerId,accessUrl}
    };

    const {data,error}=await window.supabaseClient.functions.invoke('send-transaction-emails',{body:payload});
    if(error) throw error;
    return data||{ok:false};
  }catch(e){
    console.warn('Transaction email notification failed:',e);
    return {ok:false,error:e?.message||String(e)};
  }
}

// NOTE: this function is still named startRazorpayCheckout for backward compatibility
// (every purchase/subscription/ad flow in this file calls it by this name) — internally
// it now runs the payment through Cashfree instead of Razorpay.
async function startRazorpayCheckout({amount,description,customerName,customerEmail,metadata={},onVerified}){
  if(!CASHFREE_APP_ID){
    toast("Add your Cashfree App ID in the HTML first.");
    return false;
  }
  const payable=Math.round(Number(amount||0)*100);
  if(!payable){toast("Invalid payment amount");return false;}

  const receipt=(metadata.referenceId||uid("cf")).toString().replace(/[^a-zA-Z0-9_-]/g,"").slice(0,30);
  let order;
  try{
    order=await callGatewayFunction(CASHFREE_CREATE_ORDER_FUNCTION,{
      amount:payable,
      currency:"INR",
      receipt,
      customerName,
      customerEmail,
      notes:{
        productId:String(metadata.productId||""),
        referenceId:String(metadata.referenceId||""),
        kind:String(metadata.kind||"product"),
        couponCode:String(metadata.couponCode||""),
        couponId:String(metadata.couponId||"")
      }
    });
  }catch(e){
    console.error("Cashfree order creation:",e);
    toast("Payment order could not be created.");
    return false;
  }

  if(!order?.id || !order?.payment_session_id){
    console.error("Cashfree order response:",order);
    toast("Payment gateway returned an invalid order.");
    return false;
  }

  return new Promise((resolve)=>{
    try{
      const cashfree=Cashfree({mode:CASHFREE_MODE});
      cashfree.checkout({
        paymentSessionId:order.payment_session_id,
        redirectTarget:"_modal"
      }).then(async (result)=>{
        if(result?.error){
          console.warn("Cashfree checkout closed/error:",result.error);
          resolve(false);
          return;
        }
        try{
          const verified=await callGatewayFunction(CASHFREE_VERIFY_FUNCTION,{order_id:order.id,couponCode:String(metadata.couponCode||''),couponId:String(metadata.couponId||''),productId:String(metadata.productId||''),customerId:String(metadata.customerId||'')});
          if(!verified?.verified){
            toast("Payment verification failed.");
            resolve(false);
            return;
          }
          await onVerified?.({
            razorpay_payment_id:verified.cf_order_id||order.id,
            razorpay_order_id:order.id,
            verified:true,
            razorpayOrder:order
          });
          resolve(true);
        }catch(e){
          console.error("Cashfree verification:",e);
          toast("Payment verification failed.");
          resolve(false);
        }
      });
    }catch(e){
      console.error("Cashfree Checkout:",e);
      toast("Could not open Cashfree Checkout.");
      resolve(false);
    }
  });
}


// Supabase is optional for the public shell: if the CDN is slow/unavailable,
// visitors still get the marketplace UI instead of a blank page.
const supabaseClient = window.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
window.supabaseClient = supabaseClient;
let SUPABASE_READY = false;
let SUPABASE_AUTH_BOOTSTRAP=false;
let PUBLIC_PRODUCTS_READY=false;
// Public catalog is deliberately independent of login state. Authenticated users
// still keep their private/admin snapshot in S.products, while marketplace/store
// pages read this small authoritative public catalog. This prevents the logged-in
// and logged-out seller pages from showing different product sets.
let SE_PUBLIC_CATALOG=null;
let SE_PUBLIC_CATALOG_READY=false;
let SE_PUBLIC_CATALOG_PROMISE=null;
if(supabaseClient) supabaseClient.auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_OUT'){
    seAdminPwClearUnlocked?.();
    S.currentUser=null;
    PUBLIC_PRODUCTS_READY=false;
    SE_PUBLIC_CATALOG=null;
    SE_PUBLIC_CATALOG_READY=false;
    SE_PUBLIC_CATALOG_PROMISE=null;
    ONLINE_READY=false;
    ONLINE_LOCAL_DIRTY=false;
    signalPending=false;
    try{if(liveChannel){supabaseClient.removeChannel(liveChannel);liveChannel=null;}}catch(e){}
    liveStarted=false;
    try{sePersist();}catch(e){}
    if(typeof render==='function') render();
    return;
  }
  if((event==='SIGNED_IN'||event==='INITIAL_SESSION'||event==='TOKEN_REFRESHED') && session?.user && !SUPABASE_AUTH_BOOTSTRAP){
    SUPABASE_AUTH_BOOTSTRAP=true;
    Promise.resolve(syncSupabaseAdmin(session.user)).then(()=>{
      if(typeof ensureStoreForUser==='function') ensureStoreForUser();
      if(typeof queueNormalizedSync==='function') queueNormalizedSync();
      if(typeof render==='function') render();
    }).finally(()=>{SUPABASE_AUTH_BOOTSTRAP=false;});
  }
});
async function uploadSaleEarnPublicImage(fileOrBlob, folder, ext="webp") {
  try {
    const {data:{session}} = await supabaseClient.auth.getSession();
    const uid=session?.user?.id;
    if(!uid) throw new Error("Please sign in before uploading images.");
    const path=`${uid}/${folder}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    const {error}=await supabaseClient.storage.from("product-images").upload(path,fileOrBlob,{contentType:fileOrBlob.type||`image/${ext}`,upsert:false});
    if(error) throw error;
    const {data}=supabaseClient.storage.from("product-images").getPublicUrl(path);
    if(!data?.publicUrl) throw new Error("Could not create image URL.");
    return data.publicUrl;
  } catch(e) { console.warn("Image upload failed",e); throw e; }
}
let NORMALIZED_SYNC_TIMER=null;
let NORMALIZED_SYNC_BUSY=false;
let NORMALIZED_SYNC_PENDING=false;
const NORMALIZED_SYNC_KEYS=new Set();
const NORMALIZED_SYNC_ALL=['users','sellers','products','orders','warnings'];
function normalizedOwnerId(sellerId){
 const ss=S.sellers?.[sellerId], owner=ss?.owner;
 const u=S.users?.find(x=>x.sellerId===sellerId||x.id===owner||x.authId===owner||x.name===owner);
 return u?.authId || (S.currentUser?.sellerId===sellerId ? (S.currentUser.authId||S.currentUser.id) : null);
}
function normalizedOrderStatus(value){
 const status=String(value||'PENDING').trim().toUpperCase();
 if(['SUCCESS','PAID','APPROVED','RECEIVED'].includes(status))return 'success';
 if(['CANCELLED','CANCELED'].includes(status))return 'cancelled';
 if(['REFUNDED','REFUND'].includes(status))return 'refunded';
 if(['FAILED','REJECTED'].includes(status))return 'failed';
 return 'pending';
}
function normalizedPayoutStatus(value){
 const status=String(value||'PENDING').trim().toUpperCase();
 if(status==='APPROVED')return 'approved';
 if(['PAID','SUCCESS','RECEIVED'].includes(status))return 'paid';
 if(['REJECTED','FAILED'].includes(status))return 'rejected';
 if(['CANCELLED','CANCELED'].includes(status))return 'cancelled';
 return 'pending';
}
async function syncNormalizedCore(){
 if(NORMALIZED_SYNC_BUSY||!SUPABASE_READY||ONLINE_LOADING)return;
 const needs=new Set(NORMALIZED_SYNC_KEYS);NORMALIZED_SYNC_KEYS.clear();
 if(!needs.size) NORMALIZED_SYNC_ALL.forEach(k=>needs.add(k));
 const {data:{session}}=await supabaseClient.auth.getSession();
 const me=session?.user;
 if(!me)return;
 NORMALIZED_SYNC_BUSY=true;
 try{
  const u=S.users?.find(x=>x.authId===me.id||x.id===me.id||String(x.email||'').toLowerCase()===String(me.email||'').toLowerCase())||S.currentUser;
  if(needs.has('users')&&u){
   u.authId=u.authId||me.id;
   u.userId=u.userId||('SE-'+String(me.id).replace(/-/g,'').slice(0,8).toUpperCase());
   const r=await supabaseClient.from('profiles').upsert({id:me.id,email:me.email||u.email||null,display_name:u.name||me.user_metadata?.name||me.email?.split('@')[0]||'User',role:u.isAdmin?'admin':(u.role||'user'),score:Number(u.score||0),user_id:u.userId||null},{onConflict:'id'});
   if(r.error)console.warn('profiles sync:',r.error.message);
  }
  const sid=u?.sellerId,ss=sid?S.sellers?.[sid]:null;
  if(needs.has('sellers')&&ss){
   const r=await supabaseClient.from('sellers').upsert({user_id:me.id,store_name:ss.name||ss.storeName||'',status:ss.suspended?'suspended':'active'},{onConflict:'user_id'});
   if(r.error)console.warn('sellers sync:',r.error.message);
  }
  const livePs=needs.has('products')?(S.products||[]).filter(x=>normalizedOwnerId(x.sellerId)===me.id):[];
  const deletedPs=needs.has('products')?(S.deletedProducts||[]).filter(x=>normalizedOwnerId(x?.sellerId)===me.id):[];
  if(livePs.length||deletedPs.length){
   const rows=[
    ...livePs.map(x=>({id:String(x.id),seller_id:me.id,title:String(x.title||'Untitled'),description:x.description||null,price:Number(x.price||0),status:(x.publicLive===true || String(x.approvalStatus||'APPROVED').toUpperCase()==='APPROVED')?'active':(String(x.approvalStatus||'').toUpperCase()==='REJECTED'||x.hiddenByAdmin===true?'pending':'active'),file_url:x.links?.[0]||x.deliveryUrl||null,image_url:x.image||null})),
    ...deletedPs.map(x=>({id:String(x.id),seller_id:me.id,title:String(x.title||'Untitled'),description:x.description||null,price:Number(x.price||0),status:'deleted',file_url:x.links?.[0]||x.deliveryUrl||null,image_url:x.image||null}))
   ];
   const dedup=[...new Map(rows.map(x=>[String(x.id),x])).values()];
   const r=await supabaseClient.from('products').upsert(dedup,{onConflict:'id'});
   if(r.error)console.warn('products sync:',r.error.message);
  }
  const buyerIds=new Set([me.id,u?.id,u?.userId].filter(Boolean).map(String));
  // Buyers create their own normalized order rows. Sellers read those rows through RLS;
  // they must never re-upsert another buyer's order with a null buyer_id.
  const os=needs.has('orders')?(S.orders||[]).filter(x=>buyerIds.has(String(x.customerId))):[];
  if(os.length){
   const rows=os.map(x=>({id:String(x.id),buyer_id:me.id,seller_id:normalizedOwnerId(x.sellerId),product_id:x.productId||null,product_title:product(x.productId)?.title||x.productTitle||'Deleted product',amount:Number(x.amount||0),status:normalizedOrderStatus(x.status),created_at:x.date||new Date().toISOString()})).filter(x=>x.buyer_id&&x.seller_id);
   if(rows.length){const r=await supabaseClient.from('orders').upsert(rows,{onConflict:'id'});if(r.error)console.warn('orders sync:',r.error.message);}
  }
  // IMPORTANT: payouts are NOT mirrored by background shared-state sync.
  // They are written only by the dedicated seller/admin payout actions.
  const warningOwnerIds=new Set([me.id,u?.id,u?.userId,sid].filter(Boolean).map(String));
  const ws=needs.has('warnings')?(S.warnings||[]).filter(x=>warningOwnerIds.has(String(x.userId||''))||warningOwnerIds.has(String(x.sellerId||''))):[];
  if(ws.length){
   const rows=ws.map(x=>({id:String(x.id),user_id:me.id,product_id:x.productId||null,product_title:x.productTitle||product(x.productId)?.title||null,title:x.title||'Warning',message:x.message||'',created_by:x.createdBy||null,created_at:x.date||x.createdAt||new Date().toISOString(),deleted_at:x.deletedAt||null}));
   const r=await supabaseClient.from('warnings').upsert(rows,{onConflict:'id'});if(r.error)console.warn('warnings sync:',r.error.message);
  }
 }catch(e){console.warn('Normalized Supabase sync failed',e)}
 finally{
  NORMALIZED_SYNC_BUSY=false;
  if(NORMALIZED_SYNC_PENDING){const pendingKeys=[...NORMALIZED_SYNC_KEYS];NORMALIZED_SYNC_PENDING=false;queueNormalizedSync(pendingKeys);}
 }
}
function queueNormalizedSync(keys){
 if(!SUPABASE_READY||ONLINE_LOADING)return;
 const list=Array.isArray(keys)&&keys.length?keys:NORMALIZED_SYNC_ALL;
 list.forEach(k=>{if(NORMALIZED_SYNC_ALL.includes(k))NORMALIZED_SYNC_KEYS.add(k)});
 NORMALIZED_SYNC_PENDING=true;
 clearTimeout(NORMALIZED_SYNC_TIMER);
 NORMALIZED_SYNC_TIMER=setTimeout(()=>{NORMALIZED_SYNC_PENDING=false;syncNormalizedCore()},350);
}
async function uploadSaleEarnPrivateFile(file,folder='products'){
 const {data:{session}}=await supabaseClient.auth.getSession();
 const uid=session?.user?.id;
 if(!uid)throw new Error('Please sign in before uploading files.');
 if(!file)throw new Error('No file selected.');
 const safe=String(file.name||'file').replace(/[^a-zA-Z0-9._-]/g,'_');
 const path=`${uid}/${folder}/${Date.now()}_${Math.random().toString(36).slice(2,8)}_${safe}`;
 const {error}=await supabaseClient.storage.from('product-files').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
 if(error)throw error;
 return path;
}
function dataUrlToBlob(dataUrl){
  const [meta,b64]=String(dataUrl).split(",");
  const mime=(meta.match(/data:([^;]+)/)||[])[1]||"image/webp";
  const bin=atob(b64||""); const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}
async function syncSupabaseAdmin(user){
  if(!user) return false;
  try{
    const [{data:adminRow,error:adminError},{data:profile,error:profileError}]=await Promise.all([
      supabaseClient.from("admin_users").select("user_id").eq("user_id",user.id).maybeSingle(),
      supabaseClient.from("profiles").select("id,email,display_name,role,score").eq("id",user.id).maybeSingle()
    ]);
    if(adminError){console.warn("Admin role check failed",adminError);}
    if(profileError && profileError.code!=="PGRST116"){console.warn("Profile load failed",profileError);}
    const local=S.users.find(u=>u.authId===user.id||u.id===user.id||String(u.email||"").toLowerCase()===String(user.email||"").toLowerCase());
    if(local){
      local.authId=local.authId||user.id;
      local.userId=local.userId||('SE-'+String(user.id).replace(/-/g,'').slice(0,8).toUpperCase());
      local.email=user.email||profile?.email||local.email||"";
      local.name=profile?.display_name||user.user_metadata?.name||local.name||user.email?.split("@")[0]||"User";
      local.role=profile?.role||local.role||"user";
      if(profile && Number.isFinite(Number(profile.score)) && local.scoreManual !== true) local.score=Number(profile.score);
      if(local.scoreManual===true && Number.isFinite(Number(local.score))){
        // Admin-manual score is authoritative for this user.
        local.score=Math.max(0,Math.min(100,Number(local.score)));
      }
      local.verified=true;
    }
    const verified=!!adminRow;
    try{window.__saleEarnAuthUserId=String(user.id||'')}catch{}
    if(local){ local.serverAdminVerified=verified; local.isAdmin=verified; if(verified)local.role='admin'; }
    return verified;
  }catch(e){console.warn("Supabase auth/profile sync failed",e);return false}
}

/* Sale Earn FINANCE CLOUD AUTHORITY v21
   Normalized Supabase orders/payouts are the durable financial copy.
   The shared JSON state remains a UI/cache mirror, not the only copy. */
function seAuthUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));}
function seLocalSellerFromAuth(authId){
 const id=String(authId||'');
 for(const sid of Object.keys(S.sellers||{})) if(String(normalizedOwnerId(sid)||'')===id)return sid;
 return null;
}
function seLocalOrderFromRow(r){
 const sid=seLocalSellerFromAuth(r.seller_id)||r.seller_id||null;
 const status=String(r.status||'pending').toLowerCase();
 const st=status==='success'?'SUCCESS':status==='cancelled'?'CANCELLED':status==='refunded'?'REFUNDED':status==='failed'?'FAILED':'PENDING';
 return {id:String(r.id),buyerId:r.buyer_id||null,customerId:r.buyer_id||null,sellerId:sid,productId:r.product_id||null,productTitle:r.product_title||product(r.product_id)?.title||'Deleted product',amount:Number(r.amount||0),status:st,date:r.created_at||nowISO(),paymentVerified:st==='SUCCESS',normalizedCloud:true};
}
function seLocalPayoutFromRow(r){
 const sid=seLocalSellerFromAuth(r.user_id)||r.seller_id||null;
 const pd=r.payment_details&&typeof r.payment_details==='object'?r.payment_details:{};
 const st=String(r.status||'pending').toLowerCase();
 const status=st==='paid'?'PAID':st==='approved'?'APPROVED':st==='cancelled'?'CANCELLED':st==='rejected'?'REJECTED':'PENDING';
 return {id:String(r.id),userId:r.user_id||null,sellerId:sid,amount:Number(r.amount||0),status,upi:pd.upi||pd.upiId||'',note:pd.note||'',paymentDetails:pd,returnedAmount:Number(r.returned_amount||0),cancelledAt:r.cancelled_at||null,date:r.created_at||nowISO(),updatedAt:r.updated_at||r.created_at||nowISO(),normalizedCloud:true};
}
async function hydrateSalesCountsEarly(){
  /* Lightweight first-paint sales hydration. Only product_id/status are read,
     so product cards get their real count before the heavier financial hydration. */
  if(!SUPABASE_READY||!S.currentUser||!supabaseClient)return false;
  try{
    let q=supabaseClient.from('orders').select('product_id,status').eq('status','success');
    const admin=typeof isAdmin==='function'&&isAdmin();
    if(!admin){
      const uid=String(S.currentUser.id||'');
      if(uid) q=q.or(`buyer_id.eq.${uid},seller_id.eq.${uid}`);
    }
    const {data,error}=await q;
    if(error)throw error;
    const counts=new Map();
    (data||[]).forEach(r=>{
      const id=String(r?.product_id||'');
      if(id)counts.set(id,(counts.get(id)||0)+1);
    });
    (S.products||[]).forEach(pr=>{
      if(!pr)return;
      const n=counts.get(String(pr.id));
      pr.sales=Number.isFinite(n)?n:0;
    });
    window.SALES_COUNTS_READY=true;
    return true;
  }catch(e){
    console.warn('Early sales count hydration delayed:',e?.message||e);
    return false;
  }
}

async function hydrateNormalizedFinancials(){
 if(!SUPABASE_READY||!S.currentUser||!supabaseClient)return false;
 try{
  const admin=typeof isAdmin==='function'&&isAdmin();
  let oq=supabaseClient.from('orders').select('id,buyer_id,seller_id,product_id,product_title,amount,status,created_at').order('created_at',{ascending:false});
  let pq=supabaseClient.from('payouts').select('id,user_id,amount,status,payment_details,returned_amount,cancelled_at,created_at,updated_at').order('created_at',{ascending:false});
  if(!admin){
   oq=oq.or(`buyer_id.eq.${S.currentUser.id},seller_id.eq.${S.currentUser.id}`);
   pq=pq.eq('user_id',S.currentUser.id);
  }
  const [or,pr]=await Promise.all([oq,pq]);
  if(or.error)throw or.error;
  if(pr.error)throw pr.error;
  const om=new Map((S.orders||[]).map(x=>[String(x.id),x]));
  for(const row of (or.data||[])){
   const next=seLocalOrderFromRow(row),old=om.get(next.id)||{};
   om.set(next.id,{...old,...next,productTitle:old.productTitle||next.productTitle});
  }
  S.orders=[...om.values()];
   // Reuse this authoritative order response for genuine product sales counts.
   // This removes the duplicate boot-time orders query and keeps manual sales adjustments separate.
   try{
    const counts=new Map();
    for(const row of (or.data||[])){
     if(String(row?.status||'').toLowerCase()!=='success')continue;
     const pid=String(row?.product_id||'');
     if(pid)counts.set(pid,(counts.get(pid)||0)+1);
    }
    (S.products||[]).forEach(p=>{if(p&&!seIsDeletedProduct(p)&&counts.has(String(p.id)))p.sales=counts.get(String(p.id));});
   }catch{}
   // Payouts are server-authoritative. Never merge stale local payout rows back in.
  // Otherwise a deleted/removed cloud request can resurrect on refresh.
  const cloudPayouts=(pr.data||[]).map(seLocalPayoutFromRow);
  if(admin){
   S.payouts=cloudPayouts;
  }else{
   const myId=String(S.currentUser.userId||S.currentUser.authId||S.currentUser.id||'');
   const keepOther=(S.payouts||[]).filter(x=>String(x.userId||x.sellerId||'')!==myId&&String(x.sellerId||'')!==String(currentSeller()?.id||''));
   S.payouts=[...keepOther,...cloudPayouts];
  }
  S.payouts.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  sePersist();
  return true;
 }catch(e){console.warn('Normalized finance read failed:',e?.message||e);return false;}
}
async function persistNormalizedFinancials(){
 if(!SUPABASE_READY||!S.currentUser||!supabaseClient)return false;
 try{
  const admin=typeof isAdmin==='function'&&isAdmin();
  const me=S.currentUser.id;
  const orders=(S.orders||[]).filter(x=>admin||String(x.customerId||'')===String(me));
  const orderRows=orders.map(x=>({
   id:String(x.id),buyer_id:seAuthUuid(x.customerId)?x.customerId:undefined,
   seller_id:normalizedOwnerId(x.sellerId)|| (seAuthUuid(x.sellerId)?x.sellerId:undefined),
   product_id:x.productId||null,product_title:x.productTitle||product(x.productId)?.title||'Deleted product',
   amount:Number(x.amount||0),status:normalizedOrderStatus(x.status),created_at:x.date||nowISO()
  })).filter(x=>x.buyer_id&&x.seller_id);
  if(orderRows.length){
   const r=await supabaseClient.from('orders').upsert(orderRows,{onConflict:'id'});
   if(r.error)throw r.error;
  }
  // IMPORTANT: payouts are written only by the dedicated request/admin actions.
  // Never mirror the whole local payout array here; doing so can resurrect deleted rows.
  return true;
 }catch(e){console.warn('Normalized finance write failed:',e?.message||e);return false;}
}
async function saveFinancialNow(){
 save();
 try{if(ONLINE_READY&&ONLINE_LOCAL_DIRTY)await pushOnlineState();}catch(e){console.warn('Shared cloud finance save delayed:',e)}
 const ok=await persistNormalizedFinancials();
 await hydrateNormalizedFinancials();
 return ok;
}

async function restoreSupabaseSession(){
  if(!supabaseClient){
    ONLINE_LOADING=false;
    try{if(typeof render==='function')render();}catch(e){console.warn('Public shell render failed:',e)}
    window.hideSaleEarnLoader?.();
    return false;
  }
  try{
    // Auth is restored first, but the authenticated dashboard is NOT painted
    // until its cloud snapshot + normalized financial records are loaded.
    // This prevents the temporary ₹0 flash seen after a browser refresh.
    const {data}=await supabaseClient.auth.getSession();
    const authUser=data?.session?.user||null;
    SUPABASE_READY=true;

    if(authUser){
      let u=S.users.find(x=>x.authId===authUser.id||x.id===authUser.id||String(x.email||'').toLowerCase()===String(authUser.email||'').toLowerCase());
      if(!u){
        u={id:authUser.id,authId:authUser.id,userId:'SE-'+String(authUser.id).replace(/-/g,'').slice(0,8).toUpperCase(),name:authUser.user_metadata?.name||authUser.email?.split('@')[0]||'User',email:authUser.email||'',role:'user',verified:true,serverAdminVerified:false,score:70,serverAdminVerified:false};
        u.sellerId=uid('seller');
        S.sellers[u.sellerId]={id:u.sellerId,name:u.name+"'s Store",owner:u.name,followers:0,logo:"",storeId:u.sellerId,bio:"Welcome to my Sale Earn store.",plan:"FREE",upi:""};
        S.users.push(u);
      }else{
        u.authId=authUser.id;u.id=authUser.id;
        u.userId=u.userId||('SE-'+String(authUser.id).replace(/-/g,'').slice(0,8).toUpperCase());
        u.email=authUser.email||u.email||'';
        u.name=authUser.user_metadata?.name||u.name||authUser.email?.split('@')[0]||'User';
        u.verified=true;
        u.serverAdminVerified=false;
      }
      // Keep the loader visible while authoritative account/money data loads.
      S.currentUser=u;ensureStoreForUser();
      const adminFlag=await syncSupabaseAdmin(authUser);
      u.isAdmin=!!adminFlag;u.serverAdminVerified=!!adminFlag;if(u.isAdmin)u.role='admin';
      if(!u.isAdmin)ensureStoreForUser();

      ONLINE_LOADING=true;
      const ok=await restoreOnlineState();
      // Orders/payouts are read from normalized Supabase tables before the first
      // dashboard render, so money cards use the current server values.
      if(ok){try{await hydrateNormalizedFinancials();}catch(e){console.warn('Initial financial hydration delayed',e)}}
      ONLINE_LOADING=false;
      if(ok){
        subscribeOnlineState();startInstantOnlineSync();queueNormalizedSync();
        seLoadPublicCatalog(true).catch(e=>console.warn('Public catalog hydration delayed',e));
        hydrateSalesCountsEarly().catch(e=>console.warn('Sales count hydration delayed',e));
      }
      try{render();}catch(e){console.warn('Final session render failed:',e)}
      window.hideSaleEarnLoader?.();
      return true;
    }

    try{render();}catch(e){console.warn('Logged-out shell render failed:',e)}
    window.hideSaleEarnLoader?.();
    PUBLIC_PRODUCTS_READY=false;
    seLoadPublicCatalog(true).catch(e=>console.warn('Public catalog hydration delayed',e));
    startInstantOnlineSync();
    return true;
  }catch(e){
    ONLINE_LOADING=false;S.currentUser=null;SUPABASE_READY=true;
    console.warn('Supabase session restore failed',e);
    try{render();}catch(renderError){console.warn('Fallback render failed',renderError)}
    window.hideSaleEarnLoader?.();
    return false;
  }
}

"use strict";

/* -------------------- STORAGE + DATA -------------------- */
window.deletedProductIdSet=()=>new Set((Array.isArray(S.productTombstones)?S.productTombstones:[]).map(x=>String(x?.id)));

async function seRepairDeletedPublicRows(){
  if(!supabaseClient || !S.currentUser) return;
  const ids=[...deletedProductIdSet()];
  if(!ids.length)return;
  // Older deleted products may have been hidden only in the shared snapshot.
  // Repair those rows once so every browser (including logged-out visitors) sees
  // the same authoritative public catalog. This is targeted, not a table scan.
  for(const id of ids){
    try{
      const r=await supabaseClient.from('products').update({status:'deleted'}).eq('id',id).eq('status','active');
      if(r.error)console.warn('Deleted product public-row repair skipped:',id,r.error.message||r.error);
    }catch(e){console.warn('Deleted product public-row repair skipped:',id,e?.message||e)}
  }
}

async function seLoadPublicCatalog(force=false){
  if(!supabaseClient || !SUPABASE_READY)return false;
  if(SE_PUBLIC_CATALOG_READY && !force)return true;
  if(SE_PUBLIC_CATALOG_PROMISE)return SE_PUBLIC_CATALOG_PROMISE;
  SE_PUBLIC_CATALOG_PROMISE=(async()=>{
    try{
      if(S.currentUser)await seRepairDeletedPublicRows();
      /* Category/tags were added to the public catalog merge, but older production
         schemas may not have those physical columns. Never let an optional metadata
         column turn the entire anonymous marketplace into an empty catalog. */
      let pr=await supabaseClient.from('products')
        .select('id,seller_id,title,description,price,status,file_url,image_url,created_at')
        .eq('status','active').order('created_at',{ascending:false});
      if(pr.error){
        const msg=String(pr.error.message||pr.error.code||'');
        if(/column .*?(category|tags).*does not exist|schema cache|42703/i.test(msg)){
          pr=await supabaseClient.from('products')
            .select('id,seller_id,title,description,price,status,file_url,image_url,created_at')
            .eq('status','active').order('created_at',{ascending:false});
        }
      }
      if(pr.error)throw pr.error;
      const oldById=new Map((Array.isArray(S.products)?S.products:[]).map(x=>[String(x?.id),x]));
      const deleted=deletedProductIdSet();
      SE_PUBLIC_CATALOG=(pr.data||[]).filter(row=>!deleted.has(String(row.id))&&String(row.status||'').toLowerCase()==='active').map(row=>{
        const old=oldById.get(String(row.id))||{};
        return {...old,
          id:String(row.id),
          sellerId:(typeof seLocalSellerFromAuth==='function'&&seLocalSellerFromAuth(row.seller_id))||row.seller_id,
          title:row.title||old.title||'Untitled',
          description:row.description??old.description??'',
          price:Number(row.price??old.price??0),
          status:'active',
          approvalStatus:'APPROVED',
          publicLive:true,
          hiddenByAdmin:false,
          createdAt:old.createdAt||row.created_at||nowISO(),
          image:old.image||row.image_url||'',
          category:row.category||old.category||'Other',
          tags:Array.isArray(row.tags)?row.tags:(Array.isArray(old.tags)?old.tags:[]),
          links:old.links||((row.file_url?[row.file_url]:[]))
        };
      });
      SE_PUBLIC_CATALOG_READY=true;
      PUBLIC_PRODUCTS_READY=true;
      try{await seLoadRealProductSalesCounts(true)}catch(e){console.warn('Public sales count hydration:',e?.message||e)}
      return true;
    }catch(e){
      const fallback=(Array.isArray(SE_PUBLIC_CATALOG)&&SE_PUBLIC_CATALOG.length)
        ? SE_PUBLIC_CATALOG
        : (Array.isArray(S.products)?S.products.filter(x=>x&&String(x.status||'active').toLowerCase()!=='deleted' && !(typeof deletedProductIdSet==='function'&&deletedProductIdSet().has(String(x.id)))):[]);
      if(Array.isArray(fallback)&&fallback.length){
        SE_PUBLIC_CATALOG=fallback;
        SE_PUBLIC_CATALOG_READY=true;
        PUBLIC_PRODUCTS_READY=true;
      }
      console.warn('Public catalog load failed; keeping last known good catalog',e?.message||e);
      return false;
    }finally{SE_PUBLIC_CATALOG_PROMISE=null}
  })();
  return SE_PUBLIC_CATALOG_PROMISE;
}
window.seLoadPublicCatalog=seLoadPublicCatalog;

window.studioVisibleProducts=()=>{
  if(!S.currentUser && !PUBLIC_PRODUCTS_READY)return [];
  const list=SE_PUBLIC_CATALOG_READY&&Array.isArray(SE_PUBLIC_CATALOG)?SE_PUBLIC_CATALOG:(Array.isArray(S.products)?S.products:[]);
  const deleted=deletedProductIdSet();
  return list.filter(p=>{
    if(!p||deleted.has(String(p.id)))return false;
    if(String(p?.status||'').toLowerCase()!=='active')return false;
    const approval=String(p?.approvalStatus||"APPROVED").toUpperCase();
    /* New products are public immediately while still carrying a Pending
       moderation status for Admin/Seller. Existing rejected/hidden products
       remain private. */
    const publicLive=p?.publicLive===true;
    if(approval!=="APPROVED" && !publicLive)return false;
    if(approval==="REJECTED" || p?.hiddenByAdmin===true)return false;
    const scan=productSafetyScan(p);
    return !scan.flagged;
  });
};
const KEY="saleEarnFinal_v3_clean";
const USD_INR_RATE=83.33,FX_CACHE_KEY="saleearn_fx_usd_inr_v1",FX_MAX_AGE=12*60*60*1000;
const nowISO=()=>new Date().toISOString();
const uid=(p="id")=>p+"_"+Math.random().toString(36).slice(2,9);
const feeRate=()=>effectivePlatformFeeRate(currentSeller()?.id,new Date().toISOString());
const feeLabel=()=>Math.round(feeRate()*100)+"%";
function currencyCode(){return S?.settings?.currency==="USD"?"USD":"INR"}
function readFxCache(){try{const x=JSON.parse(localStorage.getItem(FX_CACHE_KEY)||"null");return x&&Number(x.rate)>40&&Number(x.rate)<200?x:null}catch(e){return null}}
function usdInrRate(){return Number(readFxCache()?.rate||USD_INR_RATE)}
function money(n){const v=Number(n||0);return currencyCode()==="USD"?"$"+(v/usdInrRate()).toFixed(2):"₹"+v.toFixed(2)}
async function refreshCurrencyRate(force=false){
  const c=readFxCache();
  if(c&&Number(c.rate)>40&&Number(c.rate)<200){
    return Number(c.rate);
  }
  return usdInrRate();
}
function setCurrency(code){const next=code==="USD"?"USD":"INR";S.settings=S.settings||{};if(S.settings.currency===next){if(next==="USD")refreshCurrencyRate();return}S.settings.currency=next;save();render();toast(next==="USD"?"USD prices enabled":"INR prices enabled");if(next==="USD")refreshCurrencyRate()}
function currencyRateLabel(){const c=readFxCache();return `1 USD ≈ ₹${usdInrRate().toFixed(2)}${c?.updatedAt?" · updated "+new Date(c.updatedAt).toLocaleDateString("en-IN"):" · fallback rate"}`}
const PLATFORM_FEE_RATES={FREE:.20,CE:.10,PRIME:.10,ENTERPRISE:.05};
const SUBSCRIPTION_DURATION_MS=30*24*60*60*1000;
function planFeeRate(plan){return PLATFORM_FEE_RATES[String(plan||"FREE").toUpperCase()]??.20}
function subscriptionEndDate(sub){
 const d=new Date(sub?.date||0);
 if(!Number.isFinite(d.getTime()))return null;
 const e=new Date(sub.endDate||d.getTime()+SUBSCRIPTION_DURATION_MS);
 return e;
}
function activeSubscriptionAt(sid,when){
 const t=new Date(when||Date.now()).getTime();
 if(!Number.isFinite(t))return null;
 return (S.subscriptions||[])
  .filter(x=>x.sellerId===sid && x.paymentVerified!==false && String(x.paymentStatus||"SUCCESS")==="SUCCESS")
  .filter(x=>{const st=new Date(x.date||0).getTime(),en=subscriptionEndDate(x)?.getTime();return Number.isFinite(st)&&st<=t&&Number.isFinite(en)&&t<en})
  .sort((a,b)=>new Date(b.date)-new Date(a.date))[0]||null;
}
function effectivePlatformFeeRate(sid,when){
 const sub=activeSubscriptionAt(sid,when);
 if(sub)return planFeeRate(sub.plan);
 const allSubs=(S.subscriptions||[]).filter(x=>x.sellerId===sid&&x.paymentVerified!==false&&String(x.paymentStatus||"SUCCESS")==="SUCCESS");
 // If this seller has subscription history but none is active at this sale time,
 // the seller is on the normal 20% fee for that sale.
 if(allSubs.length)return .20;
 return planFeeRate(seller(sid)?.plan||"FREE");
}
function syncSubscriptionPlans(){
 let changed=false,now=Date.now();
 Object.values(S.sellers||{}).forEach(ss=>{
   const sub=activeSubscriptionAt(ss.id,now);
   const hasHistory=(S.subscriptions||[]).some(x=>x.sellerId===ss.id&&x.paymentVerified!==false&&String(x.paymentStatus||"SUCCESS")==="SUCCESS");
   const next=sub?String(sub.plan||"FREE").toUpperCase():(hasHistory?"FREE":String(ss.plan||"FREE").toUpperCase());
   if(ss.plan!==next){ss.plan=next;changed=true}
   if(sub){
     const end=subscriptionEndDate(sub);
     if(!sub.endDate||sub.endDate!==end.toISOString()){sub.endDate=end.toISOString();changed=true}
   }
 });
 if(changed)save();
 return changed;
}

function productSales(id){
 const base=S.orders.filter(o=>String(o.productId)===String(id)&&String(o.status||'').toUpperCase()==='SUCCESS').length;
 const p=(S.products||[]).find(x=>String(x?.id)===String(id));
 const cached=Number(p?.sales);
 /* Keep the public sales counter visible when the normalized order mirror is incomplete. */
 const cachedCount=Number.isFinite(cached)?Math.max(0,Math.floor(cached)):0;
 const count=Math.max(base,cachedCount);
 const ov=(S.productSaleOverrides||[]).find(x=>String(x.productId)===String(id));
 return ov&&Number.isFinite(Number(ov.salesCount))?Math.max(0,Math.floor(Number(ov.salesCount))):count;
}
function sellerEarnings(sid){const base=S.orders.filter(o=>o.sellerId===sid&&o.status==="SUCCESS").reduce((a,o)=>a+Number(o.netSellerAmount??(Number(o.amount||0)*(1-Number(o.platformFeeRate??.20)))),0);return base+(typeof financeSum==='function'?financeSum(sid,'TOTAL'):0)}
const seedProducts=[
 {id:"p1001",sellerId:"seller01",sales:124,title:"1000+ Pookie Voice Reels Bundle | Viral Voice Reels Videos | Only ₹49",category:"Reel Content Pack",tags:["Entertainment","Viral Reels","Voice Reels"],price:49,oldPrice:99,description:"Ready-to-post short-form reel assets for creators. Instant digital delivery and creator-friendly usage.",image:"https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=900&q=80",links:["https://example.com/pookie-bundle"],faq:[["What do I receive?","A digital bundle with ready-to-use reel assets and a delivery link."],["How fast is delivery?","Delivery is shown immediately after successful payment in this demo."],["Can I use these for my content?","Check the seller's product policy before commercial use."]]},
 {id:"p1002",sellerId:"seller01",sales:86,title:"1000+ Viral AI Animal Reels Bundle | Ready-to-Post AI Animal Reels",category:"Reel Content Pack",tags:["Animals","AI Reels","Entertainment"],price:49,oldPrice:89,description:"A creator pack focused on viral AI animal short videos and social-ready formats.",image:"https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=900&q=80",links:["https://example.com/ai-animal"],faq:[["Is this a physical product?","No. It is a digital product."],["How is access delivered?","A secure delivery link is shown after payment in the prototype."]]},
 {id:"p1003",sellerId:"seller01",sales:64,title:"1500+ Doraemon Reels Bundle 😺💙 | Viral Clips | HD Reels",category:"Reel Content Pack",tags:["Cartoon","Entertainment","HD Reels"],price:49,oldPrice:79,description:"A themed short-video asset collection for creators. Review the seller policy before publishing.",image:"https://images.unsplash.com/photo-1535016120720-40c646be5580?auto=format&fit=crop&w=900&q=80",links:["https://example.com/cartoon"],faq:[["How many assets?","The exact asset count is listed in the product title and seller listing."],["Can I preview it?","Use the product image and seller description for this demo."]]},
 {id:"p1004",sellerId:"seller01",sales:152,title:"2000+ Mahadev Reels Bundle | ₹49 | Hindi Devotional Reels Collection",category:"Reel Content Pack",tags:["Devotional","Hindi","Reels"],price:49,oldPrice:99,description:"Hindi devotional short-form creator resources.",image:"https://images.unsplash.com/photo-1518709594023-6eab9bab7b23?auto=format&fit=crop&w=900&q=80",links:["https://example.com/mahadev"]},
 {id:"p1005",sellerId:"seller01",sales:73,title:"MR Bean Reels Bundle 🔥 | Funny Viral Videos Collection | Only ₹49",category:"Reel Content Pack",tags:["Comedy","Funny","Viral Reels"],price:49,oldPrice:89,description:"Comedy-focused digital reel collection for creators.",image:"https://images.unsplash.com/photo-1524985069026-dd778a71c7b4?auto=format&fit=crop&w=900&q=80",links:["https://example.com/comedy"]},
 {id:"p1006",sellerId:"seller02",sales:42,title:"500+ Movie Clip Explanation Reels Bundle | Ready-to-Post",category:"Courses",tags:["Movie","Education","Explanation"],price:49,oldPrice:79,description:"Short-form movie explanation creator bundle.",image:"https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=900&q=80",links:["https://example.com/movie-explain"]},
 {id:"p1007",sellerId:"seller02",sales:38,title:"3200+ Long Cartoon Videos Bundle | 16:9 HD Cartoon Videos | Ready to Use",category:"Editing Assets",tags:["Cartoon","HD","YouTube"],price:99,oldPrice:149,description:"Long-form cartoon editing assets in a ready-to-use digital bundle.",image:"https://images.unsplash.com/photo-1513106580091-1d82408b8cd5?auto=format&fit=crop&w=900&q=80",links:["https://example.com/cartoon-hd"]},
 {id:"p1008",sellerId:"seller03",sales:57,title:"Creator Editing Toolkit | Transitions, SFX & Motion Assets",category:"Editing Assets",tags:["Editing","Transitions","SFX"],price:149,oldPrice:249,description:"A starter toolkit for editors with motion-friendly assets.",image:"https://images.unsplash.com/photo-1536240478700-b869070f9279?auto=format&fit=crop&w=900&q=80",links:["https://example.com/editing-kit"]},
 {id:"p1009",sellerId:"seller02",sales:31,title:"AI Creator Starter Course | Prompting & Workflow",category:"Courses",tags:["AI","Course","Creator"],price:199,oldPrice:299,description:"A beginner-friendly digital course for creator workflows.",image:"https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",links:["https://example.com/ai-course"]},
 {id:"p1010",sellerId:"seller03",sales:22,title:"Creator Workflow Template Pack",category:"Templates",tags:["Templates","Creator Tools","Productivity"],price:299,oldPrice:399,description:"Original creator workflow templates and productivity resources.",image:"https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=900&q=80",links:["https://example.com/creator-template-pack"]}
];
const seed={
 users:[],
 sellers:{},
 products:[],
 orders:[],
 reviews:{},
 follows:{},
 payouts:[],
 ads:[],
 referrals:[],
 subscriptions:[],
 warnings:[],
 devices:[],
 deletedProducts:[],
 cart:[],
 library:[],
 saved:[],
 currentUser:null,
 draft:null,
 settings:{currency:"INR",referralUsedBy:{},websiteUpi:"saleearn.demo@upi"},
 balancePayments:[],
 drafts:[],
 productActivity:[],
 adminAuditLog:[]
};
function load(){
 try{const raw=localStorage.getItem(KEY); if(!raw){localStorage.setItem(KEY,JSON.stringify(seed));return structuredClone(seed)}
 const d=JSON.parse(raw); return Object.assign(structuredClone(seed),d,{users:d.users||[],sellers:d.sellers||{},products:d.products||[],orders:d.orders||[],reviews:d.reviews||{},follows:d.follows||{},payouts:d.payouts||[],ads:d.ads||[],referrals:d.referrals||[],subscriptions:d.subscriptions||[],warnings:d.warnings||[],devices:d.devices||[],deletedProducts:d.deletedProducts||[],productTombstones:d.productTombstones||[],cart:d.cart||[],library:d.library||[],saved:d.saved||[],settings:Object.assign({currency:"INR",referralUsedBy:{},websiteUpi:"saleearn.demo@upi"},d.settings||{}),balancePayments:d.balancePayments||[],referralUpgrades:d.referralUpgrades||[],drafts:d.drafts||[],productActivity:d.productActivity||[],adminAuditLog:d.adminAuditLog||[],adminControls:Object.assign({marketplaceFreeze:false,newSellerRegistration:false,productUploads:false,withdrawals:false,payments:false,ads:false,referrals:false},d.adminControls||{}),riskAlerts:d.riskAlerts||[],coupons:d.coupons||[],couponRedemptions:d.couponRedemptions||[],storeThemes:d.storeThemes||{},securityEvents:d.securityEvents||[],sellerRankings:d.sellerRankings||[],growthGoals:d.growthGoals||{},platformConfig:d.platformConfig||{},notifications:d.notifications||[],messages:d.messages||[],mailMessages:d.mailMessages||[],disputes:d.disputes||[],refunds:d.refunds||[],badgeLedgers:d.badgeLedgers||{},downloadEvents:d.downloadEvents||[],serviceRefunds:d.serviceRefunds||[],sellerFinanceLedger:d.sellerFinanceLedger||[]})
 }catch(e){return structuredClone(seed)}
}
let S=load();
// Authentication is authoritative: never trust a stale localStorage currentUser on boot.
S.currentUser=null;
try{(S.users||[]).forEach(u=>{if(!u.authId&&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(u.id||'')))u.authId=u.id;if(!u.userId)u.userId='SE-'+String(u.authId||u.id||uid('user')).replace(/-/g,'').slice(0,8).toUpperCase();});}catch(e){console.warn('Legacy account migration failed',e)}
function defaultPlatformConfig(){return {
 version:1,
 commission:{defaultPct:10,newSellerPct:10,premiumPct:8,promotionalPct:10,temporaryPct:10,fixed:0,min:0,max:100,sellerOverrides:{},categoryOverrides:{}},
 plans:[
  {id:'FREE',name:'FREE',monthly:0,yearly:0,lifetime:0,trial:0,discount:0,uploadLimit:10,storageLimit:500,ads:false,analytics:false,referrals:true,advanced:false,prioritySupport:false,verified:false,commissionPct:20,active:true,archived:false,featureText:['10 product uploads','500 MB storage','Standard support','Referral access','Basic seller tools','No ads']},
  {id:'CE',name:'CE',monthly:199,yearly:0,lifetime:0,trial:0,discount:0,uploadLimit:20,storageLimit:2000,ads:true,analytics:true,referrals:true,advanced:true,prioritySupport:false,verified:false,commissionPct:10,active:true,archived:false,featureText:['20 product uploads','2 GB storage','Analytics dashboard','Advanced seller tools','Referral access','Seller ads enabled']},
  {id:'ENTERPRISE',name:'Enterprise',monthly:599,yearly:0,lifetime:0,trial:0,discount:0,uploadLimit:50,storageLimit:10000,ads:true,analytics:true,referrals:true,advanced:true,prioritySupport:true,verified:true,commissionPct:5,active:true,archived:false,featureText:['50 product uploads','10 GB storage','Advanced analytics','Priority support','Verified seller badge','All premium features']}
 ],
 features:{sellerRegistration:true,buyerRegistration:true,productUpload:true,productApproval:true,subscriptions:true,referrals:true,sellerAds:true,reviews:true,messaging:true,wishlist:true,coupons:true,withdrawals:true,refunds:true,disputes:true,notifications:true,sellerAnalytics:true,productAnalytics:true,maintenanceMode:false},
 rules:{minProductPrice:0,maxProductPrice:1000000,productUploadLimit:50,maxFileSizeMB:500,allowedFileTypes:'zip,pdf,mp4,jpg,jpeg,png,psd,ai,fig,figma,txt',sellerRegistration:true,automaticApproval:false,manualApproval:true,reviewSystem:true,minWithdrawal:30,maxWithdrawal:1000000,refundWindowDays:0,orderCancellationWindowHours:0,sellerVerificationRequired:true,sellerAccountAgeDays:0,payoutHoldingDays:0},
 payment:{gatewayStatus:'TEST',mode:'TEST',currency:'INR',methods:['UPI','Card','Paytm','Net Banking / Wallet'],timeoutMinutes:10,minPayment:1,maxPayment:1000000,autoVerify:true,manualVerify:false},
 payout:{min:30,max:1000000,processingFeePct:0,fixedFee:0,schedule:'MANUAL',instant:false,daily:true,weekly:false,manual:true,refundHoldDays:0,verificationRequired:false},
 ads:{packages:[{id:'search',name:'Search Boost',price:49,days:7,impressionLimit:0,clickLimit:0,placement:'Search',approval:false,active:true},{id:'home',name:'Homepage Featured',price:199,days:7,impressionLimit:0,clickLimit:0,placement:'Homepage',approval:false,active:true},{id:'category',name:'Category Boost',price:99,days:7,impressionLimit:0,clickLimit:0,placement:'Category',approval:false,active:true}],sellerOverrides:{}},
 referral:{buyerReward:50,sellerReward:100,commissionPct:5,maxMonthlyReward:100000,expirationDays:365,eligibility:'ALL',enabled:true,userDisabled:{}},
 branding:{websiteName:'Sale Earn',primaryColor:'#5146e5',secondaryColor:'#6d63f5',font:'Inter',footerCopyright:'© Sale Earn',contactEmail:'MohitGhasoliya90014@gmail.com',contactInfo:'',social:{instagram:'',youtube:'',telegram:'NextIdea66'},emailSenderName:'Sale Earn'},
 cms:{heroTitle:'Buy & Sell Digital Products',heroSubtitle:'Turn your skills into income.',heroImage:'',ctaText:'Start Selling',footer:'',featuredProducts:[],trendingProducts:[],topSellers:[],testimonials:[],faq:[],promotionalBanners:[]},
 sections:[{id:'hero',name:'Hero',enabled:true,order:1,title:'Hero',description:''},{id:'categories',name:'Categories',enabled:true,order:2,title:'Categories',description:''},{id:'trending',name:'Trending Products',enabled:true,order:3,title:'Trending Products',description:''},{id:'top-sellers',name:'Top Sellers',enabled:true,order:4,title:'Top Sellers',description:''},{id:'subscriptions',name:'Subscriptions',enabled:true,order:5,title:'Subscriptions',description:''},{id:'testimonials',name:'Testimonials',enabled:true,order:6,title:'Testimonials',description:''},{id:'faq',name:'FAQ',enabled:true,order:7,title:'FAQ',description:''}],
 notifications:{templates:{welcome:'Welcome {{user_name}}',sellerWelcome:'Seller welcome {{user_name}}',orderConfirmation:'Order {{order_id}} confirmed',paymentSuccessful:'Payment successful {{amount}}',paymentFailed:'Payment failed',withdrawalApproved:'Withdrawal approved',withdrawalRejected:'Withdrawal rejected',productApproved:'Product approved {{product_name}}',productRejected:'Product rejected {{product_name}}',accountWarning:'Account warning',subscriptionExpiring:'Subscription expiring',newReview:'New review',newSale:'New sale',newMessage:'New message'}},
 announcement:{enabled:false,title:'',message:'',startDate:'',endDate:'',audience:'Everyone'},
 sellerOverrides:{},
 adminRoles:[{id:'super',name:'SUPER ADMIN',permissions:['*'],users:[]},{id:'finance',name:'FINANCE ADMIN',permissions:['payments','withdrawals','refunds','commission'],users:[]},{id:'content',name:'CONTENT ADMIN',permissions:['products','categories','homepage','cms'],users:[]},{id:'support',name:'SUPPORT ADMIN',permissions:['users','orders','disputes','messages'],users:[]},{id:'marketing',name:'MARKETING ADMIN',permissions:['coupons','referrals','ads','promotions'],users:[]},{id:'analytics',name:'ANALYTICS ADMIN',permissions:['reports','sales','revenue','analytics'],users:[]}],
 beta:{},
 configHistory:[]
}}
function ensurePlatformConfig(){
 const d=defaultPlatformConfig(),p=S.platformConfig||{};
 const deep=(a,b)=>{if(!b||typeof b!=='object')return structuredClone(a);const o=structuredClone(a);Object.keys(b).forEach(k=>{if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])&&o[k]&&typeof o[k]==='object'&&!Array.isArray(o[k]))o[k]=deep(o[k],b[k]);else o[k]=b[k]});return o};
 S.platformConfig=deep(d,p);
 const requiredPlanIds=['FREE','CE','ENTERPRISE'];
 const existingPlans=Array.isArray(S.platformConfig.plans)?S.platformConfig.plans:[];
 S.platformConfig.plans=requiredPlanIds.map(id=>{const base=d.plans.find(x=>x.id===id)||{};const found=existingPlans.find(x=>x.id===id)||{};const merged=Object.assign(structuredClone(base),found);merged.featureText=Array.isArray(found.featureText)&&found.featureText.length?found.featureText.slice(0,8).map(x=>String(x||'').trim()).filter(Boolean):structuredClone(base.featureText||[]);return merged;});
 S.notifications=S.notifications||[];S.messages=S.messages||[];S.disputes=S.disputes||[];S.refunds=S.refunds||[];S.adminFinancialLedger=S.adminFinancialLedger||[];S.adminCommissionAdjustments=S.adminCommissionAdjustments||[];
 return S.platformConfig;
}
ensurePlatformConfig();
const DEMO_RESET_VERSION="saleearn_clean_start_v22_all_operational_data_zero";
/* One-time clean reset: keep all products and account/store records, but clear
   money, sales, payouts, subscriptions/plans, ads and other transactional/admin activity. */
function resetOperationalDataKeepProducts(){
 try{
  // Products stay exactly in place, but their displayed legacy sales counters are reset.
  (S.products||[]).forEach(p=>{if(!p)return;if(Object.prototype.hasOwnProperty.call(p,"sales"))p.sales=0;if(Object.prototype.hasOwnProperty.call(p,"displayedSalesCount"))p.displayedSalesCount=0;});
  S.orders=[];
  S.payouts=[];
  S.productSaleOverrides=[];
  S.ads=[];
  S.referrals=[];
  S.subscriptions=[];
  S.balancePayments=[];
  S.referralUpgrades=[];
  S.productActivity=[];
  S.adminAuditLog=[];
  S.adminFinancialLedger=[];
  S.adminCommissionAdjustments=[];
  S.sellerFinanceLedger=[];
  S.scoreHistory=[];
  S.reviews={};
  // Keep follower relationships persistent. Follow data must only change through toggleFollow().
  S.follows=S.follows&&typeof S.follows==="object"&&!Array.isArray(S.follows)?S.follows:{};
  S.warnings=[];
  S.devices=[];
  S.deletedProducts=[];
  S.cart=[];
  S.library=[];
  S.saved=[];
  S.draft=null;
  S.drafts=[];
  S.riskAlerts=[];
  S.coupons=[];
  S.couponRedemptions=[];
  S.storeThemes={};
  S.securityEvents=[];
  S.sellerRankings=[];
  S.growthGoals={};
  S.notifications=[];
  /* Messages and Mail Center history are permanent until the owner explicitly deletes them. */
  S.disputes=[];
  S.refunds=[];
  S.badgeLedgers={};
  S.downloadEvents=[];
  S.serviceRefunds=[];
  // Keep user/store accounts, but return subscription/referral state to a clean start.
  Object.values(S.sellers||{}).forEach(ss=>{
   if(!ss||typeof ss!=="object")return;
   ss.plan="FREE";
   ss.referralPercent=5;
   delete ss.lastSubscription;
  });
  (S.users||[]).forEach(u=>{
   if(!u||typeof u!=="object")return;
   if(u.lastSubscription)delete u.lastSubscription;
   ["balance","receive_balance","receiveBalance","availableBalance","spentBalance","totalSales","sales","earnings","lifetimeEarnings","receivedAmount","pendingPayout","walletBalance"].forEach(k=>{
    if(Object.prototype.hasOwnProperty.call(u,k) && typeof u[k]==="number") u[k]=0;
   });
  });
  Object.values(S.sellers||{}).forEach(ss=>{
   if(!ss||typeof ss!=="object")return;
   ["balance","receive_balance","receiveBalance","availableBalance","spentBalance","totalSales","sales","earnings","lifetimeEarnings","receivedAmount","pendingPayout","walletBalance"].forEach(k=>{
    if(Object.prototype.hasOwnProperty.call(ss,k) && typeof ss[k]==="number") ss[k]=0;
   });
  });
  return true;
 }catch(e){console.warn("Operational reset failed",e);return false}
}
try{
 const resetSeen=localStorage.getItem("SE_DEMO_RESET_VERSION");
 if(resetSeen!==DEMO_RESET_VERSION){
  resetOperationalDataKeepProducts();
  // Mark as local-only until the same clean state is written to the shared cloud state.
  localStorage.setItem("SE_DEMO_RESET_VERSION",DEMO_RESET_VERSION+"_LOCAL");
  sePersist?.();
 }
}catch(e){console.warn("Clean reset migration failed",e)}
S.users.forEach(u=>{if(u.unpublicUntil&&u.unpublicUntil<=Date.now()){u.unpublicUntil=0;u.suspendedUntil=0}});
Object.values(S.sellers).forEach(ss=>{if(!ss.referralCode)ss.referralCode=(ss.owner||"SE").replace(/\W/g,"").slice(0,4).toUpperCase()+"-"+ss.id.slice(-4).toUpperCase()});
/* Sale Earn LOW-LOAD SYNC v1 — original public marketplace/test payments retained.
   No database schema or RLS changes. One full initial read; event-driven updates plus a throttled resume fallback. */
const ONLINE_TABLE='saleearn_app_state';
let ONLINE_READY=false,ONLINE_LOADING=false,ONLINE_SYNC_TIMER=null,ONLINE_CHANNEL=null,ONLINE_POLL_TIMER=null,ONLINE_LAST_REMOTE='',ONLINE_LOCAL_DIRTY=false;
const SE_SYNC_CONFIG=Object.freeze({pollMs:0,debounceMs:0,maxWaitMs:2500,focusThrottleMs:300000,maxRetryMs:15000,maxRetries:5});
let seBase=null,seVersion=null,seExists=false,seSyncKey='',seWriteBusy=false,seReadBusy=false,seDirtySince=0,seFailures=0,seRetryAt=0,seLastCheck=0,seStopped=false,seMutation=0,seStorageWarned=false;
const seCounters={fullReads:0,versionReads:0,writes:0,skippedWrites:0,conflicts:0};
function onlineSnapshot(){return {users:S.users||[],sellers:S.sellers||{},products:S.products||[],orders:S.orders||[],reviews:S.reviews||{},follows:S.follows||{},payouts:S.payouts||[],ads:S.ads||[],referrals:S.referrals||[],subscriptions:S.subscriptions||[],warnings:S.warnings||[],devices:S.devices||[],deletedProducts:S.deletedProducts||[],productTombstones:S.productTombstones||[],balancePayments:S.balancePayments||[],referralUpgrades:S.referralUpgrades||[],drafts:S.drafts||[],productActivity:S.productActivity||[],adminAuditLog:S.adminAuditLog||[],adminControls:S.adminControls||{},platformConfig:S.platformConfig||{},riskAlerts:S.riskAlerts||[],coupons:S.coupons||[],couponRedemptions:S.couponRedemptions||[],storeThemes:S.storeThemes||{},securityEvents:S.securityEvents||[],scoreHistory:S.scoreHistory||[],sellerRankings:S.sellerRankings||[],growthGoals:S.growthGoals||{},notifications:S.notifications||[],messages:S.messages||[],mailMessages:S.mailMessages||[],disputes:S.disputes||[],refunds:S.refunds||[],adminFinancialLedger:S.adminFinancialLedger||[],adminCommissionAdjustments:S.adminCommissionAdjustments||[],badgeLedgers:S.badgeLedgers||{},downloadEvents:S.downloadEvents||[],serviceRefunds:S.serviceRefunds||[],sellerFinanceLedger:S.sellerFinanceLedger||[]}}function onlineSnapshotKey(data){return JSON.stringify(data||{});}
function seClone(x){return x===undefined?undefined:structuredClone(x);}
function sePersist(){try{localStorage.setItem(KEY,JSON.stringify(S));return true;}catch(e){if(!seStorageWarned){seStorageWarned=true;toast('Browser storage is full or unavailable. Cloud sync will be used; keep this tab open until sync completes.');}console.warn('Local save failed',e);return false;}}
function seFlushBeforeLeave(){
  try{sePersist();}catch{}
  try{
    if(typeof ONLINE_LOCAL_DIRTY!=="undefined" && ONLINE_LOCAL_DIRTY && typeof queueOnlineSync==="function") queueOnlineSync();
  }catch{}
}
window.addEventListener("pagehide",seFlushBeforeLeave);
let seLastResumeSync=0;
function seMaybeResumeSync(force=false){
  if(!SUPABASE_READY||!S.currentUser||document.visibilityState==='hidden'||navigator.onLine===false)return;
  const now=Date.now();
  if(!force && now-seLastResumeSync<SE_SYNC_CONFIG.focusThrottleMs)return;
  seLastResumeSync=now;
  if(typeof pollOnlineState==='function')pollOnlineState(force).catch(()=>{});
}
window.addEventListener("focus",()=>seMaybeResumeSync(false));
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")seFlushBeforeLeave();else seMaybeResumeSync(false);});
window.addEventListener("beforeunload",()=>{try{sePersist();}catch{}});

function seOnline(){return navigator.onLine!==false;}
function seSame(a,b){return a===b||JSON.stringify(a)===JSON.stringify(b);}
// Three-way merge: only locally changed fields override the most recent server copy.
// Unrelated remote edits survive; locally deleted keyed rows do not reappear.
// Concurrent edits to the same scalar still use local-last-write; not a transactional ledger.
function seMerge(base,local,remote){
 if(seSame(local,base))return seClone(remote);
 if(seSame(remote,base)||seSame(local,remote))return seClone(local);
 if(local===undefined)return undefined;
 if(remote===undefined)return seClone(local);
 const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
 if(obj(local)&&obj(remote)&&(obj(base)||base===undefined)){
  const out={};for(const k of new Set([...Object.keys(base||{}),...Object.keys(remote),...Object.keys(local)])){
   if(['__proto__','constructor','prototype'].includes(k))continue;
   const value=seMerge(base?.[k],local[k],remote[k]);if(value!==undefined)out[k]=value;
  }return out;
 }
 const keyed=a=>Array.isArray(a)&&a.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&x.id!=null)&&new Set(a.map(x=>String(x.id))).size===a.length;
 if(keyed(local)&&keyed(remote)&&(base===undefined||keyed(base))){
  const map=a=>new Map((a||[]).map(x=>[String(x.id),x]));const bm=map(base),lm=map(local),rm=map(remote),out=[];
  for(const id of new Set([...lm.keys(),...rm.keys(),...bm.keys()])){const value=seMerge(bm.get(id),lm.get(id),rm.get(id));if(value!==undefined)out.push(value);}return out;
 }
 return seClone(local);
}
function seSetBase(row){seExists=!!row;seVersion=row?.updated_at??null;seBase=seClone(row?.data||{});ONLINE_LAST_REMOTE=onlineSnapshotKey(seBase);}
function parseSupabaseStoragePath(url){
  try{
    const m=String(url||'').match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if(!m)return null;
    return {bucket:m[1],path:decodeURIComponent(m[2])};
  }catch(e){return null}
}
async function hideProductRowFromPublicCloud(id){
  if(!id||!window.supabaseClient||!SUPABASE_READY)return false;
  try{
    // Recycle/delete-from-public is a logical delete. Keep the normalized row
    // with status=deleted so Admin Recycle Bin can recover it and historical
    // references remain intact. Only "Delete Forever" performs a hard delete.
    const u=await supabaseClient.from('products').update({status:'deleted'}).eq('id',String(id));
    if(!u.error)return true;
    console.warn('Public product logical delete failed:',u.error.message||u.error);
    return false;
  }catch(e){console.warn('Public product row hide failed:',e?.message||e);return false;}
}
async function purgeProductFromCloud(p){
  if(!p||!window.supabaseClient)return false;
  const pid=String(p.id),errors=[];
  try{
    const r=await supabaseClient.from('products').delete().eq('id',pid);
    if(r.error){
      const u=await supabaseClient.from('products').update({status:'deleted'}).eq('id',pid);
      if(u.error){errors.push('product row: '+(r.error.message||r.error));console.warn('Cloud product row delete failed:',r.error.message||r.error);}
    }
  }catch(e){errors.push('product row: '+(e?.message||e));console.warn('Cloud product row delete failed:',e?.message||e)}
  try{
    const paths=[];
    const addPath=(url)=>{const x=parseSupabaseStoragePath(url);if(x)paths.push(x)};
    addPath(p.image);
    (Array.isArray(p.links)?p.links:[]).forEach(addPath);
    const seen=new Set();
    for(const x of paths){const key=x.bucket+'|'+x.path;if(seen.has(key))continue;seen.add(key);const r=await supabaseClient.storage.from(x.bucket).remove([x.path]);if(r.error){errors.push('storage '+x.bucket+': '+(r.error.message||r.error));console.warn('Cloud product storage delete failed:',r.error.message||r.error)}}
  }catch(e){errors.push('storage: '+(e?.message||e));console.warn('Cloud product storage delete failed:',e?.message||e)}
  return errors.length===0;
}
function tombstoneProduct(id){S.productTombstones=Array.isArray(S.productTombstones)?S.productTombstones:[];if(id!=null&&!S.productTombstones.some(x=>String(x.id)===String(id)))S.productTombstones.push({id:String(id),deletedAt:nowISO()});if(id!=null&&S.reviews)delete S.reviews[id];}
function purgeTombstonedProducts(){S.productTombstones=Array.isArray(S.productTombstones)?S.productTombstones:[];if(!S.productTombstones.length)return;const set=new Set(S.productTombstones.map(x=>String(x.id)));S.products=(S.products||[]).filter(p=>!set.has(String(p.id)));/* keep recycle-bin metadata */S.drafts=(S.drafts||[]).filter(p=>!set.has(String(p.id)));S.saved=(S.saved||[]).filter(x=>!set.has(String(x?.productId)));S.ads=(S.ads||[]).filter(x=>!set.has(String(x?.productId)));if(S.reviews&&typeof S.reviews==='object')for(const id of set)delete S.reviews[id];if(Array.isArray(S.productActivity))S.productActivity=S.productActivity.filter(x=>!set.has(String(x?.productId||'')));}
function removeProductFromAllCloudState(id){
 const pid=String(id);
 try{
  if(Array.isArray(S.products))S.products=S.products.filter(p=>String(p?.id)!==pid);
  if(Array.isArray(S.drafts))S.drafts=S.drafts.filter(p=>String(p?.id)!==pid);
  if(Array.isArray(S.productActivity))S.productActivity=S.productActivity.filter(x=>String(x?.productId||'')!==pid);
  if(S.reviews&&typeof S.reviews==='object')delete S.reviews[pid];
 }catch(e){console.warn('Product local purge failed',e)}
}
function seInstall(remote){
 const localUser=S.currentUser?seClone(S.currentUser):null;
 const localSettings=seClone(S.settings||{}),localCart=[...(S.cart||[])],localSaved=[...(S.saved||[])],localLibrary=[...(S.library||[])],localDraft=S.draft?seClone(S.draft):null;
 // Keep local product tombstones when an older cloud snapshot arrives. This prevents
 // a just-deleted product from briefly reappearing during background sync/polling.
 const localProductTombstones=Array.isArray(S.productTombstones)?seClone(S.productTombstones):[];
 const incoming=seClone(remote||{});
 const incomingProductTombstones=Array.isArray(incoming.productTombstones)?incoming.productTombstones:[];
 const tombstoneById=new Map();
 [...localProductTombstones,...incomingProductTombstones].forEach(t=>{if(t&&t.id!=null)tombstoneById.set(String(t.id),t)});
 incoming.productTombstones=[...tombstoneById.values()];
 Object.assign(S,incoming);
 for(const k of ['users','products','orders','payouts','ads','referrals','subscriptions','warnings','devices','deletedProducts','balancePayments','drafts','productActivity','referralUpgrades','adminAuditLog','adminFinancialLedger','adminCommissionAdjustments','scoreHistory','mailMessages','downloadEvents','serviceRefunds','sellerFinanceLedger','productTombstones'])S[k]=Array.isArray(S[k])?S[k]:[];
 for(const k of ['sellers','reviews','follows','badgeLedgers'])S[k]=S[k]&&typeof S[k]==='object'?S[k]:{};
 S.settings=Object.assign({currency:'INR',referralUsedBy:{},websiteUpi:'saleearn.demo@upi'},localSettings);
 S.cart=localCart;S.saved=localSaved;S.library=localLibrary;S.draft=localDraft;S.currentUser=localUser;
 if(localUser){const u=S.users.find(x=>x.id===localUser.id);if(u){u.email=localUser.email||u.email;u.name=localUser.name||u.name;u.isAdmin=localUser.isAdmin??u.isAdmin;S.currentUser=u;}else S.users.push(localUser);}
 // Follow records are cloud data; never reset them during hydration.
 S.follows=S.follows&&typeof S.follows==='object'&&!Array.isArray(S.follows)?S.follows:{};
 purgeTombstonedProducts();
 sePersist();
}
function save(){
 sePersist();if(!ONLINE_READY||ONLINE_LOADING||!S.currentUser)return;
 const snapshot=onlineSnapshot();
 const current=onlineSnapshotKey(snapshot);
 if(current===seSyncKey){seCounters.skippedWrites++;if(!seWriteBusy){ONLINE_LOCAL_DIRTY=false;seDirtySince=0;clearTimeout(ONLINE_SYNC_TIMER);}return;}
 ONLINE_LOCAL_DIRTY=true;seMutation++;if(!seDirtySince)seDirtySince=Date.now();queueOnlineSync();
 const base=seBase?.data||{};
 const needs=NORMALIZED_SYNC_ALL.filter(k=>onlineSnapshotKey(snapshot[k])!==onlineSnapshotKey(base[k]));
 if(needs.length)queueNormalizedSync(needs);
}
function queueOnlineSync(){
 if(!S.currentUser||!ONLINE_READY||!ONLINE_LOCAL_DIRTY||seStopped||!seOnline())return;
 clearTimeout(ONLINE_SYNC_TIMER);
 const maxWait=Math.max(0,SE_SYNC_CONFIG.maxWaitMs-(Date.now()-(seDirtySince||Date.now())));
 const delay=Math.max(Math.min(SE_SYNC_CONFIG.debounceMs,maxWait),seRetryAt-Date.now(),0);
 ONLINE_SYNC_TIMER=setTimeout(()=>pushOnlineState(),delay);
}
async function seReadFull(){seCounters.fullReads++;const r=await supabaseClient.from(ONLINE_TABLE).select('data,updated_at').eq('id',1).maybeSingle();if(r.error)throw r.error;return r.data;}
async function seReadVersion(){seCounters.versionReads++;const r=await supabaseClient.from(ONLINE_TABLE).select('updated_at').eq('id',1).maybeSingle();if(r.error)throw r.error;return r.data;}
function seFailure(e){
 seFailures++;const code=String(e?.code||e?.status||'');
 if(['401','403','42501','PGRST301','PGRST302'].includes(code)||seFailures>=SE_SYNC_CONFIG.maxRetries){
  seStopped=true;toast('Cloud sync paused after errors. Changes are kept locally. Check connection/permissions before retrying.');
 }else seRetryAt=Date.now()+Math.min(SE_SYNC_CONFIG.maxRetryMs,2000*2**(seFailures-1));
 console.warn('Cloud sync delayed',e?.message||e);
}
function seSucceeded(){seFailures=0;seRetryAt=0;seStopped=false;}
/* Client-side money guard: a normal (non-admin) browser can never edit or delete payouts / sale amounts / ledgers that already exist on the server. */
function seGuardNonAdmin(sent,remote){
 try{
  if(typeof isAdmin==='function'&&isAdmin())return;
  const cl=x=>JSON.parse(JSON.stringify(x)),byId=a=>new Map((Array.isArray(a)?a:[]).filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
  /* payouts: existing rows are frozen, new rows must be plain PENDING requests */
  const rp=byId(remote.payouts),fresh=[];
  for(const p of (Array.isArray(sent.payouts)?sent.payouts:[])){
   if(!p||p.id==null||rp.has(String(p.id)))continue;
   if(String(p.status||'').toUpperCase()!=='PENDING'||!(Number(p.amount)>0))continue;
   ['paidAt','paidBy','utr','processedAt','receivedAmount','cancelledAt','cancelledBy','cancelReason'].forEach(k=>delete p[k]);p.paymentVerified=false;fresh.push(p);
  }
  sent.payouts=[...fresh,...[...rp.values()].map(cl)];
  /* orders: money fields of existing sales are frozen; sales can't be deleted */
  const F=['status','amount','netSellerAmount','platformFeeRate','platformFee','sellerId','productId','gatewayPaymentId','paymentVerified','originalAmount','couponDiscount'];
  const ro=byId(remote.orders),so=byId(sent.orders);sent.orders=Array.isArray(sent.orders)?sent.orders:[];
  sent.orders.forEach(o=>{const r=o&&ro.get(String(o.id));if(r)F.forEach(k=>{if(r[k]===undefined)delete o[k];else o[k]=cl(r[k])})});
  for(const [id,r] of ro)if(!so.has(id))sent.orders.push(cl(r));
  /* append-only ledgers: rows can be added, never edited or removed */
  for(const key of ['balancePayments','sellerFinanceLedger','adminFinancialLedger','adminCommissionAdjustments']){
   const rr=byId(remote[key]),ss=byId(sent[key]),add=(Array.isArray(sent[key])?sent[key]:[]).filter(x=>x&&x.id!=null&&!rr.has(String(x.id)));
   if(key==='sellerFinanceLedger'||key==='adminFinancialLedger'||key==='adminCommissionAdjustments')sent[key]=[...[...rr.values()].map(cl)]; /* admin-only ledgers: non-admin adds nothing */
   else sent[key]=[...add,...[...rr.values()].map(cl)];
  }
 }catch(e){console.warn('money guard error',e)}
}
async function pushOnlineState(){
 if(!S.currentUser||!ONLINE_READY||ONLINE_LOADING||seWriteBusy||seReadBusy||!ONLINE_LOCAL_DIRTY||seStopped||!seOnline())return;
 if(Date.now()<seRetryAt){queueOnlineSync();return;}
 seWriteBusy=true;clearTimeout(ONLINE_SYNC_TIMER);
 try{
  const sent=seClone(onlineSnapshot()),sentKey=onlineSnapshotKey(sent),sentMutation=seMutation;
  sent.productTombstones=Array.isArray(sent.productTombstones)?sent.productTombstones:[];
  const deletedIds=new Set(sent.productTombstones.map(x=>String(x.id)));
  sent.products=(sent.products||[]).filter(p=>!deletedIds.has(String(p.id)));
  sent.drafts=(sent.drafts||[]).filter(p=>!deletedIds.has(String(p.id)));

  /* EGRESS FIX: do not download the entire JSON blob before every write.
     Use the last authoritative revision already held by this tab and perform
     a tiny conditional UPDATE. A full snapshot is fetched only on conflict. */
  let base=seClone(seBase||{}),remote=seClone(seBase||{});
  if(!seExists && seVersion===null){
    const row=await seReadFull();
    if(row){seSetBase(row);base=seClone(row.data||{});remote=seClone(row.data||{});}
    else {base={};remote={};}
  }
  seGuardNonAdmin(sent,remote);
  let merged=seMerge(base,sent,remote)||{};

  for(let attempt=0;attempt<5;attempt++){
   if(seSame(merged,remote)){
    seSetBase({data:remote,updated_at:seVersion});
    const current=onlineSnapshot();
    if(seMutation===sentMutation&&onlineSnapshotKey(current)===sentKey)seInstall(merged);
    else seInstall(seMerge(sent,seClone(current),merged));
    seSyncKey=onlineSnapshotKey(seBase||{});
    ONLINE_LOCAL_DIRTY=onlineSnapshotKey(onlineSnapshot())!==seSyncKey;
    seDirtySince=ONLINE_LOCAL_DIRTY?Date.now():0;seSucceeded();saleEarnNotifyCloudChange();
    if(typeof isAdmin==='function'&&isAdmin()&&typeof liveDirty!=='undefined'&&liveDirty&&!ONLINE_LOCAL_DIRTY){liveDirty=false;lastSignalTime=Date.now();status('live','Saved & live');}
    return;
   }
   const previous=seVersion??null;
   const previousMs=Date.parse(previous||'');
   const stamp=new Date(Math.max(Date.now(),Number.isFinite(previousMs)?previousMs+1:0)).toISOString();
   let q=supabaseClient.from(ONLINE_TABLE).update({data:merged,updated_at:stamp}).eq('id',1);
   q=previous===null?q.is('updated_at',null):q.eq('updated_at',previous);
   seCounters.writes++;
   const result=await q.select('updated_at').maybeSingle();
   if(result.error)throw result.error;
   if(result.data){
    seSetBase({data:merged,updated_at:result.data.updated_at});
    const current=seClone(onlineSnapshot());
    seInstall(seMerge(sent,current,merged));
    seSyncKey=onlineSnapshotKey(seBase||{});
    ONLINE_LOCAL_DIRTY=onlineSnapshotKey(onlineSnapshot())!==seSyncKey;
    seDirtySince=ONLINE_LOCAL_DIRTY?Date.now():0;seSucceeded();saleEarnNotifyCloudChange();
    if(typeof isAdmin==='function'&&isAdmin()&&typeof liveDirty!=='undefined'&&liveDirty&&!ONLINE_LOCAL_DIRTY){liveDirty=false;lastSignalTime=Date.now();status('live','Saved & live');}
    return;
   }
   // Another client changed the row. Only now pay the cost of one full read.
   seCounters.conflicts++;
   const row=await seReadFull();
   if(!row)throw {code:'SYNC_MISSING',message:'Cloud state row is missing.'};
   seSetBase(row);base=seClone(row.data||{});remote=seClone(row.data||{});
   seGuardNonAdmin(sent,remote);merged=seMerge(base,sent,remote)||{};
  }
  throw {code:'SYNC_CONFLICT',message:'Cloud changed while saving; retrying with the latest data.'};
 }catch(e){seFailure(e);}
 finally{seWriteBusy=false;if(ONLINE_LOCAL_DIRTY&&!seStopped)queueOnlineSync();}
}
async function restoreOnlineState(){
 if(seReadBusy)return false;seReadBusy=true;
 try{
  const row=await seReadFull();seSetBase(row);
  if(row?.data)seInstall(row.data);
  // The cloud state can contain the old transactional data, so apply the same
  // one-time reset after the remote snapshot is installed, while preserving products.
  const resetSeen=localStorage.getItem("SE_DEMO_RESET_VERSION");
  if(resetSeen!==DEMO_RESET_VERSION && resetSeen!==DEMO_RESET_VERSION+"_LOCAL"){
   resetOperationalDataKeepProducts();
   localStorage.setItem("SE_DEMO_RESET_VERSION",DEMO_RESET_VERSION+"_LOCAL");
   sePersist();
  }else if(resetSeen===DEMO_RESET_VERSION+"_LOCAL"){
   resetOperationalDataKeepProducts();
   localStorage.setItem("SE_DEMO_RESET_VERSION",DEMO_RESET_VERSION);
   sePersist();
  }
  seSyncKey=onlineSnapshotKey(seBase||{});ONLINE_READY=true;
  ONLINE_LOCAL_DIRTY=true;
  ONLINE_LOCAL_DIRTY=!row||onlineSnapshotKey(onlineSnapshot())!==seSyncKey;
  if(ONLINE_LOCAL_DIRTY){seDirtySince=Date.now();setTimeout(queueOnlineSync,0);}
  seSucceeded();startInstantOnlineSync();return true;
 }catch(e){seFailure(e);return false;}
 finally{seReadBusy=false;}
}
function subscribeOnlineState(){
 // Deliberately no realtime subscription: the old stream rebroadcast the entire
 // shared JSON blob on every write. Version polling below is the only read channel.
 if(ONLINE_CHANNEL){try{supabaseClient.removeChannel(ONLINE_CHANNEL);}catch{}ONLINE_CHANNEL=null;}
}
async function pollOnlineState(force=false){
 if(!ONLINE_READY||ONLINE_LOADING||seReadBusy||seWriteBusy||ONLINE_LOCAL_DIRTY||seStopped||!seOnline()||document.visibilityState==='hidden')return;
 if(Date.now()<seRetryAt)return;
 if(!force&&Date.now()-seLastCheck<SE_SYNC_CONFIG.focusThrottleMs)return;
 seReadBusy=true;seLastCheck=Date.now();
 try{
  const meta=await seReadVersion();
  if(!!meta===seExists&&(meta?.updated_at??null)===seVersion&&(!meta||meta.updated_at!=null)){seSucceeded();return;}
  const row=await seReadFull();
  // User may have edited while the network request was pending.
  if(ONLINE_LOCAL_DIRTY)return;
  if(row?.data){const changed=onlineSnapshotKey(row.data)!==ONLINE_LAST_REMOTE;seSetBase(row);seSyncKey=onlineSnapshotKey(seBase);if(changed){seInstall(row.data);const editing=/^dashboard\/(?:add(?:2|3)?|edit\/)/.test(routeNow());if(!editing&&!document.activeElement?.matches('input,textarea,select,button'))render();}ONLINE_LOCAL_DIRTY=onlineSnapshotKey(onlineSnapshot())!==seSyncKey;if(ONLINE_LOCAL_DIRTY&&!seDirtySince)seDirtySince=Date.now();}
  // A deleted server row is not silently recreated by an idle browser.
  else {seExists=false;seVersion=null;}
  seSucceeded();
 }catch(e){seFailure(e);}
 finally{seReadBusy=false;if(ONLINE_LOCAL_DIRTY)queueOnlineSync();}
}
function startOnlinePolling(){
  /* Background polling was removed. Live changes use the lightweight Broadcast signal;
     a throttled focus/visibility check is retained only as a resilience fallback. */
  clearTimeout(ONLINE_POLL_TIMER);
  ONLINE_POLL_TIMER=null;
}
let SE_INSTANT_CHANNEL=null,SE_INSTANT_STARTED=false,SE_INSTANT_SUBSCRIBED=false,SE_INSTANT_RETRY=null;
async function refreshPublicRealtimeData(){
 try{
  if(!supabaseClient||!SUPABASE_READY)return;
  // Production products table does not expose category/tags as physical columns.
  // Keep the public refresh schema-compatible and merge optional metadata from the
  // last known local/public row instead of making the whole catalog fail with 400.
  const pr=await supabaseClient.from('products').select('id,seller_id,title,description,price,status,file_url,image_url,created_at').eq('status','active').order('created_at',{ascending:false});
  if(pr.error)throw pr.error;
  const source=[];
  if(Array.isArray(SE_PUBLIC_CATALOG))source.push(...SE_PUBLIC_CATALOG);
  if(Array.isArray(S.products))source.push(...S.products);
  const oldById=new Map(source.map(x=>[String(x.id),x]));
  const deleted=deletedProductIdSet();
  const next=[];
  for(const row of (pr.data||[])){
   const id=String(row.id);
   if(deleted.has(id))continue;
   const old=oldById.get(id)||{};
   next.push({...old,id,title:row.title??old.title??'Untitled',description:row.description??old.description??'',price:Number(row.price??old.price??0),status:'active',approvalStatus:'APPROVED',publicLive:true,hiddenByAdmin:false,sellerId:(typeof seLocalSellerFromAuth==='function'&&seLocalSellerFromAuth(row.seller_id))||row.seller_id||old.sellerId||null,createdAt:old.createdAt||row.created_at||nowISO(),image:old.image||row.image_url||'',category:old.category||'Other',tags:Array.isArray(old.tags)?old.tags:[],links:old.links||((row.file_url?[row.file_url]:[]))});
  }
  SE_PUBLIC_CATALOG=next;
  SE_PUBLIC_CATALOG_READY=true;
  PUBLIC_PRODUCTS_READY=true;
  try{await seLoadRealProductSalesCounts(true)}catch{}
  if(!S.currentUser){S.products=next.slice();sePersist();}
  try{render()}catch{}
 }catch(e){console.warn('Public realtime refresh deferred',e?.message||e)}
}

async function consumeInstantOnlineSignal(){
 if(document.visibilityState==='hidden'||navigator.onLine===false)return;
 if(ONLINE_LOCAL_DIRTY||ONLINE_LOADING||seReadBusy||seWriteBusy){
  signalPending=true;
  clearTimeout(window.__seInstantRetryTimer);
  window.__seInstantRetryTimer=setTimeout(()=>consumeInstantOnlineSignal(),700);
  return;
 }
 signalPending=false;
 try{
  const messageRoute=/^(admin\/messages|dashboard\/messages)$/.test(String(route()||''));
  if(messageRoute){
   /* Messages are intentionally manual-refresh pages. A cloud change signal
      must not replace the open chat or move its scroll position. */
   signalPending=false;
   return;
  }
  if(S.currentUser&&ONLINE_READY){
   await pollOnlineState(true);
   if(!ONLINE_LOCAL_DIRTY&&!route().startsWith('admin'))render();
  }else{
   await refreshPublicRealtimeData();
  }
 }catch(e){
  signalPending=true;
  console.warn('Instant live refresh deferred',e?.message||e);
 }
}
async function startInstantOnlineSync(){
 if(SE_INSTANT_STARTED||!SUPABASE_READY||!supabaseClient)return;
 SE_INSTANT_STARTED=true;
 try{
  /* One lightweight public Broadcast channel is used only as a change signal.
     No database snapshot is put on the wire, so a change does not rebroadcast
     the large saleearn_app_state JSON blob. The actual read happens once, only
     after an admin save signal. */
  SE_INSTANT_CHANNEL=supabaseClient.channel('saleearn-instant-sync',{config:{broadcast:{self:false,ack:false}}});
  SE_INSTANT_CHANNEL.on('broadcast',{event:'admin-state-updated'},()=>{
   signalPending=true;
   clearTimeout(window.__seInstantRefreshTimer);
   window.__seInstantRefreshTimer=setTimeout(()=>consumeInstantOnlineSignal(),80);
  });
  await SE_INSTANT_CHANNEL.subscribe((status)=>{
   SE_INSTANT_SUBSCRIBED=status==='SUBSCRIBED';
   if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
    SE_INSTANT_SUBSCRIBED=false;
    clearTimeout(SE_INSTANT_RETRY);
    SE_INSTANT_RETRY=setTimeout(()=>{
     SE_INSTANT_STARTED=false;
     SE_INSTANT_CHANNEL=null;
     startInstantOnlineSync();
    },5000);
   }
  });
 }catch(e){
  SE_INSTANT_STARTED=false;SE_INSTANT_SUBSCRIBED=false;SE_INSTANT_CHANNEL=null;
  console.warn('Instant sync channel unavailable',e?.message||e);
 }
}
async function broadcastInstantOnlineUpdate(){
 if(!SE_INSTANT_CHANNEL||!SE_INSTANT_SUBSCRIBED)await startInstantOnlineSync();
 if(!SE_INSTANT_CHANNEL||!SE_INSTANT_SUBSCRIBED)return;
 try{
  await SE_INSTANT_CHANNEL.send({type:'broadcast',event:'admin-state-updated',payload:{v:1,at:Date.now()}});
 }catch(e){console.warn('Instant sync broadcast failed',e?.message||e)}
}

/* v30: one tiny realtime signal per burst; the database snapshot is fetched only after a change. */
let SE_LAST_BROADCAST_AT=0,SE_BROADCAST_TIMER=null;
async function saleEarnNotifyCloudChange(){
 const now=Date.now();
 if(now-SE_LAST_BROADCAST_AT<700){
  clearTimeout(SE_BROADCAST_TIMER);
  SE_BROADCAST_TIMER=setTimeout(()=>saleEarnNotifyCloudChange(),720);
  return;
 }
 SE_LAST_BROADCAST_AT=now;
 try{await broadcastInstantOnlineUpdate()}catch{}
}

function applyRemoteOnlineState(remote){
 if(!ONLINE_READY||ONLINE_LOADING||ONLINE_LOCAL_DIRTY||!remote||typeof remote!=='object')return;
 const key=onlineSnapshotKey(remote);if(key===ONLINE_LAST_REMOTE)return;
 const editing=/^dashboard\/(?:add(?:2|3)?|edit\/)/.test(routeNow());
 seInstall(remote);ONLINE_LAST_REMOTE=key;
 if(!editing&&!document.activeElement?.matches('input,textarea,select,button'))render();
}
window.saleEarnSyncStatus=()=>({ready:ONLINE_READY,pending:ONLINE_LOCAL_DIRTY,saving:seWriteBusy,paused:seStopped,failures:seFailures,counts:{...seCounters},pollMs:SE_SYNC_CONFIG.pollMs});
window.saleEarnRetrySync=async()=>{seStopped=false;seFailures=0;seRetryAt=0;if(!ONLINE_READY){await restoreSupabaseSession();return;}if(ONLINE_LOCAL_DIRTY)return pushOnlineState();return pollOnlineState(true);};
window.addEventListener('online',()=>{seStopped=false;seFailures=0;seRetryAt=0;if(!ONLINE_READY)restoreSupabaseSession();else if(ONLINE_LOCAL_DIRTY)queueOnlineSync();else seMaybeResumeSync(true);});
window.addEventListener('beforeunload',e=>{if(ONLINE_LOCAL_DIRTY||seWriteBusy){sePersist();e.preventDefault();e.returnValue='';}});


function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function currentSeller(){return S.currentUser?ensureStoreForUser():null}
function product(id){
  const deleted=deletedProductIdSet();
  if(deleted.has(String(id)))return null;
  const p=(S.products||[]).find(p=>String(p?.id)===String(id));
  if(!p)return null;
  /* Admin moderation/detail views must be able to inspect Pending/Rejected
     records. Public buyers still go through the active/public catalog guards. */
  if(typeof isAdmin==='function' && isAdmin())return p;
  if(String(p.status||'').toLowerCase()!=='active')return null;
  if(!S.currentUser){
    if(!PUBLIC_PRODUCTS_READY)return null;
    if(String(p.approvalStatus||'APPROVED').toUpperCase()!=='APPROVED' && p.publicLive!==true)return null;
    if(String(p.approvalStatus||'APPROVED').toUpperCase()==='REJECTED'||p.hiddenByAdmin===true)return null;
  }
  return p;
}
function publicFollowerCount(id){
 // Public count is seller-level data, never derived from the current visitor's private follow map.
 const sellerMap=(S&&S.sellers&&typeof S.sellers==='object')?S.sellers:{};
 const ss=sellerMap[String(id||"").trim()];
 return Math.max(0,Math.floor(Number(ss?.followers||0)));
}
function seller(id){
 const sid=String(id||"").trim();
 const sellerMap=(S&&S.sellers&&typeof S.sellers==='object')?S.sellers:{};
 const ss=sellerMap[sid]||{id:sid,name:"Seller",owner:"Seller",followers:0,logo:"",bio:"",score:70};
 ss.followers=publicFollowerCount(sid);
 return ss;
} const SE_PUBLIC_SELLER_MEMO=new Map();
function publicSellerView(id){
  const key=String(id||"");
  const base=seller(key);
  const score=getSellerScore(key);
  const memo=SE_PUBLIC_SELLER_MEMO.get(key);
  const stamp=`${base.name||""}|${base.followers||0}|${score}|${base.logo||""}|${base.bio||""}`;
  if(memo?.stamp===stamp)return memo.value;
  const value={...base,followers:publicFollowerCount(key),score};
  SE_PUBLIC_SELLER_MEMO.set(key,{stamp,value});
  return value;
}
function sellerOwnerUser(sid){const ss=S.sellers?.[sid];return (S.users||[]).find(u=>String(u.sellerId||"")===String(sid)||String(u.id||"")===String(ss?.owner||"")||String(u.authId||"")===String(ss?.owner||"")||String(u.name||"")===String(ss?.owner||""))||null}
function clampSellerScore(v){return Math.max(0,Math.min(100,Math.round(Number(v)||0)))}
function isPrimaryAdminUser(u){return !!u&&u.isAdmin===true&&String(u.authId||u.id||"")==="19424c7c-8624-4aa2-b2fb-002a0f57b8ed"}
function enforceAdminScore100(){(S.users||[]).forEach(u=>{if(isPrimaryAdminUser(u)){u.score=100;if(u.sellerId&&S.sellers?.[u.sellerId])S.sellers[u.sellerId].score=100}});if(isPrimaryAdminUser(S.currentUser))S.currentUser.score=100}
function getSellerScore(sid){
  const ss=S.sellers?.[sid],u=sellerOwnerUser(sid);
  if(isPrimaryAdminUser(u)){u.score=100;if(ss)ss.score=100;return 100}
  let score=Number(ss?.score);
  if(!Number.isFinite(score))score=Number(u?.score);
  if(!Number.isFinite(score))score=70;
  score=clampSellerScore(score);
  if(ss)ss.score=score;
  if(u)u.score=score;
  return score;
}
function sellerScoreBand(score){return score<30?{key:"red",label:"Needs attention"}:score<60?{key:"yellow",label:"Improving"}:{key:"green",label:"Good standing"}}
function sellerScoreMarkup(sid,compact=false){const score=getSellerScore(sid),band=sellerScoreBand(score);return `<div class="seller-score-card ${band.key} ${compact?'compact':''}"><div class="seller-score-head"><div><span>SELLER SCORE</span><b>${band.label}</b></div><strong>${score}<small>/100</small></strong></div><div class="seller-score-track" aria-label="Seller score ${score} out of 100"><i class="zone red"></i><i class="zone yellow"></i><i class="zone green"></i><em style="left:${score}%"></em></div><div class="seller-score-scale"><span>0</span><span>30</span><span>60</span><span>100</span></div></div>`}
function recordSellerScore(sid,newScore,reason,source,eventKey){const ss=S.sellers?.[sid],u=sellerOwnerUser(sid);if(!ss&&!u)return false;S.scoreHistory=Array.isArray(S.scoreHistory)?S.scoreHistory:[];if(eventKey&&S.scoreHistory.some(x=>x.eventKey===eventKey))return false;const old=getSellerScore(sid),next=clampSellerScore(newScore);if(u){u.score=next;u.scoreUpdatedAt=nowISO()}if(ss){ss.score=next;ss.scoreUpdatedAt=nowISO()}S.scoreHistory.unshift({id:uid("score"),sellerId:sid,userId:u?.id||null,oldScore:old,newScore:next,delta:next-old,reason:String(reason||"Score update"),source:String(source||"SYSTEM"),eventKey:eventKey||null,date:nowISO()});if(S.scoreHistory.length>300)S.scoreHistory.length=300;return true}
function adjustSellerScore(sid,delta,reason,eventKey,source="SYSTEM"){return recordSellerScore(sid,getSellerScore(sid)+Number(delta||0),reason,source,eventKey)}
async function adminSetSellerScore(sid,value){
 if(!adminOnly())return;
 const n=Number(value);
 if(!Number.isFinite(n)||n<0||n>100)return toast("Enter a score from 0 to 100");
 const next=clampSellerScore(n);
 const reason=(document.getElementById("adminSellerScoreReason")?.value||"Admin manual score update").trim();
 const changed=recordSellerScore(sid,next,reason,"ADMIN","ADMIN:"+sid+":"+Date.now());
 if(!changed)return toast("Seller not found");
 const ss=S.sellers?.[sid];
 const u=sellerOwnerUser(sid);
 if(u){
   u.score=next;
   u.scoreManual=true;
   u.scoreReason=reason;
   u.scoreUpdatedAt=nowISO();
 }
 if(ss){ss.score=next;ss.scoreManual=true;ss.scoreReason=reason;ss.scoreUpdatedAt=nowISO()}
 // Persist to the shared state first so the seller page can use the same score.
 save();
 // Also write the owner's profile directly. This makes the score follow the
 // user's/auth ID and prevents an older profile score from replacing the admin value.
 try{
   if(typeof supabaseClient!=="undefined"&&supabaseClient?.from&&u){
     const keys=[u.authId,u.id,u.userId].filter(Boolean).map(String);
     let q=null;
     if(u.authId) q=supabaseClient.from("profiles").update({score:next}).eq("id",String(u.authId));
     else if(u.id) q=supabaseClient.from("profiles").update({score:next}).eq("id",String(u.id));
     if(q){
       const r=await q;
       if(r.error)console.warn("Admin seller score profile update failed:",r.error.message);
     }
     // If the profile ID was not the auth ID, also try the Sale Earn user ID.
     if(u.userId && String(u.userId)!==String(u.authId||u.id||"")){
       const r2=await supabaseClient.from("profiles").update({score:next}).eq("user_id",String(u.userId));
       if(r2.error)console.warn("Admin seller score user_id update failed:",r2.error.message);
     }
   }
 }catch(e){console.warn("Admin seller score cloud sync failed:",e)}
 adminAudit("Set seller score",sid,{score:next,reason,userId:u?.id||null,authId:u?.authId||null});
 // Clear the public seller memo so the updated score is rendered immediately.
 try{SE_PUBLIC_SELLER_MEMO?.delete?.(String(sid))}catch(e){}
 toast("Seller score updated and connected");
 render();
}
function setSellerProfileView(sid,view){window.sellerViews=window.sellerViews||{};window.sellerViews[sid]=view==="list"?"list":"grid";render()}
function imgOrFallback(p,cls=""){return p?.image?`<img class="${cls}" loading="lazy" decoding="async" src="${esc(p.image)}" onerror="this.style.display='none';this.parentNode.querySelector('.thumb-fallback')?.classList.remove('hidden')">`:``}
function thumb(p){return `<div class="thumb">${imgOrFallback(p)}<div class="thumb-fallback ${p?.image?"hidden":""}">🧩</div></div>`}
function avatar(s){return `<div class="seller-avatar">${s.logo?`<img loading="lazy" decoding="async" src="${esc(s.logo)}">`:"SE"}</div>`}
function toast(msg){const x=document.createElement("div");x.className="toast";x.textContent=msg;document.body.appendChild(x);setTimeout(()=>x.remove(),2200)}
function navStack(){try{return JSON.parse(sessionStorage.getItem("SE_NAV_STACK")||"[]")}catch(e){return []}}
function saveNavStack(a){sessionStorage.setItem("SE_NAV_STACK",JSON.stringify(a.slice(-80)))}
function persistProductDraftFromDOM(saveLocal=true){
 try{
  const form=document.querySelector(".dash-form");
  if(!form||!form.querySelector("#pfTitle,#pfCategory,#tagInput,#pfDesc,#fileLinksWrap,#pfPrice,#pfOld"))return;
  if(!S.draft)S.draft={};
  const title=document.getElementById("pfTitle");
  const category=document.getElementById("pfCategory");
  const tagInput=document.getElementById("tagInput");
  const desc=document.getElementById("pfDesc");
  const price=document.getElementById("pfPrice");
  const oldPrice=document.getElementById("pfOld");
  if(title)S.draft.title=title.value;
  if(category)S.draft.category=category.value;
  if(tagInput)S.draft.tags=tagInput.value.split(",").map(x=>x.trim()).filter(Boolean);
  if(desc)S.draft.description=desc.value;
  if(price)S.draft.price=price.value;
  if(oldPrice)S.draft.oldPrice=oldPrice.value;
  const wrap=document.getElementById("fileLinksWrap");
  if(wrap){
   S.draft.links=[...wrap.querySelectorAll(".pfLink")].map(x=>x.value.trim());
   S.draft.linkTitles=[...wrap.querySelectorAll(".pfLinkTitle")].map((x,i)=>x.value.trim()||`File ${i+1}`);
   S.draft.fileCount=S.draft.links.length;
  }
  const size=document.getElementById("pfSizeValue"),unit=document.getElementById("pfSizeUnit");
  if(size&&size.value!="")S.draft.fileSizeValue=Number(size.value);
  if(unit)S.draft.fileSizeUnit=unit.value;
  const faqQ=[...document.querySelectorAll(".faqQ")],faqA=[...document.querySelectorAll(".faqA")];
  if(faqQ.length)S.draft.faq=faqQ.map((q,i)=>[q.value.trim(),faqA[i]?.value.trim()||""]).filter(x=>x[0]);
  const couponCode=document.getElementById("pfCouponCode"),couponValue=document.getElementById("pfCouponValue"),couponMax=document.getElementById("pfCouponMax"),couponExpiry=document.getElementById("pfCouponExpiry");
  if(couponCode||couponValue||couponMax||couponExpiry)S.draft.couponDraft={code:couponCode?.value||"",value:couponValue?.value||"",maxUses:couponMax?.value||"",expiresAt:couponExpiry?.value||""};
  if(saveLocal)localStorage.setItem(KEY,JSON.stringify(S));
 }catch(e){console.warn("Draft preservation failed",e)}
}
let PRODUCT_DRAFT_SAVE_TIMER=0;
function queueProductDraftAutosave(){persistProductDraftFromDOM(false);clearTimeout(PRODUCT_DRAFT_SAVE_TIMER);PRODUCT_DRAFT_SAVE_TIMER=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(S));}catch(e){console.warn("Draft autosave delayed",e)}},180)}
document.addEventListener("input",e=>{if(e.target?.closest?.(".dash-form"))queueProductDraftAutosave()},true);
document.addEventListener("change",e=>{if(e.target?.closest?.(".dash-form")){persistProductDraftFromDOM(true);clearTimeout(PRODUCT_DRAFT_SAVE_TIMER)}},true);
/* -------------------- ROUTE VIEW / NORMAL SCROLL -------------------- */
try{history.scrollRestoration="auto"}catch(e){}

function go(route){
  route=String(route||"home");
  if(!route.startsWith("dashboard"))sessionStorage.removeItem("SE_RECYCLE_DRAFT_REMINDER");
  const cur=routeNow();
  if(!window.__skipProductDraftPersist&&/^dashboard\/add(?:2|3)?/.test(cur))persistProductDraftFromDOM();
  if(cur===route)return;
  const st=navStack();st.push(route);saveNavStack(st);
  history.pushState({saleEarn:true,route},"","#"+route);
  render();
}
function goBack(fallback="home"){
  const st=navStack();
  if(st.length>1){st.pop();saveNavStack(st);history.back();}
  else{go(fallback)}
}
function routeNow(){return location.hash.replace(/^#/ ,"")||"home"}
function route(){return routeNow()}
window.addEventListener("popstate",()=>{
  persistProductDraftFromDOM();
  const st=navStack();if(st.length>1)st.pop();saveNavStack(st);
  render();
});

/* -------------------- HEADER / COMMON -------------------- */
function siteName(){return String(ensurePlatformConfig()?.branding?.websiteName||"Sale Earn").trim()||"Sale Earn"}
function header(){
 const path=route();
 const mi={search:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>',home:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-7 9 7"></path><path d="M5.5 10v10h13V10M9.5 20v-6h5v6"></path></svg>',cart:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H7"></path><circle cx="10" cy="20" r="1"></circle><circle cx="18" cy="20" r="1"></circle></svg>',sell:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v8M8 12h8"></path></svg>',account:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4.5 21c.7-4.2 3.2-6.3 7.5-6.3s6.8 2.1 7.5 6.3"></path></svg>'};
 const mobileSearch=`<div class="mobile-search"><span class="mobile-search-glyph">${mi.search}</span><input value="${esc(new URLSearchParams(location.search).get('q')||'')}" placeholder="Search products..." onkeydown="if(event.key==='Enter'){go('market');setTimeout(()=>{const q=this.value.trim();if(q){const m=document.querySelector('.market-tools .searchbox input');if(m){m.value=q;m.dispatchEvent(new Event('input',{bubbles:true}))}}},80)}"></div>`;
 return `<header class="topbar desktop-only"><div class="container nav"><a class="logo" href="#" onclick="go('home');return false"><span class="logo-mark">SE</span>${esc(siteName())}</a><div class="search"><span>${mi.search}</span><input placeholder="Search products..." onkeydown="if(event.key==='Enter'){go('market')}" value="${esc(new URLSearchParams(location.search).get('q')||'')}"></div><div class="nav-actions"><button class="btn" onclick="go('market')">Marketplace</button><button class="btn" onclick="window.startSelling()">Start Selling</button><button class="btn cart-btn" onclick="go('cart')">Cart ${S.cart.length?`<span class="badge-dot cart-count">${S.cart.length}</span>`:""}</button>${S.currentUser?`<button class="btn se-notif-bell" type="button" onclick="openSENotifications()" aria-label="Notifications" title="Notifications">🔔${seUnreadForCurrent().length?`<span class="se-notif-count">${seUnreadForCurrent().length>99?'99+':seUnreadForCurrent().length}</span>`:''}</button>`:''}<button class="btn" onclick="go('account')">${S.currentUser?'My Account':'Sign In'}</button><select class="pill" onchange="setCurrency(this.value)"><option value="INR" ${currencyCode()==='INR'?'selected':''}>₹ INR</option><option value="USD" ${currencyCode()==='USD'?'selected':''}>$ USD</option></select>${S.currentUser?.isAdmin&&S.currentUser?.serverAdminVerified?`<button class="btn" onclick="go('admin')" title="Open Admin Panel">Admin</button>`:""}</div></div></header>
 <header class="mobile-topbar mobile-only"><div class="mobile-topbar-inner"><a class="mobile-logo" href="#" onclick="go('home');return false"><span class="logo-mark">SE</span><span>${esc(siteName())}</span></a>${mobileSearch}${S.currentUser?`<button class="mobile-account se-notif-bell" type="button" aria-label="Notifications" onclick="openSENotifications()">🔔${seUnreadForCurrent().length?`<span class="se-notif-count">${seUnreadForCurrent().length>99?'99+':seUnreadForCurrent().length}</span>`:''}</button>`:''}<button class="mobile-account" aria-label="Open account" onclick="go('account')">${mi.account}</button></div></header>
 <nav class="mobile-bottom-nav mobile-only" aria-label="Primary navigation"><button class="${path==='home'?'active':''}" ${path==='home'?'aria-current="page"':''} onclick="go('home')"><span class="micon">${mi.home}</span><span>Home</span></button><button class="${path==='market'?'active':''}" ${path==='market'?'aria-current="page"':''} onclick="go('market')"><span class="micon">${mi.search}</span><span>Explore</span></button><button class="${path==='cart'?'active':''}" ${path==='cart'?'aria-current="page"':''} onclick="go('cart')"><span class="micon">${mi.cart}</span><span>Cart</span>${S.cart.length?`<span class="badge-dot nav-count">${S.cart.length}</span>`:''}</button><button class="${path.startsWith('dashboard')?'active':''}" onclick="window.startSelling()"><span class="micon">${mi.sell}</span><span>Sell</span></button><button class="${path.startsWith('account')?'active':''}" ${path.startsWith('account')?'aria-current="page"':''} onclick="go('account')"><span class="micon">${mi.account}</span><span>Account</span></button></nav>`
}

/* -------------------- PUBLIC LEGAL / PAYMENT POLICY PAGES -------------------- */
function togglePolicySidebar(open){
 const sidebar=document.getElementById('policySidebar');
 const backdrop=document.querySelector('.policy-sidebar-backdrop');
 if(!sidebar)return;
 const isOpen=!!open;
 sidebar.classList.toggle('mobile-open',isOpen);
 if(backdrop)backdrop.style.display=isOpen?'block':'none';
 document.body.classList.toggle('policy-menu-open',isOpen);
}

function policyPage(kind){
 const brand=esc(siteName());
 const email=esc(ensurePlatformConfig()?.branding?.contactEmail||'support@example.com');
 const pages={
  contact:{title:'Contact Us',intro:'Need help with an order, account, seller store or payment? Contact the Sale Earn support team using the details below.',body:`
   <div class="se-contact-page">
    <section class="se-contact-copy">
      <span class="eyebrow">GET IN TOUCH</span>
      <h2>How can we help you?</h2>
      <p>Have a question about a product, order, account, seller store or payment? Our support channel is available for Sale Earn marketplace questions.</p>
      <div class="se-contact-details">
        <div class="se-contact-detail"><div class="icon">✉</div><div><b>Email Support</b><a href="mailto:mohitghasoliya90014@gmail.com">mohitghasoliya90014@gmail.com</a></div></div>
        <div class="se-contact-detail"><div class="icon">☎</div><div><b>Phone Support</b><a href="tel:+918875088657">+91 8875088657</a></div></div>
        <div class="se-contact-detail"><div class="icon">◷</div><div><b>Support Hours</b><strong>Daily, 3:00 PM – 6:00 PM IST</strong></div></div>
      </div>
      <div class="se-contact-social"><small>Stay connected</small><div><button aria-label="Telegram" onclick="window.open('https://t.me/nextidea66','_blank','noopener')">✈</button><button aria-label="Email" onclick="location.href='mailto:mohitghasoliya90014@gmail.com'">✉</button><button aria-label="Support" onclick="go('policy/faq')">?</button></div></div>
    </section>
    <section class="se-contact-form">
      <h3>Send a Message</h3>
      <div class="form-grid">
       <div class="field"><label>First Name</label><input id="ctFirstName" placeholder="Your first name"></div>
       <div class="field"><label>Last Name</label><input id="ctLastName" placeholder="Your last name"></div>
       <div class="field"><label>Email Address</label><input id="ctEmail" value="${esc(S.currentUser?.email||"")}" placeholder="you@example.com"></div>
       <div class="field"><label>User ID <span class="muted">(optional)</span></label><input id="ctUserId" value="${esc(S.currentUser?.userId||S.currentUser?.id||"")}" placeholder="Your User ID"></div>
       <div class="field" style="grid-column:1/-1"><label>Subject</label><select id="ctSubject"><option value="General Inquiry">General Inquiry</option><option value="Order / Delivery Issue">Order / Delivery Issue</option><option value="Payment Issue">Payment Issue</option><option value="Seller Support">Seller Support</option><option value="Account Help">Account Help</option><option value="Policy Question">Policy Question</option></select></div>
       <div class="field" style="grid-column:1/-1"><label>Message</label><textarea id="ctMsg" rows="6" placeholder="How can we help?"></textarea></div>
      </div>
      <button class="btn primary" onclick="sendContact()">Send Message</button>
      <div class="se-contact-note">For your security, never include passwords, OTPs, card numbers, CVV, UPI PINs or other payment credentials in a support message.</div>
    </section>
   </div>
   <div class="se-contact-trust"><div><strong>Digital-only</strong><span>Online marketplace</span></div><div><strong>3–6 PM IST</strong><span>Published support hours</span></div><div><strong>Secure</strong><span>Payment credentials stay private</span></div></div>
  `},
  about:{title:'About Sale Earn',intro:'A creator-first digital marketplace built to help eligible sellers publish digital products and help buyers discover, purchase and access useful digital solutions online.',body:`
   <div class="se-about-page">
    <section class="se-about-hero">
      <span class="se-about-eyebrow">THE SALE EARN ECOSYSTEM</span>
      <h2>Sell. Buy. <span>Grow.</span></h2>
      <p>Sale Earn is a digital-products marketplace where eligible sellers can list useful digital products and buyers can discover and purchase them with online delivery after verified payment.</p>
      <small>Built around simple discovery, seller responsibility, product safety checks and convenient digital access.</small>
      <div class="se-about-hero-actions"><button class="btn primary" onclick="window.startSelling()">Become a Seller</button><button class="btn" onclick="go('market')">Explore Marketplace</button></div>
    </section>

    <section class="se-about-split">
      <div class="se-about-copy">
        <span class="se-about-tag">FOR SELLERS</span>
        <h3>Your Digital<br><strong>Business Toolkit</strong></h3>
        <p>Start selling digital products through a marketplace designed to keep publishing, discovery and delivery straightforward.</p>
        <ul class="se-about-checks">
          <li><i>✓</i><span>Upload and list digital products easily</span></li>
          <li><i>✓</i><span>Use a clear seller storefront and product pages</span></li>
          <li><i>✓</i><span>Deliver digital products online after verified payment</span></li>
          <li><i>✓</i><span>Reach marketplace buyers while building your own seller presence</span></li>
          <li><i>✓</i><span>Manage products, orders, payouts and seller settings</span></li>
        </ul>
      </div>
      <div class="se-about-feature-grid">
        <div class="se-about-feature"><b>Payment Setup</b><span>Checkout is connected to the payment method configured for the marketplace.</span></div>
        <div class="se-about-feature"><b>Digital Delivery</b><span>Products are delivered online through the approved delivery information on the listing.</span></div>
        <div class="se-about-feature"><b>Marketplace Reach</b><span>Publish digital products for buyers to discover through the marketplace.</span></div>
        <div class="se-about-feature"><b>Trust & Safety</b><span>Seller verification and product safety checks help protect marketplace quality.</span></div>
        <div class="se-about-feature se-about-feature-wide"><b>Seller Management</b><span>Eligible sellers can manage their products, orders, payouts, store information and other marketplace tools from the Vendor Portal.</span></div>
      </div>
    </section>

    <section class="se-about-section se-about-buyers">
      <span class="se-about-tag center">FOR BUYERS</span>
      <h3>Trust, Discovery &amp;<br><strong>Instant Digital Access</strong></h3>
      <div class="se-about-four-grid">
        <div class="se-about-mini"><em>⌕</em><b>Discovery</b><span>Explore digital products, bundles and useful creator assets.</span></div>
        <div class="se-about-mini"><em>◷</em><b>Online Access</b><span>Get digital access after the payment is successfully verified.</span></div>
        <div class="se-about-mini"><em>✓</em><b>Safety Checks</b><span>Listings can be reviewed for prohibited or suspicious product indicators.</span></div>
        <div class="se-about-mini"><em>♧</em><b>Seller Stores</b><span>Discover products through seller storefronts and product pages.</span></div>
      </div>
    </section>

    <section class="se-about-categories">
      <span>EXPLORE DIGITAL PRODUCTS</span>
      <div><button onclick="go('market')">Reel Content Packs</button><button onclick="go('market')">Courses</button><button onclick="go('market')">Creator Assets</button><button onclick="go('market')">Templates</button><button onclick="go('market')">Other Digital Products</button></div>
    </section>

    <section class="se-about-core">
      <div><span class="se-about-tag">THE SALE EARN CORE</span><h3>A marketplace built around<br><strong>useful digital products.</strong></h3><p>Sale Earn combines digital product discovery with seller tools, online delivery and marketplace safety controls.</p></div>
      <div class="se-about-core-list"><b><i></i>Digital products marketplace</b><b><i></i>Seller storefront &amp; management tools</b><b><i></i>Online digital delivery</b><b><i></i>Seller verification and product review</b><b><i></i>Buyer trust, support and access tools</b></div>
    </section>

    <section class="se-about-quote">“Sale Earn brings sellers and buyers together around useful digital products, with clear marketplace rules, digital delivery and safety-focused review.”</section>

    <section class="se-about-section se-about-path">
      <span class="se-about-tag center">HOW SALE EARN WORKS</span>
      <h3>Your Path to <strong>Digital Access</strong></h3>
      <p class="se-about-section-sub">A simple flow for discovering, purchasing and accessing digital products.</p>
      <div class="se-about-four-grid">
        <div class="se-about-step"><strong>01</strong><em>♙</em><b>Create Account</b><span>Create an account and use the marketplace as a buyer or eligible seller.</span></div>
        <div class="se-about-step"><strong>02</strong><em>⌕</em><b>Explore Products</b><span>Browse digital products, bundles and seller storefronts.</span></div>
        <div class="se-about-step"><strong>03</strong><em>▣</em><b>Secure Checkout</b><span>Complete checkout using the payment method shown on the marketplace.</span></div>
        <div class="se-about-step"><strong>04</strong><em>↓</em><b>Digital Delivery</b><span>After verified payment, access the digital delivery information for your purchase.</span></div>
      </div>
    </section>

    <section class="se-about-trust-stats">
      <div><strong>100%</strong><span>DIGITAL MARKETPLACE</span></div>
      <div><strong>24/7</strong><span>ONLINE PRODUCT DISCOVERY</span></div>
      <div><strong>HTTPS</strong><span>TRUSTED DELIVERY LINKS</span></div>
      <div><strong>ADMIN</strong><span>PRODUCT REVIEW CONTROL</span></div>
    </section>

    <section class="se-about-final"><h3>Ready to explore Sale Earn?</h3><p>Discover digital products or start building your seller storefront.</p><div><button class="btn primary" onclick="go('market')">Browse Marketplace</button><button class="btn" onclick="window.startSelling()">Start Selling</button></div></section>
   </div>
  `},
  sellerGuidelines:{title:'Seller Guidelines',intro:'Practical standards for sellers to publish reliable digital products, maintain buyer trust and keep delivery working.',body:`
   <div class="se-guidelines-hero"><span class="se-guidelines-check">✓</span><div><b>Creator Standards</b><p>Build listings that are clear, original or properly licensed, accurately described and easy for buyers to access.</p></div></div>

   <section class="se-guide-block"><div class="se-guide-heading"><span>✓</span><h2>What You Can Sell</h2></div><p class="se-guide-sub">Sale Earn is focused on legitimate digital products. Examples include:</p>
    <div class="se-guide-product-grid">
      <div><b>Reel Content Packs</b><span>Creator-ready digital reel and content bundles.</span></div>
      <div><b>Courses & Training</b><span>Legitimate courses, lessons, workshops and study resources.</span></div>
      <div><b>Design & Creator Assets</b><span>Templates, graphics, branding resources and other creator files.</span></div>
      <div><b>Creator Tools & Templates</b><span>Original templates, workflow resources and creator assets you are authorized to distribute.</span></div>
      <div><b>Ebooks & Guides</b><span>Original or properly licensed written digital resources.</span></div>
      <div><b>Other Digital Products</b><span>Other eligible digital products that comply with Sale Earn policies.</span></div>
    </div>
   </section>

   <div class="se-guide-two">
    <div class="se-guide-rule blue"><h3>Digital File Responsibility</h3><ul><li>Use a working HTTPS delivery link from a supported provider.</li><li>Test the link before publishing and keep it accessible after approval.</li><li>Describe file formats, contents, quantity and requirements accurately.</li><li>Repair or replace unavailable delivery links promptly.</li></ul></div>
    <div class="se-guide-rule red"><h3>Violation Consequences</h3><ul><li>A listing may be flagged or placed into Admin review.</li><li>Non-compliant products may be rejected, hidden or removed.</li><li>Serious or repeated violations may restrict seller activity or lead to account suspension/termination.</li><li>Amounts may be held or adjusted where permitted by the applicable platform policy.</li></ul></div>
   </div>

   <section class="se-guide-callout"><div><span>!</span><div><h3>Accuracy & Permission Standard</h3><p>Do not inflate product claims, use misleading thumbnails, misrepresent quantities, or upload content you are not authorized to sell. The product page should match what the buyer actually receives.</p></div></div><div class="se-guide-check-list"><b>Listing check</b><span>✓ Correct title & category</span><span>✓ Honest thumbnail & description</span><span>✓ Working delivery link</span><span>✓ Required rights/permissions</span><span>✓ No prohibited content</span></div></section>

   <div class="se-guide-heading standalone"><span>▣</span><h2>Seller Best Practices</h2></div>
   <div class="se-guide-practices">
     <div><b>Clear thumbnails</b><span>Use clean visuals that represent the actual product.</span></div>
     <div><b>Useful previews</b><span>Show enough information for buyers to understand the offer.</span></div>
     <div><b>Accurate pricing</b><span>Keep product price and included value clear.</span></div>
     <div><b>Fast support</b><span>Respond to reasonable questions about your own product.</span></div>
     <div><b>Reliable delivery</b><span>Monitor links and fix access issues quickly.</span></div>
     <div><b>Honest promotion</b><span>Avoid spam, deceptive claims and guaranteed-income promises.</span></div>
   </div>

   <div class="se-guide-dark"><h3>Seller Quality Checklist</h3><div><span>✓ Original or properly licensed product</span><span>✓ Clear title, category and tags</span><span>✓ Complete description</span><span>✓ Working online delivery</span><span>✓ Accurate claims</span><span>✓ No prohibited material</span></div></div>
  `},
  sellerPayouts:{title:'Seller Payout Policy',intro:'Sale Earn explains the seller payout flow so sellers can understand what happens before and after a payout request.',body:`
   <div class="policy-card"><h2>How payouts work</h2><ol style="line-height:1.9;padding-left:22px"><li>Eligible seller earnings appear in the seller's available-to-receive balance according to the platform's transaction rules.</li><li>The seller submits a payout request using the payout method shown in the seller dashboard.</li><li>The request can remain pending while Admin checks the request and applicable account/risk conditions.</li><li>After an approved payout is actually processed, the corresponding amount is recorded as received.</li></ol></div>
   <div class="policy-card"><h2>Cancellation or review</h2><p>Admin may cancel or place a payout under review where necessary. If a payout is cancelled before successful payment, the cancelled amount is returned to the seller's available-to-receive balance according to the platform's payout ledger logic.</p></div>
   <div class="policy-card"><h2>Seller responsibility</h2><p>Sellers must keep payout details accurate and must not submit duplicate or misleading payout requests. The platform may request additional information when needed to protect the marketplace.</p></div>
   <div class="policy-card"><h2>Important</h2><p>Payout timing can depend on payment processing, verification, account status and applicable operational controls. This page does not promise a fixed settlement time.</p></div>
  `},
  prohibited:{title:'Not Allowed Products',intro:'Sale Earn keeps the marketplace focused on legitimate digital products and does not allow products or activities that create legal, safety, fraud or payment-compliance concerns.',body:`
   <div class="policy-card"><h2>Examples of products and activities that are not allowed</h2><ul style="line-height:1.9;padding-left:22px"><li>Adult or sexually explicit material and related services</li><li>Alcohol, illegal drugs and drug-related products</li><li>Gambling, betting, lotteries and games of chance</li><li>Weapons and weapon-related products</li><li>Fake government IDs, passports, diplomas or forged documents</li><li>Hacking, cracking, phishing, credential theft, malware or illegal-access tools/instructions</li><li>Unauthorized copies of copyrighted books, music, movies, software, games or other protected material</li><li>Software downloads, license keys or other intangible software goods that are not accepted by the applicable payment provider</li><li>Counterfeit, fake or unauthorized goods</li><li>Spam, bulk unsolicited-email tools, mailing lists or similar abuse-enabling products</li><li>Pyramid, matrix, get-rich-quick or misleading guaranteed-income schemes</li><li>Money-laundering services, unlicensed money-transfer services or other regulated financial activity without required authorization</li><li>Cryptocurrency/NFT products or other products prohibited by the applicable payment provider or law</li><li>Any product or activity that is illegal, deceptive, fraudulent or otherwise prohibited by applicable law</li></ul></div>
   <div class="policy-card"><h2>How review works</h2><p>Sale Earn may use automated checks to identify common risk indicators. A flagged listing is sent to the Admin review list. Admin can inspect the product information and then approve, keep it pending or reject it. Automated flags are review signals, not a final legal finding.</p></div>
  `},
  pricing:{title:'Pricing Details',intro:'Sale Earn displays applicable prices in the marketplace and at checkout before a payment is submitted.',body:`
   <div class="se-pricing-page">
    <section class="se-pricing-hero"><span class="eyebrow">SELLER PLANS</span><h2>Simple, <span>transparent</span> pricing</h2><p>Choose the seller plan that fits your stage. Product prices are shown separately on each listing, and applicable platform charges are shown before payment.</p></section>
    <div class="se-pricing-grid">
      <article class="se-plan-card"><div class="se-plan-icon">↗</div><h3>Free</h3><div class="se-plan-price">₹0 <small>/ month</small></div><p class="se-plan-desc">A simple starting plan for eligible sellers.</p><ul class="se-plan-features"><li><i>✓</i>20% platform commission</li><li><i>✓</i>Start without a monthly subscription</li><li><i>✓</i>Digital product marketplace access</li><li><i>✓</i>Seller product and order tools</li><li><i>✓</i>Standard seller support</li></ul></article>
      <article class="se-plan-card popular"><span class="se-plan-badge">MOST POPULAR</span><div class="se-plan-icon">♛</div><h3>Premium</h3><div class="se-plan-price">₹999 <small>/ month</small></div><p class="se-plan-desc">More suitable for sellers who need a lower platform commission.</p><ul class="se-plan-features"><li><i>✓</i>15% platform commission</li><li><i>✓</i>Premium seller tools</li><li><i>✓</i>Higher selling flexibility than Free</li><li><i>✓</i>Seller product and order management</li><li><i>✓</i>Premium plan support features</li></ul><div class="se-plan-note">Annual or other billing options apply only if shown in your account.</div></article>
      <article class="se-plan-card"><div class="se-plan-icon">⬡</div><h3>Enterprise</h3><div class="se-plan-price">₹1,999 <small>/ month</small></div><p class="se-plan-desc">For eligible sellers who need the lowest current platform commission tier.</p><ul class="se-plan-features"><li><i>✓</i>10% platform commission</li><li><i>✓</i>Enterprise seller tools</li><li><i>✓</i>Advanced marketplace controls where available</li><li><i>✓</i>Seller product and order management</li><li><i>✓</i>Enterprise plan support features</li></ul></article>
    </div>
    <div class="se-pricing-foot"><b>Important:</b> Sale Earn does not add a separate buyer platform/payment fee according to the current pricing setup. Product prices, subscription charges and applicable seller commission are shown by the platform before the relevant transaction.</div>
   </div>
  `},
  faq:{title:'Frequently Asked Questions',intro:'Find clear answers about buying, selling, digital delivery, payments, refunds and seller responsibilities on Sale Earn.',body:`
   <div class="se-faq-page">
    <section class="se-faq-hero">
      <span class="eyebrow">SUPPORT CENTER</span>
      <h2>How can we <span>help you?</span></h2>
      <p>Find answers to common questions about buying and selling digital products on Sale Earn.</p>
      <div class="se-faq-search"><span>⌕</span><input id="faqSearch" placeholder="Search for answers..." oninput="filterSaleEarnFaq(this.value)"></div>
    </section>
    <div class="se-faq-layout">
      <aside class="se-faq-side">
        <h4>Help Categories</h4>
        <a onclick="document.getElementById('buyerFaq')?.scrollIntoView({behavior:'smooth'})">🛒 Buyer FAQ</a>
        <a onclick="document.getElementById('sellerFaq')?.scrollIntoView({behavior:'smooth'})">♙ Seller FAQ</a>
        <div class="se-faq-support"><b>Secure Platform</b><span>Use the marketplace safely and never share passwords, OTPs, card PINs or UPI PINs in support messages.</span><button onclick="go('policy/contact')">Contact Support</button></div>
      </aside>
      <section>
       <div class="se-faq-group" id="buyerFaq"><h3 class="se-faq-heading"><span>🛒</span>Buyer Frequently Asked Questions</h3>
        <details class="se-faq-item"><summary>How will I receive my digital product?</summary><div class="se-faq-answer">After a successfully verified payment, the order page provides the available online delivery or access information supplied for that product.</div></details>
        <details class="se-faq-item"><summary>Is payment secure on Sale Earn?</summary><div class="se-faq-answer">Checkout is handled through the payment provider configured for Sale Earn. Never share an OTP, password, card PIN, CVV or UPI PIN with support.</div></details>
        <details class="se-faq-item"><summary>Can I download the product multiple times?</summary><div class="se-faq-answer">Download or access limits depend on the product and its delivery method. Check the product description or contact support if the delivered access does not work as expected.</div></details>
        <details class="se-faq-item"><summary>Do I need software to open the files?</summary><div class="se-faq-answer">Some digital files may require compatible software or an app. Sellers should describe important requirements on the product listing.</div></details>
        <details class="se-faq-item"><summary>Can I get a refund?</summary><div class="se-faq-answer">Successful digital-product purchases are normally non-refundable. Payment errors such as duplicate or incorrect transaction status can be reviewed by support.</div></details>
        <details class="se-faq-item"><summary>What if my download link is not working?</summary><div class="se-faq-answer">Use the Report Delivery Issue option or contact support with your order ID and registered email so the delivery status can be reviewed.</div></details>
        <details class="se-faq-item"><summary>Are products original?</summary><div class="se-faq-answer">Sellers must have the necessary rights or permissions for products they list. Unauthorized copyrighted material and other prohibited products are not allowed.</div></details>
        <details class="se-faq-item"><summary>Can I resell products?</summary><div class="se-faq-answer">Only if the seller explicitly grants resale or redistribution rights. A purchase does not automatically give resale rights.</div></details>
        <details class="se-faq-item"><summary>Do I need an account to buy?</summary><div class="se-faq-answer">Account requirements can depend on the marketplace flow. If an account is required at checkout, follow the sign-in or account creation step shown on the website.</div></details>
        <details class="se-faq-item"><summary>How fast is delivery?</summary><div class="se-faq-answer">Sale Earn is a digital-only marketplace, so eligible delivery information is provided online after successful payment verification. Actual access depends on the product listing and delivery setup.</div></details>
        <details class="se-faq-item"><summary>Can I contact the seller before buying?</summary><div class="se-faq-answer">Use the seller/store contact information or marketplace support options that are available on the relevant listing. Do not share sensitive payment credentials.</div></details>
        <details class="se-faq-item"><summary>What file types are provided?</summary><div class="se-faq-answer">File types vary by product. Sellers should describe included files and important requirements accurately in the listing.</div></details>
        <details class="se-faq-item"><summary>Can I access products on mobile?</summary><div class="se-faq-answer">Many digital products can be accessed on compatible mobile devices, but compatibility depends on the product and its required software.</div></details>
        <details class="se-faq-item"><summary>What if a seller leaves the platform?</summary><div class="se-faq-answer">Keep your order information and contact support if you lose access to a purchased product. Sale Earn can review the order and delivery status.</div></details>
       </div>
       <div class="se-faq-group" id="sellerFaq"><h3 class="se-faq-heading"><span>♙</span>Seller Frequently Asked Questions</h3>
        <details class="se-faq-item"><summary>How do I start selling on Sale Earn?</summary><div class="se-faq-answer">Use Become a Seller / Vendor Portal and complete the seller onboarding steps shown by the platform. Sellers must meet the published eligibility and verification requirements.</div></details>
        <details class="se-faq-item"><summary>What types of products can I sell?</summary><div class="se-faq-answer">Sale Earn is a digital-products marketplace. Examples include creator assets, reel content packs, courses, templates and other eligible digital products that comply with marketplace rules.</div></details>
        <details class="se-faq-item"><summary>How do I upload product files?</summary><div class="se-faq-answer">Use the Vendor Portal product upload flow. Delivery information must use a supported trusted HTTPS provider and sellers must confirm they have the required rights.</div></details>
        <details class="se-faq-item"><summary>How will I get paid?</summary><div class="se-faq-answer">Eligible seller earnings move through the platform's payout workflow. A payout request can be reviewed before it is successfully processed.</div></details>
        <details class="se-faq-item"><summary>Does Sale Earn charge commission?</summary><div class="se-faq-answer">Yes. Current seller plan settings are Free: 20% commission, Premium: 15%, and Enterprise: 10%. Applicable settings shown by the platform control future eligible transactions.</div></details>
        <details class="se-faq-item"><summary>Can I promote my product outside Sale Earn?</summary><div class="se-faq-answer">Yes, sellers can bring their own traffic as long as their promotion is lawful, accurate and does not involve spam, deceptive claims or prohibited activity.</div></details>
        <details class="se-faq-item"><summary>Can I update my product after publishing?</summary><div class="se-faq-answer">Product updates can be made through the seller tools when available. Changes should remain accurate and compliant; updated listings may be reviewed again.</div></details>
        <details class="se-faq-item"><summary>What if a customer requests a refund?</summary><div class="se-faq-answer">Sale Earn normally does not refund successful digital-product purchases. Payment errors or exceptional issues can be reviewed through support under the published policy.</div></details>
        <details class="se-faq-item"><summary>Can I sell resale-rights products?</summary><div class="se-faq-answer">Only where the seller has valid rights to distribute them and the listing clearly states the permitted licence or resale rights. Unauthorized copyrighted content is not allowed.</div></details>
        <details class="se-faq-item"><summary>How do I increase my sales?</summary><div class="se-faq-answer">Use accurate titles, useful descriptions, clear previews, appropriate pricing and reliable delivery information. Do not make misleading or guaranteed-income claims.</div></details>
        <details class="se-faq-item"><summary>Will Sale Earn promote my products?</summary><div class="se-faq-answer">Marketplace discovery may make eligible products visible to buyers, but no specific promotion or sales volume is guaranteed unless an applicable platform feature explicitly says so.</div></details>
        <details class="se-faq-item"><summary>Can I sell internationally?</summary><div class="se-faq-answer">International availability depends on the payment provider, applicable laws, seller eligibility and platform configuration. Do not assume every product or seller is eligible internationally.</div></details>
        <details class="se-faq-item"><summary>What if my product violates policy?</summary><div class="se-faq-answer">A listing may be flagged, kept pending, rejected, hidden or removed. Serious or repeated violations can also lead to seller account restrictions or termination.</div></details>
        <details class="se-faq-item"><summary>Can I create my own brand page?</summary><div class="se-faq-answer">Eligible sellers can use their seller storefront and available store settings to present their marketplace presence, subject to the platform's current features and rules.</div></details>
       </div>
       <div id="faqEmpty" class="se-faq-empty">No matching questions found.</div>
      </section>
    </div>
   </div>
  `},
  sitemap:{title:'Sitemap',intro:'A simple map of Sale Earn pages and marketplace areas so buyers and sellers can find the right section quickly.',body:`
   <div class="se-sitemap-page">
    <section class="se-sitemap-hero"><span class="eyebrow">SITE MAP</span><h2>Explore <span>Sale Earn</span></h2><p>Browse public marketplace, account, seller and information pages from one place.</p></section>
    <div class="se-sitemap-grid">
      <div class="se-sitemap-card"><h3>Marketplace</h3><a onclick="go('home')">Home</a><a onclick="go('market')">Marketplace / Explore</a><a onclick="go('cart')">Shopping Cart</a></div>
      <div class="se-sitemap-card"><h3>Account</h3><a onclick="go('account')">My Account</a><a onclick="go('account/orders')">My Orders</a><a onclick="go('account/library')">My Library</a></div>
      <div class="se-sitemap-card"><h3>For Sellers</h3><a onclick="window.startSelling()">Become a Seller</a><a onclick="go('dashboard/products')">My Products</a><a onclick="go('dashboard/orders')">Seller Orders</a><a onclick="go('dashboard/subscription')">Seller Subscription</a></div>
      <div class="se-sitemap-card"><h3>Help & Support</h3><a onclick="go('policy/faq')">Frequently Asked Questions</a><a onclick="go('policy/contact')">Contact Us</a><a onclick="go('policy/shipping')">Shipping & Delivery</a><a onclick="go('policy/refund')">Cancellation & Refund</a></div>
      <div class="se-sitemap-card"><h3>Seller Information</h3><a onclick="go('policy/sellerGuidelines')">Seller Guidelines</a><a onclick="go('policy/sellerPayouts')">Seller Payout Policy</a><a onclick="go('policy/pricing')">Pricing</a><a onclick="go('policy/prohibited')">Not Allowed Products</a></div>
      <div class="se-sitemap-card"><h3>Company & Legal</h3><a onclick="go('policy/about')">About Sale Earn</a><a onclick="go('policy/terms')">Terms & Conditions</a><a onclick="go('policy/privacy')">Privacy Policy</a><a onclick="go('policy/sitemap')">Sitemap</a></div>
    </div>
   </div>
  `},
  terms:{title:'Terms & Conditions',intro:'The rules that govern use of Sale Earn, its digital marketplace, seller tools and related services.',body:`
   <div class="se-legal-hero-note accent"><span class="se-legal-icon">✓</span><div><b>Using Sale Earn means you agree to these terms</b><p>Sale Earn is a digital-products marketplace where eligible sellers can list products and customers can purchase eligible digital products. Use the platform lawfully and provide accurate information.</p></div></div>

   <div class="se-terms-grid">
    <div class="se-legal-section compact"><div class="se-legal-section-title"><span>01</span><h2>Acceptance of Terms</h2></div><p>By registering or using Sale Earn, you agree to these Terms & Conditions and applicable platform policies. If you do not agree, do not use the platform.</p></div>
    <div class="se-legal-section compact"><div class="se-legal-section-title"><span>02</span><h2>Platform Description</h2></div><p>Sale Earn provides marketplace tools for eligible sellers to list digital products and for buyers to discover and purchase eligible digital products.</p></div>
    <div class="se-legal-section compact"><div class="se-legal-section-title"><span>03</span><h2>User Accounts</h2></div><p>Users must provide accurate information and are responsible for keeping account credentials confidential and secure.</p></div>
    <div class="se-legal-section compact"><div class="se-legal-section-title"><span>04</span><h2>Seller Responsibilities</h2></div><p>Sellers must have the rights or permissions needed to distribute their products and must keep titles, images, descriptions, tags and delivery links accurate.</p></div>
    <div class="se-legal-section compact"><div class="se-legal-section-title"><span>05</span><h2>Commission & Fees</h2></div><p>Applicable seller commission and subscription prices are shown by the platform. Current seller plans use Free 20%, Premium 15% and Enterprise 10% commission, with subscription prices shown on the Pricing page.</p></div>
    <div class="se-legal-section compact"><div class="se-legal-section-title"><span>06</span><h2>Orders & Payments</h2></div><p>Buyers should review product details and the final payable amount before payment. Payment processing may be provided by a third-party payment provider.</p></div>
    <div class="se-legal-section compact"><div class="se-legal-section-title"><span>07</span><h2>Refund Policy</h2></div><p>Successful digital-product purchases are normally non-refundable. Payment errors and exceptional transaction issues may be reviewed under the published Cancellation & Refund Policy.</p></div>
    <div class="se-legal-section compact"><div class="se-legal-section-title"><span>08</span><h2>Prohibited Content</h2></div><p>Illegal, deceptive, fraudulent, unauthorized copyrighted, adult/explicit, gambling, weapon, drug-related, hacking/cracking and other prohibited products are not allowed.</p></div>
    <div class="se-legal-section compact"><div class="se-legal-section-title"><span>09</span><h2>Account Suspension</h2></div><p>Sale Earn may place listings under review, hide or remove products, restrict seller activity, or suspend/terminate accounts when necessary for safety, fraud prevention, compliance or platform protection.</p></div>
    <div class="se-legal-section compact"><div class="se-legal-section-title"><span>10</span><h2>Digital Delivery</h2></div><p>Sale Earn currently supports online digital delivery only. Physical shipping is not offered. Access depends on the product listing and its delivery setup.</p></div>
    <div class="se-legal-section compact"><div class="se-legal-section-title"><span>11</span><h2>Intellectual Property</h2></div><p>Sale Earn branding and platform materials belong to their respective owners. Purchased products remain subject to the licence or usage rights stated by the seller.</p></div>
    <div class="se-legal-section compact"><div class="se-legal-section-title"><span>12</span><h2>Changes to Terms</h2></div><p>These terms may be updated when the platform, services or applicable requirements change. The current published version applies to future use.</p></div>
   </div>

   <div class="se-legal-dark-contact"><span>✉</span><h3>Contact Support</h3><p>For questions about these Terms & Conditions, contact Sale Earn support.</p><b>mohitghasoliya90014@gmail.com</b></div>
  `},
  privacy:{title:'Privacy Policy',intro:'How Sale Earn collects, uses and protects information needed to operate its digital marketplace.',body:`
   <div class="se-legal-hero-note"><span class="se-legal-icon">◉</span><div><b>Your privacy matters</b><p>This policy explains the types of information Sale Earn may handle when you browse the marketplace, create an account, purchase a product, sell products or contact support.</p></div></div>

   <div class="se-legal-section">
    <div class="se-legal-section-title"><span>01</span><h2>Information We Collect</h2></div>
    <div class="se-info-list">
      <div><b>Personal information</b><p>Name, email address and optional phone information where provided.</p></div>
      <div><b>Account information</b><p>Login/account details, seller profile information and store details for sellers.</p></div>
      <div><b>Order information</b><p>Orders, purchased products, transaction references and information needed to support delivery and account history.</p></div>
      <div><b>Usage & security information</b><p>Pages visited, products viewed, device/browser information and technical information that may be needed for security, fraud prevention and website operation.</p></div>
    </div>
   </div>

   <div class="se-legal-section">
    <div class="se-legal-section-title"><span>02</span><h2>How We Use Your Information</h2></div>
    <ul class="se-legal-bullets">
      <li>Create and manage user accounts.</li><li>Process orders and payment-related transaction status.</li><li>Provide digital delivery and access information.</li><li>Provide customer and seller support.</li><li>Improve website functionality and user experience.</li><li>Prevent fraud, abuse and policy violations.</li><li>Maintain platform security and operational records.</li>
    </ul>
   </div>

   <div class="se-info-columns">
    <div class="se-info-panel"><h3>Buyer Data Usage</h3><p>Buyer information may be used to process orders, provide product access, maintain purchase history, answer support requests and send important account/order updates.</p></div>
    <div class="se-info-panel"><h3>Seller Data Usage</h3><p>Seller information may be used for seller onboarding, verification where required, payout processing, product management, marketplace operations and trust/safety checks.</p></div>
   </div>

   <div class="se-legal-mini-grid">
    <div class="se-legal-mini"><span>03</span><div><h3>Payment Information</h3><p>Payment processing is handled through the payment provider configured for checkout. Sale Earn should not request or store card PINs, OTPs, passwords or similar payment credentials through support.</p></div></div>
    <div class="se-legal-mini"><span>04</span><div><h3>Data Sharing</h3><p>Information may be shared only where reasonably necessary for marketplace operation, payment processing, security, legal obligations or service providers supporting the platform.</p></div></div>
    <div class="se-legal-mini"><span>05</span><div><h3>Cookies & Tracking</h3><p>Cookies or similar technologies may be used for functionality, preferences, login/session handling, security and applicable analytics. Browser settings can restrict cookies, although some features may stop working correctly.</p></div></div>
    <div class="se-legal-mini"><span>06</span><div><h3>Data Security</h3><p>Reasonable technical and organisational measures are used to protect information. No online system can be guaranteed to be completely secure.</p></div></div>
    <div class="se-legal-mini"><span>07</span><div><h3>Data Retention</h3><p>Information may be retained for as long as reasonably necessary for account operation, transaction records, security, disputes or applicable legal/compliance requirements.</p></div></div>
    <div class="se-legal-mini"><span>08</span><div><h3>Your Choices</h3><p>You can contact support with privacy questions or requests about your account information. Some records may need to remain available for security, transaction or legal reasons.</p></div></div>
    <div class="se-legal-mini"><span>09</span><div><h3>Third-Party Services</h3><p>Sale Earn may link to or use third-party services such as payment or delivery providers. Their own terms and privacy practices may also apply.</p></div></div>
    <div class="se-legal-mini"><span>10</span><div><h3>Policy Updates</h3><p>This Privacy Policy may be updated when the website, services or applicable requirements change. The latest version will be published on this page.</p></div></div>
   </div>

   <div class="se-legal-dark-contact"><span>✉</span><h3>Privacy Questions?</h3><p>Contact Sale Earn for privacy-related questions or account information requests.</p><b>mohitghasoliya90014@gmail.com</b></div>
  `},
  refund:{title:'Cancellation & Refund Policy',intro:'A clear policy for digital purchases, payment issues and support reviews on Sale Earn.',body:`
   <div class="se-legal-hero-note"><span class="se-legal-icon">↩</span><div><b>Digital products are different from physical goods</b><p>Sale Earn is a digital-only marketplace. Because digital products can be accessed online after successful payment, completed purchases are normally non-refundable.</p></div></div>

   <div class="se-legal-section">
    <div class="se-legal-section-title"><span>01</span><h2>Digital Product Nature</h2></div>
    <p>Products listed on Sale Earn are digital products such as creator assets, reel content packs, courses, templates and other eligible digital resources. Once a digital product is successfully delivered or made accessible, it cannot be physically returned.</p>
   </div>

   <div class="se-legal-section">
    <div class="se-legal-section-title"><span>02</span><h2>General Refund Rule</h2></div>
    <p>After a successful and verified purchase, Sale Earn normally does not provide a refund. Buyers should review the product description, included content, compatibility information and final payable amount before confirming payment.</p>
   </div>

   <div class="se-refund-columns">
    <div class="se-refund-box positive"><h3>✓ When Support May Review</h3><ul>
      <li>Duplicate payment or the same transaction appears to have been charged twice.</li>
      <li>Payment status is incorrect or a payment-processing error needs investigation.</li>
      <li>An order was marked incorrectly because of a platform/payment error.</li>
      <li>Another exceptional transaction issue is supported by the available payment/order records.</li>
    </ul></div>
    <div class="se-refund-box negative"><h3>× When a Refund Is Normally Not Given</h3><ul>
      <li>Buyer changed their mind after completing the purchase.</li>
      <li>Buyer purchased by mistake and the transaction was successfully completed.</li>
      <li>Buyer does not like the product or expected different results.</li>
      <li>Buyer has already received or accessed the digital product.</li>
      <li>The product description or requirements were not reviewed before purchase.</li>
    </ul></div>
   </div>

   <div class="se-legal-mini-grid">
    <div class="se-legal-mini"><span>03</span><div><h3>Payment Errors</h3><p>If you believe a duplicate or incorrect payment occurred, contact support with the order/payment reference. The transaction can be checked against available records.</p></div></div>
    <div class="se-legal-mini"><span>04</span><div><h3>Paid Platform Services</h3><p>Subscriptions, advertising, message packs and other paid platform services are normally non-refundable after successful activation or consumption, subject to correction of genuine platform/payment errors or applicable law.</p></div></div>
    <div class="se-legal-mini"><span>05</span><div><h3>Seller Responsibility</h3><p>Sellers must provide accurate product information and working delivery access. Policy or product issues may be reviewed through the platform's support and moderation process.</p></div></div>
    <div class="se-legal-mini"><span>06</span><div><h3>Support Review</h3><p>Refund-related decisions depend on the transaction details, applicable policy and available evidence. A support review does not guarantee a refund.</p></div></div>
   </div>

   <div class="se-legal-contact-card"><div><span class="se-legal-contact-icon">✉</span><h3>Contact Support</h3><p>For payment-status or transaction issues, contact Sale Earn support with your registered email and order/payment reference.</p><b>mohitghasoliya90014@gmail.com</b><small>Support hours: Daily, 3–6 PM IST · Phone: 8875088657</small></div><div class="se-legal-dark-note"><b>Fair-use reminder</b><p>Never send your OTP, password, UPI PIN, CVV or full card number in a support message.</p></div></div>
  `},
  shipping:{title:'Shipping & Delivery Policy',intro:`${brand} is a digital-only marketplace. Physical shipping and courier delivery are not offered.`,body:`
   <div class="policy-card"><h2>Digital delivery only</h2><p>Sale Earn currently supports digital products only. There is no physical shipping, courier delivery or shipping charge for marketplace products.</p></div>
   <div class="policy-card"><h2>How digital delivery works</h2><p>After a successfully verified payment, access or delivery information is provided online according to the product listing and seller-provided delivery link. Products may use trusted HTTPS delivery providers supported by the marketplace.</p></div>
   <div class="policy-card"><h2>Delivery problems</h2><p>If a purchased digital product is not accessible after a successful payment, contact support with the order ID and registered email so the transaction and delivery status can be reviewed.</p></div>
  `},
 };
 const x=pages[kind]||pages.contact;
 const nav=[['about','About Sale Earn'],['contact','Contact Us'],['faq','FAQs'],['pricing','Pricing'],['sellerGuidelines','Seller Guidelines'],['sellerPayouts','Seller Payouts'],['prohibited','Not Allowed'],['terms','Terms & Conditions'],['privacy','Privacy Policy'],['refund','Cancellation & Refund'],['shipping','Shipping & Delivery'],['sitemap','Sitemap']];
 return `${header()}<main class="page policy-page"><div class="container"><div class="policy-mobile-bar"><button class="policy-menu-btn" onclick="togglePolicySidebar(true)" aria-label="Open policy menu"><span>☰</span> Menu</button><div class="policy-mobile-title">${x.title}</div><button class="policy-mobile-close" onclick="togglePolicySidebar(false)" aria-label="Close policy menu">✕</button></div><div class="policy-sidebar-backdrop" onclick="togglePolicySidebar(false)" aria-hidden="true"></div><div class="policy-layout"><aside class="policy-sidebar" id="policySidebar"><div class="policy-sidebar-head"><span class="policy-sidebar-icon">SE</span><div><b>Website Information</b><small>Sale Earn Policies</small></div><button class="policy-mobile-close" onclick="togglePolicySidebar(false)" aria-label="Close menu">✕</button></div><div class="policy-sidebar-list">${nav.map(([id,label])=>`<button class="policy-side-link ${id===kind?'active':''}" onclick="go('policy/${id}');togglePolicySidebar(false)"><span>${({about:'ⓘ',contact:'✉',faq:'?',pricing:'₹',sellerGuidelines:'✓',sellerPayouts:'⇧',prohibited:'!',terms:'▣',privacy:'◉',refund:'↩',shipping:'▱',sitemap:'☷'})[id]||'•'}</span><b>${label}</b>${id===kind?'<i>›</i>':''}</button>`).join('')}</div><div class="policy-sidebar-foot"><span>Need help?</span><button onclick="go('policy/contact');togglePolicySidebar(false)">Contact Support</button></div></aside><section class="policy-main"><div class="policy-hero"><span class="policy-kicker">Sale Earn · Website Information</span><h1>${x.title}</h1><p>${x.intro}</p><div class="policy-updated">Last updated: ${new Date().toLocaleDateString('en-IN')}</div></div><div class="policy-content">${x.body}</div></section></div></div></main>${footer()}`;
}

function footer(){return `<footer class="footer"><div class="container footer-grid">
 <div class="footer-brand"><div class="logo"><span class="logo-mark">SE</span><span>${esc(siteName())}</span></div><p class="footer-description">A creator-first digital marketplace for products, bundles and useful assets.</p></div>
 <div class="footer-col"><b>Explore</b><a onclick="go('market')">Marketplace</a><a onclick="go('home')">Home</a><a onclick="go('cart')">Cart</a></div>
 <div class="footer-col"><b>Sell</b><a onclick="window.startSelling()">Vendor Portal</a><a onclick="go('dashboard/products')">My Products</a><a onclick="go('dashboard/orders')">Orders</a></div>
 <div class="footer-col"><b>Sellers & Legal</b><a onclick="window.startSelling()">Become a Seller</a><a onclick="go('policy/sellerGuidelines')">Seller Guidelines</a><a onclick="go('policy/terms')">Terms & Conditions</a><a onclick="go('policy/privacy')">Privacy Policy</a><a onclick="go('policy/refund')">Refund Policy</a></div>
 <div class="footer-col"><b>Support</b><a onclick="go('policy/contact')">Contact Us</a><a onclick="go('policy/faq')">FAQs</a><a onclick="go('policy/pricing')">Pricing</a><a onclick="go('policy/about')">About Sale Earn</a><a onclick="go('policy/prohibited')">Not Allowed</a><a onclick="go('policy/shipping')">Shipping & Delivery</a><a onclick="go('policy/sitemap')">Sitemap</a><a href="https://t.me/nextidea66" target="_blank" rel="noopener">Telegram</a><a onclick="go('account')">My Account</a></div>
 </div></footer>`}
function ensureStoreForUser(){
 if(!S.currentUser)return null;
 if(!Number.isFinite(Number(S.currentUser.score)))S.currentUser.score=70;
 S.currentUser.score=clampSellerScore(S.currentUser.score);
 if(!S.sellers || typeof S.sellers!=="object" || Array.isArray(S.sellers)) S.sellers={};
 let sid=S.currentUser.sellerId;
 let store=sid?S.sellers[sid]:null;
 if(!sid || !store){
  sid=sid||uid("seller");
  S.currentUser.sellerId=sid;
  store=store||{
   id:sid,
   name:(S.currentUser.name||"User")+"'s Store",
   owner:S.currentUser.name||"User",
   followers:0,
   logo:"",
   storeId:sid,
   bio:"Welcome to my Sale Earn store.",
   plan:"FREE",
   upi:"",
   score:S.currentUser.score
  };
  store.id=store.id||sid;
  store.owner=store.owner||S.currentUser.name||"User";
  store.name=store.name||((S.currentUser.name||"User")+"'s Store");
  store.followers=Number(store.followers||0);
  store.plan=store.plan||"FREE";
  store.score=getSellerScore(sid);
  S.sellers[sid]=store;
  save();
 }
 return store;
}
function startSelling(){
 try{
  if(controlOff('newSellerRegistration')&&!S.currentUser){toast('New registrations are temporarily disabled by Admin');return false;}
  if(!S.currentUser){
   openAuth("signin","seller");
   return false;
  }
  ensureStoreForUser();
  const target="dashboard/overview";
  const current=routeNow();
  if(current===target){render();return false;}
  go(target);
 }catch(err){
  console.error("Start Selling error:",err);
  toast(err?.message||"Start Selling could not open. Please try again.");
 }
 return false;
}
window.startSelling=startSelling;

/* -------------------- PRODUCT CARD / HOME -------------------- */
function hasPurchased(pid){return !!(S.currentUser&&S.orders.some(o=>o.customerId===S.currentUser.id&&o.productId===pid&&o.status==="SUCCESS"))}
function productCard(p){
 const s=publicSellerView(p.sellerId),saved=!!(S.currentUser&&S.saved?.some(x=>x.userId===S.currentUser.id&&x.productId===p.id)),purchased=hasPurchased(p.id);
 return `<article class="product-card" onclick="go('product/${p.id}')">
  ${thumb(p)}
  <button class="plus" onclick="event.stopPropagation();addCart('${p.id}')">+</button>
  <button class="save-product ${saved?'saved':''}" title="${saved?'Remove from Saved':'Save product'}" onclick="event.stopPropagation();toggleSaved('${p.id}')">${saved?'♥':'♡'}</button>
  <div class="body"><div class="product-tags">${(p.tags||[]).slice(0,2).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
   <h3>${esc(p.title)}</h3><div><span class="price">${money(p.price)}</span>${p.oldPrice?`<span class="old">${money(p.oldPrice)}</span>`:""}</div><div class="seller-product-meta"><span class="seller-sales">Sales: ${productSales(p.id)}</span>${p.featured?`<span class="featured-badge">★ Featured</span>`:""}</div>
   <div class="seller-line" onclick="event.stopPropagation();go('seller/${p.sellerId}')">${avatar(s)}<span>${esc(s.name)}</span></div>
   <div style="display:flex;gap:8px;margin-top:10px"><button class="btn ${purchased?'primary':''}" style="flex:1;padding:9px" onclick="event.stopPropagation();${purchased?`openPurchasedByProduct('${p.id}')`:`buyNow('${p.id}')`}">${purchased?'Check':'Buy'}</button></div>
  </div>
 </article>`
}
function activeAds(){const now=Date.now();return (S.ads||[]).filter(a=>{const end=new Date(a.endDate||0).getTime(),start=new Date(a.startDate||0).getTime(),p=product(a.productId);return a.status==="ACTIVE"&&["ONLINE","BALANCE","RAZORPAY_TEST"].includes(String(a.paymentSource||""))&&a.paymentStatus==="SUCCESS"&&a.paymentVerified===true&&!!p&&p.sellerId===a.sellerId&&start<=now&&end>now})}
function uniqueAdProducts(list){const seen=new Set();return (list||[]).filter(a=>{const id=String(a.productId||"");if(!id||seen.has(id))return false;seen.add(id);return true})}
function startAdFromHome(id){if(!S.currentUser){openAuth("signin","seller");return}if(!currentSeller()){toast("Seller dashboard access required");return}if(currentSeller().id!==product(id)?.sellerId){toast("Only the product owner can boost this product");return}go("dashboard/ads")}
function home(){
 const homepageAds=uniqueAdProducts(activeAds().filter(a=>String(a.placement||a.type||"").includes("Homepage")));
 const marketplaceAds=uniqueAdProducts(activeAds().filter(a=>String(a.placement||a.type||"").includes("Marketplace")));
 const premiumIds=new Set([...homepageAds,...marketplaceAds].map(a=>a.productId));
 const premium=studioVisibleProducts().filter(p=>premiumIds.has(p.id));
 const picks=[...premium,...studioVisibleProducts().filter(p=>!premiumIds.has(p.id))];
 const repeated=[...picks,...picks].slice(0,12);
 const heroShowcase=repeated.length?`<div class="hero-art"><div class="hero-kicker">THE ULTIMATE DIGITAL ECONOMY · PREMIUM PICKS</div><div class="hero-track">${repeated.map(p=>`<div class="pick-card" onclick="go('product/${p.id}')">${thumb(p)}<div class="body"><h4>${esc(p.title)}</h4><span class="price">${money(p.price)}</span></div></div>`).join("")}</div></div>`:`<div class="hero-art hero-empty"><div class="hero-empty-mark">SE</div><div><div class="hero-kicker">CREATOR-FIRST MARKETPLACE</div><h3>Build, sell and discover digital products.</h3><p>Courses, creator bundles, editing assets and useful creator templates and digital assets in one calm workspace.</p></div><div class="hero-empty-tags"><span>Courses</span><span>Assets</span><span>Templates</span></div></div>`;
 const ads=homepageAds;
 const homeAdStrip=ads.length?`<div class="ad-strip home-ad-strip"><div class="ad-track">${ads.map(a=>{const p=product(a.productId);return `<div class="ad-card" onclick="go('product/${a.productId}')"><div class="ad-thumb">${p?.image?`<img src="${esc(p.image)}">`:"📣"}</div><div><b>${esc(a.title||p?.title||"Sponsored")}</b><div class="small" style="color:#aeb8cc">${esc(a.placement||"Homepage")}</div></div></div>`}).join("")}</div></div>`:"";
 const topProducts=[...premium].filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i).slice(0,10);
 const topRepeated=[...topProducts,...topProducts];
 return `${header()}
 <main class="page">
 ${homepageAds.length?`<section class="ad-premium"><div class="container"><div class="small" style="color:#bfc8dd;font-weight:900;margin-bottom:8px">ADVERTISEMENT · PREMIUM PRODUCTS</div></div><div class="ad-premium-track">${homepageAds.map(a=>{const p=product(a.productId);return p?`<div class="ad-premium-card" onclick="go('product/${p.id}')"><div class="ad-thumb">${p.image?`<img src="${esc(p.image)}">`:`<span>🧩</span>`}</div><div class="ad-info"><div class="small" style="color:#aeb8cc">Seller ID: <span style="color:#fff;cursor:pointer" onclick="event.stopPropagation();go('seller/${p.sellerId}')">@${esc(p.sellerId)}</span></div><b>${esc(p.title)}</b><div class="ad-price">${money(p.price)}</div></div><button class="ad-boost" onclick="event.stopPropagation();startAdFromHome('${p.id}')">Ad / Boost</button></div>`:""}).join("")}</div></section>`:""}
 <section id="home-hero" class="hero"><div class="container hero-grid">
  <div><div class="eyebrow">THE CREATOR MARKETPLACE</div><h1>${esc(ensurePlatformConfig().cms.heroTitle||"Turn your digital skills into products people want.")}</h1><p>${esc(ensurePlatformConfig().cms.heroSubtitle||"Discover ready-to-use creator assets, courses, reel content packs and templates — or launch your own store with Sale Earn.")}</p>
  <div class="hero-actions"><button class="btn primary" onclick="go('market')">Explore Marketplace →</button><button class="btn" onclick="window.startSelling()">Start Selling</button></div></div>
  ${heroShowcase}
 </div></section>
 <section id="home-categories" class="section"><div class="container"><div class="section-head"><div><h2>Browse by Category</h2><p>Open a category and explore its live subcategories.</p></div></div>
 <div class="category-grid">${["Courses","Reel Content Pack","Editing Assets","Templates"].map((c,i)=>`<button class="category-card" onclick="window.marketCategory='${c}';go('market')"><div class="cat-icon">${["🎓","🎬","✂️","💻"][i]}</div><h3>${c}</h3><p>Explore products and subcategories</p></button>`).join("")}</div></div></section>
 <section id="home-trending" class="section"><div class="container"><div class="section-head"><div><h2>Popular Creator Assets</h2><p>Useful products across the marketplace.</p></div></div><div class="grid">${studioVisibleProducts().slice(0,8).map(productCard).join("")}</div></div></section>
 </main>${footer()}`
}

/* -------------------- MARKET -------------------- */
function subcatsFor(cat){
 const source=(typeof studioVisibleProducts==='function'?studioVisibleProducts():[]);
 return [...new Set(source.filter(p=>!cat||p.category===cat).flatMap(p=>Array.isArray(p.tags)?p.tags:[]).map(t=>String(t||'').trim()).filter(Boolean))].slice(0,12)
}
function searchRelevanceScore(p,q){if(!q)return 0;const title=String(p.title||"").toLowerCase().trim(),category=String(p.category||"").toLowerCase(),tags=(p.tags||[]).map(x=>String(x).toLowerCase());const words=q.split(/\s+/).filter(Boolean);let score=0;if(title===q)score+=1000;if(title.startsWith(q))score+=650;if(title.includes(q))score+=450;for(const w of words){if(title.split(/\s+/).includes(w))score+=180;else if(title.includes(w))score+=100; if(category===w)score+=80;else if(category.includes(w))score+=40;if(tags.includes(w))score+=70;else if(tags.some(t=>t.includes(w)))score+=35}return score}
function sortMarketProducts(ps,q,boosted,marketplaceBoosted){return ps.sort((a,b)=>{if(q){const ar=searchRelevanceScore(a,q),br=searchRelevanceScore(b,q);if(br!==ar)return br-ar}const ab=Number(boosted.has(a.id))+Number(marketplaceBoosted.has(a.id)),bb=Number(boosted.has(b.id))+Number(marketplaceBoosted.has(b.id));if(bb!==ab)return bb-ab;return Number(b.createdAt||0)-Number(a.createdAt||0)})}
function updateMarketResults(){if(route()!=="market")return;const host=document.getElementById("marketResults");if(!host)return;const q=(window.marketSearch||"").toLowerCase().trim(),cat=window.marketCategory||"All",sub=window.marketSub||"All";let ps=studioVisibleProducts().filter(p=>(cat==="All"||p.category===cat)&&(sub==="All"||(p.tags||[]).includes(sub)));if(q)ps=ps.filter(p=>searchRelevanceScore(p,q)>0);const ads=activeAds(),boosted=new Set(ads.filter(a=>String(a.placement||"").includes("Search")).map(a=>a.productId)),marketplaceBoosted=new Set(ads.filter(a=>String(a.placement||"").includes("Marketplace")).map(a=>a.productId));sortMarketProducts(ps,q,boosted,marketplaceBoosted);host.innerHTML=ps.length?ps.map(productCard).join(""):"<div class=\"dash-card\"><h3>No products found</h3><p class=\"muted\">Try another category, subcategory or search term.</p></div>";const h=host.parentElement.querySelector('.section-head h2');if(h)h.textContent=ps.length+" Products"}
function market(){ if(controlOff('marketplaceFreeze'))return `${header()}<main class="page"><div class="container auth-box"><h2>Marketplace Temporarily Frozen</h2><p class="muted">Admin has temporarily paused marketplace activity. Please try again later.</p></div></main>${footer()}`;
 const q=(window.marketSearch||"").toLowerCase().trim(), cat=window.marketCategory||"All", sub=window.marketSub||"All";
 let ps=studioVisibleProducts().filter(p=>(cat==="All"||p.category===cat)&&(sub==="All"||(p.tags||[]).includes(sub)));
 const ads=activeAds(),boosted=new Set(ads.filter(a=>String(a.placement||"").includes("Search")).map(a=>a.productId)),marketplaceBoosted=new Set(ads.filter(a=>String(a.placement||"").includes("Marketplace")).map(a=>a.productId));
 if(q)ps=ps.filter(p=>searchRelevanceScore(p,q)>0);
 if(window.marketSort==="low")ps.sort((a,b)=>a.price-b.price); else if(window.marketSort==="high")ps.sort((a,b)=>b.price-a.price); else sortMarketProducts(ps,q,boosted,marketplaceBoosted);
 const marketplaceAds=uniqueAdProducts(ads.filter(a=>String(a.placement||a.type||"").includes("Marketplace")));
 const premiumIds=new Set(marketplaceAds.map(a=>a.productId));
 const premiumProducts=marketplaceAds.map(a=>product(a.productId)).filter(Boolean).filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i);
 const premiumRepeated=premiumProducts;
 const cats=["All","Courses","Reel Content Pack","Editing Assets","Templates"]; // Public category options are auth-independent.
 const catEmoji={'All':'🛍️','Courses':'🎓','Reel Content Pack':'🎬','Editing Assets':'✂️','Templates':'🧩','Games':'🎮'};
 return `${header()}<main class="page"><div class="container page-title"><h1>Marketplace</h1><p class="muted">Find your next digital product.</p></div>
 ${marketplaceAds.length?`<section class="ad-premium"><div class="container"><div class="small" style="color:#bfc8dd;font-weight:900;margin-bottom:8px">ADVERTISEMENT · MARKETPLACE PREMIUM</div></div><div class="ad-premium-track">${premiumRepeated.map(p=>`<div class="ad-premium-card" onclick="go('product/${p.id}')"><div class="ad-thumb">${p.image?`<img src="${esc(p.image)}">`:`<span>🧩</span>`}</div><div class="ad-info"><div class="small" style="color:#aeb8cc">Seller ID: <span style="color:#fff;cursor:pointer" onclick="event.stopPropagation();go('seller/${p.sellerId}')">@${esc(p.sellerId)}</span></div><b>${esc(p.title)}</b><div class="ad-price">${money(p.price)}</div></div><button class="ad-boost" onclick="event.stopPropagation();startAdFromHome('${p.id}')">Ad / Boost</button></div>`).join("")}</div></section>`:""}
 <div class="container market-layout"><aside class="sidebar-filter"><h4>Categories</h4>${cats.map(c=>`<button class="filter-cat ${cat===c?"active":""}" onclick="window.marketCategory='${c}';window.marketSub='All';render()"><span><span class="category-filter-icon">${catEmoji[c]||''}</span>${c}</span></button>${c!=="All"&&cat===c?`<div class="subcats"><button class="${sub==="All"?"active":""}" onclick="event.stopPropagation();window.marketSub='All';render()">All ${c}</button>${subcatsFor(c).map(t=>`<button class="${sub===t?"active":""}" onclick="event.stopPropagation();window.marketSub='${esc(t)}';render()"># ${esc(t)}</button>`).join("")}</div>`:""}`).join("")}</aside>
 <section><div class="market-tools"><div class="searchbox"><input value="${esc(window.marketSearch||"")}" oninput="window.marketSearch=this.value;updateMarketResults()" placeholder="Search by product, category or tag"></div><select class="btn" onchange="window.marketSort=this.value;render()"><option value="new" ${window.marketSort!=="low"&&window.marketSort!=="high"?"selected":""}>Newest</option><option value="low" ${window.marketSort==="low"?"selected":""}>Price: Low</option><option value="high" ${window.marketSort==="high"?"selected":""}>Price: High</option></select><div class="view-toggle"><button class="${window.marketView!=="list"?"active":""}" onclick="window.marketView='grid';render()" aria-label="Grid view">Grid</button><button class="${window.marketView==='list'?"active":""}" onclick="window.marketView='list';render()" aria-label="List view">List</button></div></div>
 <div class="section-head"><div><h2>${ps.length} Products</h2><p>${cat}${sub!=="All"?" · "+sub:""}</p></div></div>
 <div id="marketResults" class="grid ${window.marketView==='list'?"list-view":""}">${ps.length?ps.map(productCard).join(""):`<div class="dash-card"><h3>No products found</h3><p class="muted">Try another category, subcategory or search term.</p></div>`}</div></section></div></main>${footer()}`
}

/* -------------------- DETAIL / FBT / FAQ / REVIEWS -------------------- */
function addCart(id){
 const p=product(id); if(!p)return;
 if(S.cart.includes(id)){toast("Already in cart");showCartNotice(p,true);return}
 S.cart.push(id);save();render();showCartNotice(p,false)
}
function showCartNotice(p,already=false){
 document.querySelectorAll('.cart-notice').forEach(x=>x.remove());
 const n=document.createElement('div');n.className='cart-notice';
 n.innerHTML=`${p.image?`<img src="${esc(p.image)}" alt="">`:`<div style="width:62px;height:62px;border-radius:14px;background:var(--surface2);display:grid;place-items:center;font-size:24px">🧩</div>`}<div class="notice-body"><div class="notice-title">${esc(p.title)}</div><div class="notice-meta">@${esc(p.sellerId)} · ${money(p.price)} · ${already?'Already in cart':'Added to cart'}</div><div class="notice-actions"><button class="btn primary" onclick="go('cart');this.closest('.cart-notice')?.remove()">View Cart</button><button class="btn" onclick="buyNow('${p.id}');this.closest('.cart-notice')?.remove()">Buy Now</button></div></div><button class="btn iconbtn" style="align-self:flex-start" onclick="this.closest('.cart-notice')?.remove()">×</button>`;
 document.body.appendChild(n);const c=document.querySelector('.cart-btn');if(c){c.classList.remove('cart-pulse');void c.offsetWidth;c.classList.add('cart-pulse')}
 setTimeout(()=>n.remove(),6500)
}
function removeCart(id){S.cart=S.cart.filter(x=>x!==id);save();render()}
function buyNow(id){const p=product(id);if(!p)return;if(hasPurchased(id)){openPurchasedByProduct(id);return}if(!S.currentUser){openGuestBuyer(id);return}openBuy(id)}
function openGuestBuyer(id){const p=product(id);if(!p)return;window.pendingGuestProduct=id;document.getElementById("modalRoot").innerHTML=`<div class="modal-bg"><div class="modal auth-box"><button class="btn iconbtn close" onclick="closeModal()">×</button><h2>Buy Product</h2><p class="muted">No account is required. Enter your name and Gmail/email to continue to checkout.</p><div class="field"><label>Name</label><input id="guestBuyName" placeholder="Your name" autocomplete="name"></div><div class="field"><label>Gmail / Email</label><input id="guestBuyEmail" type="email" placeholder="you@example.com" autocomplete="email"></div><div class="hero-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="continueGuestBuy()">Continue to Buy</button></div></div></div>`}
function guestBuyerId(email){let h=0;for(let i=0;i<email.length;i++)h=((h<<5)-h)+email.charCodeAt(i)|0;return 'GUEST-'+Math.abs(h).toString(36).toUpperCase()}
function continueGuestBuy(){const id=window.pendingGuestProduct,name=(document.getElementById("guestBuyName")?.value||"").trim(),email=(document.getElementById("guestBuyEmail")?.value||"").trim().toLowerCase();if(!name||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){alert("Please enter your name and a valid email address.");return}closeModal();window.pendingGuestProduct=null;window.pendingBuy={id,name,userId:guestBuyerId(email),email,guest:true,couponId:'',couponCode:'',discount:0,couponServerValidated:false};openBuy(id)}
function openPurchasedByProduct(id){const o=S.orders.find(x=>x.customerId===S.currentUser?.id&&x.productId===id&&x.status==="SUCCESS");if(o)openPurchasedAsset(o.id);else toast("Purchase not found")}
function openBuy(id){
 const p=product(id); if(!p)return;
 window.pendingBuy={...(window.pendingBuy||{}),id};
 const guest=!!window.pendingBuy?.guest;
 const name=guest?(window.pendingBuy?.name||""):(S.currentUser?.name||"");
 const userId=guest?(window.pendingBuy?.userId||""):(S.currentUser?.id||"");
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal"><button type="button" class="btn iconbtn close" aria-label="Close" title="Close" onclick="closeModal()">×</button><h2>Buy ${esc(p.title)}</h2><p class="muted">${guest?"Guest checkout — sign in is not required.":"Your verified account is used for this purchase."}</p>
 <div class="form-grid"><div class="field"><label>Name</label><input id="buyName" value="${esc(name)}" readonly></div><div class="field"><label>Email</label><input id="buyEmail" value="${esc(guest?(window.pendingBuy?.email||""):(S.currentUser?.email||""))}" readonly></div>${!guest?`<div class="field"><label>User ID</label><input id="buyUserId" value="${esc(userId)}" readonly></div>`:""}</div><div class="field"><label>Coupon Code (optional)</label><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="buyCoupon" placeholder="Enter coupon" value="${esc(window.pendingBuy?.couponCode||'')}" style="flex:1;min-width:180px"><button class="btn" onclick="applyCheckoutCoupon()">Apply</button><button class="btn" type="button" onclick="cancelCheckoutCoupon()">Cancel</button></div><div class="small muted">Enter your coupon and tap Apply. Coupon is verified on the secure checkout server.</div></div>
 <div class="payment-total" style="display:flex;justify-content:space-between;font-weight:800;margin:16px 0 4px"><span>Amount to pay</span><span>${money(Number(window.pendingBuy?.amount??p.price))}</span></div>${window.pendingBuy?.discount?`<div class="small muted" style="margin:0 0 10px">Coupon discount applied: -${money(window.pendingBuy.discount)}</div>`:""}
 <div class="small muted" style="margin:6px 0 4px;line-height:1.5">By continuing, you confirm that you have reviewed the <a href="#policy/terms" onclick="event.preventDefault();go('policy/terms')">Terms &amp; Conditions</a>, <a href="#policy/refund" onclick="event.preventDefault();go('policy/refund')">Cancellation &amp; Refund Policy</a> and <a href="#policy/shipping" onclick="event.preventDefault();go('policy/shipping')">Digital Delivery Policy</a>.</div>
 <div class="modal-footer"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="continuePayment('${id}')">Pay ${money(Number(window.pendingBuy?.amount??p.price))} with Cashfree</button></div></div></div>`
}
function continuePayment(id){
 if(!window.payMethod || !(ensurePlatformConfig().payment?.methods||[]).includes(window.payMethod)){
   window.payMethod = (ensurePlatformConfig().payment?.methods||[])[0] || 'UPI';
 }
 if(window.pendingBuy?.guest){const n=(window.pendingBuy.name||document.getElementById("buyName")?.value||"").trim(),e=(window.pendingBuy.email||document.getElementById("buyEmail")?.value||"").trim().toLowerCase();if(!n||!e){toast("Name and email are required");return}window.pendingBuy={...window.pendingBuy,id,name:n,email:e,userId:guestBuyerId(e),guest:true};testPay();return}
 const n=S.currentUser?.name?.trim(),e=S.currentUser?.email?.trim();
 if(!n||!e){toast("Verified account details are required");return}
 window.pendingBuy={...window.pendingBuy,id,name:n,email:e,userId:S.currentUser.id};testPay()
}
function cancelPayment(expired=false){
 clearInterval(window.paymentTimer);const p=product(window.pendingBuy?.id);const oid=uid("ord");
 if(p&&S.currentUser){S.orders.unshift({id:oid,productId:p.id,sellerId:p.sellerId,customerId:S.currentUser.id,customerName:window.pendingBuy.name,customerEmail:window.pendingBuy.email,amount:p.price,status:"CANCELLED",method:"Cashfree",date:nowISO(),reason:expired?"Payment timer expired":"Payment cancelled"});save()}
 closeModal();go("cancelled/"+(oid||"none"))
}
/* -------------------- FAKE GATEWAY VERIFICATION (PROTOTYPE ONLY) -------------------- */
// Production rule: only a trusted server/webhook must mark a real transaction verified. Client-side fake gateway is for testing UI/state flow only.
function fakeGatewayCreate(kind,amount,meta={}){
 const id=uid("gw"); const u=meta?.customerId||meta?.sellerId||S.currentUser?.id||window.pendingBuy?.userId||currentSeller()?.id||null;
 S.gatewayPayments=S.gatewayPayments||[];
 const tx={id,kind,amount:Number(amount||0),userId:u,status:"PENDING",verified:false,createdAt:nowISO(),meta:JSON.parse(JSON.stringify(meta||{}))};
 S.gatewayPayments.unshift(tx); save(); return tx;
}
function fakeGatewayMarkSuccess(id){
 S.gatewayPayments=S.gatewayPayments||[];
 const tx=S.gatewayPayments.find(x=>x.id===id);
 if(!tx||tx.status!=="PENDING"||tx.verified)return false;
 tx.status="SUCCESS";tx.gatewaySuccessAt=nowISO();save();return true;
}
function fakeGatewayVerify(id,expected={}){
 S.gatewayPayments=S.gatewayPayments||[];
 const tx=S.gatewayPayments.find(x=>x.id===id);
 if(!tx||tx.status!=="SUCCESS"||tx.verified)return false;
 if(expected.userId!=null && tx.userId!==expected.userId)return false;
 if(expected.amount!=null && Math.abs(Number(tx.amount)-Number(expected.amount))>0.000001)return false;
 if(expected.kind && tx.kind!==expected.kind)return false;
 if(expected.recipient && tx.meta?.recipient!==expected.recipient)return false;
 if(expected.refId && tx.meta?.refId!==expected.refId)return false;
 if(expected.recipientUpi && tx.meta?.recipientUpi!==expected.recipientUpi)return false;
 tx.verified=true;tx.verifiedAt=nowISO();save();return true;
}
function fakeGatewayFail(id,reason="Verification failed"){
 const tx=(S.gatewayPayments||[]).find(x=>x.id===id);if(!tx)return;tx.status="FAILED";tx.verified=false;tx.reason=reason;tx.failedAt=nowISO();save();
}
function gatewayAlreadyProcessed(kind,refId){return !!(S.gatewayPayments||[]).some(x=>x.kind===kind&&x.meta?.refId===refId&&x.status==="SUCCESS"&&x.verified)}
function gatewayVerifyAndContinue(kind,amount,meta,done){
 const tx=fakeGatewayCreate(kind,amount,{...(meta||{}),refId:meta?.refId||uid("ref"),recipient:meta?.recipient||"ADMIN"});
 setTimeout(()=>{
   if(!fakeGatewayMarkSuccess(tx.id)){fakeGatewayFail(tx.id,"Gateway did not report success");toast("Payment failed");return}
   setTimeout(()=>{
     if(!fakeGatewayVerify(tx.id,{userId:tx.userId,amount,kind,recipient:meta?.recipient||"ADMIN",refId:tx.meta.refId,recipientUpi:meta?.recipientUpi})){fakeGatewayFail(tx.id,"Verification mismatch");toast("Payment verification failed");return}
     done(tx)
   },500)
 },500);
 return tx;
}


async function testPay(){
 if(!systemGuard('payments','Payments are temporarily disabled by Admin'))return;
 const pending=window.pendingBuy;if(!pending?.id)return;
 const p=product(pending.id);if(!p)return;
 const payable=Number(pending.amount??p.price);
 const payCfg=ensurePlatformConfig().payment||{};
 if(payable<Number(payCfg.minPayment||0)||payable>Number(payCfg.maxPayment||1e15)){
   toast("Payment amount is outside the Admin payment limits");return;
 }
 const customerId=S.currentUser?.id||pending.userId||null;
 if(hasPurchased(p.id)){closeModal();openPurchasedByProduct(p.id);return}
 if(gatewayAlreadyProcessed("product",p.id+":"+customerId)){
   toast("This payment was already processed");return;
 }

 clearInterval(window.paymentTimer);
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg"><div class="modal" style="text-align:center;padding:34px"><div style="font-size:42px">💳</div><h2>Opening Secure Checkout</h2><p class="muted">Secure checkout is loading...</p><div class="dash-card"><div>Amount: <b>${money(payable)}</b></div><div class="small muted">Payment is applied only after server-side verification.</div></div></div></div>`;

 const orderRef=uid("ord");
 const ok=await startRazorpayCheckout({
   amount:payable,
   description:razorpaySafeDescription("Sale Earn - "+String(p.title||"Digital product")),
   customerName:pending.name||S.currentUser?.name||"Guest",
   customerEmail:pending.email||S.currentUser?.email||"",
   metadata:{
     kind:"product",
     referenceId:orderRef,
     productId:p.id,
     sellerId:p.sellerId,
     customerId:customerId||"",
     couponCode:String(window.pendingBuy?.couponCode||""),
     couponId:String(window.pendingBuy?.couponId||"")
   },
   onVerified:async(response)=>{
     if((S.orders||[]).some(o=>o.id===orderRef||o.gatewayPaymentId===response.razorpay_payment_id)){
       toast("Duplicate payment blocked");return;
     }
     const orderDate=nowISO();
     const rate=effectivePlatformFeeRate(p.sellerId,orderDate,p.category);
     const order={
       id:orderRef,
       productId:p.id,
       productTitle:p.title,
       productImage:p.image||"",
       sellerId:p.sellerId,
       customerId,
       customerName:pending.name||S.currentUser?.name||"Guest",
       customerEmail:pending.email||S.currentUser?.email||"",
       amount:payable,
       originalAmount:Number(p.price||0),
       couponDiscount:Math.max(0,Number(p.price||0)-payable),
       platformFeeRate:rate,
       platformFee:payable*rate,
       netSellerAmount:payable*(1-rate),
       deliveryUrl:(p.links&&p.links[0])||"",
       deliveryLinks:[...(p.links||[])],
       deliveryTitles:[...(p.linkTitles||p.links?.map((_,i)=>`File ${i+1}`)||[])],
       status:"SUCCESS",
       method:"Cashfree",
       date:orderDate,
       gatewayPaymentId:response.razorpay_payment_id,
       razorpayOrderId:response.razorpay_order_id,
       paymentVerified:true
     };
     /* Coupon usage is finalized by the trusted Cashfree verification backend.
        The browser never increments a coupon usage counter. */
     order.couponServerFinalized=window.pendingBuy?.couponCode ? !!response.couponFinalized : true;
     S.orders.unshift(order);
     window.lastPurchasedOrderId=order.id;
     adjustSellerScore(p.sellerId,5,"Successful sale","SALE:"+order.id);
     p.sales=S.orders.filter(o=>o.productId===p.id&&o.status==="SUCCESS").length;
     if(!S.library.includes(p.id))S.library.push(p.id);
     S.cart=S.cart.filter(x=>x!==p.id);

     if(window.pendingBuy?.couponId){
       const c=S.coupons.find(x=>x.id===window.pendingBuy.couponId)||((p.coupon&&p.coupon.id===window.pendingBuy.couponId)?p.coupon:null);
       if(c){
         c.used=Number(c.used||0)+1;
         S.couponRedemptions=S.couponRedemptions||[];
         S.couponRedemptions.push({id:uid('cr'),couponId:c.id,code:c.code,userId:window.pendingBuy.userId,productId:p.id,date:nowISO()});
       }else if(p.coupon&&p.coupon.code===window.pendingBuy.couponCode){
         p.coupon.used=Number(p.coupon.used||0)+1;
         S.couponRedemptions=S.couponRedemptions||[];
         S.couponRedemptions.push({id:uid('cr'),couponId:'product:'+p.id,code:p.coupon.code,userId:window.pendingBuy.userId,productId:p.id,date:nowISO()});
       }
     }
     await saveFinancialNow();
     // Payment is already verified and the order is saved before notifications are sent.
     // Email failures never roll back a successful purchase.
     await sendTransactionEmails(order,p);
     closeModal();
     go("success/"+order.id);
   }
 });
 if(!ok){
   closeModal();
 }
}
function servicePaymentPanel(kind,amount,meta={}){
 const label=kind==="subscription"?"Subscription":kind==="ad"?"Ad / Boost":"Payment";
 window.pendingService={kind,amount:Number(amount||0),meta};
 const available=sellerAvailableBalance(currentSeller().id);
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg"><div class="modal payment-service-modal"><div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><button class="btn" onclick="servicePaymentBack()">← Back</button><h2 style="margin:0">${label} Payment</h2></div><button class="btn iconbtn close" onclick="closeModal()">×</button><div class="dash-card"><div class="small muted">Amount</div><h2>${money(amount)}</h2>${window.pendingService?.discount?`<div class="small muted">Coupon discount: -${money(window.pendingService.discount)}</div>`:""}<div class="small muted">Choose how you want to pay.</div></div><div class="field"><label>Coupon Code (optional)</label><div style="display:flex;gap:8px"><input id="serviceCoupon" placeholder="Enter coupon" value="${esc(window.pendingService?.couponCode||'')}"><button class="btn" onclick="applyServiceCoupon()">Apply</button></div><div class="small muted">Admin coupons may apply to this ${label.toLowerCase()}.</div></div><div class="service-pay-options"><button class="btn primary" onclick="servicePayOnline()">Pay Online</button><button class="btn" onclick="servicePayBalance()">Pay from Available Balance</button></div><p class="small muted">A subscription/Ad will activate only after a verified gateway payment. Balance payments deduct from To Receive immediately after successful confirmation.</p></div></div>`
}
function servicePaymentBack(){const x=window.pendingService;if(x?.kind==='ad'){const m=x.meta||{};window.pendingAdDraft={...(window.pendingAdDraft||{}),productId:m.productId||window.pendingAdDraft?.productId||"",type:m.type||window.pendingAdDraft?.type||"",days:m.days||window.pendingAdDraft?.days||7,search:m.search??window.pendingAdDraft?.search??""};openAdCampaign(window.pendingAdDraft);return}closeModal()}
function applyServiceCoupon(){const x=window.pendingService;if(!x)return;const code=(document.getElementById('serviceCoupon')?.value||'').trim().toUpperCase();const context=x.kind==='subscription'?'SUBSCRIPTION':x.kind==='ad'?'ADS':'PRODUCT';const userId=S.currentUser?.id||currentSeller()?.id||'guest';let c=validCoupon(code,null,userId,context);if(c&&context==='ADS'&&c.placement&&x.meta?.type&&!String(x.meta.type).toLowerCase().includes(String(c.placement).toLowerCase()))c=null;if(!c){toast('Invalid, expired, exhausted or not applicable here');return}const base=Number(x.meta?.baseAmount??x.amount);const d=couponDiscount(c,base);window.pendingService={...x,couponId:c.id,couponCode:c.code,discount:d,baseAmount:base,amount:Math.max(0,base-d),meta:{...(x.meta||{}),discount:d,baseAmount:base}};toast('Coupon applied');servicePaymentPanel(window.pendingService.kind,window.pendingService.amount,window.pendingService.meta)}

async function servicePayOnline(){
 if(!systemGuard('payments','Payments are temporarily disabled by Admin'))return;
 const x=window.pendingService;if(!x)return;
 const sid=currentSeller()?.id;
 if(!sid){toast("Seller account required");return}
 const label=x.kind==="subscription"?"Subscription":x.kind==="ad"?"Ad / Boost":"Payment";
 clearInterval(window.paymentTimer);
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg"><div class="modal" style="text-align:center;padding:34px"><div style="font-size:42px">💳</div><h2>Opening Secure Checkout</h2><p class="muted">Secure checkout is loading...</p><div class="dash-card"><div>Amount: <b>${money(x.amount)}</b></div><div class="small muted">Service activates only after server-side verification.</div></div></div></div>`;
 const refId=x.id||uid("svc");
 const ok=await startRazorpayCheckout({
   amount:x.amount,
   description:razorpaySafeDescription("Sale Earn - "+label),
   customerName:S.currentUser?.name||currentSeller()?.name||"",
   customerEmail:S.currentUser?.email||"",
   metadata:{
     kind:x.kind,
     referenceId:refId,
     sellerId:sid,
     plan:x.meta?.plan||"",
     productId:x.meta?.productId||""
   },
   onVerified:async(response)=>{
     const verified={...x,gatewayPaymentId:response.razorpay_payment_id,razorpayOrderId:response.razorpay_order_id,paymentVerified:true};
     window.serviceOnline=null;
     window.pendingService=null;
     applyServicePayment(verified,"RAZORPAY_TEST");
     toast(`${label} payment verified.`);
     showServiceSuccess(verified);
   }
 });
 if(!ok)closeModal();
}
function cancelServicePayment(expired=false){clearInterval(window.paymentTimer);closeModal();if(expired)toast("Payment session expired")}
function completeServiceOnline(){ if(!systemGuard('payments','Payments are temporarily disabled by Admin'))return;
 const x=window.serviceOnline;if(!x)return;
 clearInterval(window.paymentTimer);
 const sid=currentSeller()?.id;if(!sid)return;
 const refId=x.id||uid("svc");
 if(gatewayAlreadyProcessed(x.kind,refId)){toast("This payment was already processed");return}
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg"><div class="modal" style="text-align:center;padding:34px"><div style="font-size:42px">⏳</div><h2>Verifying Payment</h2><p class="muted">Checking test-gateway transaction...</p></div></div>`;
 const tx=fakeGatewayCreate(x.kind,x.amount,{refId, sellerId:sid, plan:x.meta?.plan||null, productId:x.meta?.productId||null, recipient:"ADMIN"});
 setTimeout(()=>{
   if(!fakeGatewayMarkSuccess(tx.id)){fakeGatewayFail(tx.id,"Gateway did not report success");toast("Payment failed");return}
   setTimeout(()=>{
   if(!fakeGatewayVerify(tx.id,{userId:sid,amount:x.amount,kind:x.kind,recipient:"ADMIN",refId})){fakeGatewayFail(tx.id,"Verification mismatch");toast("Payment verification failed");return}
   const verified={...x,gatewayPaymentId:tx.id,paymentVerified:true};window.serviceOnline=null;window.pendingService=null;
   applyServicePayment(verified,"ONLINE_TEST");toast(`${verified.kind==='subscription'?'Subscription':'Ad / Boost'} test payment verified.`);showServiceSuccess(verified)
   },500)
 },700);
}
function servicePayBalance(){
 if(!systemGuard('payments','Payments are temporarily disabled by Admin'))return;
 const x=window.pendingService;if(!x)return;const available=sellerAvailableBalance(currentSeller().id);
 if(x.amount>available){toast("Insufficient To Receive balance");return}
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg"><div class="modal"><button class="btn iconbtn close" onclick="closeModal()">×</button><h2>Confirm Balance Payment</h2><div class="dash-card" style="text-align:center"><div class="small muted">Available To Receive</div><h2>${money(available)}</h2><div>Payment: <b>${money(x.amount)}</b></div><div class="small muted">Remaining after payment: ${money(available-x.amount)}</div></div><div class="modal-footer"><button class="btn" onclick="servicePaymentPanel(window.pendingService.kind,window.pendingService.amount,window.pendingService.meta)">Back</button><button class="btn primary" onclick="completeServiceBalance()">Confirm & Pay</button></div></div></div>`
}
function completeServiceBalance(){ if(!systemGuard('payments','Payments are temporarily disabled by Admin'))return;
 const x=window.pendingService;if(!x)return;const sid=currentSeller().id,available=sellerAvailableBalance(sid);if(x.amount>available){toast("Insufficient To Receive balance");return}
 const refId=uid("balpay"),tx=fakeGatewayCreate(x.kind,x.amount,{refId,sellerId:sid,recipient:"INTERNAL_LEDGER",source:"BALANCE"});
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg"><div class="modal" style="text-align:center;padding:34px"><div style="font-size:42px">⏳</div><h2>Verifying Balance Payment</h2><p class="muted">Checking available balance and transaction...</p></div></div>`;
 setTimeout(()=>{
   if(!fakeGatewayMarkSuccess(tx.id)){fakeGatewayFail(tx.id,"Balance ledger did not report success");toast("Balance payment failed");return}
   setTimeout(()=>{
     if(!fakeGatewayVerify(tx.id,{userId:sid,amount:x.amount,kind:x.kind,recipient:"INTERNAL_LEDGER",refId})){fakeGatewayFail(tx.id,"Balance verification mismatch");toast("Balance payment verification failed");return}
     if(sellerAvailableBalance(sid)<x.amount){fakeGatewayFail(tx.id,"Insufficient balance at verification");toast("Insufficient To Receive balance");return}
     applyServicePayment({...x,gatewayPaymentId:tx.id,paymentVerified:true},"BALANCE");
     toast(`${x.kind==="subscription"?"Subscription":"Ad / Boost"} payment verified — amount deducted from To Receive.`);showServiceSuccess(x)
   },500)
 },500)
}
function applyServicePayment(x,source){
 if(!x||!x.paymentVerified)return false;
 S.balancePayments=S.balancePayments||[];S.drafts=S.drafts||[];
 if(source==='BALANCE'){
   if((S.balancePayments||[]).some(b=>b.gatewayPaymentId===x.gatewayPaymentId&&b.status==='SUCCESS'))return false;
   S.balancePayments.unshift({id:uid("bal"),sellerId:currentSeller().id,amount:x.amount,kind:x.kind,source,status:"SUCCESS",paymentVerified:true,gatewayPaymentId:x.gatewayPaymentId||null,date:nowISO(),meta:x.meta||{}});
 }
 if(x.kind==="subscription" && (source==="BALANCE"||source==="ONLINE_TEST"||source==="RAZORPAY_TEST")){
   S.subscriptions=S.subscriptions||[];
   const subDate=nowISO(),subEnd=new Date(new Date(subDate).getTime()+SUBSCRIPTION_DURATION_MS).toISOString();
   if(x.gatewayPaymentId && S.subscriptions.some(z=>z.gatewayPaymentId===x.gatewayPaymentId))return false;
   S.subscriptions.unshift({id:uid("sub"),sellerId:currentSeller().id,plan:x.meta.plan,amount:x.amount,discount:x.meta.discount||0,paymentSource:source,paymentStatus:"SUCCESS",paymentVerified:true,gatewayPaymentId:x.gatewayPaymentId||null,date:subDate,startDate:subDate,endDate:subEnd});
   currentSeller().plan=x.meta.plan;currentSeller().lastSubscription={plan:x.meta.plan,amount:x.amount,date:subDate,discount:x.meta.discount||0};
   const usedReferral=S.settings.referralUsedBy?.[S.currentUser?.id];
   if(usedReferral&&usedReferral.sellerId!==currentSeller().id){
     const referrer=seller(usedReferral.sellerId),refRate=Math.min(20,Math.max(5,Number(referrer?.referralPercent||5))),paidAmount=Number(x.amount||0),commission=paidAmount*(refRate/100);
     S.referrals=S.referrals||[];
     const refKey=x.gatewayPaymentId||usedReferral.sellerId+':'+S.currentUser?.id+':'+subDate;
     if(!S.referrals.some(r=>r.paymentKey===refKey))S.referrals.unshift({id:uid("ref"),sellerId:usedReferral.sellerId,userId:S.currentUser.id,userName:S.currentUser.name,commission,status:"ACTIVE",date:subDate,paidAmount,rate:refRate,sourceSubscription:true,paymentKey:refKey});
   }
 }else if(x.kind==="ad" && (source==="BALANCE"||source==="ONLINE_TEST"||source==="RAZORPAY_TEST")){
   const sid=currentSeller().id,rate=x.meta.rate||0,days=x.meta.days||1,start=new Date(),end=new Date(start.getTime()+days*86400000);
   if(x.gatewayPaymentId && S.ads.some(a=>a.gatewayPaymentId===x.gatewayPaymentId))return false;
   S.ads.unshift({id:uid("ad"),sellerId:sid,productId:x.meta.productId,type:x.meta.type,placement:x.meta.type,cost:x.amount,clicks:0,status:"ACTIVE",startDate:start.toISOString(),endDate:end.toISOString(),paymentSource:source,paymentStatus:"SUCCESS",paymentVerified:true,gatewayPaymentId:x.gatewayPaymentId||null});
 }
 save();return true;
}
function showServiceSuccess(x){
 const label=x.kind==="subscription"?"Subscription":x.kind==="ad"?"Ad Campaign":"Payment";
 const detail=x.kind==="subscription"?`${esc(x.meta.plan)} plan is now active.`:`${label} is now active.`;
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg"><div class="modal" style="text-align:center;padding:34px"><div style="font-size:58px">✓</div><h2>Payment Successful</h2><p class="muted">${detail}</p><div class="dash-card"><b>Paid ${money(x.amount)}</b><div class="small muted">Recorded in ${x.kind==="subscription"?"Subscription Pay History":"Ad Payment History"}.</div></div><button class="btn primary" onclick="closeModal();render()">Done</button></div></div>`
}
function fbt(p){
 let same=S.products.filter(x=>x.sellerId===p.sellerId&&x.id!==p.id);
 if(same.length<4)same=[...same,...S.products.filter(x=>x.sellerId!==p.sellerId&&x.id!==p.id)];
 return same.slice(0,4)
}
function toggleFaq(el){el.parentElement.classList.toggle("open")}
function reviewsFor(id){return S.reviews[id]||[]}
function stars(n){return "★".repeat(n)+"☆".repeat(5-n)}
function openReview(id){
 let rating=5;
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal"><button class="btn iconbtn close" onclick="closeModal()">×</button><h2>Write a Review</h2><div class="field"><label>Your name</label><input id="rvName" value="${esc(S.currentUser?.name||"")}"></div><div class="field"><label>Rating</label><div class="star-picker" id="starPicker">${[1,2,3,4,5].map(i=>`<button class="on" onclick="pickStar(${i})">★</button>`).join("")}</div></div><div class="field"><label>Your review</label><textarea id="rvText" placeholder="Tell other customers what you think..."></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="submitReview('${id}')">Publish Review</button></div></div></div>`;
 window.reviewRating=5
}
function pickStar(n){window.reviewRating=n;document.querySelectorAll("#starPicker button").forEach((b,i)=>b.classList.toggle("on",i<n))}
function submitReview(id){
 const name=document.getElementById("rvName").value.trim()||"Customer",text=document.getElementById("rvText").value.trim();
 if(!text){toast("Please write a review");return}
 S.reviews[id]=S.reviews[id]||[];const uidv=S.currentUser?.id||"guest";const count=S.reviews[id].filter(r=>r.userId===uidv).length;if(count>=10){toast("You can post maximum 10 reviews/comments for this product");return}
 S.reviews[id].unshift({id:uid("rv"),userId:uidv,name,rating:window.reviewRating||5,text,date:nowISO(),verified:!!S.library.includes(id),likes:0,dislikes:0,likedBy:[],dislikedBy:[],replies:[]});save();closeModal();toast("Review published");render()
}
function reactReview(pid,rid,type){
 const r=(S.reviews[pid]||[]).find(x=>x.id===rid);if(!r)return;const uidv=S.currentUser?.id||"guest";r.likedBy=r.likedBy||[];r.dislikedBy=r.dislikedBy||[];if(type==='like'){if(r.likedBy.includes(uidv)){r.likedBy=r.likedBy.filter(x=>x!==uidv)}else{r.likedBy.push(uidv);r.dislikedBy=r.dislikedBy.filter(x=>x!==uidv)}}else{if(r.dislikedBy.includes(uidv)){r.dislikedBy=r.dislikedBy.filter(x=>x!==uidv)}else{r.dislikedBy.push(uidv);r.likedBy=r.likedBy.filter(x=>x!==uidv)}}r.likes=r.likedBy.length;r.dislikes=r.dislikedBy.length;save();render()}
function replyReview(pid,rid){
 if(!S.currentUser){openAuth('signin','review');return}const r=(S.reviews[pid]||[]).find(x=>x.id===rid);if(!r)return;const text=prompt('Write your reply/comment:','');if(!text||!text.trim())return;r.replies=r.replies||[];r.replies.push({id:uid('reply'),userId:S.currentUser.id,name:S.currentUser.name||'User',text:text.trim(),date:nowISO(),sellerReply:S.currentUser.sellerId===product(pid)?.sellerId});save();render()}
function reviewHtml(pid,r){const isSeller=S.currentUser?.sellerId===product(pid)?.sellerId;const likes=(r.likedBy||[]).length,dislikes=(r.dislikedBy||[]).length;return `<div class="review-item"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(r.name)}</b><span class="stars">${stars(r.rating)}</span></div><div class="small muted">${new Date(r.date).toLocaleDateString()} ${r.verified?`· <b style="color:#17a875">Verified buyer</b>`:""}</div><p>${esc(r.text)}</p><div class="review-actions"><button class="btn" onclick="reactReview('${pid}','${r.id}','like')">👍 ${likes}</button><button class="btn" onclick="reactReview('${pid}','${r.id}','dislike')">👎 ${dislikes}</button><button class="btn" onclick="replyReview('${pid}','${r.id}')">↩ Reply</button>${isSeller?`<button class="btn" onclick="replyReview('${pid}','${r.id}')">↩ Seller Reply</button>`:''}</div>${(r.replies||[]).length?`<div class="review-replies">${r.replies.map(x=>`<div class="review-reply"><b>${esc(x.name)}</b> ${x.sellerReply?`<span class="admin-pill success">Seller</span>`:''}<div class="small muted">${new Date(x.date).toLocaleDateString()}</div><div>${esc(x.text)}</div></div>`).join('')}</div>`:''}</div>`}
function toggleProductDescription(button){
 const wrap=button?.closest('.product-description-wrap');
 const text=wrap?.querySelector('.product-description-text');
 if(!wrap||!text)return;
 const expanded=text.classList.toggle('expanded');
 button.textContent=expanded?'Show less ↑':'More ↓';
 button.setAttribute('aria-expanded',expanded?'true':'false');
}
function detail(id){
 const p=product(id);if(!p)return notFound();
 const s=seller(p.sellerId), rs=reviewsFor(id), bundles=fbt(p), avg=rs.length?(rs.reduce((a,r)=>a+r.rating,0)/rs.length).toFixed(1):"New";
 return `${header()}<main class="page"><div class="container detail-wrap">
 <button class="btn" onclick="goBack()">← Back</button>
 <div class="detail-main" style="margin-top:15px">${thumbLarge(p)}<div class="detail-info"><div>${(p.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div><h1>${esc(p.title)}</h1><div class="stars">${stars(Math.round(Number(avg)||0))} <span class="muted">${rs.length?avg+" / 5 · "+rs.length+" reviews":"No reviews yet"}</span></div><div class="detail-price">${money(p.price)} ${p.oldPrice?`<span class="old">${money(p.oldPrice)}</span>`:""}</div><div class="detail-sales-line"><span>✓ Verified sales</span><b>${productSales(p.id)}</b><span>sales</span></div>${(()=>{const descText=String(p.description||"Digital product with instant delivery.");const showToggle=descText.length>180;return `<div class="product-description-wrap"><p class="desc product-description-text">${esc(descText)}</p>${showToggle?`<button type="button" class="product-description-toggle" onclick="toggleProductDescription(this)" aria-expanded="false">More ↓</button>`:''}</div>`})()}
 <div class="detail-actions"><button class="btn primary" onclick="${hasPurchased(p.id)?`openPurchasedByProduct('${p.id}')`:`buyNow('${p.id}')`} ">${hasPurchased(p.id)?"Check":"Buy Now"}</button><button class="btn" onclick="addCart('${p.id}')">Add to Cart</button><button class="btn" onclick="shareProduct('${p.id}')">↗ Share</button></div><div class="product-trust-row"><span class="product-trust-pill">✓ Digital product</span><span class="product-trust-pill">✓ Secure checkout</span><span class="product-trust-pill">✓ Admin-reviewed listing</span><span class="product-trust-pill">✓ Online delivery</span></div><div class="dash-card" style="margin:12px 0"><h3 style="margin-top:0">What’s Inside</h3><div class="stats"><span><b>${p.fileCount||((p.links||[]).length||1)}</b> Files</span><span><b>${esc(p.fileSize||"250 MB")}</b> Size</span><span><b>${esc(p.category)}</b> Type</span></div><p class="small muted">Seller listing: @${esc(s.id)} · ${esc(s.name)}</p></div>
 <div class="seller-box" onclick="go('seller/${s.id}')" style="cursor:pointer">${avatar(s)}<div><b>${esc(s.name)}</b><div class="small muted">@${esc(s.id)} · ${s.followers||0} followers</div></div></div>
 <div class="faq"><button onclick="toggleFaq(this)">What is included? <span class="chev">⌄</span></button><div class="faq-content">${esc((p.links||[]).length)} secure delivery link(s) and the product details shown here.</div></div><div class="broken-link-box"><b>Delivery issue?</b><p class="small muted" style="margin:5px 0 9px">If a delivery link is unavailable or does not match the listing, report it to Sale Earn support.</p><button class="btn" onclick="reportProductIssue('${p.id}')">Report delivery issue</button></div>
 ${(p.faq||[]).map(f=>`<div class="faq"><button onclick="toggleFaq(this)">${esc(f[0])}<span class="chev">⌄</span></button><div class="faq-content">${esc(f[1])}</div></div>`).join("")}
 </div></div>
 <div class="bundle-box"><div class="section-head"><div><h2>Frequently Bought Together</h2><p>Products from this seller are preferred first; fallback products fill the row if needed.</p></div></div><div class="grid">${bundles.map(productCard).join("")}</div></div>
 <div class="review-box"><div class="section-head"><div><h2>Customer Reviews</h2><p>Anyone can submit a rating and review. Verified buyers receive a badge.</p></div><button class="btn primary" onclick="openReview('${p.id}')">★ Write Review</button></div>
 ${rs.length?rs.map(r=>`<div class="review-item"><div style="display:flex;justify-content:space-between"><b>${esc(r.name)}</b><span class="stars">${stars(r.rating)}</span></div><div class="small muted">${new Date(r.date).toLocaleDateString()} ${r.verified?`· <b style="color:#17a875">Verified buyer</b>`:""}</div><p>${esc(r.text)}</p></div>`).join(""):`<div class="dash-card" style="margin:0"><p class="muted">No reviews yet. Be the first to rate this product.</p></div>`}</div>
 </div><button class="btn primary sticky-buy" onclick="${hasPurchased(p.id)?`openPurchasedByProduct('${p.id}')`:`buyNow('${p.id}')`} ">${hasPurchased(p.id)?"Check":"Buy "+money(p.price)}</button></main>${footer()}`}
function reportProductIssue(id){const p=product(id);if(!p)return;const subject=encodeURIComponent('Product delivery issue: '+(p.title||id));const body=encodeURIComponent('Product ID: '+id+'\nProduct: '+(p.title||'')+'\n\nPlease describe the delivery issue:');go('policy/contact');setTimeout(()=>{const sub=document.getElementById('ctSubject'),msg=document.getElementById('ctMsg');if(sub)sub.value=decodeURIComponent(subject);if(msg)msg.value=decodeURIComponent(body)},80);toast('Support form opened');}
async function shareProduct(id){
 const p=product(id);if(!p){toast("Product not found");return}
 const url=location.origin+location.pathname+"#product/"+encodeURIComponent(id);
 try{
  if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(url)}
  else{
   const ta=document.createElement("textarea");ta.value=url;ta.setAttribute("readonly","");ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();
  }
  toast("Product link copied");
 }catch(e){toast("Could not copy product link")}
}
function thumbLarge(p){return `<div class="detail-image">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.title||'Product image')}" onload="setDetailImageRatio(this)" onerror="this.style.display='none'">`:`<div class="thumb-fallback">🧩</div>`}</div>`}
function setDetailImageRatio(img){const main=img.closest(".detail-main");if(!main||!img.naturalWidth||!img.naturalHeight)return;main.classList.remove("ratio-landscape","ratio-portrait","ratio-square");const ratio=img.naturalWidth/img.naturalHeight;main.classList.add(ratio>1.15?"ratio-landscape":ratio<.87?"ratio-portrait":"ratio-square")}
function success(id){
 const o=S.orders.find(x=>x.id===id);if(!o||o.status!=="SUCCESS"||(S.currentUser&&o.customerId!==S.currentUser.id))return notFound();const p=product(o.productId),links=(p?.links?.length?p.links:o.deliveryLinks?.length?o.deliveryLinks:[o.deliveryUrl]).filter(Boolean),titles=p?.linkTitles||o.deliveryTitles||[];
 return `${header()}<main class="page"><div class="container"><div class="success-card"><div class="success-icon">✓</div><h1>Payment Successful</h1><p class="muted">Your verified digital product links are ready.</p><div class="delivery-links">${links.map((link,i)=>`<div class="link-box delivery-link-item"><div><b>${esc(titles[i]||`File ${i+1}`)}</b><small>${esc(new URL(link).hostname)}</small></div><button class="btn primary" onclick="window.open('${esc(link)}','_blank','noopener')">Open Link</button></div>`).join("")||'<div class="link-box">Delivery link unavailable. Contact seller support.</div>'}</div><p class="small muted">Order ID: ${esc(o.id)} · Method: ${esc(o.method)}</p><div class="hero-actions" style="justify-content:center"><button class="btn" onclick="go('market')">Continue Shopping</button></div></div></div></main>${footer()}`
}

/* -------------------- SELLER PROFILE / CART / AUTH -------------------- */
function cancelled(id){const o=S.orders.find(x=>x.id===id),p=o?product(o.productId):product(window.pendingBuy?.id);return `${header()}<main class="page"><div class="container"><div class="success-card cancelled"><div class="success-icon" style="background:#fff0f0;color:var(--red)">×</div><h1>Payment Cancelled</h1><p class="muted">Your payment was not completed. ${o?.reason?esc(o.reason)+".":"You can try again whenever you are ready."}</p>${o?`<p class="small muted">Order ID: ${esc(o.id)} · Status: CANCELLED</p>`:""}<div class="hero-actions" style="justify-content:center"><button class="btn primary" onclick="go('cart')">Return to Cart</button><button class="btn" onclick="go('market')">Continue Shopping</button>${p?`<button class="btn" onclick="go('product/${p.id}')">View Product</button>`:""}</div></div></div></main>${footer()}`}

function meFollowId(){return S.currentUser?(S.currentUser.authId||S.currentUser.userId||S.currentUser.id):null}
function isFollowing(sid){
 const me=meFollowId();
 return !!(me && S.follows[me+"_"+sid])
}
function toggleFollow(sid){
 if(!S.currentUser){openAuth("signin","follow");return}
 const me=meFollowId();if(!me)return;
 S.follows=S.follows&&typeof S.follows==='object'&&!Array.isArray(S.follows)?S.follows:{};
 const key=me+"_"+sid,ss=seller(sid);
 if(S.currentUser.sellerId===sid){toast("You cannot follow your own store");return}
 if(S.follows[key]){delete S.follows[key];ss.followers=Math.max(0,(ss.followers||0)-1);toast("Unfollowed")}else{S.follows[key]=true;ss.followers=(ss.followers||0)+1;toast("Followed seller")}
 // Follow state is part of the cloud snapshot and is persisted immediately.
 save();
 render()
}
async function shareSeller(id){const url=location.origin+location.pathname+"#seller/"+id;try{if(navigator.share)await navigator.share({title:"Sale Earn Seller",text:"View this seller on Sale Earn",url});else{await navigator.clipboard?.writeText(url);toast("Seller link copied")}}catch(e){}}
function sellerProfile(id){
 const s=publicSellerView(id),owner=S.users.find(u=>u.sellerId===id),publicSource=Array.isArray(SE_PUBLIC_CATALOG)&&SE_PUBLIC_CATALOG_READY?SE_PUBLIC_CATALOG:studioVisibleProducts(),ps=publicSource.filter(p=>String(p?.sellerId)===String(id)&&!seIsDeletedProduct(p)),follow=!!S.currentUser&&isFollowing(id);if(owner?.unpublicUntil&&owner.unpublicUntil>Date.now())return `${header()}<main class="page"><div class="container auth-box"><h2>Seller not available</h2><p class="muted">This seller profile is temporarily unavailable.</p><button class="btn" onclick="goBack()">← Back</button></div></main>${footer()}`;
 const theme=storeTheme(id),view=(window.sellerViews||{})[id]||theme.layout||"grid";return `${header()}<main class="page seller-profile"><div class="container"><button class="btn" onclick="goBack()">← Back</button>${theme.banner?`<div class="store-banner" style="background-image:url('${esc(theme.banner)}')"></div>`:""}
 <div class="profile-head" style="margin-top:15px"><div class="profile-logo">${s.logo?`<img src="${esc(s.logo)}">`:"SE"}</div><div class="profile-meta"><h1>${esc(s.name)}</h1><p class="muted">@${esc(s.id)} · ${esc(s.owner||"Seller")}</p>${theme.tagline?`<div class="pill">${esc(theme.tagline)}</div>`:""}<div class="stats"><span><b>${s.followers||0}</b> Followers</span><span><b>${ps.length}</b> Products</span><span><b>${S.orders.filter(o=>o.sellerId===id&&o.status==="SUCCESS").length}</b> Sales</span></div></div><div class="seller-profile-actions">${sellerScoreMarkup(id,true)}<div class="seller-action-buttons"><button class="btn share-btn" onclick="shareSeller('${s.id}')">↗ Share</button><button class="btn ${follow?"":"primary"}" onclick="toggleFollow('${id}')">${follow?"Unfollow":"Follow"}</button></div></div></div>
 <div class="seller-tools"><button class="btn ${view==="grid"?"primary":""}" onclick="setSellerProfileView('${id}','grid')">▦ Grid</button><button class="btn ${view==="list"?"primary":""}" onclick="setSellerProfileView('${id}','list')">☰ List</button><button class="btn ${window.sellerFeatured?"primary":""}" onclick="window.sellerFeatured=!window.sellerFeatured;render()">★ Featured</button><span class="pill">Total Assets: ${ps.length}</span><span class="pill">Total Sales: ${ps.reduce((a,p)=>a+productSales(p.id),0)}</span></div><div class="section-head" style="margin-top:28px"><div><h2>Store Products</h2><p>${esc(s.bio||"Digital products from this seller.")}</p></div></div><div class="grid seller-products ${view==="list"?"list-view":"grid-view"}">${ps.filter(p=>!window.sellerFeatured||p.featured).map(productCard).join("")||`<div class="dash-card"><h3>No featured products</h3><p class="muted">This seller has not marked any product as featured yet.</p></div>`}</div></div></main>${footer()}`
}
function cart(){
 const ps=S.cart.map(product).filter(Boolean);const total=ps.reduce((a,p)=>a+p.price,0);
 return `${header()}<main class="page cart"><div class="container page-title"><h1>Your Cart</h1><p class="muted">${ps.length} product(s)</p></div><div class="container"><div class="dash-card">${ps.length?ps.map(p=>`<div class="cart-product-row"><div class="cart-product-media">${thumbMini(p)}</div><div class="cart-product-info"><b class="cart-product-title">${esc(p.title)}</b><div class="small muted cart-product-price">${money(p.price)}</div></div><div class="cart-product-actions"><button class="btn danger" onclick="removeCart('${p.id}')">Remove</button><button class="btn primary" onclick="buyNow('${p.id}')">Buy</button></div></div>`).join(""):`<div style="text-align:center;padding:50px"><h2>Your cart is empty</h2><p class="muted">Add products using the + button.</p><button class="btn primary" onclick="go('market')">Explore Marketplace</button></div>`}
 ${ps.length?`<div class="cart-coupon-box" style="margin-top:16px;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--surface2)"><b>Coupon</b><div class="small muted" style="margin:4px 0 9px">Coupon will be checked again on the secure checkout server for the item you choose.</div><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="cartCouponCode" class="input" maxlength="40" placeholder="Enter coupon code" style="flex:1;min-width:180px"><button class="btn" onclick="applyCartCoupon()">Apply to first item</button></div></div><div style="display:flex;justify-content:space-between;align-items:center;padding-top:18px;gap:10px;flex-wrap:wrap"><b>Total ${money(total)}</b><button class="btn primary" onclick="buyNow('${ps[0].id}')">Checkout first item</button></div>`:""}</div></div></main>${footer()}`
}
function thumbMini(p){return `<div class="mini-thumb">${p.image?`<img src="${esc(p.image)}">`:"🧩"}</div>`}
function openAuth(mode="signin",reason=""){
 if(S.currentUser){toast("You are already logged in");return}
 window.authMode=mode;window.authReason=reason;
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal"><button class="btn iconbtn close" onclick="closeModal()">×</button><div class="tabs"><button class="${mode==='signin'?'active':''}" onclick="openAuth('signin','${reason}')">Sign In</button><button class="${mode==='signup'?'active':''}" onclick="openAuth('signup','${reason}')">Sign Up</button></div><div id="authBody">${authBody(mode)}</div></div></div>`
}
function authBody(mode){
 if(mode==="signup")return `<h2>Create your account</h2><p class="muted">We will send a 6-digit OTP to the email address you enter below. After you receive it, open the email, copy the OTP, and enter it here to verify your account.</p><div class="field"><label>Name</label><input id="authName" placeholder="Your name" autocomplete="name"></div><div class="field"><label>Email</label><input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email"></div><p class="small muted">Every verified account can buy and sell. Your store is created automatically.</p><div class="modal-footer"><button class="btn primary" onclick="signup()">Send Verification Code</button></div>`;
 return `<h2>Welcome back</h2><p class="muted">Enter your email address and we will send a secure 6-digit OTP to that email. After you receive it, open the email, copy the OTP, and enter it here to sign in.</p><div class="field"><label>Email</label><input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email"></div><div class="modal-footer"><button class="btn primary" onclick="signin()">Send Verification Code</button></div>`;
}
function authOtpErrorMessage(e,fallback){
 const m=String(e?.message||e?.error_description||"").toLowerCase();
 if(m.includes("over_email_send_rate_limit")||m.includes("rate limit")||m.includes("too many")) return "Please wait 60 seconds before requesting another OTP. If you still don't receive it, check Spam/Promotions.";
 if(m.includes("over_request_rate_limit")) return "Too many requests from this device. Please wait a few minutes and try again.";
 if(m.includes("otp_expired")||m.includes("expired")) return "This OTP has expired. Please request a new code.";
 if(m.includes("invalid login credentials")||m.includes("invalid otp")||m.includes("token has expired")) return "The OTP is invalid or expired. Please request a new code.";
 return e?.message||fallback;
}
function authOtpCooldownText(){
 const o=window.pendingAuth,btn=document.getElementById("resendAuthOtpBtn");
 if(!o||!btn)return;
 const left=Math.max(0,Math.ceil(((o.resendAvailableAt||0)-Date.now())/1000));
 btn.disabled=left>0||!!o.sending;
 btn.textContent=left>0?`Resend OTP (${left}s)`:"Resend OTP";
 if(left>0){clearTimeout(o.cooldownTimer);o.cooldownTimer=setTimeout(authOtpCooldownText,1000)}
}
function startAuthOtpCooldown(seconds=60){
 const o=window.pendingAuth;if(!o)return;
 o.resendAvailableAt=Date.now()+Math.max(1,Number(seconds)||60)*1000;
 authOtpCooldownText();
}
function setAuthSendButtonBusy(button,busy,label){
 if(!button)return;
 button.disabled=!!busy;
 if(busy){button.dataset.authOriginalText=button.textContent;button.textContent="Sending…"}
 else button.textContent=label||button.dataset.authOriginalText||"Send Verification Code";
}
function showAuthOtp(mode,email,name=""){
 clearTimeout(window.pendingAuth?.cooldownTimer);
 window.pendingAuth={mode,email,name,expires:Date.now()+Number(ensurePlatformConfig().payment?.timeoutMinutes||10)*60*1000,sending:false,verifying:false,resendAvailableAt:Date.now()+60000};
 document.getElementById("authBody").innerHTML=`<h2>Verify your email</h2><p class="muted">A 6-digit OTP has been sent to <b>${esc(email)}</b>. Open your email inbox, copy the OTP, and enter it below. The OTP expires in 10 minutes.</p><div class="field"><label>Verification Code</label><input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="Enter 6-digit code" oninput="this.value=this.value.replace(/\D/g,'').slice(0,6)" onkeydown="if(event.key==='Enter')verifyAuthOtp()"></div><div class="modal-footer"><button class="btn" onclick="openAuth('${mode}')">Back</button><button id="resendAuthOtpBtn" class="btn" onclick="resendAuthOtp()">Resend OTP (60s)</button><button id="verifyAuthOtpBtn" class="btn primary" onclick="verifyAuthOtp()">Verify & Continue</button></div><p class="small muted" style="margin-top:10px">Didn't receive the OTP? Check Spam/Promotions, confirm the email address, then resend after the countdown finishes.</p>`;
 authOtpCooldownText();
 setTimeout(()=>document.getElementById("otp")?.focus(),50);
}
async function signup(){ if(!systemGuard('newSellerRegistration','New registrations are temporarily disabled by Admin'))return;
 const name=document.getElementById("authName")?.value.trim(),email=document.getElementById("authEmail")?.value.trim().toLowerCase();
 if(!name||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){toast("Enter a valid name and email");return}
 const btn=document.querySelector('#authBody button[onclick="signup()"]');
 if(window.pendingAuth?.sending)return;
 setAuthSendButtonBusy(btn,true);
 window.pendingAuth={sending:true};
 try{
   const {data,error}=await supabaseClient.auth.signInWithOtp({email,options:{shouldCreateUser:true,data:{name}}});
   if(error) throw error;
   showAuthOtp("signup",email,name);
   toast("Verification code sent to your email");
 }catch(e){console.error(e);window.pendingAuth=null;setAuthSendButtonBusy(btn,false,"Send Verification Code");toast(authOtpErrorMessage(e,"Unable to send verification code"))}
}
async function signin(){
 const email=document.getElementById("authEmail")?.value.trim().toLowerCase();
 if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){toast("Enter a valid email");return}
 const btn=document.querySelector('#authBody button[onclick="signin()"]');
 if(window.pendingAuth?.sending)return;
 setAuthSendButtonBusy(btn,true);
 window.pendingAuth={sending:true};
 try{
   const {error}=await supabaseClient.auth.signInWithOtp({email,options:{shouldCreateUser:false}});
   if(error) throw error;
   showAuthOtp("signin",email);
   toast("Verification code sent to your email");
 }catch(e){console.error(e);window.pendingAuth=null;setAuthSendButtonBusy(btn,false,"Send Verification Code");toast(authOtpErrorMessage(e,"Unable to send verification code"))}
}
async function resendAuthOtp(){
 const o=window.pendingAuth;if(!o?.email){toast("Enter your email again");return}
 if(o.sending||o.verifying)return;
 const left=Math.max(0,Math.ceil(((o.resendAvailableAt||0)-Date.now())/1000));
 if(left>0){toast(`Please wait ${left} seconds before requesting another OTP`);authOtpCooldownText();return}
 const btn=document.getElementById("resendAuthOtpBtn");
 o.sending=true;authOtpCooldownText();
 try{
   const {error}=await supabaseClient.auth.signInWithOtp({email:o.email,options:{shouldCreateUser:o.mode==="signup",data:o.mode==="signup"?{name:o.name||""}:undefined}});
   if(error) throw error;
   o.expires=Date.now()+Number(ensurePlatformConfig().payment?.timeoutMinutes||10)*60*1000;
   startAuthOtpCooldown(60);
   toast("New OTP sent to your email");
 }catch(e){console.error(e);toast(authOtpErrorMessage(e,"Unable to resend OTP"));if(o)startAuthOtpCooldown(60)}finally{if(o)o.sending=false;authOtpCooldownText();}
}
async function verifyAuthOtp(){
 const o=window.pendingAuth,token=document.getElementById("otp")?.value.trim(),btn=document.getElementById("verifyAuthOtpBtn");
 if(!o||Date.now()>o.expires){toast("Code expired. Request a new code.");return}
 if(o.verifying)return;
 if(!/^\d{6}$/.test(token)){toast("Enter the 6-digit code");return}
 o.verifying=true;if(btn){btn.disabled=true;btn.textContent="Verifying…"}
 try{
   const {data,error}=await supabaseClient.auth.verifyOtp({email:o.email,token,type:"email"});
   if(error) throw error;
   const user=data?.user;
   if(!user) throw new Error("Verification succeeded but no user session was returned.");
   let u=S.users.find(x=>x.authId===user.id||x.id===user.id||String(x.email||"").toLowerCase()===String(user.email||o.email||"").toLowerCase());
   if(!u){
     u={id:user.id,authId:user.id,userId:'SE-'+String(user.id).replace(/-/g,'').slice(0,8).toUpperCase(),name:user.user_metadata?.name||o.name||o.email.split("@")[0],email:user.email||o.email,role:"user",verified:true,profileLastChanged:Date.now()};
     u.sellerId=uid("seller");
     S.sellers[u.sellerId]={id:u.sellerId,name:u.name+"'s Store",owner:u.name,followers:0,logo:"",storeId:u.sellerId,bio:"Welcome to my Sale Earn store.",plan:"FREE",upi:""};
     S.users.push(u);
   }else{
     u.authId=u.authId||user.id;
     u.userId=u.userId||('SE-'+String(user.id).replace(/-/g,'').slice(0,8).toUpperCase());
     u.email=user.email||o.email;
     u.name=u.name||user.user_metadata?.name||o.name||o.email.split("@")[0];
     u.verified=true;
   }
   u.isAdmin=await syncSupabaseAdmin(user);u.serverAdminVerified=!!u.isAdmin;
   const profileRow=(await supabaseClient.from('profiles').select('display_name,role,score').eq('id',user.id).maybeSingle()).data;
   if(profileRow?.display_name) u.name=profileRow.display_name;
   if(profileRow?.role) u.role=profileRow.role;
   if(profileRow && Number.isFinite(Number(profileRow.score)) && u.scoreManual!==true) u.score=Number(profileRow.score);
   if(u.isAdmin) u.role='admin';
   S.currentUser=u;
   ensureStoreForUser();
   save();
   window.pendingAuth=null;
   closeModal();
   toast(u.isAdmin?"Admin signed in successfully":"Signed in successfully");
   if(window.authReason==="seller")go("dashboard/overview"); else if(window.authReason==="admin")go("admin"); else render();
 }catch(e){console.error(e);toast(authOtpErrorMessage(e,"Invalid or expired verification code"));o.verifying=false;if(btn){btn.disabled=false;btn.textContent="Verify & Continue"}}
}
function replaceDevice(id){const u=window.pendingDeviceLogin?.u;if(!u)return;const devices=S.devices||[],mine=devices.filter(d=>d.userId===u.id),target=mine.find(d=>d.id===id);if(!target){toast("Device not found");return}if(Date.now()-target.lastSeen<7*86400000&&!confirm("This device was active recently. Replace it anyway?"))return;S.devices=devices.filter(d=>d.id!==id);S.devices.push({id:uid("dev"),userId:u.id,fingerprint:window.pendingDeviceLogin.fp,label:navigator.platform||"Device",lastSeen:Date.now()});S.currentUser=u;ensureStoreForUser();save();window.pendingDeviceLogin=null;closeModal();toast("New device approved");render()}
async function signout(){if(!confirm("Are you sure you want to sign out?"))return;try{await supabaseClient.auth.signOut()}catch(e){} S.currentUser=null;save();toast("Signed out");go("home")}
function changeUserId(){
 const u=S.currentUser;if(!u||u.isAdmin)return;
 const input=document.getElementById('newUserId'),next=(input?.value||'').trim().toUpperCase();
 if(!/^[A-Z0-9_-]{4,30}$/.test(next)){toast('User ID must be 4–30 characters: letters, numbers, _ or -');return}
 const current=String(u.userId||('SE-'+String(u.authId||u.id).replace(/-/g,'').slice(0,8))).toUpperCase();
 if(next===current){toast('This is already your User ID');return}
 if(u.userIdLastChanged&&Date.now()-u.userIdLastChanged<7*86400000){const left=Math.ceil((7*86400000-(Date.now()-u.userIdLastChanged))/86400000);toast('User ID can be changed again in '+left+' day(s)');return}
 if((S.users||[]).some(x=>x!==u&&String(x.userId||'').toUpperCase()===next)){toast('User ID already exists');return}
 const authId=u.authId||u.id;
 if(SUPABASE_READY&&authId){
   supabaseClient.from('profiles').select('id').eq('user_id',next).neq('id',authId).maybeSingle().then(r=>{
     if(r.error){toast('Could not verify User ID availability');console.warn('User ID check failed',r.error);return}
     if(r.data){toast('User ID already exists');return}
     u.userId=next;u.userIdLastChanged=Date.now();save();toast('User ID updated successfully');render();
   });
   return;
 }
 u.userId=next;u.userIdLastChanged=Date.now();save();toast('User ID updated successfully');render();
}
function deleteAccount(){
 const u=S.currentUser;if(!u)return;
 adminConfirm('Delete your account?','Your account and associated Sale Earn data will be permanently deleted. This cannot be undone. You will be signed out after the deletion is confirmed.','deleteAccountNow()','Delete Account')
}
async function deleteAccountNow(){
 const u=S.currentUser;if(!u)return;
 const authId=u.authId||u.id;
 if(!SUPABASE_READY||!window.supabaseClient?.rpc||!authId){
   toast('Secure account deletion is unavailable. Please try again later.');
   return;
 }
 try{
   // Permanent Auth deletion must happen server-side. The RPC should use
   // auth.uid() so a normal user can delete only their own account.
   const r=await supabaseClient.rpc('se_delete_own_account',{target_user_id:String(authId)});
   if(r?.error) throw r.error;
   const sid=u.sellerId;
   S.users=S.users.filter(x=>x.id!==u.id);
   S.orders=S.orders.filter(o=>o.customerId!==u.id&&o.customerEmail!==u.email);
   S.devices=S.devices.filter(d=>d.userId!==u.id);
   S.saved=(S.saved||[]).filter(x=>x.userId!==u.id);
   Object.keys(S.reviews||{}).forEach(pid=>{S.reviews[pid]=(S.reviews[pid]||[]).filter(r=>r.userId!==u.id)});
   Object.keys(S.follows||{}).forEach(k=>{if(k.startsWith(u.id+'_')||(u.authId&&k.startsWith(u.authId+'_')))delete S.follows[k]});
   if(sid){delete S.sellers[sid];S.products=S.products.filter(p=>p.sellerId!==sid)}
   S.currentUser=null;
   try{await supabaseClient.auth.signOut()}catch(_){}
   save();closeModal();toast('Account permanently deleted');go('home');
 }catch(e){
   console.error('Permanent account deletion failed:',e);
   toast(e?.message||'Account could not be permanently deleted. Please try again.');
 }
}
function accountPanel(){
 const u=S.currentUser;if(!u)return `${header()}<main class="page"><div class="container"><div class="auth-box"><h1>My Account</h1><p class="muted">Sign in to manage your saved products, orders and files.</p><button class="btn primary" onclick="openAuth('signin')">Sign In</button><button class="btn" onclick="openAuth('signup')">Create Account</button></div></div></main>${footer()}`;
 const r=route(),panel=r.startsWith('account/')?r.split('/')[1]:(r.startsWith('policy/')?'policy-'+r.split('/')[1]:'home');
 const orders=S.orders.filter(o=>!o.customerId||o.customerId===u.id||o.customerEmail===u.email);
 const saved=(S.saved||[]).filter(x=>x.userId===u.id).map(x=>product(x.productId)).filter(Boolean);
 const files=orders.filter(o=>o.status==='SUCCESS').map(o=>product(o.productId)).filter(Boolean);
 const active=(p)=>panel===p?'active':'';
 const nav=`<aside class="account-nav">
   <button class="${active('home')}" onclick="go('account/home')">♙ &nbsp; Home</button>
   <button class="${active('saved')}" onclick="go('account/saved')">♡ &nbsp; Saved</button>
   <button class="${active('orders')}" onclick="go('account/orders')">◈ &nbsp; Orders</button>
   <button class="${active('files')}" onclick="go('account/files')">⇩ &nbsp; Files</button>
   <button class="${active('security')}" onclick="go('account/security')">⚙ &nbsp; Security</button><button class="${active('appearance')}" onclick="go('account/appearance')">☾ &nbsp; Appearance</button><button class="${active('contact')}" onclick="go('policy/contact')">✉ &nbsp; Contact Us</button><div class="account-nav-divider">Website Information</div><button class="${active('policy-about')}" onclick="go('policy/about')">ⓘ &nbsp; About Sale Earn</button><button class="${active('policy-prohibited')}" onclick="go('policy/prohibited')">! &nbsp; Not Allowed</button><button class="${active('policy-pricing')}" onclick="go('policy/pricing')">₹ &nbsp; Pricing</button><button class="${active('policy-terms')}" onclick="go('policy/terms')">▣ &nbsp; Terms & Conditions</button><button class="${active('policy-privacy')}" onclick="go('policy/privacy')">◉ &nbsp; Privacy Policy</button><button class="${active('policy-refund')}" onclick="go('policy/refund')">↩ &nbsp; Cancellation & Refund</button><button class="${active('policy-shipping')}" onclick="go('policy/shipping')">▱ &nbsp; Shipping & Delivery</button>
 </aside>`;
 let content='';
 if(panel==='saved') content=`<div class="account-panel"><div class="section-head"><div><h2>Saved Products</h2><p>Products you saved for later.</p></div><span class="pill">♡ ${saved.length}</span></div>${saved.length?saved.map(p=>`<div class="asset-card" onclick="go('product/${p.id}')"><div style="width:82px;height:62px;border-radius:10px;overflow:hidden">${thumbMini(p)}</div><div class="asset-main"><b>${esc(p.title)}</b><div class="small muted">${esc(seller(p.sellerId).name)} · ${money(p.price)}</div></div><button class="btn iconbtn" onclick="event.stopPropagation();addCart('${p.id}')">＋</button><button class="btn iconbtn" onclick="event.stopPropagation();toggleSaved('${p.id}')">♥</button></div>`).join(''):`<div class="account-empty"><div class="empty-icon">♡</div><h2>Your wishlist is empty</h2><p class="muted">Add products you love to your wishlist to see them here.</p><button class="btn primary" onclick="go('market')">Explore Products</button></div>`}</div>`;
 else if(panel==='orders') content=`<div class="account-panel"><div class="section-head"><div><h2>Your Orders</h2><p>Purchased, pending and cancelled orders.</p></div><span class="pill">◈ ${orders.length} Orders</span></div>${orders.length?orders.map(o=>{const p=product(o.productId);const st=o.status==='SUCCESS'?'success':o.status==='PENDING'?'pending':'cancelled';return `<div class="account-order" onclick="accountOrderClick('${o.id}')">${thumbMini(p||{image:''})}<div class="account-order-main"><b>${esc(p?.title||'Product')}</b><div class="small muted">Order: ${esc(o.id)} · ${new Date(o.date).toLocaleString('en-IN')}</div><div class="small muted">Customer: ${esc(o.customerName||u.name)} · ${esc(o.customerEmail||u.email)}</div></div><div class="account-order-price">${money(o.amount)}<div><span class="account-badge ${st}">${esc(o.status)}</span></div></div></div>`}).join(''):`<div class="account-empty"><div class="empty-icon">◈</div><h2>No orders yet</h2><p class="muted">Your successful purchases will appear here.</p><button class="btn primary" onclick="go('market')">Explore Marketplace</button></div>`}</div>`;
 else if(panel==='files') content=`<div class="account-panel"><div class="section-head"><div><h2>Asset Library</h2><p>Your purchased digital products and secure delivery access.</p></div><span class="pill">⇩ ${files.length} Assets</span></div>${files.length?files.map(p=>{const o=orders.find(x=>x.productId===p.id&&x.status==='SUCCESS');return `<div class="asset-card" onclick="openPurchasedAsset('${o.id}')"><div style="width:82px;height:62px;border-radius:10px;overflow:hidden">${thumbMini(p)}</div><div class="asset-main"><b>${esc(p.title)}</b><div class="small muted">Purchased · ${o?new Date(o.date).toLocaleString('en-IN'):''}</div></div><button class="btn primary" onclick="event.stopPropagation();openPurchasedAsset('${o.id}')">Open File</button></div>`}).join(''):`<div class="account-empty"><div class="empty-icon">⇩</div><h2>Your Asset Library is Empty</h2><p class="muted">Once you purchase digital products, your download links and files will appear here automatically.</p><button class="btn primary" onclick="go('market')">Explore Marketplace</button></div>`}</div>`;
 else if(panel==='security') content=`<div class="account-profile-card"><h2 style="margin-top:0">Profile</h2><div class="security-form-grid"><div class="field"><label>FULL NAME</label><input id="profileName" value="${esc(u.name)}"></div><div class="field"><label>MOBILE NUMBER</label><input id="profileMobile" value="${esc(u.mobile||"")}" placeholder="Add your mobile number"></div></div><button class="btn primary" onclick="updateProfile()">Update Profile</button></div><div class="account-profile-card"><h2 style="margin-top:0">Security & Password</h2><div class="security-form-grid"><div class="field"><label>CURRENT PASSWORD</label><input id="currentPass" type="password"></div><div class="field"><label>NEW PASSWORD</label><input id="newPass" type="password"></div><div class="field"><label>CONFIRM PASSWORD</label><input id="confirmPass" type="password"></div></div><button class="btn" onclick="changePassword()">Change Password</button><div class="security-row"><div><b>Change User ID</b><div class="small muted">Once every 7 days</div></div><div style="display:flex;gap:8px;align-items:center"><input id="newUserId" value="${esc(u.userId||u.id)}" style="max-width:190px"><button class="btn" onclick="changeUserId()">Update ID</button></div></div><div class="security-row"><div><b>Login ID / Email</b><div class="small muted">${esc(u.email)}</div></div><span class="account-badge success">Verified</span></div></div><div class="account-danger"><h3 style="margin-top:0">Danger Zone</h3><p class="muted">Permanently delete your account and associated Sale Earn data. This action cannot be undone.</p><button class="btn danger" onclick="deleteAccount()">Delete Account</button></div>`;
 else if(panel==='appearance'){const ct=S.currentUser?.theme||'light';content=`<div class="account-panel"><div class="section-head"><div><h2>Appearance</h2><p>Choose your own website theme. The setting is saved to your account.</p></div></div><div class="admin-grid2" style="margin-top:10px"><button class="admin-kpi appearance-choice ${ct==='light'?'active':''}" onclick="setTheme('light')"><span>☀ Light Mode</span><b style="font-size:18px">Bright & clean</b><div class="theme-preview" style="background:#fff"><i style="background:#e9ecf5"></i><i style="background:#dcd7ff"></i><i style="background:#5146e5"></i></div></button><button class="admin-kpi appearance-choice ${ct==='dark'?'active':''}" onclick="setTheme('dark')"><span>☾ Dark Mode</span><b style="font-size:18px">Deep dark theme</b><div class="theme-preview" style="background:#080d1b"><i style="background:#111a2c"></i><i style="background:#26334d"></i><i style="background:#6d63f5"></i></div></button><button class="admin-kpi appearance-choice ${ct==='system'?'active':''}" onclick="setTheme('system')"><span>◐ System Mode</span><b style="font-size:18px">Follow device</b><div class="theme-preview" style="background:linear-gradient(90deg,#fff 50%,#080d1b 50%)"><i></i><i></i><i></i></div></button></div><div class="admin-card" style="margin-top:18px"><b>Current theme: ${ct==='dark'?'Dark':ct==='system'?'System':'Light'}</b><p class="small muted" style="margin:6px 0 0">The selected theme applies across the homepage, marketplace, product pages, cart, payment, seller dashboard and My Account.</p></div></div>`;}
else content=`<div class="account-help"><div><h2 style="margin:0 0 6px">Need Help?</h2><p style="margin:0;opacity:.82">Our support team is available to assist you with product and account questions.</p><b>Support</b></div><button class="btn" onclick="window.open('https://t.me/NextIdea66','_blank')">Message Us</button></div><div class="account-stats"><div class="account-stat"><b>${orders.length}</b><span class="muted">Orders Placed</span></div><div class="account-stat"><b>${files.length}</b><span class="muted">Digital Assets</span></div></div><div class="account-panel"><div class="section-head"><div><h3>Recent Activity</h3><p>Click any item to open its related page.</p></div><button class="btn" onclick="go('account/orders')">View All</button></div>${orders.slice(0,6).map(o=>{const p=product(o.productId);return `<div class="account-order" onclick="accountOrderClick('${o.id}')"><div class="account-order-main"><b>${esc(p?.title||'Product')}</b><div class="small muted">${new Date(o.date).toLocaleString('en-IN')} · ${esc(o.id)}</div></div><span class="account-badge ${o.status==='SUCCESS'?'success':o.status==='PENDING'?'pending':'cancelled'}">${esc(o.status)}</span></div>`}).join('')||`<div class="account-empty"><p class="muted">No recent activity yet.</p><button class="btn primary" onclick="go('market')">Explore Marketplace</button></div>`}</div>`;
 return `${header()}<main class="page account-shell"><div class="container"><div class="account-head"><div class="account-user"><div class="account-avatar">${esc((u.name||'U').charAt(0).toUpperCase())}</div><div><h1 style="margin:0">Account Settings</h1><p class="muted" style="margin:4px 0">${esc(u.email)}</p></div></div><div style="display:flex;gap:8px">${u.isAdmin?`<button class="btn" onclick="go('admin')">Admin</button>`:""}<button class="btn" onclick="signout()">↪ Sign Out</button></div></div><div class="account-layout">${nav}<section>${content}</section></div></div></main>${footer()}`;
}
function setTheme(theme){const t=['light','dark','system'].includes(theme)?theme:'system',u=S.currentUser;if(u)u.theme=t;localStorage.setItem('saleEarnTheme',t);applyTheme();if(u)save();toast(t==='dark'?'Dark mode enabled':t==='light'?'Light mode enabled':'System mode enabled');render()}
function applyTheme(){const t=S.currentUser?.theme||localStorage.getItem('saleEarnTheme')||'system';const dark=t==='dark'||(t==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light'}
(function(){try{const mq=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');if(mq){const fn=()=>{if(S.currentUser?.theme==='system')applyTheme()};mq.addEventListener?mq.addEventListener('change',fn):mq.addListener&&mq.addListener(fn)}}catch(e){}})();
function updateProfile(){const u=S.currentUser;if(!u)return;const newName=document.getElementById("profileName").value.trim()||u.name;if(newName!==u.name&&u.profileLastChanged&&Date.now()-u.profileLastChanged<7*86400000){toast("Profile name can be changed once every 7 days");return}u.name=newName;u.profileLastChanged=Date.now();u.mobile=document.getElementById("profileMobile").value.trim();const ss=u.sellerId?seller(u.sellerId):null;if(ss)ss.owner=u.name;save();toast("Profile updated");render()}
function changePassword(){const u=S.currentUser;if(!u)return;const a=document.getElementById("currentPass").value,b=document.getElementById("newPass").value,c=document.getElementById("confirmPass").value;if(a!==u.password){toast("Current password is incorrect");return}if(b.length<6){toast("New password must be at least 6 characters");return}if(b!==c){toast("Passwords do not match");return}u.password=b;save();toast("Password changed successfully");render()}
function accountOrderClick(id){const o=S.orders.find(x=>x.id===id);if(!o)return; if(o.status==='SUCCESS')openPurchasedAsset(id); else if(o.status==='PENDING')openBuy(o.productId); else go('product/'+o.productId)}
function openPurchasedAsset(orderId){const o=S.orders.find(x=>x.id===orderId),u=S.currentUser;if(!o||!u||(o.customerId&&o.customerId!==u.id&&o.customerEmail!==u.email)||o.status!=='SUCCESS'){toast('Secure file access unavailable');return}go('success/'+o.id)}
function toggleSaved(pid){if(!S.currentUser){openAuth('signin','save');return}S.saved=S.saved||[];const i=S.saved.findIndex(x=>x.userId===S.currentUser.id&&x.productId===pid);if(i>=0){S.saved.splice(i,1);toast('Removed from Saved')}else{S.saved.push({userId:S.currentUser.id,productId:pid,date:nowISO()});toast('Saved')}save();render()}
function account(){return accountPanel()}

/* -------------------- CONTACT -------------------- */
function contact(){return `${header()}<main class="page"><div class="container"><div class="auth-box" style="max-width:700px"><button class="btn" onclick="goBack()">← Back</button><h1 style="margin-top:20px">Contact Us</h1><p class="muted">Need help with a product, store or account? Send a message directly to Sale Earn Support.</p><div class="form-grid"><div class="field"><label>User ID</label><input id="ctUserId" value="${esc(S.currentUser?.userId||S.currentUser?.id||"")}" placeholder="Enter your User ID"></div><div class="field"><label>Name</label><input id="ctName" value="${esc(S.currentUser?.name||"")}" placeholder="Your name"></div><div class="field"><label>Email</label><input id="ctEmail" value="${esc(S.currentUser?.email||"")}" placeholder="Your email"></div></div><div class="form-grid"><div class="field"><label>Subject</label><input id="ctSubject" maxlength="160" placeholder="What do you need help with?"></div><div class="field"><label>First name <span class="muted">optional</span></label><input id="ctFirstName" placeholder="First name"></div><div class="field"><label>Last name <span class="muted">optional</span></label><input id="ctLastName" placeholder="Last name"></div></div><div class="field"><label>Message</label><textarea id="ctMsg" placeholder="How can we help?"></textarea></div><button class="btn primary" onclick="sendContact()">Send Message</button><div class="dash-card" style="margin-top:15px"><b>Support email</b><p>MohitGhasoliya90014@gmail.com</p><small class="muted">Messages from this form are stored securely in the Admin Mail Center.</small><b>WhatsApp</b><p>Not available</p><b>Telegram</b><p><a style="color:var(--brand)" href="https://t.me/nextidea66" target="_blank" rel="noopener">@nextidea66</a></p></div></div></div></main>${footer()}`
}
let CONTACT_ADMIN_SYNC_BUSY=false;
let CONTACT_ADMIN_POLL_TIMER=null;
let CONTACT_ADMIN_INITIAL_LOADED=false;
let CONTACT_ADMIN_REALTIME_CHANNEL=null;
let CONTACT_ADMIN_REALTIME_STARTED=false;
async function storeContactMessageCloud(payload){
  if(!window.supabaseClient) return {ok:false,reason:"Supabase unavailable"};
  const row={
    name:String(payload.name||'Guest').slice(0,160),
    email:String(payload.email||'').slice(0,320),
    subject:String(payload.subject||'General Inquiry').slice(0,200),
    message:String(payload.message||'').slice(0,10000),
    user_id:payload.userId||null
  };
  try{
    // Keep support messages in the Sale Earn database so an authenticated Admin
    // can see them from any device. The public insert policy belongs in Supabase RLS.
    // Do not chain .select() here. A public contact form only needs INSERT
    // permission; requiring SELECT on the inserted row can make a valid
    // message look like a failed send when RLS intentionally blocks reads.
    // Hard timeout: never let a hung network request leave the Send button stuck.
    const insertPromise=window.supabaseClient.from("contact_messages").insert(row);
    const timeoutPromise=new Promise((_,rej)=>setTimeout(()=>rej(new Error('Request timed out. Check your internet connection and try again.')),20000));
    const {error}=await Promise.race([insertPromise,timeoutPromise]);
    if(error){
      console.warn("contact_messages insert failed:",error.message||error);
      return {ok:false,reason:error.message||"contact_messages insert failed"};
    }
    return {ok:true,row:null};
  }catch(e){
    console.warn("contact_messages insert failed:",e);
    return {ok:false,reason:e?.message||"contact_messages insert failed"};
  }
}
function contactRowToMail(row, previous={}){
 const externalId=String(row?.id||row?.message_id||row?.created_at||uid("contact"));
 const from=String(row?.email||row?.from_email||row?.sender_email||"Guest");
 const name=String(row?.name||row?.full_name||row?.sender_name||"Guest");
 const msg=String(row?.message||row?.body||"");
 const subject=String(row?.subject||"Contact Support");
 const platformCfg=(typeof cfg==='function'?cfg():{})||{};
 /* Read=true is monotonic locally. A stale SELECT/realtime payload must never
    downgrade a message that this browser already confirmed as read. */
 const incomingRead=!!row?.read;
 const mergedRead=previous?.read===true ? true : incomingRead;
 return {...previous,id:`contact-${externalId}`,externalId,type:"contact",from:name,fromEmail:from,to:platformCfg.branding?.contactEmail||"Sale Earn Support",subject,body:msg,plainMessage:msg,userId:row?.user_id||row?.userId||row?.userid||null,productId:row?.product_id||null,orderId:row?.order_id||null,date:row?.created_at||row?.createdAt||nowISO(),read:mergedRead,readAt:mergedRead?(previous?.readAt||nowISO()):null,starred:previous?.starred===true?true:!!row?.starred,cloudSynced:true};
}
function mergeContactMailRows(rows){
 /* This function can run before the later Mail Center script defines mailStore().
    Read the state directly so early Admin realtime events cannot throw. */
 const existing=Array.isArray(S.mailMessages)?S.mailMessages:[];
 const map=new Map(existing.map(x=>[String(x.externalId||x.id),x]));
 (Array.isArray(rows)?rows:[]).forEach(row=>{
   const externalId=String(row?.id||row?.message_id||row?.created_at||"");
   if(!externalId)return;
   map.set(externalId,contactRowToMail(row,map.get(externalId)||{}));
 });
 S.mailMessages=Array.from(map.values()).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,500);
 sePersist();
}
async function loadContactMessagesForAdmin(force=false){
 if(!force&&CONTACT_ADMIN_INITIAL_LOADED)return true;
 if(CONTACT_ADMIN_SYNC_BUSY||!isAdmin()||!window.supabaseClient)return false;
 CONTACT_ADMIN_SYNC_BUSY=true;
 try{
   const {data,error}=await window.supabaseClient.from("contact_messages").select("id,name,email,subject,message,user_id,created_at,read,starred").order("created_at",{ascending:false}).limit(300);
   if(error){console.warn("Contact message inbox read failed:",error.message||error);return;}
   mergeContactMailRows(data);
   CONTACT_ADMIN_INITIAL_LOADED=true;
   if(String(route()||"")==="admin/mail")render();
 }catch(e){console.warn("Contact message inbox sync failed:",e);}
 finally{CONTACT_ADMIN_SYNC_BUSY=false;}
}
async function startContactAdminRealtime(){
 if(CONTACT_ADMIN_REALTIME_STARTED||!isAdmin()||!window.supabaseClient)return;
 CONTACT_ADMIN_REALTIME_STARTED=true;
 try{
   CONTACT_ADMIN_REALTIME_CHANNEL=window.supabaseClient.channel('saleearn-admin-contact-mail');
   CONTACT_ADMIN_REALTIME_CHANNEL.on('postgres_changes',{event:'INSERT',schema:'public',table:'contact_messages',select:['id','name','email','subject','message','user_id','created_at','read','starred']},payload=>{
     if(!isAdmin())return;
     mergeContactMailRows([payload.new]);
     if(String(route()||"")==="admin/mail")render();
   }).on('postgres_changes',{event:'UPDATE',schema:'public',table:'contact_messages',select:['id','name','email','subject','message','user_id','created_at','read','starred']},payload=>{
     if(!isAdmin())return;
     mergeContactMailRows([payload.new]);
     if(String(route()||"")==="admin/mail")render();
   }).on('postgres_changes',{event:'DELETE',schema:'public',table:'contact_messages',select:['id']},payload=>{
     const id=String(payload.old?.id||payload.old?.message_id||"");
     if(id){S.mailMessages=(Array.isArray(S.mailMessages)?S.mailMessages:[]).filter(x=>String(x.externalId||x.id)!==id);sePersist();}
     if(String(route()||"")==="admin/mail")render();
   });
   await CONTACT_ADMIN_REALTIME_CHANNEL.subscribe(status=>{
     if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
       CONTACT_ADMIN_REALTIME_STARTED=false;
       CONTACT_ADMIN_REALTIME_CHANNEL=null;
       CONTACT_ADMIN_INITIAL_LOADED=false;
     }
   });
 }catch(e){
   CONTACT_ADMIN_REALTIME_STARTED=false;CONTACT_ADMIN_REALTIME_CHANNEL=null;
   console.warn('Contact mail realtime unavailable:',e?.message||e);
 }
}
function stopContactAdminRealtime(){
 if(CONTACT_ADMIN_REALTIME_CHANNEL&&window.supabaseClient){try{window.supabaseClient.removeChannel(CONTACT_ADMIN_REALTIME_CHANNEL);}catch(e){}}
 CONTACT_ADMIN_REALTIME_CHANNEL=null;CONTACT_ADMIN_REALTIME_STARTED=false;
}
function stopContactAdminPolling(){clearTimeout(CONTACT_ADMIN_POLL_TIMER);CONTACT_ADMIN_POLL_TIMER=null;}

async function sendContact(){
 const uidValue=document.getElementById("ctUserId")?.value.trim()||S.currentUser?.userId||S.currentUser?.id||"Guest",
       first=document.getElementById("ctFirstName")?.value.trim()||"",
       last=document.getElementById("ctLastName")?.value.trim()||"",
       n=document.getElementById("ctName")?.value.trim()||[first,last].filter(Boolean).join(" "),
       e=document.getElementById("ctEmail")?.value.trim(),
       m=document.getElementById("ctMsg")?.value.trim(),
       subject=document.getElementById("ctSubject")?.value.trim()||"General Inquiry";
 if(!n||!e||!m){toast("Please fill name, email and message");return}
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){toast("Please enter a valid email address");return}
 if(m.length>10000){toast("Message is too long");return}
 const btn=document.querySelector('[onclick="sendContact()"]');
 if(btn){btn.disabled=true;btn.textContent="Sending…"}
 const body=`User ID: ${uidValue}\nName: ${n}\nEmail: ${e}\nSubject: ${subject}\n\nMessage:\n${m}`;
 const localMsg={id:uid("mail"),type:"contact",from:n,fromEmail:e,to:ensurePlatformConfig().branding?.contactEmail||"Sale Earn Support",subject,body,plainMessage:m,userId:S.currentUser?.authId||S.currentUser?.id||uidValue,date:nowISO(),read:false,starred:false,cloudSynced:false};
 try{
   const cloud=await storeContactMessageCloud({name:n,email:e,subject,message:m,userId:S.currentUser?.authId||S.currentUser?.id||null});
   if(!cloud.ok)throw new Error(cloud.reason||"Could not save support message");
   localMsg.cloudSynced=true;
   localMsg.externalId=cloud.row?.id||cloud.row?.message_id||cloud.row?.created_at||null;
   S.mailMessages=Array.isArray(S.mailMessages)?S.mailMessages:[];
   S.mailMessages.unshift(localMsg);
   if(S.mailMessages.length>500)S.mailMessages.length=500;
   sePersist();
   if(S.currentUser)save();
   document.getElementById("ctMsg").value="";
   toast("Message sent — Admin Mail Center has received it");
 }catch(err){
   console.error("Contact delivery failed:",err);
   // Keep an unsent draft only on this device. Do not silently send customer data
   // to an unrelated third-party mail service.
   localMsg.cloudError=String(err?.message||err);
   S.mailMessages=Array.isArray(S.mailMessages)?S.mailMessages:[];
   S.mailMessages.unshift(localMsg);
   if(S.mailMessages.length>500)S.mailMessages.length=500;
   sePersist();
   toast('Message could not reach Admin: '+String(err?.message||err||'unknown error'));
 }finally{
   if(btn){btn.disabled=false;btn.textContent="Send Message"}
 }
}


/* v78 Admin password field visibility controls. */
(function(){
  if(document.getElementById('saleearn-admin-password-visibility-v78'))return;
  const st=document.createElement('style');
  st.id='saleearn-admin-password-visibility-v78';
  st.textContent=`
    .se-admin-password-wrap{position:relative;width:100%;display:block}
    .se-admin-password-wrap input{width:100%;padding-right:48px!important;box-sizing:border-box}
    .se-admin-password-toggle{position:absolute;right:7px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:1px solid var(--line,#d7dce8);border-radius:9px;background:var(--surface,#fff);cursor:pointer;display:grid;place-items:center;font-size:17px;line-height:1;z-index:2}
    .se-admin-password-toggle:hover{transform:translateY(-50%) scale(1.04);border-color:var(--primary,#635bff)}
  `;
  document.head.appendChild(st);
})();

/* -------------------- PRIVATE ADMIN -------------------- */
/* v80: Admin authorization is server-authoritative.
   The browser may render an Admin screen, but privileged database operations are
   protected by Supabase Auth + admin_users + RLS/RPC. Do not treat localStorage,
   sessionStorage, HTML edits, or user metadata as proof of admin rights. */
function isAdmin(){
 const u=S.currentUser;
 if(!u||u.isAdmin!==true)return false;
 const authId=String(u.authId||u.id||"");
 return authId===String(window.__saleEarnAuthUserId||authId) && !!u.serverAdminVerified;
}
const SE_ADMIN_PW_SESSION='saleearn_admin_pw_unlocked_v2';
let seAdminPasswordModalOpen=false;
function seAdminPwUnlocked(){
 try{return sessionStorage.getItem(SE_ADMIN_PW_SESSION+':'+String(S.currentUser?.authId||S.currentUser?.id||''))==='1'}catch{return false}
}
function seAdminPwMarkUnlocked(){try{sessionStorage.setItem(SE_ADMIN_PW_SESSION+':'+String(S.currentUser?.authId||S.currentUser?.id||''),'1')}catch{}}
function seAdminPwClearUnlocked(){try{sessionStorage.removeItem(SE_ADMIN_PW_SESSION+':'+String(S.currentUser?.authId||S.currentUser?.id||''))}catch{}}
function seAdminPwToggle(id,button){
 const input=document.getElementById(id);
 if(!input)return;
 const showing=input.type==='text';
 input.type=showing?'password':'text';
 button.setAttribute('aria-label',showing?'Show password':'Hide password');
 button.title=showing?'Show password':'Hide password';
 button.textContent=showing?'👁':'🙈';
}
async function seAdminRpc(name,args){
 if(!window.supabaseClient?.rpc)throw new Error('Secure Admin backend is not connected.');
 const {data,error}=await window.supabaseClient.rpc(name,args||{});
 if(error)throw error;
 return data;
}
function seAdminPwOpen(mode='verify'){
 if(seAdminPasswordModalOpen)return;
 if(!isAdmin()){toast('Admin access required');return}
 seAdminPasswordModalOpen=true;
 const first=mode==='setup';
 document.getElementById('modalRoot').innerHTML=`<div class="modal-bg" data-admin-password-gate="1"><div class="modal" style="max-width:520px"><button class="btn iconbtn close" onclick="seAdminPwClose()">×</button><div class="tabs"><button class="active">Admin Security</button></div><h2>${first?'Set Admin Password':'Admin Password Required'}</h2><p class="muted">${first?'Create the Admin password. It will be stored only as a secure server-side hash.':'Enter the Admin password. The password is checked on the secure Supabase backend; it is not stored in this HTML or browser storage.'}</p>${first?`<div class="field"><label>NEW ADMIN PASSWORD</label><div class="se-admin-password-wrap"><input id="seAdminPw1" type="password" autocomplete="new-password" minlength="8" placeholder="Minimum 8 characters"><button type="button" class="se-admin-password-toggle" onclick="seAdminPwToggle('seAdminPw1',this)" aria-label="Show password" title="Show password">👁</button></div></div><div class="field"><label>CONFIRM PASSWORD</label><div class="se-admin-password-wrap"><input id="seAdminPw2" type="password" autocomplete="new-password" minlength="8" placeholder="Re-enter password"><button type="button" class="se-admin-password-toggle" onclick="seAdminPwToggle('seAdminPw2',this)" aria-label="Show password" title="Show password">👁</button></div></div><div class="modal-footer"><button class="btn primary" onclick="seAdminPwSet()">Set Password & Continue</button></div>`:`<div class="field"><label>ADMIN PASSWORD</label><div class="se-admin-password-wrap"><input id="seAdminPw1" type="password" autocomplete="current-password" placeholder="Enter Admin password" onkeydown="if(event.key==='Enter')seAdminPwVerify()"><button type="button" class="se-admin-password-toggle" onclick="seAdminPwToggle('seAdminPw1',this)" aria-label="Show password" title="Show password">👁</button></div></div><div id="seAdminPwError" class="small" style="min-height:20px"></div><div class="modal-footer"><button class="btn primary" onclick="seAdminPwVerify()">Unlock Admin</button></div>`}</div></div>`;
 setTimeout(()=>document.getElementById('seAdminPw1')?.focus(),0);
}
function seAdminPwClose(){if(seAdminPasswordModalOpen){seAdminPasswordModalOpen=false;closeModal()}}
async function seAdminPwSet(){
 if(!isAdmin())return;
 const a=String(document.getElementById('seAdminPw1')?.value||''),b=String(document.getElementById('seAdminPw2')?.value||'');
 if(a.length<8)return toast('Admin password must be at least 8 characters');
 if(a!==b)return toast('Passwords do not match');
 try{
   const saved=await seAdminRpc('saleearn_set_admin_password',{p_new_password:a});
   if(saved!==true)throw new Error('The secure password setup was not accepted.');
   seAdminPwMarkUnlocked();seAdminPasswordModalOpen=false;closeModal();toast('Admin password set successfully');render();
 }catch(e){console.error('Admin password setup failed',e);toast(e?.message||'Could not save the Admin password.');}
}
async function seAdminPwVerify(){
 if(!isAdmin())return;
 const input=String(document.getElementById('seAdminPw1')?.value||'');
 const err=document.getElementById('seAdminPwError');
 if(!input)return;
 try{
   const ok=await seAdminRpc('saleearn_verify_admin_password',{p_password:input});
   if(ok!==true){if(err)err.textContent='Incorrect Admin password.';return}
   seAdminPwMarkUnlocked();
   seAdminPasswordModalOpen=false;closeModal();toast('Admin unlocked');render();
 }catch(e){console.error('Admin password verification failed',e);if(err)err.textContent=e?.message||'Secure Admin verification failed.';}
}
async function seAdminPwNeedsSetup(){
 try{return (await seAdminRpc('saleearn_admin_password_configured'))!==true}catch(e){return false}
}
async function seAdminPwChange(){
 if(!isAdmin())return;
 document.getElementById('modalRoot').innerHTML=`<div class="modal-bg" data-admin-password-change="1"><div class="modal" style="max-width:520px"><button class="btn iconbtn close" onclick="closeModal()">×</button><div class="tabs"><button class="active">Admin Security</button></div><h2>Change Admin Password</h2><p class="muted">Enter the current password, then choose a new Admin password. The new password is stored only as a secure server-side hash.</p><div class="field"><label>CURRENT ADMIN PASSWORD</label><div class="se-admin-password-wrap"><input id="seAdminOldPw" type="password" autocomplete="current-password"><button type="button" class="se-admin-password-toggle" onclick="seAdminPwToggle('seAdminOldPw',this)" aria-label="Show password" title="Show password">👁</button></div></div><div class="field"><label>NEW ADMIN PASSWORD</label><div class="se-admin-password-wrap"><input id="seAdminNewPw" type="password" minlength="8" autocomplete="new-password"><button type="button" class="se-admin-password-toggle" onclick="seAdminPwToggle('seAdminNewPw',this)" aria-label="Show password" title="Show password">👁</button></div></div><div class="field"><label>CONFIRM NEW PASSWORD</label><div class="se-admin-password-wrap"><input id="seAdminNewPw2" type="password" minlength="8" autocomplete="new-password"><button type="button" class="se-admin-password-toggle" onclick="seAdminPwToggle('seAdminNewPw2',this)" aria-label="Show password" title="Show password">👁</button></div></div><div id="seAdminChangeError" class="small" style="min-height:20px"></div><div class="modal-footer"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="seAdminPwChangeSave()">Change Password</button></div></div></div>`;
 setTimeout(()=>document.getElementById('seAdminOldPw')?.focus(),0);
}
async function seAdminPwChangeSave(){
 if(!isAdmin())return;
 const old=String(document.getElementById('seAdminOldPw')?.value||''),next=String(document.getElementById('seAdminNewPw')?.value||''),confirm=String(document.getElementById('seAdminNewPw2')?.value||'');
 const err=document.getElementById('seAdminChangeError');
 if(!old||!next||!confirm){if(err)err.textContent='Fill all password fields.';return}
 if(next.length<8){if(err)err.textContent='New Admin password must be at least 8 characters.';return}
 if(next!==confirm){if(err)err.textContent='New passwords do not match.';return}
 try{
   const verified=await seAdminRpc('saleearn_verify_admin_password',{p_password:old});
   if(verified!==true){if(err)err.textContent='Current Admin password is incorrect.';return}
   const saved=await seAdminRpc('saleearn_set_admin_password',{p_new_password:next});
   if(saved!==true)throw new Error('The secure password update was not accepted.');
   seAdminPwMarkUnlocked();closeModal();toast('Admin password changed successfully');
 }catch(e){console.error('Admin password change failed',e);if(err)err.textContent=e?.message||'Could not save the new Admin password.';}
}
function adminOnly(){
 if(!S.currentUser){openAuth('signin','admin');return false}
 if(!isAdmin()){toast('Admin access required');return false}
 if(seAdminPwUnlocked())return true;
 seAdminPwOpen();
 return false;
}
function adminConfirm(title,message,action,label="Confirm"){document.getElementById("modalRoot").innerHTML=`<div class="admin-confirm-bg"><div class="admin-confirm"><h2 style="margin-top:0">${esc(title)}</h2><p class="muted">${esc(message)}</p><div class="modal-footer"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn danger" onclick="${action};closeModal()">${esc(label)}</button></div></div></div>`}
function adminNav(page){return go('admin'+(page?'/' + page:''))}
function logProductActivity(productId,action,meta={}){S.productActivity=S.productActivity||[];S.productActivity.unshift({id:uid("act"),productId,action,date:nowISO(),sellerId:meta.sellerId||S.currentUser?.sellerId||null,meta:meta||{}});if(S.productActivity.length>300)S.productActivity.length=300}
function logAdminAudit(action,targetId,meta={}){if(!S.currentUser?.isAdmin)return;S.adminAuditLog=S.adminAuditLog||[];S.adminAuditLog.unshift({id:uid("audit"),action,targetId,date:nowISO(),adminId:S.currentUser.id,meta:meta||{}});if(S.adminAuditLog.length>300)S.adminAuditLog.length=300}
function adminStats(){
 const orders=S.orders.filter(o=>o.status==='SUCCESS');
 const sales=orders.reduce((a,o)=>a+Number(o.amount||0),0);
 const earnings=orders.reduce((a,o)=>{const net=o.netSellerAmount!=null?Number(o.netSellerAmount):Number(o.amount||0)*(1-Number(o.platformFeeRate??.20));return a+net},0);
 return {orders,sales,earnings,reviews:Object.values(S.reviews||{}).flat(),deleted:S.deletedProducts||[]};
}
function adminSidebar(active){const items=[['','▦','Dashboard'],['control','⚙','Platform Control Center'],['money','₹','Money Overview'],['users','♙','Users'],['products','◈','Products'],['orders','▤','Orders'],['reviews','★','Reviews'],['smartreviews','✦','Smart Reviews'],['sales','₹','Sales & Earnings'],['payouts','⇧','Withdrawals'],['warnings','⚠','Warnings'],['commission','◔','Total Web Commission'],['ranking','↗','Seller Ranking'],['growth','⚡','Seller Growth'],['analytics','▥','Analytics'],['risk','⚠','Risk Center'],['coupons','%','Coupons'],['security','⌘','Security'],['audit','⌁','Admin Audit Log']];const recycleCount=(S.deletedProducts||[]).length;return `<aside class="admin-side"><button class="admin-brand" onclick="go('home')" title="Go to Homepage"><span class="logo-mark">SE</span><span>SALE EARN<br><small>ADMIN PANEL</small></span></button><div class="admin-nav-title">Management</div>${items.map(([id,ic,label])=>`<button class="admin-link ${active===id?'active':''}" onclick="adminNav('${id}')"><span>${ic}</span><span class="label">${label}</span>${id==='warnings'&&S.warnings?.length?`<span class="count">${S.warnings.length}</span>`:''}</button>`).join('')}<div class="admin-nav-title">System</div><button class="admin-link ${active==='emergency'?'active':''}" onclick="adminNav('emergency')"><span>⛔</span><span class="label">Emergency Controls</span></button><button class="admin-link ${active==='deleted'?'active':''}" onclick="adminNav('deleted')"><span>⌫</span><span class="label">Recycle Bin</span>${recycleCount?`<span class="count">${recycleCount}</span>`:''}</button><button class="admin-link ${active==='system'?'active':''}" onclick="adminNav('system')"><span>⚙</span><span class="label">System Health</span></button><button class="admin-link" onclick="go('account')"><span>⚙</span><span class="label">My Account</span></button><button class="admin-link" onclick="goBack()"><span>←</span><span class="label">Back</span></button><button class="admin-link" onclick="signout()"><span>↪</span><span class="label">Sign Out</span></button></aside>`}
function adminTop(title){return `<div class="admin-top"><div><h1>${esc(title)}</h1><span class="small muted">Private administration • Authorized account only</span></div><div class="admin-search-wrap"><input id="adminGlobalSearch" class="input admin-search" placeholder="Search users, products, orders..." oninput="adminSearchLive(this.value)" onkeydown="if(event.key==='Enter'){adminSearch(this.value)}" autocomplete="off"><div id="adminSearchResults" class="admin-search-results hidden"></div></div><div style="display:flex;gap:8px;align-items:center"><span class="admin-pill success">● ADMIN</span><button class="btn" onclick="seAdminPwChange()">🔐 Password</button><button class="btn admin-back-btn" onclick="goBack()">← Back</button></div></div>`}
function adminLayout(active,title,content){if(!adminOnly())return `${header()}<main class="page"></main>`;return `<div class="admin-shell">${adminSidebar(active)}<section class="admin-main">${adminTop(title)}<div class="admin-content">${content}</div></section></div>`}
function bindAdminScroll(){const c=document.querySelector('.admin-content');const w=document.querySelector('.admin-search-wrap');if(!c||!w)return;c.onscroll=()=>w.classList.toggle('admin-search-hidden',c.scrollTop>34);w.classList.remove('admin-search-hidden');}
function adminPage(){
 const st=adminStats(),u=S.users,p=S.products,o=S.orders;
 const recent=o.slice(0,7),latest=u.slice(-7).reverse();
 const totalSp=s=>o.filter(x=>x.sellerId===s&&x.status==='SUCCESS').reduce((a,x)=>a+Number(x.amount||0),0);
 const recentOrders=`<div class="admin-card"><div class="section-head"><div><h2>Recent Orders</h2><div class="sub">Click any order to inspect customer, product, payment and status.</div></div><button class="btn" onclick="adminNav('orders')">View All</button></div><table class="admin-table"><thead><tr><th>Order</th><th>User</th><th>Product</th><th>Amount</th><th>Status</th></tr></thead><tbody>${recent.map(x=>{const pr=product(x.productId);return `<tr class="data-row" onclick="adminNav('order/${x.id}')"><td><b>#${esc(x.id)}</b><div class="small muted">${new Date(x.date).toLocaleString('en-IN')}</div></td><td>${esc(x.customerId||x.customerEmail||'-')}</td><td>${esc(pr?.title||'Deleted product')}</td><td>${money(x.amount)}</td><td><span class="admin-pill ${x.status==='SUCCESS'?'success':x.status==='CANCELLED'?'danger':'warn'}">${esc(x.status)}</span></td></tr>`}).join('')||`<tr><td colspan="5"><div class="admin-empty">No orders yet.</div></td></tr>`}</tbody></table></div>`;
 const latestUsers=`<div class="admin-card"><div class="section-head"><div><h2>Latest Users</h2><div class="sub">Click a user to inspect account, store, orders and activity.</div></div><button class="btn" onclick="adminNav('users')">View All</button></div><table class="admin-table"><thead><tr><th>User ID</th><th>Email</th><th>Orders</th><th>Status</th></tr></thead><tbody>${latest.map(x=>{const oo=o.filter(y=>y.customerId===x.id);const restricted=x.unpublicUntil&&x.unpublicUntil>Date.now();return `<tr class="data-row" onclick="adminNav('user/${x.id}')"><td><b>${esc(x.id)}</b><div class="small muted">${esc(x.name)}</div></td><td>${esc(x.email)}</td><td>${oo.length}</td><td><span class="admin-pill ${restricted?'danger':'success'}">${restricted?'Restricted':'Active'}</span></td></tr>`}).join('')||`<tr><td colspan="4"><div class="admin-empty">No users yet.</div></td></tr>`}</tbody></table></div>`;
 return adminLayout('','Dashboard',`<div class="admin-kpis"><div class="admin-kpi" onclick="adminNav('users')"><div class="kpi-icon">♙</div><span>Total Users</span><b>${u.length}</b></div><div class="admin-kpi" onclick="adminNav('products')"><div class="kpi-icon">◈</div><span>Total Products</span><b>${p.length}</b></div><div class="admin-kpi" onclick="adminNav('orders')"><div class="kpi-icon">▤</div><span>Total Orders</span><b>${o.length}</b></div><div class="admin-kpi" onclick="adminNav('sales')"><div class="kpi-icon">₹</div><span>Total Sales</span><b>${money(st.sales)}</b></div></div><div class="admin-kpis" style="margin-top:15px"><div class="admin-kpi" onclick="adminNav('sales')"><span>Seller Earnings</span><b>${money(st.earnings)}</b><small class="muted">Net after platform fee</small></div><div class="admin-kpi" onclick="adminNav('orders')"><span>Successful Orders</span><b>${st.orders.length}</b></div><div class="admin-kpi" onclick="adminNav('reviews')"><span>Total Reviews</span><b>${st.reviews.length}</b></div><div class="admin-kpi" onclick="adminNav('commission')"><span>Total Web Commission</span><b>${money(webCommissionStats().net)}</b><small class="muted">Platform earnings</small></div></div><div class="admin-grid2">${recentOrders}${latestUsers}</div><div class="admin-grid2"><div class="admin-card"><h2>Orders Overview</h2><div class="sub">Current order status distribution.</div>${['SUCCESS','PENDING','CANCELLED','FAILED'].map(k=>{const n=o.filter(x=>x.status===k).length;return `<div style="display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid #edf0f5"><span>${k}</span><b>${n}</b></div>`}).join('')}</div><div class="admin-card"><h2>Today's Sales & Earnings</h2><div class="sub">Successful transactions recorded today.</div>${(()=>{const d=new Date().toDateString(),td=st.orders.filter(x=>new Date(x.date).toDateString()===d);const sale=td.reduce((a,x)=>a+Number(x.amount||0),0),earn=td.reduce((a,x)=>a+(x.netSellerAmount!=null?Number(x.netSellerAmount):Number(x.amount||0)*(1-Number(x.platformFeeRate??.20))),0);return `<div class="admin-stat-row"><div class="admin-stat"><b>${td.length}</b><span class="small muted">Orders</span></div><div class="admin-stat"><b>${money(sale)}</b><span class="small muted">Sales</span></div><div class="admin-stat"><b>${money(earn)}</b><span class="small muted">Net earnings</span></div></div>`})()}</div></div>`);
}
function adminUsers(){const rows=(S.users||[]).filter(u=>u&&!u.isAdmin&&String(u.id||'').trim()&&String(u.email||'').trim());return adminLayout('users','Users',`<div class="admin-card"><div class="section-head"><div><h2>All Users</h2><div class="sub">Every account can buy and sell. Admin controls are separate.</div></div></div><table class="admin-table"><thead><tr><th>User</th><th>Email</th><th>Store</th><th>Orders</th><th>Sales</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(u=>{const oo=S.orders.filter(x=>x.customerId===u.id),sid=u.sellerId,ss=sid?seller(sid):null,restricted=u.unpublicUntil&&u.unpublicUntil>Date.now();return `<tr class="data-row" onclick="adminNav('user/${u.id}')"><td><b>${esc(u.id)}</b><div>${esc(u.name)}</div></td><td>${esc(u.email)}</td><td>${ss?esc(ss.name):'-'}</td><td>${oo.length}</td><td>${sid?money(adminStats().orders.filter(x=>x.sellerId===sid).reduce((a,x)=>a+Number(x.amount||0),0)):'₹0.00'}</td><td><span class="admin-pill ${restricted?'danger':'success'}">${restricted?'Restricted':'Active'}</span></td><td onclick="event.stopPropagation()"><button class="btn ${restricted?'primary':''}" onclick="${restricted?`adminRelease('${u.id}')`:`adminRestrict('${u.id}')`}">${restricted?'Release':'Restrict 3 Days'}</button></td></tr>`}).join('')||`<tr><td colspan="7"><div class="admin-empty">No users found.</div></td></tr>`}</tbody></table></div>`)}
function adminUserDetail(id){const u=S.users.find(x=>x.id===id);if(!u)return adminLayout('users','User Not Found',`<button class="btn" onclick="adminNav('users')">← Users</button>`);const ss=u.sellerId?seller(u.sellerId):null,orders=S.orders.filter(x=>x.customerId===u.id),products=ss?S.products.filter(p=>p.sellerId===ss.id):[],restricted=u.unpublicUntil&&u.unpublicUntil>Date.now();return adminLayout('users','User Details',`<button class="btn admin-back" onclick="adminNav('users')">← Back to Users</button><div class="admin-detail"><div class="admin-detail-box"><h2>${esc(u.name)}</h2><p class="muted">User ID: <b>${esc(u.id)}</b></p><p>Email: ${esc(u.email)}</p><p>Role: Buyer + Seller</p><p>Status: <span class="admin-pill ${restricted?'danger':'success'}">${restricted?'Restricted until '+new Date(u.unpublicUntil).toLocaleString('en-IN'):'Active'}</span></p><div class="security-row" style="margin-top:12px"><div><b>Seller Score</b><div class="small muted">Admin can manually set 0–100. Red 0–29 · Yellow 30–59 · Green 60–100.</div></div><div style="display:flex;gap:8px;align-items:center"><input id="adminScore_${esc(u.id)}" type="number" min="0" max="100" value="${Number.isFinite(Number(u.score))?Number(u.score):70}" style="width:90px"><button class="btn" onclick="(async()=>{const ok=await saleEarnEditUserScore('${esc(u.id)}',document.getElementById('adminScore_${esc(u.id)}').value,'Admin score update');if(ok){toast('User score saved & connected');render()}})()">Save Score</button></div></div><div class="admin-actions"><button class="btn" onclick="${restricted?`adminRelease('${u.id}')`:`adminRestrict('${u.id}')`}">${restricted?'Release':'Restrict 3 Days'}</button>${ss?`<button class="btn primary" onclick="go('seller/${ss.id}')">Open Store</button>`:''}</div></div><div class="admin-detail-box"><h2>Account Overview</h2><div class="admin-stat-row"><div class="admin-stat"><b>${orders.length}</b><span class="small muted">Orders</span></div><div class="admin-stat"><b>${products.length}</b><span class="small muted">Live Products</span></div><div class="admin-stat"><b>${money(orders.filter(x=>x.status==='SUCCESS').reduce((a,x)=>a+Number(x.amount||0),0))}</b><span class="small muted">Spent</span></div></div></div></div><div class="admin-card"><h2>Products & Sales</h2>${products.map(p=>`<div class="security-row"><div><b>${esc(p.title)}</b><div class="small muted">${esc(p.id)} · Sales ${productSales(p.id)}</div></div><button class="btn" onclick="adminNav('product/${p.id}')">Open Product</button></div>`).join('')||'<div class="admin-empty">No live products.</div>'}</div><div class="admin-card"><h2>Customer Orders</h2>${orders.map(x=>`<div class="security-row" onclick="adminNav('order/${x.id}')" style="cursor:pointer"><div><b>${esc(product(x.productId)?.title||'Deleted product')}</b><div class="small muted">${esc(x.id)} · ${new Date(x.date).toLocaleString('en-IN')}</div></div><span class="admin-pill ${x.status==='SUCCESS'?'success':x.status==='CANCELLED'?'danger':'warn'}">${esc(x.status)} · ${money(x.amount)}</span></div>`).join('')||'<div class="admin-empty">No orders.</div>'}</div>`)}
function adminProducts(){const ps=S.products;return adminLayout('products','Products',`<div class="admin-card"><div class="section-head"><div><h2>Product Management</h2><div class="sub">Open any product to inspect seller, sales, files and secure delivery URL.</div></div></div><table class="admin-table"><thead><tr><th>Product</th><th>Seller</th><th>Sales</th><th>Price</th><th>Action</th></tr></thead><tbody>${ps.map(p=>`<tr class="data-row" onclick="adminNav('product/${p.id}')"><td><b>${esc(p.title)}</b><div class="small muted">${esc(p.id)}</div></td><td>@${esc(p.sellerId)}</td><td>${productSales(p.id)}</td><td>${money(p.price)}</td><td onclick="event.stopPropagation()"><button class="btn danger" onclick="adminDeleteProduct('${p.id}')">Delete</button></td></tr>`).join('')||`<tr><td colspan="5"><div class="admin-empty">No products.</div></td></tr>`}</tbody></table></div>`)}
function adminProductDetail(id){const p=product(id);if(!p)return adminLayout('products','Product Not Found',`<button class="btn" onclick="adminNav('products')">← Products</button>`);const s=seller(p.sellerId),sales=S.orders.filter(x=>x.productId===p.id&&x.status==='SUCCESS');return adminLayout('products','Product Details',`<button class="btn admin-back" onclick="adminNav('products')">← Back to Products</button><div class="admin-product-preview admin-detail-box"><div>${p.image?`<img src="${esc(p.image)}" alt="">`:`<div class="thumb-fallback">🧩</div>`}</div><div><h2>${esc(p.title)}</h2><p class="muted">Product ID: <b>${esc(p.id)}</b></p><p>Seller: <b>@${esc(s.id)}</b> · ${esc(s.name)}</p><p>Category: ${esc(p.category||'-')}</p><p>Price: <b>${money(p.price)}</b> · Sales: <b>${productSales(p.id)}</b></p><p>${esc(p.description||'')}</p><div class="admin-actions"><button class="btn primary" onclick="go('seller/${s.id}')">Open Seller</button><button class="btn danger" onclick="adminDeleteProduct('${p.id}')">Delete Product</button></div></div></div><div class="admin-grid2"><div class="admin-detail-box"><h2>Files & Secure Delivery</h2><p>File count: ${esc(p.fileCount||((p.links||[]).length||1))}</p><p>File size: ${esc(p.fileSize||'Not specified')}</p>${(p.links||[]).map((l,i)=>`<div class="security-row"><span><b>${esc((p.linkTitles||[])[i]||`File ${i+1}`)}</b><small class="muted" style="display:block">Secure Link ${i+1}</small></span><button class="btn" onclick="window.open('${esc(l)}','_blank','noopener')">Open Secure Link</button></div>`).join('')||'<div class="admin-empty">No secure link stored.</div>'}</div><div class="admin-detail-box"><h2>Sales</h2>${sales.map(x=>`<div class="security-row"><div><b>${esc(x.customerId||x.customerEmail||'Customer')}</b><div class="small muted">${esc(x.id)} · ${new Date(x.date).toLocaleString('en-IN')}</div></div><span>${money(x.amount)}</span></div>`).join('')||'<div class="admin-empty">No successful sales.</div>'}</div></div>`)}
function adminOrders(){const os=S.orders;return adminLayout('orders','Orders',`<div class="admin-card"><div class="section-head"><div><h2>All Orders</h2><div class="sub">Customer ID, product, seller, payment amount and status.</div></div></div><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Seller</th><th>Paid</th><th>Payment</th><th>Status</th></tr></thead><tbody>${os.map(x=>`<tr class="data-row" onclick="adminNav('order/${x.id}')"><td>${esc(x.id)}<div class="small muted">${new Date(x.date).toLocaleString('en-IN')}</div></td><td>${esc(x.customerId||x.customerEmail||'-')}</td><td>${esc(product(x.productId)?.title||'Deleted product')}</td><td>@${esc(x.sellerId||'-')}</td><td>${money(x.amount)}</td><td>${esc(x.method||'-')}</td><td><span class="admin-pill ${x.status==='SUCCESS'?'success':x.status==='CANCELLED'?'danger':'warn'}">${esc(x.status)}</span></td></tr>`).join('')||`<tr><td colspan="7"><div class="admin-empty">No orders.</div></td></tr>`}</tbody></table></div>`)}
function adminOrderDetail(id){const x=S.orders.find(o=>o.id===id);if(!x)return adminLayout('orders','Order Not Found',`<button class="btn" onclick="adminNav('orders')">← Orders</button>`);const p=product(x.productId);return adminLayout('orders','Order Details',`<button class="btn admin-back" onclick="adminNav('orders')">← Back to Orders</button><div class="admin-detail"><div class="admin-detail-box"><h2>Order ${esc(x.id)}</h2><p>User ID: <b>${esc(x.customerId||'-')}</b></p><p>Customer: ${esc(x.customerName||'-')} · ${esc(x.customerEmail||'-')}</p><p>Date: ${new Date(x.date).toLocaleString('en-IN')}</p><p>Payment method: ${esc(x.method||'-')}</p><p>Amount paid: <b>${money(x.amount)}</b></p><p>Status: <span class="admin-pill ${x.status==='SUCCESS'?'success':x.status==='CANCELLED'?'danger':'warn'}">${esc(x.status)}</span></p></div><div class="admin-detail-box"><h2>Product</h2><p>${esc(p?.title||'Deleted product')}</p><p>Product ID: ${esc(x.productId)}</p><p>Seller ID: @${esc(x.sellerId||'-')}</p><p>Delivery: ${x.status==='SUCCESS'?'Access granted':'No secure access granted'}</p>${p?`<button class="btn primary" onclick="adminNav('product/${p.id}')">Open Product</button>`:''}</div></div>`)}
function adminReviews(){const rows=[];Object.entries(S.reviews||{}).forEach(([pid,rs])=>(rs||[]).forEach(r=>rows.push({p:product(pid),pid,r})));rows.sort((a,b)=>new Date(b.r.date)-new Date(a.r.date));return adminLayout('reviews','Reviews',`<div class="admin-card"><div class="section-head"><div><h2>Review Management</h2><div class="sub">Admin can edit or remove any review.</div></div></div><table class="admin-table"><thead><tr><th>Product</th><th>User</th><th>Rating</th><th>Review</th><th>Date</th><th>Action</th></tr></thead><tbody>${rows.map(x=>`<tr class="data-row"><td onclick="adminNav('product/${x.pid}')">${esc(x.p?.title||'Deleted product')}</td><td>${esc(x.r.userId||x.r.name||'Unknown')}</td><td>${'★'.repeat(Number(x.r.rating||0))}</td><td style="max-width:320px">${esc(x.r.text||'')}</td><td>${x.r.date?new Date(x.r.date).toLocaleDateString('en-IN'):'-'}</td><td onclick="event.stopPropagation()"><button class="btn" onclick="adminEditReview('${x.pid}','${x.r.id}')">Edit</button> <button class="btn danger" onclick="adminDeleteReview('${x.pid}','${x.r.id}')">Delete</button></td></tr>`).join('')||`<tr><td colspan="6"><div class="admin-empty">No reviews.</div></td></tr>`}</tbody></table></div>`)}
function adminEditReview(pid,rid){if(!adminOnly())return;const r=(S.reviews?.[pid]||[]).find(x=>x.id===rid);if(!r){toast('Review not found');return}const text=prompt('Edit review:',r.text||'');if(text===null)return;const clean=String(text).trim();if(!clean){toast('Review cannot be empty');return}r.text=clean;r.editedAt=nowISO();r.editedBy=S.currentUser?.id||'ADMIN';logAdminAudit('Edited review',rid,{productId:pid});save();toast('Review updated');render()}
function adminSales(){const st=adminStats();const bySeller={};st.orders.forEach(x=>{bySeller[x.sellerId]=bySeller[x.sellerId]||{sales:0,orders:0,net:0};bySeller[x.sellerId].sales+=Number(x.amount||0);bySeller[x.sellerId].net+=Number(x.netSellerAmount||0);bySeller[x.sellerId].orders++});const today=new Date().toDateString();const td=st.orders.filter(x=>new Date(x.date).toDateString()===today);return adminLayout('sales','Sales & Earnings',`<div class="admin-kpis"><div class="admin-kpi"><span>Total Sales</span><b>${money(st.sales)}</b></div><div class="admin-kpi"><span>Net Seller Earnings</span><b>${money(st.earnings)}</b></div><div class="admin-kpi"><span>Today's Sales</span><b>${money(td.reduce((a,x)=>a+Number(x.amount||0),0))}</b></div><div class="admin-kpi"><span>Today's Orders</span><b>${td.length}</b></div></div><div class="admin-card"><h2>Seller-wise Sales</h2><div class="sub">See which seller sold which products and how much was earned.</div><table class="admin-table"><thead><tr><th>Seller</th><th>Orders</th><th>Gross Sales</th><th>Net Seller Earnings</th><th>Products Sold</th></tr></thead><tbody>${Object.entries(bySeller).map(([sid,v])=>`<tr class="data-row" onclick="adminNav('seller/${sid}')"><td>@${esc(sid)}<div class="small muted">${esc(seller(sid).name)}</div></td><td>${v.orders}</td><td>${money(v.sales)}</td><td>${money(v.net)}</td><td>${S.products.filter(p=>p.sellerId===sid).map(p=>`${esc(p.title)} (${productSales(p.id)})`).join('<br>')||'Deleted product(s) may be in recycle bin'}</td></tr>`).join('')||`<tr><td colspan="5"><div class="admin-empty">No successful sales.</div></td></tr>`}</tbody></table></div>`)}
function adminSellerDetail(id){const ss=seller(id),ps=S.products.filter(p=>p.sellerId===id),os=S.orders.filter(o=>o.sellerId===id&&o.status==='SUCCESS');return adminLayout('sales','Seller Sales',`<button class="btn admin-back" onclick="adminNav('sales')">← Back to Sales</button><div class="admin-detail"><div class="admin-detail-box"><h2>${esc(ss.name)}</h2><p>Seller ID: @${esc(id)}</p><p>Owner: ${esc(ss.owner||'-')}</p><p>Plan: ${esc(ss.plan||'FREE')}</p>${sellerScoreMarkup(id,true)}<div class="field"><label>Set Seller Score (0–100)</label><div class="score-admin-row"><input id="adminSellerScore" type="number" min="0" max="100" value="${getSellerScore(id)}"><input id="adminSellerScoreReason" placeholder="Reason for manual update"><button class="btn primary" onclick="adminSetSellerScore('${id}',document.getElementById('adminSellerScore').value)">Save Score</button></div></div></div><div class="admin-detail-box"><div class="admin-stat-row"><div class="admin-stat"><b>${os.length}</b><span class="small muted">Successful sales</span></div><div class="admin-stat"><b>${money(os.reduce((a,x)=>a+Number(x.amount||0),0))}</b><span class="small muted">Gross</span></div><div class="admin-stat"><b>${money(os.reduce((a,x)=>a+Number(x.netSellerAmount||0),0))}</b><span class="small muted">Net</span></div></div></div></div><div class="admin-card"><h2>Products Sold</h2>${ps.map(p=>`<div class="security-row"><div><b>${esc(p.title)}</b><div class="small muted">${esc(p.id)} · ${productSales(p.id)} sales</div></div><span>${money(os.filter(o=>o.productId===p.id).reduce((a,x)=>a+Number(x.amount||0),0))}</span></div>`).join('')||'<div class="admin-empty">No live products.</div>'}</div>`)}
/* ================= SECURE PAYOUT + LEDGER (v2) ================= */
const PAYOUT_PAID_STATES=["APPROVED","PAID","SUCCESS","RECEIVED"];
function r2(n){return Math.round((Number(n)||0)*100)/100}
function payoutOrderNet(o){const v=(o.netSellerAmount!==undefined&&o.netSellerAmount!==null&&o.netSellerAmount!=='')?Number(o.netSellerAmount):Number(o.amount||0)*(1-Number(o.platformFeeRate??.20));return Number.isFinite(v)?v:0}
function payoutFmtDate(d){return d?new Date(d).toLocaleString('en-IN'):'-'}
/* One single source of truth for a seller's money. Nothing is hidden by clamping: 'raw' can go negative = glitch. */
function sellerLedger(sid){
 const orders=(S.orders||[]).filter(o=>o&&o.sellerId===sid&&String(o.status||'').toUpperCase()==='SUCCESS'&&o.paymentVerified!==false);
 const gross=r2(orders.reduce((a,o)=>a+Number(o.amount||0),0));
 const adjTotal=r2(typeof financeSum==='function'?(Number(financeSum(sid,'TOTAL'))||0):0);
 const earned=r2(orders.reduce((a,o)=>a+payoutOrderNet(o),0)+adjTotal);
 const P=(S.payouts||[]).filter(x=>x&&x.sellerId===sid);
 const adjReceived=r2(typeof financeSum==='function'?(Number(financeSum(sid,'RECEIVED'))||0):0);
 const paid=r2(P.filter(x=>PAYOUT_PAID_STATES.includes(payoutStatusUpper(x))).reduce((a,x)=>a+Number(x.amount||0),0)+adjReceived);
 const pending=r2(P.filter(x=>payoutReservesBalance(x)).reduce((a,x)=>a+Number(x.amount||0),0));
 const balSpent=(S.balancePayments||[]).filter(x=>x.sellerId===sid&&String(x.source||"").toUpperCase()==="BALANCE"&&String(x.status||"").toUpperCase()==="SUCCESS"&&x.paymentVerified!==false).reduce((a,x)=>a+Number(x.amount||0),0);
 const legacyAds=(S.ads||[]).filter(x=>x.sellerId===sid&&!x.paymentSource&&String(x.status||"").toUpperCase()!=="CANCELLED").reduce((a,x)=>a+Number(x.cost||0),0);
 const legacySubs=(S.subscriptions||[]).filter(x=>x.sellerId===sid&&!x.paymentSource).reduce((a,x)=>a+Number(x.amount||0),0);
 const adjToReceive=r2(typeof financeSum==='function'?(Number(financeSum(sid,'TO_RECEIVE'))||0):0);
 const spent=r2(balSpent+legacyAds+legacySubs);
 const raw=r2(earned-paid-pending-spent+adjToReceive);
 return {sid,orders,sales:orders.length,gross,fee:r2(gross-(earned-adjTotal)),earned,paid,pending,spent,adj:adjToReceive,adjTotal,adjReceived,raw,available:Math.max(0,raw),deficit:raw<0?r2(-raw):0};
}
/* Scans the whole platform for money glitches so admin can catch them early. */
function payoutIntegrity(){
 const out=[],add=(lv,sid,msg)=>out.push({lv,sid:sid||'-',msg});
 const sids=new Set(Object.keys(S.sellers||{}));(S.payouts||[]).forEach(p=>p&&p.sellerId&&sids.add(p.sellerId));
 sids.forEach(sid=>{const L=sellerLedger(sid);if(L.deficit>0)add('high',sid,`Ledger is short by ${money(L.deficit)} (paid + pending + spent is more than earned). Do NOT pay until checked.`)});
 const utrs={};
 (S.payouts||[]).forEach(p=>{if(!p)return;const st=payoutStatusUpper(p),amt=Number(p.amount);
  if(!Number.isFinite(amt)||amt<=0)add('high',p.sellerId,`Payout ${p.id} has an invalid amount`);
  if(!S.sellers?.[p.sellerId])add('high',p.sellerId,`Payout ${p.id} belongs to an unknown seller`);
  if(PAYOUT_PAID_STATES.includes(st)){
   if(!p.utr)add('low',p.sellerId,`Payout ${p.id} (${money(amt)}) is Paid but has no bank/UPI reference`);
   else{const k=String(p.utr).toLowerCase();if(utrs[k])add('high',p.sellerId,`Reference ${p.utr} is used on more than one payout`);utrs[k]=1}
  }});
 const gw={};
 (S.orders||[]).forEach(o=>{if(!o||String(o.status||'').toUpperCase()!=='SUCCESS')return;
  const amt=Number(o.amount||0),net=payoutOrderNet(o);
  if(amt>0){
   if(!o.gatewayPaymentId)add('medium',o.sellerId,`Sale ${o.id} has no gateway payment reference`);
   else{if(gw[o.gatewayPaymentId])add('high',o.sellerId,`Payment ref ${o.gatewayPaymentId} is used on 2+ sales`);gw[o.gatewayPaymentId]=1}
   if(o.paymentVerified!==true)add('medium',o.sellerId,`Sale ${o.id} is not marked payment-verified`);
  }
  if(net>amt+0.01||net<0)add('high',o.sellerId,`Sale ${o.id}: seller share ${money(net)} is more than customer paid ${money(amt)}`);
  else if(o.platformFeeRate!=null&&Math.abs(net-amt*(1-Number(o.platformFeeRate)))>0.05)add('medium',o.sellerId,`Sale ${o.id}: seller share does not match platform fee`);
 });
 const rank={high:0,medium:1,low:2};return out.sort((a,b)=>rank[a.lv]-rank[b.lv]);
}
function payoutLog(p,action,extra){p.history=Array.isArray(p.history)?p.history:[];p.history.push({at:nowISO(),by:S.currentUser?.id||null,action,...(extra||{})})}
function adminPayoutIntegrityDetails(sid,msg){
 if(!adminOnly())return;
 const sl=seller(sid),u=(S.users||[]).find(x=>x.sellerId===sid),L=sellerLedger(sid);
 const sales=[...(L.orders||[])].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).slice(0,12);
 const payouts=(S.payouts||[]).filter(x=>x.sellerId===sid).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).slice(0,12);
 const line=(k,v)=>`<tr><td>${k}</td><td style="text-align:right"><b>${v}</b></td></tr>`;
 document.getElementById('modalRoot').innerHTML=`<div class="modal-bg"><div class="modal" style="max-width:980px;width:96%;max-height:92vh;overflow:auto"><button class="btn iconbtn close" onclick="closeModal()">&#10005;</button>
 <h2 style="margin-top:0">Money Integrity — @${esc(sid||'-')}</h2>
 <p class="small muted">${esc(msg||'')} </p>
 <div class="admin-actions" style="margin-bottom:16px">${u?`<button class="btn" onclick="closeModal();adminNav('user/${esc(u.id)}')">Open User</button>`:''}<button class="btn" onclick="closeModal();adminNav('seller/${esc(sid)}')">Open Seller</button><button class="btn" onclick="closeModal();adminNav('payouts')">Open Withdrawals</button></div>
 <div class="admin-detail"><div class="admin-detail-box"><h3>Ledger Summary</h3><table class="admin-table"><tbody>${line('Successful sales',L.sales)}${line('Gross sales',money(L.gross))}${line('Platform fee',money(L.fee))}${line('Seller net earnings',money(L.earned))}${line('Already paid',money(L.paid))}${line('Pending payouts',money(L.pending))}${line('Spent on services',money(L.spent))}${line('Available To Receive',money(L.available))}${line('Ledger shortfall',money(L.deficit))}</tbody></table></div>
 <div class="admin-detail-box"><h3>Seller / Account</h3><p><b>@${esc(sid)}</b> · ${esc(sl.name||sl.owner||'-')}</p><p>User ID: <b>${esc(u?.userId||u?.id||'-')}</b></p><p>Email: ${esc(u?.email||'-')}</p><p>Plan: ${esc(sl.plan||'FREE')}</p><p>Score: ${esc(u?.score??sl.score??'-')}</p></div></div>
 <h3>Recent Sales</h3><div class="se-admin-detail-list"><table class="admin-table"><thead><tr><th>Date</th><th>Order</th><th>Product</th><th>Paid</th><th>Seller Share</th><th>Payment Ref</th></tr></thead><tbody>${sales.map(o=>`<tr class="data-row" onclick="closeModal();adminNav('order/${esc(o.id)}')"><td>${payoutFmtDate(o.date)}</td><td>${esc(o.id)}</td><td>${esc(o.productTitle||product(o.productId)?.title||'Product')}</td><td>${money(o.amount)}</td><td>${money(payoutOrderNet(o))}</td><td>${esc(o.gatewayPaymentId||'NONE')}</td></tr>`).join('')||'<tr><td colspan="6">No successful sales.</td></tr>'}</tbody></table></div>
 <h3>Recent Payouts</h3><div class="se-admin-detail-list"><table class="admin-table"><thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>UPI</th><th>Reference</th></tr></thead><tbody>${payouts.map(p=>`<tr class="data-row" onclick="closeModal();adminPayoutDetails('${esc(p.id)}')"><td>${payoutFmtDate(p.date)}</td><td>${money(p.amount)}</td><td>${esc(payoutStatusUpper(p))}</td><td>${esc(p.upi||'-')}</td><td>${esc(p.utr||p.cancelReason||'-')}</td></tr>`).join('')||'<tr><td colspan="5">No payouts.</td></tr>'}</tbody></table></div>
 <div class="modal-footer"><button class="btn" onclick="closeModal()">Close</button></div></div></div>`;
}
async function refreshAdminPayoutsCloud(){
  try{
    if(!ONLINE_READY||!S.currentUser||!isAdmin())return false;
    if(!ONLINE_LOCAL_DIRTY&&!ONLINE_LOADING&&!seReadBusy&&!seWriteBusy){
      await pollOnlineState(true);
    }
    return true;
  }catch(e){
    console.warn('Admin payout refresh failed:',e);
    return false;
  }
}
function adminPayouts(){
  if(isAdmin()&&ONLINE_READY&&!ONLINE_LOCAL_DIRTY){
    setTimeout(async()=>{
      const before=JSON.stringify(S.payouts||[]);
      await refreshAdminPayoutsCloud();
      if(route().startsWith('admin/payouts')&&before!==JSON.stringify(S.payouts||[]))render();
    },0);
  }
 const P=[...(S.payouts||[])].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)),cache={},L=sid=>cache[sid]||(cache[sid]=sellerLedger(sid));
 const pend=P.filter(x=>payoutStatusUpper(x)==='PENDING'),paid=P.filter(x=>PAYOUT_PAID_STATES.includes(payoutStatusUpper(x))),canc=P.filter(x=>payoutStatusUpper(x)==='CANCELLED');
 const sum=a=>r2(a.reduce((s,x)=>s+Number(x.amount||0),0));
 const issues=payoutIntegrity(),high=issues.filter(i=>i.lv==='high').length;
 const pill=lv=>`<span class="admin-pill ${lv==='high'?'danger':lv==='medium'?'warn':'success'}">${lv.toUpperCase()}</span>`;
 const rows=P.map(x=>{const st=payoutStatusUpper(x),cls=st==='CANCELLED'?'danger':st==='PENDING'?'warn':'success',sid=x.sellerId,l=L(sid);
  const u=S.users?.find(u=>u.sellerId===sid),bad=l.deficit>0;
  return `<tr><td><b>@${esc(sid||'-')}</b><div class="small muted">${esc(u?.email||seller(sid).name||'')}</div></td><td>${esc(x.userId||u?.userId||u?.id||'-')}</td><td><b>${money(x.amount)}</b></td><td>${esc(x.upi||seller(sid).upi||'-')}</td>
  <td class="small">Sales: <b>${l.sales}</b><br>Earned: ${money(l.earned)}<br>Paid: ${money(l.paid)}<br>Available: <b>${money(l.available)}</b>${bad?`<br><span style="color:#ef5b67;font-weight:800">GLITCH: short ${money(l.deficit)}</span>`:''}</td>
  <td><span class="admin-pill ${cls}">${esc(st)}</span>${x.utr?`<div class="small muted">Ref: ${esc(x.utr)}</div>`:''}</td><td>${payoutFmtDate(x.date)}</td>
  <td style="white-space:nowrap"><button class="btn" data-id="${esc(x.id||'')}" onclick="adminPayoutDetails(this.dataset.id)">Details</button>${st==='PENDING'?` <button class="btn primary" data-id="${esc(x.id||'')}" onclick="adminMarkPayoutPaid(this.dataset.id)">Paid</button> <button class="btn danger" data-id="${esc(x.id||'')}" onclick="adminCancelPayout(this.dataset.id)">Cancel</button>`:''}</td></tr>`}).join('');
 return adminLayout('payouts','Withdrawals',`<div class="admin-kpis"><div class="admin-kpi"><span>Pending requests</span><b>${pend.length} / ${money(sum(pend))}</b></div><div class="admin-kpi"><span>Total paid out</span><b>${money(sum(paid))}</b></div><div class="admin-kpi"><span>Cancelled</span><b>${canc.length}</b></div><div class="admin-kpi"><span>Money glitches found</span><b style="color:${high?'#ef5b67':'#17b77d'}">${high?high+' HIGH':'None'}</b></div></div>
 <div class="admin-card"><h2>Money Integrity Check</h2><div class="sub">Checked automatically every time this page opens. Fix every HIGH item before paying anyone.</div>${issues.length?`<div class="se-scroll-panel"><table class="admin-table"><thead><tr><th>Level</th><th>Seller</th><th>Problem</th><th>Open</th></tr></thead><tbody>${issues.slice(0,40).map(i=>`<tr class="data-row" onclick="adminPayoutIntegrityDetails('${esc(i.sid)}','${esc(i.msg).replace(/'/g,"&#39;")}')"><td>${pill(i.lv)}</td><td>@${esc(i.sid)}</td><td>${esc(i.msg)}</td><td><button class="btn" onclick="event.stopPropagation();adminPayoutIntegrityDetails('${esc(i.sid)}','${esc(i.msg).replace(/'/g,"&#39;")}')">Details</button></td></tr>`).join('')}</tbody></table></div>${issues.length>40?`<div class="small muted" style="padding:8px">+ ${issues.length-40} more</div>`:''}`:'<div class="admin-empty">All balances match. No glitch found.</div>'}</div>
 <div class="admin-card"><h2>Seller Payout Requests</h2><div class="sub">Manual payout: pay the seller on UPI yourself, then press Paid and enter the bank/UPI transaction reference. Use Details to see the seller's full sales and money history first.</div><div class="se-scroll-panel"><table class="admin-table"><thead><tr><th>Seller</th><th>User ID</th><th>Amount</th><th>UPI</th><th>Seller money</th><th>Status</th><th>Requested At</th><th>Action</th></tr></thead><tbody>${rows||'<tr><td colspan="8"><div class="admin-empty">No payout requests.</div></td></tr>'}</tbody></table></div></div>`)}
function adminPayoutDetails(id){
 if(!adminOnly())return;
 const p=(S.payouts||[]).find(x=>String(x.id)===String(id));if(!p){toast('Payout not found');return}
 const sid=p.sellerId,L=sellerLedger(sid),u=S.users?.find(u=>u.sellerId===sid),st=payoutStatusUpper(p),sl=seller(sid);
 const sales=[...L.orders].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).slice(0,10);
 const others=(S.payouts||[]).filter(x=>x.sellerId===sid&&x.id!==p.id).slice(0,10);
 const line=(k,v,b)=>`<tr><td>${k}</td><td style="text-align:right">${b?'<b>'+v+'</b>':v}</td></tr>`;
 const snap=p.snapshot?`<p class="small muted">At request time: ${p.snapshot.sales} sales, earned ${money(p.snapshot.earned)}, already paid ${money(p.snapshot.paidBefore)}, available ${money(p.snapshot.availableBefore)}.</p>`:'';
 document.getElementById('modalRoot').innerHTML=`<div class="modal-bg"><div class="modal" style="max-width:860px;width:95%;max-height:90vh;overflow:auto"><button class="btn iconbtn close" onclick="closeModal()">&#10005;</button><h2 style="margin-top:0">Payout details</h2>
 <p><b>@${esc(sid)}</b> ${esc(sl.name||'')} ${sl.suspended?'<span class="admin-pill danger">SUSPENDED</span>':''}<br><span class="small muted">${esc(u?.email||'-')} &middot; User ID ${esc(u?.userId||u?.id||'-')} &middot; Score ${esc(u?.score??sl.score??'-')}</span></p>
 <p>Request: <b>${money(p.amount)}</b> to <b>${esc(p.upi||'-')}</b> &middot; <span class="admin-pill ${st==='CANCELLED'?'danger':st==='PENDING'?'warn':'success'}">${esc(st)}</span> &middot; ${payoutFmtDate(p.date)}${p.note?`<br>Seller note: ${esc(p.note)}`:''}${p.utr?`<br>Reference: <b>${esc(p.utr)}</b>`:''}${p.cancelReason?`<br>Cancel reason: ${esc(p.cancelReason)}`:''}</p>${snap}
 <h3>How the seller's money adds up</h3><table class="admin-table"><tbody>${line('Successful sales (count)',L.sales)}${line('Total customers paid (gross)',money(L.gross))}${line('Platform fee kept',money(L.fee))}${line('Seller net earnings',money(L.earned),1)}${L.adj?line('Admin adjustments',money(L.adj)):''}${line('Already paid out',money(L.paid))}${line('Pending requests (incl. this one if pending)',money(L.pending))}${line('Used for ads / plans / services',money(L.spent))}${line('Available To Receive now',money(L.available),1)}</tbody></table>
 <p>${L.deficit>0?`<span class="admin-pill danger">GLITCH</span> Ledger is short by <b>${money(L.deficit)}</b>. Do not pay this request; investigate the sales below.`:'<span class="admin-pill success">LEDGER OK</span> Earnings cover everything paid, pending and spent.'}</p>
 <h3>Last ${sales.length} sales</h3><div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>Date</th><th>Order</th><th>Product</th><th>Buyer</th><th>Paid</th><th>Seller gets</th><th>Payment ref</th></tr></thead><tbody>${sales.map(o=>`<tr><td>${payoutFmtDate(o.date)}</td><td>${esc(o.id)}</td><td>${esc(o.productTitle||'')}</td><td>${esc(o.customerEmail||o.customerId||'')}</td><td>${money(o.amount)}</td><td>${money(payoutOrderNet(o))}</td><td>${esc(o.gatewayPaymentId||'NONE')}${o.paymentVerified===true?'':' <span class="admin-pill warn">unverified</span>'}</td></tr>`).join('')||'<tr><td colspan="7">No sales</td></tr>'}</tbody></table></div>
 <h3>Other payouts of this seller</h3><div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Reference / reason</th></tr></thead><tbody>${others.map(x=>`<tr><td>${payoutFmtDate(x.date)}</td><td>${money(x.amount)}</td><td>${esc(payoutStatusUpper(x))}</td><td>${esc(x.utr||x.cancelReason||'')}</td></tr>`).join('')||'<tr><td colspan="4">None</td></tr>'}</tbody></table></div>
 ${(p.history||[]).length?`<h3>History of this request</h3><ul class="small">${p.history.map(h=>`<li>${payoutFmtDate(h.at)} &ndash; ${esc(h.action)}${h.utr?' (ref '+esc(h.utr)+')':''}${h.reason?' ('+esc(h.reason)+')':''}</li>`).join('')}</ul>`:''}
 <div class="modal-footer"><button class="btn" onclick="closeModal()">Close</button>${st==='PENDING'?`<button class="btn danger" data-id="${esc(p.id)}" onclick="adminCancelPayout(this.dataset.id)">Cancel</button><button class="btn primary" data-id="${esc(p.id)}" onclick="adminMarkPayoutPaid(this.dataset.id)">Mark Paid</button>`:''}</div></div></div>`}
function adminMarkPayoutPaid(id){
 if(!adminOnly())return;
 const p=(S.payouts||[]).find(x=>String(x.id)===String(id));if(!p){toast('Payout not found');return}
 if(payoutStatusUpper(p)!=='PENDING'){toast('Only pending payouts can be marked Paid');return}
 const L=sellerLedger(p.sellerId);
 document.getElementById('modalRoot').innerHTML=`<div class="modal-bg"><div class="modal" style="max-width:480px"><button class="btn iconbtn close" onclick="closeModal()">&#10005;</button><h2 style="margin-top:0">Confirm payment</h2>
 <p>Seller <b>@${esc(p.sellerId)}</b><br>Amount <b>${money(p.amount)}</b><br>UPI <b>${esc(p.upi||'-')}</b></p>
 ${L.deficit>0?`<p style="color:#ef5b67"><b>Blocked:</b> this seller's ledger is short by ${money(L.deficit)}. Open Details and check before paying.</p>`:`<p class="small muted">Ledger OK. Seller earned ${money(L.earned)} from ${L.sales} sales.</p>`}
 <div class="field"><label>Bank / UPI transaction reference (UTR) *</label><input id="poUtr" maxlength="40" placeholder="e.g. 412345678901" autocomplete="off"></div>
 <label style="display:flex;gap:8px;align-items:flex-start;margin:12px 0"><input type="checkbox" id="poPaidChk"><span>I have actually sent ${money(p.amount)} to this UPI ID.</span></label>
 <div class="modal-footer"><button class="btn" onclick="closeModal()">Back</button><button class="btn primary" ${L.deficit>0?'disabled':''} data-id="${esc(p.id)}" onclick="adminConfirmPayoutPaid(this.dataset.id)">Mark as Paid</button></div></div></div>`}
async function adminConfirmPayoutPaid(id){
 if(!adminOnly())return;if(window.__payoutAdminBusy)return;window.__payoutAdminBusy=true;
 try{
  const p=(S.payouts||[]).find(x=>String(x.id)===String(id));if(!p){toast('Payout not found');return}
  if(payoutStatusUpper(p)!=='PENDING'){toast('Only pending payouts can be marked Paid');return}
  const utr=String(document.getElementById('poUtr')?.value||'').trim();
  if(!/^[A-Za-z0-9._\-\/]{6,40}$/.test(utr)){toast('Enter the transaction reference (6-40 letters/numbers)');return}
  if((S.payouts||[]).some(x=>x.id!==p.id&&x.utr&&String(x.utr).toLowerCase()===utr.toLowerCase())){toast('This reference is already used on another payout');return}
  if(!document.getElementById('poPaidChk')?.checked){toast('Tick the confirmation box first');return}
  const amt=r2(p.amount),L=sellerLedger(p.sellerId);
  if(!(amt>0)){toast('Invalid payout amount');return}
  if(L.deficit>0){toast('Blocked: seller ledger is short by '+money(L.deficit));return}
  const now=nowISO();
  if(SUPABASE_READY&&window.supabaseClient){
   const upd={status:'paid',payment_details:{...(p.paymentDetails||{}),upi:p.upi||'',note:p.note||'',utr},updated_at:now};
   const {error}=await supabaseClient.from('payouts').update(upd).eq('id',String(p.id));
   if(error){toast('Cloud update failed: '+String(error.message||error).slice(0,120));return}
  }
  p.status='PAID';p.utr=utr;p.processedAt=now;p.paidAt=now;p.paidBy=S.currentUser?.id||'ADMIN';p.paymentVerified=true;p.manualPayout=true;p.receivedAmount=amt;
  payoutLog(p,'PAID',{utr,amount:amt});
  logAdminAudit('Marked payout Paid',p.id,{sellerId:p.sellerId,userId:p.userId,amount:amt,upi:p.upi||'',utr});
  save();await hydrateNormalizedFinancials().catch(()=>{});closeModal();toast('Payout marked Paid');render();
 }finally{window.__payoutAdminBusy=false}
}
function adminCancelPayout(id){
 if(!adminOnly())return;
 const p=(S.payouts||[]).find(x=>String(x.id)===String(id));if(!p){toast('Payout not found');return}
 if(payoutStatusUpper(p)!=='PENDING'){toast('Only pending payouts can be cancelled');return}
 document.getElementById('modalRoot').innerHTML=`<div class="modal-bg"><div class="modal" style="max-width:460px"><button class="btn iconbtn close" onclick="closeModal()">&#10005;</button><h2 style="margin-top:0">Cancel payout</h2><p>${money(p.amount)} for <b>@${esc(p.sellerId)}</b> will go back to the seller's Available To Receive.</p><div class="field"><label>Reason (shown to seller) *</label><input id="poCancelReason" maxlength="80" placeholder="e.g. Wrong UPI ID"></div><div class="modal-footer"><button class="btn" onclick="closeModal()">Back</button><button class="btn danger" data-id="${esc(p.id)}" onclick="adminConfirmCancelPayout(this.dataset.id)">Cancel payout</button></div></div></div>`}
async function adminConfirmCancelPayout(id){
 if(!adminOnly())return;if(window.__payoutAdminBusy)return;window.__payoutAdminBusy=true;
 try{
  const p=(S.payouts||[]).find(x=>String(x.id)===String(id));if(!p){toast('Payout not found');return}
  if(payoutStatusUpper(p)!=='PENDING'){toast('Only pending payouts can be cancelled');return}
  const reason=String(document.getElementById('poCancelReason')?.value||'').trim().slice(0,80);
  if(reason.length<3){toast('Enter a reason');return}
  const now=nowISO();
  if(SUPABASE_READY&&window.supabaseClient){
   const upd={status:'cancelled',cancelled_at:now,returned_amount:r2(p.amount),payment_details:{...(p.paymentDetails||{}),upi:p.upi||'',note:p.note||'',cancelReason:reason},updated_at:now};
   const {error}=await supabaseClient.from('payouts').update(upd).eq('id',String(p.id));
   if(error){toast('Cloud update failed: '+String(error.message||error).slice(0,120));return}
  }
  p.status='CANCELLED';p.cancelledAt=now;p.cancelledBy=S.currentUser?.id||'ADMIN';p.cancelReason=reason;p.paymentVerified=false;p.returnedToBalance=true;p.returnedAmount=r2(p.amount);
  payoutLog(p,'CANCELLED',{reason});
  logAdminAudit('Cancelled payout',p.id,{sellerId:p.sellerId,userId:p.userId,amount:p.amount,upi:p.upi||'',reason});
  save();await hydrateNormalizedFinancials().catch(()=>{});closeModal();toast('Payout cancelled; amount returned to seller');render();
 }finally{window.__payoutAdminBusy=false}
}
function adminWarnings(){const live=S.products||[],editing=window.__adminWarnEditId?(S.warnings||[]).find(w=>String(w.id)===String(window.__adminWarnEditId)):null;return adminLayout('warnings','Warnings',`<div class="admin-card"><div class="section-head"><div><h2>Warning Center</h2><div class="sub">${editing?'Editing an existing warning. Update the fields and save, or cancel.':'Warn a seller/user and optionally tag the exact live product that needs fixing.'}</div></div></div><div class="form-grid"><div class="field"><label>Seller/User ID</label><input id="admSid" placeholder="seller id or user id" value="${esc(editing?(editing.sellerId||editing.userId||''):'')}"></div><div class="field"><label>Live Product (optional)</label><select id="admWarnProduct"><option value="">— No product tag —</option>${live.filter(p=>!p.hiddenByAdmin).map(p=>`<option value="${esc(p.id)}" ${editing&&editing.productId===p.id?'selected':''}>${esc(p.title)} · ${esc(p.id)} · @${esc(p.sellerId)}</option>`).join('')}</select></div><div class="field"><label>Product ID (optional)</label><input id="admWarnProductId" placeholder="Paste exact product ID" value="${esc(editing?.productId||'')}"></div><div class="field"><label>Title</label><input id="admWarnTitle" value="${esc(editing?editing.title||'':'Product Fix Required')}"></div></div><div class="field"><label>Message</label><textarea id="admWarnMsg" placeholder="Explain what the seller needs to fix...">${esc(editing?.message||'')}</textarea></div><button id="admWarnSubmitBtn" class="btn primary" onclick="adminWarning()">${editing?'Update Warning':'Send Warning'}</button>${editing?' <button class="btn" onclick="adminCancelWarningEdit()">Cancel Edit</button>':''}<div style="margin-top:18px">${(S.warnings||[]).map(w=>`<div class="security-row"><div style="flex:1;cursor:pointer" onclick="seAdminOpenWarning('${esc(w.id||'')}')"><b>${esc(w.title||'Admin Warning')}</b><div class="small muted">@${esc(w.sellerId||w.userId||'-')} · ${w.productId?`Product: ${esc(w.productId)} · `:''}${w.date?new Date(w.date).toLocaleString('en-IN'):'-'}${w.edited?' · <span class="muted">(edited)</span>':''}</div><div>${esc(w.message||'')}</div></div><div style="display:flex;gap:8px;align-items:center"><span class="admin-pill ${w.read?'success':'danger'}">${w.read?'READ':'UNREAD'}</span><button class="btn" onclick="adminEditWarningStart('${esc(w.id||'')}')">Edit</button><button class="btn danger" onclick="adminRemoveWarning('${esc(w.id||'')}')">Remove</button></div></div>`).join('')||'<div class="admin-empty">No warnings.</div>'}</div></div>`)}
window.adminEditWarningStart=function(id){if(!adminOnly())return;const w=(S.warnings||[]).find(x=>String(x.id)===String(id));if(!w)return toast('Warning not found');window.__adminWarnEditId=id;render();setTimeout(()=>document.getElementById('admWarnMsg')?.scrollIntoView({behavior:'smooth',block:'center'}),50)};
window.adminCancelWarningEdit=function(){window.__adminWarnEditId=null;render()};
function adminRemoveWarning(id){if(!adminOnly())return;const i=(S.warnings||[]).findIndex(w=>String(w.id)===String(id));if(i<0){toast('Warning not found');return}const w=S.warnings[i];S.warnings.splice(i,1);logAdminAudit('Removed warning',id,{sellerId:w.sellerId,userId:w.userId||null});save();toast('Warning removed');render()}
function adminWarning(){if(!adminOnly())return;const raw=document.getElementById("admSid")?.value.trim(),msg=document.getElementById("admWarnMsg")?.value.trim(),title=document.getElementById("admWarnTitle")?.value.trim()||"Admin Warning";const selectedProduct=(document.getElementById("admWarnProduct")?.value||"").trim(),typedProduct=(document.getElementById("admWarnProductId")?.value||"").trim(),productId=typedProduct||selectedProduct;if(!raw||!msg){toast("Enter a user/seller ID and message");return}let sid=raw;let targetUserId=null;if(!S.sellers[sid]){const u=(S.users||[]).find(x=>String(x.id)===String(raw));if(u?.sellerId&&S.sellers[u.sellerId]){sid=u.sellerId;targetUserId=u.id}else{toast("User/Seller ID not found");return}}let taggedProduct=null;if(productId){taggedProduct=product(productId);if(!taggedProduct){toast("Product ID not found in live products");return}if(String(taggedProduct.sellerId)!==String(sid)){toast("Tagged product does not belong to this seller/user");return}}
 if(window.__adminWarnEditId){
  const w=(S.warnings||[]).find(x=>String(x.id)===String(window.__adminWarnEditId));
  if(!w){toast('Warning not found');window.__adminWarnEditId=null;render();return}
  w.sellerId=sid;w.userId=targetUserId;w.productId=taggedProduct?.id||null;w.productTitle=taggedProduct?.title||null;w.title=title;w.message=msg;w.edited=true;w.editedAt=nowISO();
  logAdminAudit('Edited seller warning',sid,{title,targetUserId,productId:taggedProduct?.id||null});
  window.__adminWarnEditId=null;save();toast('Warning updated');render();return;
 }
 S.warnings=S.warnings||[];const warning={id:uid("warn"),sellerId:sid,userId:targetUserId,productId:taggedProduct?.id||null,productTitle:taggedProduct?.title||null,title,message:msg,date:nowISO(),read:false};S.warnings.unshift(warning);adjustSellerScore(sid,-10,'Admin warning','WARNING:'+warning.id,'ADMIN');logAdminAudit('Sent seller warning',sid,{title,targetUserId,productId:taggedProduct?.id||null});save();toast(taggedProduct?`Warning sent and tagged to ${taggedProduct.id}`:"Warning sent");render()}
function warningMailStore(){S.mailMessages=Array.isArray(S.mailMessages)?S.mailMessages:[];return S.mailMessages}
function warningConversationFor(s){const u=S.currentUser||{},emails=new Set([String(u.email||'').toLowerCase()]);return warningMailStore().filter(m=>String(m.sellerId||'')===String(s.id)||String(m.userId||'')===String(u.id)||emails.has(String(m.to||'').toLowerCase())||emails.has(String(m.fromEmail||'').toLowerCase())).sort((a,b)=>new Date(b.date)-new Date(a.date))}
function dashWarnings(){const s=currentSeller();if(!s)return dashShell('warnings','<div class="dash-card"><h2>Warnings</h2><p class="muted">Seller sign-in required.</p></div>');const rows=(S.warnings||[]).filter(w=>String(w.sellerId)===String(s.id)),messages=warningConversationFor(s);return dashShell('warnings',`<div class="dash-card warning-support-card"><div class="section-head"><div><h2>Message Admin</h2><p>Ask a question, explain your update, or request warning resolution.</p></div><span class="pill">Admin Inbox</span></div><div class="form-grid"><div class="field"><label>Related Warning</label><select id="warnMailWarning"><option value="">General support message</option>${rows.map(w=>`<option value="${esc(w.id)}">${esc(w.title||'Warning')} · ${w.productId?esc(w.productTitle||w.productId):'Account'}</option>`).join('')}</select></div><div class="field"><label>Subject</label><input id="warnMailSubject" maxlength="160" value="Warning support request" placeholder="Message subject"></div></div><div class="field"><label>Message</label><textarea id="warnMailBody" maxlength="5000" placeholder="Tell Admin what you fixed or what help you need..."></textarea></div><label class="warning-resolution-check"><input id="warnMailResolved" type="checkbox"> <span><b>Request resolution review</b><small>I have completed the required changes and want Admin to review this warning.</small></span></label><button class="btn primary" onclick="sendWarningMessageToAdmin()">✉ Send Message to Admin</button></div><div class="dash-card"><div class="section-head"><div><h2>Warnings</h2><p>Important notices from Sale Earn Admin.</p></div><span class="pill">${rows.length} warning${rows.length===1?'':'s'}</span></div>${rows.map(w=>`<div class="security-row" style="cursor:pointer" onclick="seOpenSellerWarning('${esc(w.id||'')}')"><div style="flex:1"><b>${esc(w.title||'Admin Warning')}</b><div class="small muted">${w.date?new Date(w.date).toLocaleString('en-IN'):'-'}</div>${w.productId?`<div class="small" style="margin-top:5px"><b>Product to fix:</b> <a style="color:var(--brand);font-weight:800" href="#product/${encodeURIComponent(w.productId)}" onclick="event.stopPropagation()">${esc(w.productTitle||w.productId)}</a> <span class="muted">(${esc(w.productId)})</span></div>`:''}<p style="margin:6px 0 0">${esc(w.message||'')}</p></div><span class="admin-pill ${w.read?'success':(w.resolutionRequested?'warn':'danger')}">${w.read?'READ':(w.resolutionRequested?'REVIEW REQUESTED':'UNREAD')}</span></div>`).join('')||'<div class="admin-empty">No active warnings.</div>'}</div><div class="dash-card"><div class="section-head"><div><h2>Admin Conversation</h2><p>Your warning and support messages.</p></div><span class="pill">${messages.length}</span></div>${messages.map(m=>`<div class="warning-message ${m.type==='sent'?'admin-reply':'seller-message'}"><div><b>${m.type==='sent'?'Sale Earn Admin':'You'}</b><span>${m.date?new Date(m.date).toLocaleString('en-IN'):'-'}</span></div><strong>${esc(m.subject||'Message')}</strong><p>${esc(m.body||'')}</p>${m.warningId?`<small>Warning reference: ${esc(m.warningId)}</small>`:''}</div>`).join('')||'<div class="admin-empty">No messages yet.</div>'}</div>`)}
function sendWarningMessageToAdmin(){const s=currentSeller(),u=S.currentUser;if(!s||!u)return;const warningId=(document.getElementById('warnMailWarning')?.value||'').trim(),subject=(document.getElementById('warnMailSubject')?.value||'').trim(),body=(document.getElementById('warnMailBody')?.value||'').trim(),resolutionRequested=!!document.getElementById('warnMailResolved')?.checked;if(!subject||!body)return toast('Subject and message are required');const w=warningId?(S.warnings||[]).find(x=>String(x.id)===warningId&&String(x.sellerId)===String(s.id)):null;if(warningId&&!w)return toast('Related warning was not found');const m={id:uid('mail'),threadId:w?.mailThreadId||uid('thread'),type:'inbox',from:u.name||s.owner||'Seller',fromEmail:u.email||'',to:'Admin Mail Center',subject,body,date:nowISO(),read:false,starred:false,userId:u.id,sellerId:s.id,warningId:w?.id||null,productId:w?.productId||null,resolutionRequested};warningMailStore().unshift(m);if(w){w.mailThreadId=m.threadId;if(resolutionRequested){w.resolutionRequested=true;w.resolutionRequestedAt=m.date;w.resolutionMessageId=m.id}}if(warningMailStore().length>500)warningMailStore().length=500;save();toast('Message sent to Admin Inbox');render()}
function webCommissionStats(days=0){
 const cutoff=days>0?Date.now()-days*86400000:0;
 const inPeriod=x=>!cutoff||new Date(x.date||x.startDate||0).getTime()>=cutoff;
 const success=(S.orders||[]).filter(o=>o.status==='SUCCESS'&&inPeriod(o));
 const productCommission=success.reduce((a,o)=>{const fee=o.platformFee!=null?Number(o.platformFee):Number(o.amount||0)*(Number(o.platformFeeRate??.20));return a+Math.max(0,fee)},0);
 const subscriptionGross=(S.subscriptions||[]).filter(x=>(x.paymentStatus==='SUCCESS'||x.paymentVerified===true)&&inPeriod(x)).reduce((a,x)=>a+Number(x.amount||0),0);
 const adGross=(S.ads||[]).filter(x=>(x.paymentStatus==='SUCCESS'||x.paymentVerified===true)&&inPeriod(x)).reduce((a,x)=>a+Number(x.cost||0),0);
 const referralPaid=(S.referrals||[]).filter(x=>(x.status==='ACTIVE'||x.status==='PAID')&&inPeriod(x)).reduce((a,x)=>a+Number(x.commission||0),0);
 const adminAdjustments=(S.adminCommissionAdjustments||[]).filter(inPeriod).reduce((a,x)=>a+Number(x.amount||0),0);
 const gross=productCommission+subscriptionGross+adGross+adminAdjustments;
 return {productCommission,subscriptionGross,adGross,referralPaid,adminAdjustments,gross,net:Math.max(0,gross-referralPaid)};
}
function saleEarnMoneyLedger(days=0){
 const cutoff=days>0?Date.now()-days*86400000:0, rows=[];
 const add=(date,type,source,amount,direction,status='SUCCESS',ref='-')=>{
  const n=Number(amount||0),t=new Date(date||0).getTime();
  if(!n||!Number.isFinite(n)||(cutoff&&t<cutoff))return;
  rows.push({date:date||nowISO(),type,source,amount:n,direction,status,ref});
 };
 (S.orders||[]).forEach(o=>{if(String(o.status||'').toUpperCase()==='SUCCESS'||o.paymentVerified)add(o.date,'Income','Product sale',Number(o.amount||0),'IN','SUCCESS',o.id)});
 (S.subscriptions||[]).forEach(x=>{if(x.paymentVerified!==false&&String(x.paymentStatus||'SUCCESS').toUpperCase()==='SUCCESS')add(x.date,'Income','Subscription',Number(x.amount||0),'IN','SUCCESS',x.id)});
 (S.ads||[]).forEach(x=>{if(x.paymentVerified!==false&&String(x.paymentStatus||'SUCCESS').toUpperCase()==='SUCCESS')add(x.startDate||x.date,'Income','Advertising',Number(x.cost ?? x.amount ?? 0),'IN','SUCCESS',x.id)});
 Object.values(S.badgeLedgers||{}).forEach(st=>(st?.purchases||[]).forEach(x=>{if(x.paymentVerified!==false&&String(x.paymentStatus||'SUCCESS').toUpperCase()==='SUCCESS')add(x.date,'Income','Product badge credits',Number(x.amount||0),'IN','SUCCESS',x.id)}));
 (S.referrals||[]).filter(x=>['PAID','ACTIVE','SUCCESS'].includes(String(x.status||'').toUpperCase())).forEach(x=>add(x.date,'Expense','Referral payout',Number(x.commission||0),'OUT',x.status||'PAID',x.id));
 (S.payouts||[]).filter(x=>['PAID','APPROVED','SUCCESS','RECEIVED'].includes(String(x.status||'').toUpperCase())).forEach(x=>add(x.paidAt||x.processedAt||x.date,'Expense','Seller payout',Number(x.amount||0),'OUT',x.status,x.id));
 (S.serviceRefunds||[]).forEach(x=>add(x.date,'Expense','Service refund',Number(x.amount||0),'OUT',x.reason||'REFUND',x.id));
 (S.balancePayments||[]).forEach(x=>{const a=Number(x.amount||0);if(!a)return;const kind=String(x.kind||'Balance transaction');if(/refund/i.test(kind))add(x.date,'Expense',kind.replace(/Refund/i,' refund'),Math.abs(a),'OUT',x.status||'SUCCESS',x.id);});
 (S.adminFinancialLedger||[]).forEach(x=>{const a=Number(x.amount||x.value||0);if(!a)return;add(x.date||x.createdAt,'Ledger',x.kind||x.type||'Admin adjustment',Math.abs(a),a>=0?'IN':'OUT',x.status||'RECORDED',x.id||x.refId||'-')});
 return rows.sort((a,b)=>new Date(b.date)-new Date(a.date));
}
function adminCommission(){
 const days=Number(window.adminCommissionDays||0),c=webCommissionStats(days),labels=days===0?'All Time':`Last ${days} Days`;
 const ledger=saleEarnMoneyLedger(days),income=ledger.filter(x=>x.direction==='IN').reduce((a,x)=>a+x.amount,0),expense=ledger.filter(x=>x.direction==='OUT').reduce((a,x)=>a+x.amount,0),netCash=income-expense;
 const badgeRevenue=ledger.filter(x=>x.source==='Product badge credits'&&x.direction==='IN').reduce((a,x)=>a+x.amount,0);
 const messages=(S.mailMessages||[]).filter(x=>!days||new Date(x.date||0).getTime()>=Date.now()-days*86400000),unread=messages.filter(x=>!x.read).length;
 const ledgerRows=ledger.slice(0,150).map(x=>`<div class="security-row" style="display:grid;grid-template-columns:150px 1fr 130px 110px;gap:10px;align-items:center"><div class="small muted">${new Date(x.date).toLocaleString('en-IN')}</div><div><b>${esc(x.source)}</b><div class="small muted">${esc(x.type)} · Ref: ${esc(x.ref)}</div></div><span class="tag">${esc(x.status)}</span><b style="text-align:right;color:${x.direction==='IN'?'#16a34a':'#dc2626'}">${x.direction==='IN'?'+':'−'}${money(x.amount)}</b></div>`).join('')||'<div class="admin-empty">No money movement recorded for this period.</div>';
 return adminLayout('commission','Total Web Commission',`
 <div class="admin-card" style="margin-bottom:18px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b>Commission Period</b><button class="btn ${days===0?'primary':''}" onclick="window.adminCommissionDays=0;render()">All Time</button><button class="btn ${days===7?'primary':''}" onclick="window.adminCommissionDays=7;render()">7 Days</button><button class="btn ${days===30?'primary':''}" onclick="window.adminCommissionDays=30;render()">30 Days</button><button class="btn ${days===365?'primary':''}" onclick="window.adminCommissionDays=365;render()">1 Year</button></div></div>
 <div class="admin-kpis">
  <div class="admin-kpi"><div class="kpi-icon">◔</div><span>Total Web Commission</span><b>${money(c.net)}</b><small class="muted">Net platform commission · ${labels}</small></div>
  <div class="admin-kpi"><span>Money In</span><b>${money(income)}</b><small class="muted">Every recorded incoming rupee</small></div>
  <div class="admin-kpi"><span>Money Out</span><b>${money(expense)}</b><small class="muted">Payouts, refunds & tracked costs</small></div>
  <div class="admin-kpi"><span>Net Cash Tracked</span><b>${money(netCash)}</b><small class="muted">Income − outgoing</small></div>
  <div class="admin-kpi"><span>Product Badge Revenue</span><b>${money(badgeRevenue)}</b><small class="muted">₹3 per paid badge placement credit</small></div>
  <div class="admin-kpi"><span>Contact Messages</span><b>${messages.length}</b><small class="muted">${unread} unread · <button class="btn" style="padding:3px 8px" onclick="go('admin/mail')">Open Mail Center</button></small></div>
 </div>
 <div class="admin-grid2">
  <div class="admin-card"><h2>Commission Breakdown</h2><div class="sub">Only successful/verified records are included.</div>${[['Product sales commission',c.productCommission],['Subscription revenue',c.subscriptionGross],['Ads revenue',c.adGross],['Product badge revenue',badgeRevenue],['Deleted-user balance transferred',c.adminAdjustments||0],['Referral payouts',-c.referralPaid],['Net web commission',c.net]].map(r=>`<div class="security-row"><span>${r[0]}</span><b>${r[1]<0?'−':''}${money(Math.abs(r[1]))}</b></div>`).join('')}</div>
  <div class="admin-card"><h2>Commission Summary</h2><div class="security-row"><span>Gross platform revenue</span><b>${money(c.gross+badgeRevenue)}</b></div><div class="security-row"><span>Tracked money out</span><b>− ${money(expense)}</b></div><div class="security-row"><span><b>Net cash tracked</b></span><b>${money(netCash)}</b></div><div class="security-row"><span>Contact inbox</span><b>${messages.length} messages</b></div><div class="security-row"><span>Product badge credits</span><b>${money(badgeRevenue)}</b></div></div>
 </div>
 <div class="admin-card" style="margin-top:18px"><div class="section-head"><div><h2>Money Movement — ₹1-by-₹1 Tracking</h2><div class="sub">Every recorded payment, badge purchase, seller payout, referral payout and refund appears here with date, source and reference.</div></div><button class="btn primary" onclick="go('admin/mail')">Open Messages</button></div><div style="max-height:520px;overflow:auto;border:1px solid var(--line);border-radius:14px;padding:4px 10px">${ledgerRows}</div></div>
 `)
}
function adminAuditPage(){const rows=(S.adminAuditLog||[]).slice(0,300);return adminLayout('audit','Admin Audit Log',`<div class="admin-card"><div class="section-head"><div><h2>Admin Actions</h2><div class="sub">A history of important administrative actions with date and time.</div></div></div>${rows.map(x=>`<div class="security-row"><div><b>${esc(x.action)}</b><div class="small muted">Target: ${esc(x.targetId||'-')} · Admin: ${esc(x.adminId||'-')}</div></div><span class="small muted">${new Date(x.date).toLocaleString('en-IN')}</span></div>`).join('')||'<div class="admin-empty">No admin audit activity yet.</div>'}</div>`)}
function adminSystem(){const checks=[['Supabase connection',SUPABASE_READY?'CONNECTED':'NOT CONNECTED'],['Payment gateway','LIVE'],['Realtime sync',ONLINE_READY?'READY':'WAITING'],['Product recycle cleanup','7-DAY AUTO DELETE'],['Admin authorization','DATABASE ROLE CHECK']];return adminLayout('system','System Health',`<div class="admin-kpis">${checks.map(x=>`<div class="admin-kpi"><span>${esc(x[0])}</span><b style="font-size:18px">${esc(x[1])}</b></div>`).join('')}</div><div class="admin-card" style="margin-top:18px"><h2>Platform Environment</h2><div class="sub">Core platform status.</div><div class="security-row"><span>Payment gateway</span><b>LIVE</b></div><div class="security-row"><span>Public catalog</span><b>LOCAL + SUPABASE STATE</b></div><div class="security-row"><span>Admin access</span><b>AUTHORIZED USERS ONLY</b></div></div>`)}
function adminDeleted(){
 const ps=S.deletedProducts||[];
 setTimeout(()=>hydrateAdminDeletedProducts().catch(e=>console.warn('Deleted products load:',e?.message||e)),0);
 return adminLayout('deleted','Deleted Products / Recycle Bin',`<div class="admin-card"><div class="section-head"><div><h2>Recycle Bin</h2><div class="sub">Deleted products stay here so Admin can search and restore them.</div></div></div><div class="field"><input id="recycleSearch" placeholder="Search deleted product..." oninput="filterRecycle(this.value)"></div><div id="recycleList">${adminRecycleRows(ps)}</div></div>`);
}
async function hydrateAdminDeletedProducts(){
 if(!adminOnly()||!window.supabaseClient)return;
 const r=await supabaseClient.from('products').select('id,seller_id,title,description,price,status,file_url,image_url,created_at').eq('status','deleted').order('created_at',{ascending:false});
 if(r.error){console.warn('Deleted products query failed:',r.error.message);return;}
 const known=new Set((S.deletedProducts||[]).map(p=>String(p.id)));
 for(const row of (r.data||[])){
  if(!known.has(String(row.id)))S.deletedProducts.unshift({id:String(row.id),sellerId:row.seller_id,title:row.title||'Untitled',description:row.description||'',price:Number(row.price||0),status:'deleted',links:row.file_url?[row.file_url]:[],image:row.image_url||'',createdAt:row.created_at||nowISO(),deletedAt:nowISO(),recycledFrom:'live'});
 }
 const el=document.getElementById('recycleList');if(el)el.innerHTML=adminRecycleRows(S.deletedProducts||[]);
}
function adminRecycleRows(ps){return ps.map(p=>`<div class="security-row recycle-row"><div><b>${esc(p.title)}</b><div class="small muted">${esc(p.id)} · Seller @${esc(p.sellerId)} · Deleted ${p.deletedAt?new Date(p.deletedAt).toLocaleString('en-IN'):'-'}</div></div><div class="admin-actions"><button class="btn" onclick="adminRestoreProduct('${p.id}')">Restore</button><button class="btn danger" onclick="adminPermanentDelete('${p.id}')">Delete Forever</button></div></div>`).join('')||'<div class="admin-empty">Recycle Bin is empty.</div>'}
function filterRecycle(q){const ps=(S.deletedProducts||[]).filter(p=>(p.title||'').toLowerCase().includes(q.toLowerCase())||(p.id||'').toLowerCase().includes(q.toLowerCase())||(p.sellerId||'').toLowerCase().includes(q.toLowerCase()));const el=document.getElementById('recycleList');if(el)el.innerHTML=adminRecycleRows(ps)}
function adminRestrict(id){if(!adminOnly())return;const u=S.users.find(x=>x.id===id);if(!u||u.isAdmin)return;adminConfirm('Restrict this user?','The user and store will be unpublished for 3 days. You can release them earlier.','adminRestrictNow(\''+id+'\')','Restrict 3 Days')}
function adminRestrictNow(id){const u=S.users.find(x=>x.id===id);if(!u)return;u.unpublicUntil=Date.now()+3*86400000;u.suspendedUntil=u.unpublicUntil;adjustSellerScore(u.sellerId,-12,'3-day account restriction','RESTRICT:'+id+':'+Date.now(),'ADMIN');logAdminAudit('Restricted user for 3 days',id);save();toast('User restricted for 3 days');render()}
function adminRelease(id){if(!adminOnly())return;adminConfirm('Release this user?','Their public profile/store will become available again.','adminReleaseNow(\''+id+'\')','Release')}
function adminReleaseNow(id){const u=S.users.find(x=>x.id===id);if(!u)return;u.unpublicUntil=0;u.suspendedUntil=0;logAdminAudit('Released user',id);save();toast('User released');render()}
function adminDeleteProduct(id){if(!adminOnly())return;const p=product(id);if(!p)return;showPMConfirm('Delete Product',`<b>${esc(p.title||'Untitled Product')}</b><p class="muted">Choose what Admin should do with this product.</p>`,[`<button class="btn" onclick="closeModal()">Cancel</button>`,`<button class="btn" onclick="adminDeleteProductNow('${esc(id)}')">Move to Deleted</button>`,`<button class="btn danger" onclick="adminPermanentDeleteProduct('${esc(id)}')">Permanent Delete</button>`])}
async function adminDeleteProductNow(id){
 if(!adminOnly())return;
 const p=product(id);if(!p)return;
 const archived={...p,recycledFrom:'admin',recycledAt:nowISO(),deletedAt:nowISO(),deletedBy:S.currentUser?.id||null};
 S.deletedProducts=S.deletedProducts||[];
 S.deletedProducts=S.deletedProducts.filter(x=>String(x.id)!==String(id));
 S.deletedProducts.unshift(archived);
 S.products=(S.products||[]).filter(x=>String(x.id)!==String(id));
 S.saved=(S.saved||[]).filter(x=>String(x?.productId)!==String(id));
 S.ads=(S.ads||[]).filter(x=>String(x?.productId)!==String(id));
 logAdminAudit('Moved product to Deleted',id,{sellerId:p.sellerId});
 logProductActivity(id,'Moved to Deleted',{sellerId:p.sellerId});
 save();render();toast('Product hidden. Moving it to Deleted…');
 const hidden=await hideProductRowFromPublicCloud(id);
 save();render();
 toast(hidden?'Product moved to Deleted':'Product hidden locally; public database row could not be removed. Check RLS.');
}
async function adminPermanentDeleteProduct(id){
 if(!adminOnly())return;
 const p=product(id);if(!p)return;
 showPMConfirm('Permanent Delete',`<b>${esc(p.title||'Untitled Product')}</b><p class="muted">This permanently removes the product and its Supabase product/storage data. This cannot be undone.</p>`,[`<button class="btn" onclick="closeModal()">Cancel</button>`,`<button class="btn danger" onclick="adminPermanentDeleteProductNow('${esc(id)}')">Delete Forever</button>`]);
}
async function adminPermanentDeleteProductNow(id){
 if(!adminOnly())return;
 const p=product(id);if(!p)return;
 tombstoneProduct(id);removeProductFromAllCloudState(id);
 S.saved=(S.saved||[]).filter(x=>String(x?.productId)!==String(id));
 S.ads=(S.ads||[]).filter(x=>String(x?.productId)!==String(id));
 adjustSellerScore(p.sellerId,-2,'Product permanently deleted','DELETE:'+id+':'+Date.now(),'ADMIN');
 logAdminAudit('Permanently deleted product',id,{sellerId:p.sellerId});
 logProductActivity(id,'Permanently deleted',{sellerId:p.sellerId});
 save();render();toast('Product hidden. Permanently deleting cloud data…');
 const ok=await purgeProductFromCloud(p);
 save();render();
 toast(ok?'Product permanently deleted':'Product hidden; some cloud data could not be deleted. Check Supabase RLS/storage permissions.');
}
function adminRestoreProduct(id){if(!adminOnly())return;adminConfirm('Restore this product?','The product will return to the public marketplace.','adminRestoreProductNow(\''+id+'\')','Restore')}
async function adminRestoreProductNow(id){
 if(!adminOnly())return;
 const i=(S.deletedProducts||[]).findIndex(p=>String(p.id)===String(id));if(i<0)return;
 const p={...S.deletedProducts[i]};delete p.deletedAt;delete p.deletedBy;delete p.recycledAt;delete p.recycledFrom;
 S.productTombstones=(S.productTombstones||[]).filter(t=>String(t.id)!==String(id));
 S.deletedProducts.splice(i,1);S.products=S.products||[];S.products.unshift(p);
 logAdminAudit('Restored product from Deleted',id,{sellerId:p.sellerId});
 logProductActivity(id,'Restored to Live Products',{sellerId:p.sellerId});
 save();render();toast('Product restored. Publishing it again…');
 const owner=sellerOwnerUser(p.sellerId);const ownerId=owner?.authId||owner?.id||normalizedOwnerId(p.sellerId)||p.sellerId;const r=window.supabaseClient?await supabaseClient.from('products').upsert({id:String(p.id),seller_id:ownerId,title:String(p.title||'Untitled'),description:p.description||null,price:Number(p.price||0),status:'active',file_url:p.links?.[0]||p.deliveryUrl||null,image_url:p.image||null},{onConflict:'id'}):{error:null};
 if(r.error)console.warn('Restored product cloud upsert failed:',r.error.message||r.error);
 save();render();toast(r.error?'Product restored locally; public row could not be recreated. Check RLS.':'Product restored');
}
function adminPermanentDelete(id){if(!adminOnly())return;const p=(S.deletedProducts||[]).find(x=>String(x.id)===String(id));if(!p)return;adminConfirm('Permanently delete?','This removes the product from Deleted and permanently deletes its Supabase product/storage data. It cannot be restored.','adminPermanentDeleteNow(\''+id+'\')','Delete Forever')}
async function adminPermanentDeleteNow(id){
 if(!adminOnly())return;
 const p=(S.deletedProducts||[]).find(x=>String(x.id)===String(id));if(!p)return;
 tombstoneProduct(id);removeProductFromAllCloudState(id);
 S.deletedProducts=(S.deletedProducts||[]).filter(x=>String(x.id)!==String(id));
 adjustSellerScore(p.sellerId,-2,'Product permanently deleted','DELETE:'+id+':'+Date.now(),'ADMIN');
 logAdminAudit('Permanently deleted product',id,{sellerId:p.sellerId});
 logProductActivity(id,'Permanently deleted',{sellerId:p.sellerId});
 save();render();toast('Product hidden. Permanently deleting cloud data…');
 const ok=await purgeProductFromCloud(p);
 save();render();toast(ok?'Product permanently deleted':'Product hidden; some cloud data could not be deleted. Check Supabase RLS/storage permissions.');
}
function adminDeleteReview(pid,rid){if(!adminOnly())return;adminConfirm('Delete this review?','This review will be removed from the product review list.','adminDeleteReviewNow(\''+pid+'\',\''+rid+'\')','Delete Review')}
function adminDeleteReviewNow(pid,rid){S.reviews[pid]=(S.reviews[pid]||[]).filter(r=>r.id!==rid);logAdminAudit('Deleted review',rid,{productId:pid});save();toast('Review deleted');render()}
function adminSearchResults(q){q=q.trim().toLowerCase();if(!q)return [];const rows=[];S.users.filter(u=>(u.id+' '+u.email+' '+u.name).toLowerCase().includes(q)).slice(0,5).forEach(u=>rows.push({type:'User',label:u.name||u.id,meta:u.id+' · '+u.email,route:'user/'+u.id,icon:'♙'}));S.products.filter(p=>(p.id+' '+p.title+' '+p.category).toLowerCase().includes(q)).slice(0,5).forEach(p=>rows.push({type:'Product',label:p.title,meta:p.id+' · '+p.category,route:'product/'+p.id,icon:'◈'}));S.orders.filter(o=>(o.id+' '+(o.customerId||'')+' '+(o.customerEmail||'')).toLowerCase().includes(q)).slice(0,5).forEach(o=>rows.push({type:'Order',label:'#'+o.id,meta:(o.customerId||o.customerEmail||'Customer')+' · '+o.status,route:'order/'+o.id,icon:'▤'}));return rows.slice(0,10)}
function adminSearchLive(q){const box=document.getElementById('adminSearchResults');if(!box)return;const rows=adminSearchResults(q);if(!q.trim()||!rows.length){box.classList.add('hidden');box.innerHTML='';return}box.classList.remove('hidden');box.innerHTML=rows.map(x=>`<div class="admin-search-result" onclick="adminNav('${x.route}');document.getElementById('adminSearchResults')?.classList.add('hidden')"><span style="width:28px;height:28px;border-radius:9px;background:#eeecff;display:grid;place-items:center">${x.icon}</span><div><b>${esc(x.label)}</b><div class="small muted">${esc(x.type)} · ${esc(x.meta)}</div></div></div>`).join('')}
function adminSearch(q){const rows=adminSearchResults(q);if(rows[0])return adminNav(rows[0].route);toast('No matching user, product or order found')}
function adminRemoveProduct(id){adminDeleteProduct(id)}
function adminSuspend(id){adminRestrict(id)}


/* -------------------- ADVANCED ADMIN / BUSINESS SYSTEMS -------------------- */
function advState(){
 S.adminControls=S.adminControls||{marketplaceFreeze:false,newSellerRegistration:false,productUploads:false,withdrawals:false,payments:false,ads:false,referrals:false};
 S.riskAlerts=S.riskAlerts||[];S.coupons=S.coupons||[];S.couponRedemptions=S.couponRedemptions||[];S.storeThemes=S.storeThemes||{};S.securityEvents=S.securityEvents||[];S.sellerRankings=S.sellerRankings||[];S.growthGoals=S.growthGoals||{};
 return S.adminControls;
}
function controlOff(key){
 const legacy=advState();
 if(legacy&&legacy[key]===true)return true;
 const c=ensurePlatformConfig(),f=c.features||{};
 const map={
  ads:'sellerAds',sellerAds:'sellerAds',sellerRegistration:'sellerRegistration',buyerRegistration:'buyerRegistration',
  productUpload:'productUpload',productUploads:'productUpload',productApproval:'productApproval',
  subscriptions:'subscriptions',referrals:'referrals',reviews:'reviews',messaging:'messaging',wishlist:'wishlist',
  coupons:'coupons',withdrawals:'withdrawals',refunds:'refunds',disputes:'disputes',notifications:'notifications',
  sellerAnalytics:'sellerAnalytics',productAnalytics:'productAnalytics'
 };
 const featureKey=map[key]||key;
 return Object.prototype.hasOwnProperty.call(f,featureKey) ? f[featureKey]===false : false;
}
function systemGuard(key,message){if(controlOff(key)){toast(message||'This feature is temporarily disabled by Admin');return false}return true}
function logSecurityEvent(type,meta={}){S.securityEvents=S.securityEvents||[];S.securityEvents.unshift({id:uid('sec'),type,date:nowISO(),userId:S.currentUser?.id||window.pendingBuy?.userId||null,meta:meta||{}});if(S.securityEvents.length>300)S.securityEvents.length=300}
function adminAudit(action,targetId,meta={}){logAdminAudit(action,targetId,meta);logSecurityEvent('ADMIN_ACTION',{action,targetId,meta})}
function adminMoneyOverview(){
 const sellers=Object.values(S.sellers||{}).map(ss=>{const gross=sellerEarnings(ss.id),received=(S.payouts||[]).filter(x=>x.sellerId===ss.id&&x.status==='APPROVED').reduce((a,x)=>a+Number(x.amount||0),0),toReceive=sellerAvailableBalance(ss.id),sales=(S.orders||[]).filter(x=>x.sellerId===ss.id&&x.status==='SUCCESS').length;return {id:ss.id,name:ss.name||ss.owner||ss.id,gross,received,toReceive,sales}});
 const totalTo=sellers.reduce((a,x)=>a+x.toReceive,0),totalReceived=sellers.reduce((a,x)=>a+x.received,0),totalSales=sellers.reduce((a,x)=>a+x.sales,0);
 return adminLayout('money','Admin Money Overview',`<div class="admin-kpis"><div class="admin-kpi"><span>All Users · To Receive</span><b>${money(totalTo)}</b></div><div class="admin-kpi"><span>All Users · Received</span><b>${money(totalReceived)}</b></div><div class="admin-kpi"><span>Total Successful Sales</span><b>${totalSales}</b></div><div class="admin-kpi"><span>Seller Accounts</span><b>${sellers.length}</b></div></div><div class="admin-card"><div class="section-head"><div><h2>Seller-wise Money</h2><div class="sub">To Receive excludes approved/pending payouts and balance-paid services.</div></div></div><table class="admin-table"><thead><tr><th>Seller</th><th>Sales</th><th>To Receive</th><th>Received</th><th>Gross Net Earnings</th></tr></thead><tbody>${sellers.map(x=>`<tr class="data-row" onclick="adminNav('seller/${x.id}')"><td><b>@${esc(x.id)}</b><div>${esc(x.name)}</div></td><td>${x.sales}</td><td>${money(x.toReceive)}</td><td>${money(x.received)}</td><td>${money(x.gross)}</td></tr>`).join('')||'<tr><td colspan="5"><div class="admin-empty">No seller data.</div></td></tr>'}</tbody></table></div>`)
}
function adminEmergency(){
 const c=advState(),labels=[['marketplaceFreeze','Marketplace Freeze','Hide public marketplace buying/listing surfaces'],['newSellerRegistration','New Seller Registration','Block new account creation'],['productUploads','Product Uploads','Block publishing/editing new products'],['withdrawals','Withdrawals','Block payout requests'],['payments','Payments','Block all checkout/service payments'],['ads','Advertising','Block new advertising campaigns'],['referrals','Referral System','Block referral application/upgrades']];
 return adminLayout('emergency','Emergency Controls',`<div class="admin-card"><div class="section-head"><div><h2>System Kill-Switches</h2><div class="sub">Changes are logged. Existing records are preserved; switches block new actions only.</div></div></div>${labels.map(([k,t,d])=>`<div class="security-row"><div><b>${t}</b><div class="small muted">${d}</div></div><button class="btn ${c[k]?'danger':'primary'}" onclick="toggleEmergency('${k}')">${c[k]?'ON · BLOCKED':'OFF · ALLOWED'}</button></div>`).join('')}</div><div class="admin-card"><h2>Current protection state</h2><p class="muted">Use this panel during maintenance, fraud spikes or payment incidents. It does not delete or alter historical money records.</p></div>`)
}
function toggleEmergency(key){if(!adminOnly())return;const c=advState();c[key]=!c[key];adminAudit('Emergency control '+(c[key]?'enabled':'disabled'),key,{enabled:c[key]});save();toast((c[key]?'Enabled ':'Disabled ')+key);render()}
function detectRiskAlerts(){
 const alerts=[];const orders=(S.orders||[]).filter(o=>o.status==='SUCCESS');
 const byUser={};orders.forEach(o=>{const k=o.customerId||('guest:'+o.customerEmail);(byUser[k]??=[]).push(o)});
 Object.entries(byUser).forEach(([id,os])=>{if(os.length<3)return;const times=os.map(o=>new Date(o.date).getTime()).sort((a,b)=>a-b);for(let i=2;i<times.length;i++){if(times[i]-times[i-2]<10*60*1000){alerts.push({type:'Order Spike',severity:'HIGH',subject:id,reason:'Three successful orders inside 10 minutes',evidence:os.slice(-3).map(x=>x.id).join(', ')});break}}});
 const failed=(S.orders||[]).filter(o=>o.status==='FAILED');const failedBy={};failed.forEach(o=>(failedBy[o.customerId||o.customerEmail||'guest']??=[]).push(o));Object.entries(failedBy).forEach(([id,os])=>{if(os.length>=3)alerts.push({type:'Repeated Failed Payments',severity:'MEDIUM',subject:id,reason:'Three or more failed payment records',evidence:String(os.length)+' failures'})});
 const ref={};(S.referrals||[]).forEach(r=>(ref[r.sellerId]??=[]).push(r));Object.entries(ref).forEach(([sid,rs])=>{if(rs.length>=5){const recent=rs.filter(r=>Date.now()-new Date(r.date).getTime()<24*3600000);if(recent.length>=5)alerts.push({type:'Referral Pattern',severity:'MEDIUM',subject:sid,reason:'Unusually concentrated referral activity in 24 hours',evidence:String(recent.length)+' referrals'})}});
 const fp={};(S.devices||[]).forEach(d=>{if(!d.fingerprint)return;(fp[d.fingerprint]??=[]).push(d.userId)});Object.entries(fp).forEach(([finger,ids])=>{const uniq=[...new Set(ids)].filter(Boolean);if(uniq.length>1)alerts.push({type:'Linked Account Signal',severity:'MEDIUM',subject:uniq.join(', '),reason:'Multiple account IDs share a device/session fingerprint',evidence:'Fingerprint '+finger.slice(0,10)+'… · '+uniq.length+' accounts'})});
 const refs={};(S.gatewayPayments||[]).forEach(t=>{const refId=t.meta?.refId;if(refId) (refs[refId]??=[]).push(t.id)});Object.entries(refs).forEach(([refId,ids])=>{if(ids.length>1)alerts.push({type:'Payment Reference Reuse',severity:'HIGH',subject:refId,reason:'The same payment reference appears more than once',evidence:ids.join(', ')})});
 return alerts;
}
function adminRiskDetails(a){
 if(!adminOnly()||!a)return;
 const u=(S.users||[]).find(x=>x.id===a.userId||x.userId===a.userId||x.sellerId===a.sellerId),sid=a.sellerId||u?.sellerId||'';
 document.getElementById('modalRoot').innerHTML=`<div class="modal-bg"><div class="modal" style="max-width:720px;width:94%"><button class="btn iconbtn close" onclick="closeModal()">&#10005;</button><h2 style="margin-top:0">Risk Signal Details</h2><p><span class="admin-pill ${a.severity==='HIGH'?'danger':'warn'}">${esc(a.severity||'')}</span> <b>${esc(a.type||'Signal')}</b></p><div class="admin-detail"><div class="admin-detail-box"><h3>Subject</h3><p>${esc(a.subject||'-')}</p><p class="small muted">User: ${esc(a.userId||'-')}<br>Seller: ${esc(sid||'-')}</p></div><div class="admin-detail-box"><h3>Reason & Evidence</h3><p>${esc(a.reason||'-')}</p><p class="small muted">${esc(a.evidence||'-')}</p></div></div><div class="admin-actions" style="margin-top:16px">${u?`<button class="btn" onclick="closeModal();adminNav('user/${esc(u.id)}')">Open User</button>`:''}${sid?`<button class="btn" onclick="closeModal();adminNav('seller/${esc(sid)}')">Open Seller</button>`:''}<button class="btn" onclick="closeModal();adminNav('security')">Open Security</button></div><div class="modal-footer"><button class="btn" onclick="closeModal()">Close</button></div></div></div>`;
}
function adminRisk(){const alerts=detectRiskAlerts();S.riskAlerts=alerts.map((a,i)=>({...a,id:'risk_'+i,date:a.date||nowISO()}));return adminLayout('risk','Fraud Detection / Risk Center',`<div class="admin-kpis"><div class="admin-kpi"><span>Risk Alerts</span><b>${alerts.length}</b></div><div class="admin-kpi"><span>High Severity</span><b>${alerts.filter(x=>x.severity==='HIGH').length}</b></div><div class="admin-kpi"><span>Possible Linked Signals</span><b>${alerts.filter(x=>x.type==='Linked Account Signal').length}</b></div><div class="admin-kpi"><span>Security Events</span><b>${(S.securityEvents||[]).length}</b></div></div><div class="admin-card"><div class="section-head"><div><h2>Signal-based Risk Alerts</h2><div class="sub">These are signals, not proof that two accounts belong to the same person. Admin review is required.</div></div><button class="btn" onclick="adminRisk()">Scan</button></div>${alerts.map((a,i)=>`<div class="security-row" style="cursor:pointer" onclick="adminRiskDetails(S.riskAlerts[${i}]||{})"><div><b>${esc(a.type)}</b><div class="small muted">${esc(a.subject)} · ${esc(a.reason)}</div><div class="small muted">Evidence: ${esc(a.evidence||'-')}</div></div><span class="admin-pill ${a.severity==='HIGH'?'danger':'warn'}">${a.severity}</span></div>`).join('')||'<div class="admin-empty">No current risk signals detected.</div>'}</div>`)}
function analyticsOrders(start,end){return (S.orders||[]).filter(o=>o.status==='SUCCESS'&&(!start||new Date(o.date)>=start)&&(!end||new Date(o.date)<end))}
function adminAnalytics(){
 const start=window.adminAnalyticsStart?new Date(window.adminAnalyticsStart):new Date(Date.now()-30*86400000);const end=window.adminAnalyticsEnd?new Date(window.adminAnalyticsEnd+'T23:59:59'):new Date();const os=analyticsOrders(start,end);
 const activeSellerIds=new Set(os.map(o=>o.sellerId));(S.productActivity||[]).filter(x=>new Date(x.date)>=start&&new Date(x.date)<end&&x.sellerId).forEach(x=>activeSellerIds.add(x.sellerId));const activeBuyerIds=new Set(os.map(o=>o.customerId||o.customerEmail));const daily={};os.forEach(o=>{const d=new Date(o.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});daily[d]=(daily[d]||0)+Number(o.amount||0)});const bars=Object.entries(daily).slice(-14);
 return adminLayout('analytics','Advanced Admin Analytics',`<div class="admin-card"><div class="form-grid"><div class="field"><label>From</label><input id="aaStart" type="date" value="${start.toISOString().slice(0,10)}"></div><div class="field"><label>To</label><input id="aaEnd" type="date" value="${end.toISOString().slice(0,10)}"></div><div class="field" style="align-self:end"><button class="btn primary" onclick="applyAdminAnalytics()">Apply Filter</button></div></div></div><div class="admin-kpis"><div class="admin-kpi"><span>Active Sellers</span><b>${activeSellerIds.size}</b><small class="muted">At least one successful sale in range</small></div><div class="admin-kpi"><span>Active Buyers</span><b>${activeBuyerIds.size}</b><small class="muted">Unique purchasers in range</small></div><div class="admin-kpi"><span>Orders</span><b>${os.length}</b></div><div class="admin-kpi"><span>Sales</span><b>${money(os.reduce((a,o)=>a+Number(o.amount||0),0))}</b></div></div><div class="admin-grid2"><div class="admin-card"><h2>Sales Trend</h2><div class="sub">Selected date range; latest 14 active days shown.</div><div class="chart">${bars.map(([d,v])=>{const max=Math.max(1,...bars.map(x=>x[1]));return `<div class="bar-wrap"><b class="small">${money(v)}</b><div class="bar" style="height:${Math.max(4,v/max*155)}px"></div><div class="bar-label">${esc(d)}</div></div>`}).join('')||'<div class="admin-empty">No sales in range.</div>'}</div></div><div class="admin-card"><h2>Buyer / Seller Activity</h2><div class="security-row"><span>Unique active buyers</span><b>${activeBuyerIds.size}</b></div><div class="security-row"><span>Active sellers</span><b>${activeSellerIds.size}</b></div><div class="security-row"><span>Average order value</span><b>${money(os.length?os.reduce((a,o)=>a+Number(o.amount||0),0)/os.length:0)}</b></div></div></div>`)
}
function applyAdminAnalytics(){window.adminAnalyticsStart=document.getElementById('aaStart')?.value||'';window.adminAnalyticsEnd=document.getElementById('aaEnd')?.value||'';render()}
function sellerScore(ss){return getSellerScore(ss.id)}
function sellerRankings(){return Object.values(S.sellers||{}).map(ss=>({seller:ss,score:sellerScore(ss)})).sort((a,b)=>b.score-a.score)}
function adminRanking(){const rows=sellerRankings();return adminLayout('ranking','Seller Ranking',`<div class="admin-card"><div class="section-head"><div><h2>Dynamic Seller Ranking</h2><div class="sub">Score starts at 70. Sales add 5; product deletion subtracts 2; warnings subtract 10; 3-day restrictions subtract 12. Admin can set it manually.</div></div></div>${rows.map((x,i)=>`<div class="security-row"><div><b>#${i+1} @${esc(x.seller.id)}</b><div class="small muted">${esc(x.seller.name||x.seller.owner||'Seller')} · ${x.seller.plan||'FREE'} · ${x.seller.followers||0} followers</div></div><span class="admin-pill ${x.score>=60?'success':x.score>=30?'warn':'danger'}">Score ${x.score} · ${x.score>=85?'Elite':x.score>=70?'Top Seller':x.score>=50?'Rising':'Needs Attention'}</span></div>`).join('')||'<div class="admin-empty">No sellers yet.</div>'}</div>`)}
function adminGrowth(){const rows=sellerRankings().slice(0,12);return adminLayout('growth','Seller Growth Center',`<div class="admin-card"><h2>Growth Opportunities</h2><div class="sub">Actionable suggestions generated from current marketplace records.</div>${rows.map(x=>{const sid=x.seller.id,orders=S.orders.filter(o=>o.sellerId===sid&&o.status==='SUCCESS').length,products=S.products.filter(p=>p.sellerId===sid).length,followers=x.seller.followers||0,tip=products<3?'Add more quality products':orders<3?'Improve product visibility with relevant ads':followers<5?'Promote your store and gain followers':'Maintain review quality and consistent activity';return `<div class="security-row"><div><b>@${esc(sid)}</b><div class="small muted">Products ${products} · Sales ${orders} · Followers ${followers}</div></div><span class="pill">${tip}</span></div>`}).join('')||'<div class="admin-empty">No seller data.</div>'}</div>`)}
function adminSmartReviews(){const rows=Object.entries(S.reviews||{}).flatMap(([pid,rs])=>(rs||[]).map(r=>({pid,r}))).sort((a,b)=>Number(b.r.rating||0)-Number(a.r.rating||0));return adminLayout('smartreviews','Smart Review System',`<div class="admin-card"><div class="section-head"><div><h2>Review Quality & Moderation</h2><div class="sub">Verified-buyer badges, helpful reactions and seller replies are retained. Admin can remove policy-violating reviews.</div></div></div>${rows.map(x=>`<div class="security-row"><div><b>${esc(x.r.name||'User')} · ${'★'.repeat(Number(x.r.rating||0))}</b><div class="small muted">${esc(product(x.pid)?.title||'Deleted product')} · ${x.r.verified?'Verified buyer':'Unverified'} · 👍 ${(x.r.likedBy||[]).length}</div><div>${esc(x.r.text||'')}</div></div><button class="btn danger" onclick="adminDeleteReview('${x.pid}','${x.r.id}')">Remove</button></div>`).join('')||'<div class="admin-empty">No reviews yet.</div>'}</div>`)}
function adminCoupons(){const sellerCoupons=(S.products||[]).filter(p=>p.coupon?.code).map(p=>({...p.coupon,productId:p.id,sellerId:p.sellerId,source:'seller-product'}));const rows=[...(S.coupons||[]),...sellerCoupons];return adminLayout('coupons','Coupon & Discount System',`<div class="admin-card"><div class="section-head"><div><h2>Create Coupon</h2><div class="sub">Choose exactly where this coupon can be used.</div></div></div><div class="form-grid"><div class="field"><label>Code</label><input id="cpCode" placeholder="SAVE10"></div><div class="field"><label>Applies To</label><select id="cpScope" onchange="updateAdminCouponScope()"><option value="PRODUCT">3 · Other / Products</option><option value="SUBSCRIPTION">1 · Subscription</option><option value="ADS">2 · Ads</option></select></div><div class="field" id="cpPlacementWrap" style="display:none"><label>Ad Placement</label><select id="cpPlacement"><option value="Homepage">Homepage</option><option value="Marketplace">Marketplace</option></select></div><div class="field"><label>Type</label><select id="cpType"><option value="percent">Percent</option><option value="fixed">Fixed INR</option></select></div><div class="field"><label>Value</label><input id="cpValue" type="number" min="0"></div><div class="field"><label>Max Uses</label><input id="cpMax" type="number" min="1" value="100"></div><div class="field"><label>Expires</label><input id="cpExpiry" type="date"></div></div><button class="btn primary" onclick="createCoupon()">Create Coupon</button></div><div class="admin-card"><h2>Coupons</h2>${rows.map(c=>`<div class="security-row"><div><b>${esc(c.code)}</b><div class="small muted">${c.scope==='SUBSCRIPTION'?'Subscription':c.scope==='ADS'?'Ads · '+esc(c.placement||'Any placement'):'Products / Other'} · ${c.type==='percent'?c.value+'%':money(c.value)} · Uses ${c.used||0}/${c.maxUses||'∞'} · ${c.expiresAt?new Date(c.expiresAt).toLocaleDateString('en-IN'):'No expiry'}${c.sellerId?' · Seller @'+esc(c.sellerId):''}${c.productId?' · Product '+esc(c.productId):''}</div></div><button class="btn danger" onclick="${c.source==='seller-product'?`disableProductCoupon('${c.productId}')`:`disableCoupon('${c.id}')`}">${c.active===false?'Disabled':'Disable'}</button></div>`).join('')||'<div class="admin-empty">No coupons.</div>'}</div>`)}
function updateAdminCouponScope(){const e=document.getElementById('cpPlacementWrap');if(e)e.style.display=document.getElementById('cpScope')?.value==='ADS'?'block':'none'}
function createCoupon(){if(!adminOnly())return;const code=(document.getElementById('cpCode')?.value||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'');const scope=document.getElementById('cpScope')?.value||'PRODUCT';const placement=scope==='ADS'?(document.getElementById('cpPlacement')?.value||'Homepage'):null;const type=document.getElementById('cpType')?.value;const value=Math.max(0,Number(document.getElementById('cpValue')?.value||0));const maxUses=Math.max(1,Number(document.getElementById('cpMax')?.value||1));const ex=document.getElementById('cpExpiry')?.value;if(!code||!value){toast('Enter coupon code and value');return}if(type==='percent'&&value>100){toast('Percent discount cannot exceed 100%');return}if(S.coupons.some(c=>c.code===code&&c.active!==false)){toast('Coupon code already exists');return}S.coupons.unshift({id:uid('cp'),code,type,value,maxUses,used:0,active:true,scope,placement,expiresAt:ex?new Date(ex+'T23:59:59').toISOString():null,createdAt:nowISO(),createdBy:S.currentUser?.id||'ADMIN'});adminAudit('Created coupon',code,{scope,placement,type,value,maxUses});save();render()}
function disableCoupon(id){if(!adminOnly())return;const c=S.coupons.find(x=>x.id===id);if(!c)return;c.active=false;adminAudit('Disabled coupon',id);save();render()}
function disableProductCoupon(productId){if(!adminOnly())return;const p=product(productId);if(!p?.coupon)return;p.coupon.active=false;adminAudit('Disabled seller product coupon',productId,{sellerId:p.sellerId,code:p.coupon.code});save();render()}
function validCoupon(code,productId,userId,context='PRODUCT'){const c=(S.coupons||[]).find(x=>x.code===String(code||'').trim().toUpperCase()&&x.active!==false);if(!c)return null;if(c.expiresAt&&Date.now()>new Date(c.expiresAt).getTime())return null;if(Number(c.used||0)>=Number(c.maxUses||Infinity))return null;if(c.scope&&c.scope!==context)return null;if(context==='PRODUCT'){if(c.productId&&c.productId!==productId)return null;if(c.sellerId&&c.sellerId!==product(productId)?.sellerId)return null;if((S.couponRedemptions||[]).some(x=>x.couponId===c.id&&x.userId===userId&&x.productId===productId))return null}return c}
function couponDiscount(c,price){if(!c)return 0;return Math.min(price,c.type==='percent'?price*Number(c.value||0)/100:Number(c.value||0))}
function applyCheckoutCoupon(){const p=product(window.pendingBuy?.id);if(!p)return;const code=(document.getElementById('buyCoupon')?.value||'').trim().toUpperCase();const userId=window.pendingBuy?.userId||S.currentUser?.id||'guest';let c=validCoupon(code,p.id,userId,'PRODUCT');if(!c&&p.coupon&&p.coupon.code===code&&p.coupon.active!==false&&(!p.coupon.expiresAt||Date.now()<=new Date(p.coupon.expiresAt).getTime())&&Number(p.coupon.used||0)<Number(p.coupon.maxUses||Infinity))c=p.coupon;if(!c){toast('Invalid, expired, exhausted or not applicable to this product');return}const d=couponDiscount(c,p.price);window.pendingBuy={...window.pendingBuy,couponId:c.id,couponCode:c.code,discount:d,amount:Math.max(0,p.price-d)};toast('Coupon applied');openBuy(p.id)}
function cancelCheckoutCoupon(){if(!window.pendingBuy)return;window.pendingBuy={...window.pendingBuy,couponId:null,couponCode:null,discount:0,amount:undefined};const el=document.getElementById('buyCoupon');if(el)el.value='';toast('Coupon removed');openBuy(window.pendingBuy.id)}
function storeTheme(sid){return S.storeThemes?.[sid]||{tagline:'',banner:'',accent:'',layout:'grid',showBio:true}}
function readStoreImage(file,maxBytes,label,cb){if(!file)return;if(!file.type||!file.type.startsWith('image/')){toast(label+' must be an image');return}if(file.size>maxBytes){toast(label+' must be '+(maxBytes/(1024*1024)).toFixed(0)+' MB or smaller');return}const r=new FileReader();r.onload=()=>cb(String(r.result||''));r.onerror=()=>toast('Could not read '+label.toLowerCase());r.readAsDataURL(file)}
function previewStoreLogo(e){const f=e.target.files?.[0];readStoreImage(f,2*1024*1024,'Logo Image',data=>{const s=currentSeller();if(!s)return;s.logo=data;save();const box=document.getElementById('storeLogoPreview');if(box)box.innerHTML='<img src="'+esc(data)+'" alt="Store logo">';toast('Logo saved');})}
function previewStoreBanner(e){const f=e.target.files?.[0];readStoreImage(f,2*1024*1024,'Banner Image',data=>{const s=currentSeller();if(!s)return;const t=storeTheme(s.id);S.storeThemes[s.id]={...t,banner:data};save();const box=document.getElementById('storeBannerPreview');if(box){box.style.backgroundImage="url(''+data.replace(/'/g,'%27')+'')";}toast('Banner saved');})}
function removeStoreLogo(){const s=currentSeller();if(!s)return;s.logo='';save();const box=document.getElementById('storeLogoPreview');if(box)box.innerHTML='<span>SE</span>';toast('Logo removed')}
function removeStoreBanner(){const s=currentSeller();if(!s)return;const t=storeTheme(s.id);S.storeThemes[s.id]={...t,banner:''};save();const box=document.getElementById('storeBannerPreview');if(box)box.style.backgroundImage='none';toast('Banner removed')}
function dashStoreSettings(){const s=currentSeller(),t=storeTheme(s.id);return dashShell('settings',`${sellerScoreMarkup(s.id)}<div class="dash-card"><div class="section-head"><div><h2>Mini Business Store & Customization</h2><p>Customize your public storefront without changing marketplace product data.</p></div></div><div class="field"><label>Store Logo Image</label><div id="storeLogoPreview" class="logo-upload" style="margin:8px 0 10px">${s.logo?`<img src="${esc(s.logo)}" alt="Store logo">`:'<span>SE</span>'}</div><input id="storeLogoFile" type="file" accept="image/*" onchange="previewStoreLogo(event)"><small class="muted">Image only · maximum 2 MB.</small><div style="margin-top:8px"><button type="button" class="btn" onclick="removeStoreLogo()">Remove Logo</button></div></div><div class="field"><label>Store Banner Image</label><div id="storeBannerPreview" class="store-banner" style="margin:8px 0 10px;${t.banner?`background-image:url('${esc(t.banner)}');`:''}"></div><input id="storeBannerFile" type="file" accept="image/*" onchange="previewStoreBanner(event)"><small class="muted">Image only · maximum 2 MB.</small><div style="margin-top:8px"><button type="button" class="btn" onclick="removeStoreBanner()">Remove Banner</button></div></div><div class="field"><label>Store Name</label><input id="setName" value="${esc(s.name||'')}"></div><div class="field"><label>Tagline</label><input id="setTagline" value="${esc(t.tagline||'')}" placeholder="Premium creator resources"></div><div class="field"><label>Banner Image URL (optional)</label><input id="setBanner" value="${esc(t.banner&&/^https?:\/\//i.test(t.banner)?t.banner:'')}" placeholder="https://..."><small class="muted">You can use the upload above or an image URL.</small></div><div class="field"><label>Store Bio</label><textarea id="setBio">${esc(s.bio||'')}</textarea></div><div class="field"><label>Support Contact</label><input id="setContact" value="${esc(s.support||'')}"></div><div class="field"><label>Store Layout</label><select id="setLayout"><option value="grid" ${t.layout==='grid'?'selected':''}>Grid</option><option value="list" ${t.layout==='list'?'selected':''}>List</option></select></div><div class="modal-footer"><button class="btn primary" onclick="saveAdvancedStoreSettings()">Save Store</button></div></div>`)}
function saveAdvancedStoreSettings(){const s=currentSeller();const t=storeTheme(s.id);s.name=document.getElementById('setName')?.value.trim()||s.name;s.bio=document.getElementById('setBio')?.value||'';s.support=document.getElementById('setContact')?.value.trim()||'';const url=document.getElementById('setBanner')?.value.trim()||'';S.storeThemes[s.id]={...t,tagline:document.getElementById('setTagline')?.value.trim()||'',banner:url||t.banner||'',layout:document.getElementById('setLayout')?.value||'grid'};adminAudit('Updated store customization',s.id,{seller:true});save();toast('Store customization saved');render()}
function adminSecurity(){const c=advState();return adminLayout('security','Payment & Security Protection',`<div class="admin-card"><h2>Protection Status</h2><div class="security-row"><span>Checkout freeze</span><b>${c.payments?'BLOCKED':'OPEN'}</b></div><div class="security-row"><span>Withdrawal freeze</span><b>${c.withdrawals?'BLOCKED':'OPEN'}</b></div><div class="security-row"><span>Advertising freeze</span><b>${c.ads?'BLOCKED':'OPEN'}</b></div><div class="security-row"><span>Referral freeze</span><b>${c.referrals?'BLOCKED':'OPEN'}</b></div><div class="security-row"><span>Audit events</span><b>${(S.securityEvents||[]).length}</b></div></div><div class="admin-card"><h2>Security Rules</h2><ul class="muted"><li>Client-side prototype payments are never treated as real settlement proof.</li><li>Production payments must be verified on a trusted server/webhook before balance or access changes.</li><li>Risk signals are advisory and never claim identity certainty.</li><li>Admin actions are logged with timestamp and target.</li></ul></div>`)}
function adminAuditAdvanced(){const rows=(S.adminAuditLog||[]);return adminLayout('audit','Admin Audit Log',`<div class="admin-card"><div class="section-head"><div><h2>Immutable-style Audit History</h2><div class="sub">The browser prototype keeps append-only records. Production should write these server-side with database policies.</div></div></div>${rows.map(x=>`<div class="security-row"><div><b>${esc(x.action)}</b><div class="small muted">${new Date(x.date).toLocaleString('en-IN')} · Admin ${esc(x.adminId||'-')} · Target ${esc(x.targetId||'-')}</div><div class="small muted">${esc(JSON.stringify(x.meta||{}))}</div></div></div>`).join('')||'<div class="admin-empty">No audit entries yet.</div>'}</div>`)}
function growthGoal(sid){return S.growthGoals?.[sid]||{targetSales:10,targetFollowers:10,targetProducts:5}}
function sellerGrowthDashboard(){const s=currentSeller(),g=growthGoal(s.id),sales=S.orders.filter(o=>o.sellerId===s.id&&o.status==='SUCCESS').length,followers=s.followers||0,products=S.products.filter(p=>p.sellerId===s.id).length;return dashShell('overview',`<div class="dash-card"><h2>Seller Growth Center</h2><p class="muted">Your current growth targets and progress.</p><div class="security-row"><span>Sales goal</span><b>${sales}/${g.targetSales}</b></div><div class="security-row"><span>Followers goal</span><b>${followers}/${g.targetFollowers}</b></div><div class="security-row"><span>Products goal</span><b>${products}/${g.targetProducts}</b></div><div class="hero-actions"><button class="btn primary" onclick="go('dashboard/settings')">Improve Store</button><button class="btn" onclick="go('dashboard/ads')">Relevant Ads</button></div></div>`) }

/* -------------------- DASHBOARD -------------------- */
const dashItems=[
 ["overview","▦","Dashboard"],["products","◈","My Products"],["orders","▤","My Orders"],["payouts","₹","Payouts"],["subscription","♙","Subscription"],["ads","⌁","My Ads"],["followers","♧","My Followers"],["referral","⌘","Referral Program"],["settings","⚙","Store Settings"],["warnings","⚠","Warnings"]
];
function dashShell(page,content){
 const s=ensureStoreForUser(); if(!S.currentUser)return `${header()}<main class="page"><div class="container"><div class="auth-box"><h2>Seller sign-in required</h2><button class="btn primary" onclick="openAuth('signin','seller')">Sign In</button></div></div></main>`;
 return `<div class="dashboard-shell"><aside class="dash-side"><button class="dash-brand dash-brand-link" type="button" onclick="go('market')" title="Open Marketplace"><span class="logo-mark">SE</span><span>Vendor Portal</span></button><button class="dash-link" onclick="go('home')">⌂ <span>Back to Homepage</span></button><button class="dash-link" onclick="go('seller/${s.id}')">↗ <span>View My Store</span></button><div class="dash-nav-title">MANAGEMENT</div>${dashItems.map(x=>`<button class="dash-link ${page===x[0]?'active':''}" onclick="go('dashboard/${x[0]}')">${x[1]} <span>${x[2]}</span></button>`).join("")}<div class="store-mini">${avatar(s)}<div><b class="small">${esc(s.name)}</b><div class="small muted">${esc(s.owner)}</div></div></div><button class="btn upgrade" onclick="go('dashboard/subscription')">♙ Upgrade Plan</button></aside>
 <section class="dash-main"><div class="dash-top"><h1>${dashTitle(page)}</h1><div style="display:flex;align-items:center;gap:8px"><div class="plan-badge">◈ &nbsp; ${esc(s.plan||"FREE")}</div>${(S.warnings||[]).filter(w=>w.sellerId===s.id).length?`<button class="btn" onclick="go('dashboard/warnings')">⚠<span class="seller-warning-badge">${(S.warnings||[]).filter(w=>w.sellerId===s.id).length}</span></button>`:""}</div></div><div class="dash-content">${content}</div></section></div>`
}
function dashTitle(p){return {overview:"Overview",products:"Products",orders:"Orders",payouts:"Payouts",subscription:"Plans",ads:"Advertising",followers:"My Followers",referral:"Referral Program",settings:"Settings",warnings:"Warnings",warnings:"Warnings"}[p]||"Vendor Portal"}
function dashOverview(){
 const sid=currentSeller().id,orders=S.orders.filter(o=>o.sellerId===sid),success=orders.filter(o=>o.status==="SUCCESS"),gross=success.reduce((a,o)=>a+Number(o.amount||0),0),L=sellerLedger(sid),total=r2(gross+Number(L.earningsAdj||0)),paid=L.paid,pending=L.available;
 const days=[...Array(7)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return d});
 const vals=days.map(d=>success.filter(o=>new Date(o.date).toDateString()===d.toDateString()).reduce((a,o)=>a+o.amount,0));const max=Math.max(1,...vals);
 return dashShell("overview",`<div class="metric-grid"><div class="metric"><div class="metric-top"><span>₹</span><span class="metric-label total">Total</span></div><h2>${money(total)}</h2><div>Gross product sales before platform fee, incl. Admin adjustments</div></div><div class="metric orange"><div class="metric-top"><span>◷</span><span class="metric-label receive">To Receive</span></div><h2>${money(pending)}</h2><div>Net after platform fee, not yet paid out</div></div><div class="metric green"><div class="metric-top"><span>✓</span><span class="metric-label received">Received</span></div><h2>${money(paid)}</h2><div>Already Paid</div></div><div class="metric pink"><div class="metric-top"><span>▣</span><span class="metric-label sales">Sales</span></div><h2>${success.length}</h2><div>Total Orders</div></div></div>
 <div class="dash-card"><div class="section-head"><div><h3>Last 7 days Sales</h3><p>Live from this seller's saved order records.</p></div><button class="btn" onclick="go('dashboard/orders')">Analysis →</button></div><div class="chart">${vals.map((v,i)=>`<div class="bar-wrap"><b class="small">${v?money(v):""}</b><div class="bar" style="height:${Math.max(3,v/max*155)}px"></div><div class="bar-label">${days[i].toLocaleDateString("en-IN",{day:"2-digit",month:"2-digit"})}</div></div>`).join("")}</div></div>
 <div class="dash-card"><h3>⚡ Power Actions</h3><div class="power-grid"><button class="power" onclick="startNewProduct()"><span class="picon">＋</span><span><b>New Asset</b><small class="muted">List a digital product</small></span></button><button class="power" onclick="go('dashboard/settings')"><span class="picon">♙</span><span><b>Store Profile</b><small class="muted">Update identity & store</small></span></button><button class="power" onclick="go('dashboard/subscription')"><span class="picon">♕</span><span><b>Subscriptions</b><small class="muted">Change listing plans</small></span></button></div></div>`)
}
function productStateData(sid){
 const now=Date.now(); S.drafts=S.drafts||[]; S.deletedProducts=S.deletedProducts||[]; const beforeRecycle=S.deletedProducts.length;
 // Anything explicitly moved to recycle is permanently removed after 7 days.
 S.deletedProducts=S.deletedProducts.filter(x=>{const t=new Date(x.deletedAt||x.recycledAt||now).getTime();return !Number.isFinite(t)||now-t<7*86400000});
 if(S.deletedProducts.length!==beforeRecycle){localStorage.setItem(KEY,JSON.stringify(S));}
 const live=S.products.filter(p=>p.sellerId===sid), drafts=S.drafts.filter(d=>d.sellerId===sid), recycle=S.deletedProducts.filter(p=>p.sellerId===sid);
 return {live,drafts,recycle};
}
function draftLimitForSeller(s){return ({FREE:10,CE:20,PRIME:20,ENTERPRISE:50}[s?.plan||'FREE']||10)}
function productManagerTab(){const r=route();return r==='dashboard/drafts'?'drafts':r==='dashboard/recycle'?'recycle':'live'}
function productManagerCard(p,type){
 const dateVal=type==='recycle'?(p.deletedAt||p.recycledAt||p.createdAt):(p.createdAt||p.savedAt);
 const dt=dateVal?new Date(dateVal):null;
 const date=dt&&!isNaN(dt)?dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'-';
 const time=dt&&!isNaN(dt)?dt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'-';
 const status=type==='live'?'LIVE':type==='drafts'?'DRAFT':'RECYCLED';
 const action=type==='live'?`<button class="btn" onclick="go('dashboard/edit/${esc(p.id)}')">Edit</button><button class="btn" onclick="go('product/${esc(p.id)}')">View</button><button class="btn danger" onclick="openDeleteChoice('${esc(p.id)}','live')">Delete</button>`:type==='drafts'?`<button class="btn primary" onclick="continueDraft('${esc(p.id)}')">Continue Editing</button><button class="btn danger" onclick="openDeleteChoice('${esc(p.id)}','drafts')">Delete</button>`:`<button class="btn primary" onclick="restoreRecycled('${esc(p.id)}')">Restore</button><button class="btn danger" onclick="permanentDeleteItem('${esc(p.id)}','recycle')">Permanent Delete</button>`;
 return `<div class="pm-card ${type==='drafts'?'pm-draft':''}" data-title="${esc(p.title||'')}" data-date="${esc(dateVal||'')}"><div class="pm-check"><input type="checkbox" class="pm-select" value="${esc(p.id)}"></div><div class="pm-image">${p.image?`<img src="${esc(p.image)}">`:'🧩'}</div><div class="pm-info"><div class="pm-top"><span class="pm-status ${type}">${status}</span><span class="small muted">${date} · ${time}</span></div><h3>${esc(p.title||'Untitled Draft')}</h3><div class="small muted">${esc(p.category||'No category')} · ${type==='recycle'?'Deleted':'Added'}</div>${type==='live'?`<div class="small muted">${(p.links||[]).length} secure assets · ${money(p.price||0)}</div>`:''}</div><div class="pm-actions">${action}</div></div>`;
}
function viewProductActivity(id){const p=product(id),rows=(S.productActivity||[]).filter(x=>x.productId===id).slice(0,50);const body=`<b>${esc(p?.title||id)}</b>${rows.map(x=>`<div class="security-row"><div><b>${esc(x.action)}</b><div class="small muted">${new Date(x.date).toLocaleString('en-IN')}</div></div></div>`).join('')||'<div class="pm-empty">No activity recorded yet.</div>'}`;showPMConfirm('Product Activity',body,[`<button class="btn" onclick="closeModal()">Close</button>`])}
function dashProducts(){return productManager('live')}
function productManager(tab='live'){
 const sid=currentSeller().id,s=currentSeller(),d=productStateData(sid); const sets={live:d.live,drafts:d.drafts,recycle:d.recycle}; let list=sets[tab]||d.live;
 const q=(window.pmSearch||'').trim().toLowerCase(),sort=window.pmSort||'latest',days=Number(window.pmDays||0),cat=window.pmCat||'ALL';
 list=list.filter(x=>(!q||(x.title||'').toLowerCase().includes(q)||(x.category||'').toLowerCase().includes(q))&&(cat==='ALL'||x.category===cat));
 if(days>0){const cut=Date.now()-days*86400000;list=list.filter(x=>new Date(tab==='recycle'?(x.deletedAt||x.recycledAt):(x.createdAt||x.savedAt||Date.now())).getTime()>=cut)}
 // Pending/new products stay at the top for the seller so review-required
 // items are never buried below older approved listings.
 list.sort((a,b)=>{
   const ap=tab==='live' && (a.approvalStatus||'APPROVED')==='PENDING' ? 1 : 0;
   const bp=tab==='live' && (b.approvalStatus||'APPROVED')==='PENDING' ? 1 : 0;
   if(bp!==ap)return bp-ap;
   const ad=new Date(tab==='recycle'?(a.deletedAt||a.recycledAt):(a.createdAt||a.savedAt||0)).getTime(),bd=new Date(tab==='recycle'?(b.deletedAt||b.recycledAt):(b.createdAt||b.savedAt||0)).getTime();return sort==='oldest'?ad-bd:bd-ad
 });
 const counts=`<div class="pm-tabs"><button class="pm-tab ${tab==='live'?'active':''}" onclick="go('dashboard/products')">Live Products</button><button class="pm-tab ${tab==='drafts'?'active':''}" onclick="go('dashboard/drafts')">Drafts</button><button class="pm-tab ${tab==='recycle'?'active':''}" onclick="go('dashboard/recycle')">Recycle Bin${d.recycle.length?`<span class="pm-badge">${d.recycle.length}</span>`:''}</button></div>`;
 const available=tab==='live'?`${d.live.length} Live Products available`:tab==='drafts'?`${d.drafts.length} Drafts available`:`${d.recycle.length} Products available in Recycle Bin`;
 const controls=`<div class="pm-controls"><input class="input" placeholder="Search ${tab==='live'?'products':tab==='drafts'?'drafts':'recycle bin'}..." value="${esc(window.pmSearch||'')}" oninput="pmLiveSearch(this)"><select class="input" onchange="window.pmSort=this.value;render()"><option value="latest" ${sort==='latest'?'selected':''}>Latest</option><option value="oldest" ${sort==='oldest'?'selected':''}>Oldest</option></select><select class="input" onchange="window.pmDays=this.value;render()"><option value="0">All days</option><option value="7" ${days===7?'selected':''}>7 days</option><option value="14" ${days===14?'selected':''}>14 days</option><option value="21" ${days===21?'selected':''}>21 days</option><option value="30" ${days===30?'selected':''}>30 days</option></select><select class="input" onchange="window.pmCat=this.value;render()"><option value="ALL">All categories</option>${['Courses','Reel Content Pack','Editing Assets','Templates'].map(c=>`<option value="${c}" ${cat===c?'selected':''}>${c}</option>`).join('')}</select><div class="pm-view" aria-label="Product view"><button class="btn icon-view ${window.pmView==='list'?'':'primary'}" title="Grid view" aria-label="Grid view" onclick="window.pmView='grid';render()"><span aria-hidden="true">▦</span><span class="view-label">Grid</span></button><button class="btn icon-view ${window.pmView==='list'?'primary':''}" title="List view" aria-label="List view" onclick="window.pmView='list';render()"><span aria-hidden="true">☷</span><span class="view-label">List</span></button></div></div>`;
 const bulk=`<div class="pm-bulk"><label><input type="checkbox" onchange="toggleAllPM(this.checked)"> Select All</label><button class="btn" onclick="toggleAllPM(false)">Deselect All</button><span id="pmSelectedCount">0 selected</span>${tab==='recycle'?`<button class="btn primary" onclick="bulkPM('restore')">Restore Selected</button><button class="btn danger" onclick="bulkPM('permanent')">Permanent Delete Selected</button>`:`<button class="btn danger" onclick="bulkPM('delete')">Delete Selected</button>`}</div>`;
 const listHtml=list.map(x=>productManagerCard(x,tab)).join('')||`<div class="pm-empty">No ${tab==='live'?'live products':tab==='drafts'?'drafts':'recycled products'} found.</div>`;
 const recycleNotice=tab==='recycle'&&d.recycle.length?`<div class="pm-recycle-notice"><b>Recycle Bin</b><span>Items are permanently deleted 7 days after moving here.</span><button class="btn danger" onclick="deleteAllDraftsFromRecycleBin()">Delete All Drafts from Recycle Bin</button></div>`:'';
 const managerBack=tab!=='live'?`<button class="btn pm-back" onclick="goBack('dashboard/products')">← Back to Live Products</button>`:'';
 return dashShell('products',`<div class="dash-card pm-shell"><div class="section-head"><div><h2>My Products</h2><p>Manage live products, drafts and recycled products.</p></div><button class="btn primary" onclick="startNewProduct()">＋ New Product</button></div>${managerBack}${counts}<div class="pm-available">${available}</div>${controls}${bulk}${recycleNotice}<div class="pm-list ${window.pmView==='list'?'list-view':''} js-pm-list">${listHtml}</div></div>`);
}
function pmLiveSearch(input){
  window.pmSearch=input.value;
  const q=(input.value||"").trim().toLowerCase();
  document.querySelectorAll(".js-pm-list .pm-card").forEach(card=>{
    const title=(card.dataset.title||"").toLowerCase();
    const text=(card.textContent||"").toLowerCase();
    card.style.display=(!q||title.includes(q)||text.includes(q))?"":"none";
  });
  const visible=[...document.querySelectorAll(".js-pm-list .pm-card")].filter(x=>x.style.display!=="none").length;
  const empty=document.querySelector(".js-pm-search-empty");
  if(empty) empty.remove();
  if(q && !visible){
    const box=document.createElement("div"); box.className="pm-empty js-pm-search-empty"; box.textContent="No matching products found.";
    document.querySelector(".js-pm-list")?.appendChild(box);
  }
}
function selectedPM(){return [...document.querySelectorAll('.pm-select:checked')].map(x=>x.value)}
function toggleAllPM(v){document.querySelectorAll('.pm-select').forEach(x=>x.checked=v);const el=document.getElementById('pmSelectedCount');if(el)el.textContent=`${selectedPM().length} selected`}
function bulkPM(action){const ids=selectedPM();if(!ids.length){toast('Select at least one product');return}window.pmBulkIds=ids;if(action==='delete')openBulkDeleteChoice(ids);else if(action==='restore'){ids.forEach(id=>restoreRecycled(id));render()}else if(action==='permanent')openBulkPermanentChoice(ids)}
function openDeleteChoice(id,type){const p=type==='live'?product(id):(S.drafts||[]).find(x=>x.id===id);if(!p)return;if(type==='live'){showPMConfirm('Delete Product Permanently',`<b>${esc(p.title||'Untitled Product')}</b><p class="muted">This product will disappear from the marketplace immediately and be permanently removed from Sale Earn cloud data and storage. It cannot be restored.</p>`,[`<button class="btn" onclick="closeModal()">Cancel</button>`,`<button class="btn danger" onclick="confirmPermanentSingle('${esc(id)}','live')">Delete Forever</button>`]);return}showPMConfirm('Delete Draft',`<b>${esc(p.title||'Untitled Draft')}</b><p class="muted">Choose what should happen to this draft.</p>`,[`<button class="btn" onclick="closeModal()">Cancel</button>`,`<button class="btn" onclick="moveToRecycle('${esc(id)}','drafts')">Move to Recycle Bin</button>`,`<button class="btn danger" onclick="confirmPermanentSingle('${esc(id)}','drafts')">Permanent Delete</button>`]);}
function showPMConfirm(title,body,buttons){document.getElementById('modalRoot').innerHTML=`<div class="modal-bg"><div class="modal-card"><h2>${title}</h2><div>${body}</div><div class="modal-footer">${buttons.join('')}</div></div></div>`}
function moveToRecycle(id,type){const p=type==='live'?product(id):(S.drafts||[]).find(x=>x.id===id);if(!p)return;const sid=currentSeller().id;S.deletedProducts=S.deletedProducts||[];S.deletedProducts.unshift({...p,recycledFrom:type,recycledAt:nowISO(),deletedAt:nowISO()});if(type==='live'){S.products=S.products.filter(x=>x.id!==id);adjustSellerScore(p.sellerId,-2,'Product deleted','DELETE:'+id+':'+Date.now(),'SELLER')}else S.drafts=S.drafts.filter(x=>x.id!==id);logProductActivity(id,type==='live'?'Moved to Recycle Bin':'Draft moved to Recycle Bin',{sellerId:sid});closeModal();save();toast('Moved to Recycle Bin');render()}
function confirmPermanentSingle(id,type){showPMConfirm('Permanent Delete','This action cannot be undone. Are you sure?', [`<button class="btn" onclick="closeModal()">Cancel</button>`,`<button class="btn danger" onclick="permanentDeleteItem('${esc(id)}','${type}')">Yes, Permanently Delete</button>`])}
async function permanentDeleteItem(id,type){
 const live=type==='live'?S.products.find(x=>x.id===id):null;
 const src=type==='live'?live:(type==='drafts'?(S.drafts||[]).find(x=>x.id===id):(S.deletedProducts||[]).find(x=>String(x.id)===String(id)));
 const sellerId=src?.sellerId||currentSeller()?.id||null;
 if(!src)return;
 if(type==='live'){
  S.deletedProducts=Array.isArray(S.deletedProducts)?S.deletedProducts:[];
  S.deletedProducts=S.deletedProducts.filter(x=>String(x.id)!==String(id));
  S.deletedProducts.unshift({...src,recycledFrom:'live',recycledAt:nowISO(),deletedAt:nowISO(),deletedBy:S.currentUser?.id||null});
 }
 tombstoneProduct(id);removeProductFromAllCloudState(id);
 if(type==='live'&&live)adjustSellerScore(live.sellerId,-2,'Product permanently deleted','DELETE:'+id+':'+Date.now(),'SELLER');
 if(type==='drafts')S.drafts=(S.drafts||[]).filter(x=>String(x.id)!==String(id));
 else if(type!=='live')S.deletedProducts=(S.deletedProducts||[]).filter(x=>String(x.id)!==String(id));
 S.saved=(S.saved||[]).filter(x=>String(x?.productId)!==String(id));
 S.ads=(S.ads||[]).filter(x=>String(x?.productId)!==String(id));
 closeModal();render();toast('Product hidden. Syncing deletion…');
 const hidden=await hideProductRowFromPublicCloud(id);
 logProductActivity(id,'Permanently deleted by seller',{sellerId});
 save();render();
 toast(hidden?'Product deleted from public view and sent to Admin Deleted':'Product hidden locally; cloud status update needs retry');
}
function openBulkDeleteChoice(ids){showPMConfirm('Delete Selected Permanently',`You selected <b>${ids.length}</b> live product(s). They will be hidden immediately and permanently removed from cloud data/storage.`,[`<button class="btn" onclick="closeModal()">Cancel</button>`,`<button class="btn danger" onclick="openBulkPermanentChoice(${JSON.stringify(ids).replace(/"/g,'&quot;')})">Delete Forever</button>`])}
function bulkMoveSelected(){const ids=window.pmBulkIds||selectedPM();const sid=currentSeller().id;S.deletedProducts=S.deletedProducts||[];ids.forEach(id=>{const p=S.products.find(x=>x.id===id&&x.sellerId===sid)||(S.drafts||[]).find(x=>x.id===id&&x.sellerId===sid);if(!p)return;const from=S.products.some(x=>x.id===id&&x.sellerId===sid)?'live':'drafts';S.deletedProducts.unshift({...p,recycledFrom:from,recycledAt:nowISO(),deletedAt:nowISO()});if(from==='live'){S.products=S.products.filter(x=>x.id!==id);adjustSellerScore(p.sellerId,-2,'Product deleted','DELETE:'+id+':'+Date.now(),'SELLER')}else S.drafts=S.drafts.filter(x=>x.id!==id)});window.pmBulkIds=[];closeModal();save();toast('Selected items moved to Recycle Bin');render()}
function openBulkPermanentChoice(ids){showPMConfirm('Permanent Delete Selected',`This will permanently delete <b>${ids.length}</b> item(s).`,[`<button class="btn" onclick="closeModal()">Cancel</button>`,`<button class="btn danger" onclick="bulkPermanentNow(${JSON.stringify(ids).replace(/"/g,'&quot;')})">Yes, Permanently Delete</button>`])}
async function bulkPermanentNow(ids){
 const sid=currentSeller().id,items=[];
 ids.forEach(id=>{
  const live=S.products.find(x=>x.id===id&&x.sellerId===sid);
  const src=live||(S.drafts||[]).find(x=>x.id===id&&x.sellerId===sid)||(S.deletedProducts||[]).find(x=>String(x.id)===String(id)&&x.sellerId===sid);
  if(!src)return;
  if(live){
   S.deletedProducts=Array.isArray(S.deletedProducts)?S.deletedProducts:[];
   S.deletedProducts=S.deletedProducts.filter(x=>String(x.id)!==String(id));
   S.deletedProducts.unshift({...live,recycledFrom:'live',recycledAt:nowISO(),deletedAt:nowISO(),deletedBy:S.currentUser?.id||null});
  }
  items.push(src);tombstoneProduct(id);removeProductFromAllCloudState(id);
  if(live)adjustSellerScore(sid,-2,'Product permanently deleted','DELETE:'+id+':'+Date.now(),'SELLER');
 });
 closeModal();render();toast('Selected products hidden. Syncing deletion…');
 for(const src of items)await hideProductRowFromPublicCloud(src.id);
 save();render();toast('Selected products deleted and sent to Admin Deleted');
}
async function restoreRecycled(id){
 const x=(S.deletedProducts||[]).find(p=>String(p.id)===String(id));if(!x)return;
 const sid=currentSeller().id;
 S.productTombstones=(S.productTombstones||[]).filter(t=>String(t.id)!==String(id));
 if(x.recycledFrom==='drafts'){
  S.drafts=S.drafts||[];S.drafts.unshift({...x,savedAt:x.savedAt||x.createdAt||nowISO()});
 }else{
  const restored={...x};delete restored.deletedAt;delete restored.deletedBy;delete restored.recycledAt;delete restored.recycledFrom;
  S.products=S.products||[];S.products.unshift(restored);
  if(window.supabaseClient){
   const owner=sellerOwnerUser(restored.sellerId),ownerId=owner?.authId||owner?.id||normalizedOwnerId(restored.sellerId)||restored.sellerId;
   const r=await supabaseClient.from('products').upsert({id:String(restored.id),seller_id:ownerId,title:String(restored.title||'Untitled'),description:restored.description||null,price:Number(restored.price||0),status:'active',file_url:restored.links?.[0]||restored.deliveryUrl||null,image_url:restored.image||null},{onConflict:'id'});
   if(r.error){toast('Restore could not be saved to Supabase');return;}
  }
 }
 logProductActivity(id,x.recycledFrom==='drafts'?'Restored to Drafts':'Restored to Live Products',{sellerId:sid});
 S.deletedProducts=S.deletedProducts.filter(p=>String(p.id)!==String(id));
 save();toast('Product restored');render();
}
function continueDraft(id){const d=(S.drafts||[]).find(x=>x.id===id);if(!d)return;S.draft=structuredClone(d);go('dashboard/add'+(d.step>1?d.step===2?'2':'3':'')+`?draft=${encodeURIComponent(id)}`)}
function saveDraftFromForm(){
 S.draft=S.draft||{};const r=route();const title=document.getElementById('pfTitle')?.value?.trim();if(title)S.draft.title=title;const cat=document.getElementById('pfCategory');if(cat)S.draft.category=cat.value;const tags=document.getElementById('tagInput');if(tags)S.draft.tags=tags.value.split(',').map(x=>x.trim()).filter(Boolean);const desc=document.getElementById('pfDesc');if(desc)S.draft.description=desc.value;collectStep2();
 const price=document.getElementById('pfPrice'),old=document.getElementById('pfOld');if(price)S.draft.price=Number(price.value||0);if(old)S.draft.oldPrice=Number(old.value||0);
 const sid=currentSeller().id,existingId=new URLSearchParams(location.hash.split('?')[1]||'').get('draft');const limit=draftLimitForSeller(currentSeller());S.drafts=S.drafts||[];
 if(!existingId && S.drafts.filter(x=>x.sellerId===sid).length>=limit){showPMConfirm('Draft Limit Reached',`Your ${esc(currentSeller().plan||'FREE')} plan allows <b>${limit}</b> saved drafts.`,[`<button class="btn" onclick="closeModal()">Cancel</button>`,`<button class="btn primary" onclick="closeModal();go('dashboard/subscription')">Buy Plan</button>`,`<button class="btn" onclick="closeModal();go('dashboard/drafts')">Delete Saved Draft</button>`]);return}
 const obj={...structuredClone(S.draft),id:existingId||uid('draft'),sellerId:sid,step:r.startsWith('dashboard/add3')?3:r.startsWith('dashboard/add2')?2:1,savedAt:existingId?(S.drafts.find(x=>x.id===existingId)?.savedAt||nowISO()):nowISO(),createdAt:existingId?(S.drafts.find(x=>x.id===existingId)?.createdAt||nowISO()):nowISO()};const ix=S.drafts.findIndex(x=>x.id===obj.id);if(ix>=0)S.drafts[ix]=obj;else S.drafts.unshift(obj);save();toast('Draft saved');S.draft=structuredClone(obj);render();
}
function deleteAllDraftsFromRecycleBin(){const drafts=(S.deletedProducts||[]).filter(x=>x.sellerId===currentSeller().id&&x.recycledFrom==='drafts');if(!drafts.length){toast('No recycled drafts found');return}showPMConfirm('Delete All Drafts from Recycle Bin',`Permanently delete <b>${drafts.length}</b> recycled draft(s)?`,[`<button class="btn" onclick="closeModal()">Cancel</button>`,`<button class="btn danger" onclick="deleteAllRecycledDraftsNow()">Yes, Delete All Drafts</button>`])}
function deleteAllRecycledDraftsNow(){const sid=currentSeller().id;S.deletedProducts=(S.deletedProducts||[]).filter(x=>!(x.sellerId===sid&&x.recycledFrom==='drafts'));closeModal();save();toast('Recycled drafts deleted');render()}
function deleteProduct(id){openDeleteChoice(id,'live')}
function dashOrders(){
 const sid=currentSeller().id,all=S.orders.filter(o=>o.sellerId===sid),q=(window.orderSearch||"").toLowerCase();
 const list=all.filter(o=>{const p=product(o.productId);return !q||(p?.title+" "+o.customerName+" "+o.customerEmail).toLowerCase().includes(q)});
 const total=all.length;return dashShell("orders",`<div class="dash-card" style="padding:16px"><div style="display:flex;justify-content:space-between;align-items:center"><input style="max-width:450px;width:100%;height:42px;border:1px solid var(--line);border-radius:11px;padding:0 13px" value="${esc(window.orderSearch||"")}" oninput="orderLiveSearch(this)" placeholder="Search by product or customer..."><b>Total: <span style="color:var(--brand)">${total}</span></b></div></div><div class="dash-card" style="padding:0;overflow:hidden"><table class="dash-table"><thead><tr><th>Product</th><th>Customer</th><th>Date ↓</th><th>Amount</th><th>Status</th></tr></thead><tbody>${list.map(o=>{const p=product(o.productId);return `<tr><td><button style="background:none;color:#4278cf;font-weight:800;text-align:left" onclick="go('product/${o.productId}')">${esc(p?.title||"Deleted product")}</button></td><td><b>${esc(o.customerName)}</b><div class="small muted">${esc(o.customerEmail)}</div></td><td class="muted">${new Date(o.date).toLocaleString()}</td><td><b style="color:#1aad78">${money(o.amount)}</b></td><td><span class="status ${o.status.toLowerCase()}">${o.status}</span></td></tr>`}).join("")||`<tr><td colspan="5">No orders found.</td></tr>`}</tbody></table></div>`)
}
function payoutStatusUpper(x){return String(x?.status||"PENDING").trim().toUpperCase()}
function payoutReservesBalance(x){return ["PENDING","UNDER REVIEW","ON HOLD","PROCESSING"].includes(payoutStatusUpper(x))}
function sellerAvailableBalance(sid){
 const earned=sellerEarnings(sid);
 const paid=(S.payouts||[]).filter(x=>x.sellerId===sid&&["APPROVED","PAID","SUCCESS","RECEIVED"].includes(payoutStatusUpper(x))).reduce((a,x)=>a+Number(x.amount||0),0);
 const reserved=(S.payouts||[]).filter(x=>x.sellerId===sid&&payoutReservesBalance(x)).reduce((a,x)=>a+Number(x.amount||0),0);
 const balanceSpent=(S.balancePayments||[]).filter(x=>x.sellerId===sid&&String(x.source||"").toUpperCase()==="BALANCE"&&String(x.status||"").toUpperCase()==="SUCCESS"&&x.paymentVerified!==false).reduce((a,x)=>a+Number(x.amount||0),0);
 const legacyAds=(S.ads||[]).filter(x=>x.sellerId===sid&&!x.paymentSource&&String(x.status||"").toUpperCase()!=="CANCELLED").reduce((a,x)=>a+Number(x.cost||0),0);
 const legacySubs=(S.subscriptions||[]).filter(x=>x.sellerId===sid&&!x.paymentSource).reduce((a,x)=>a+Number(x.amount||0),0);
 const adjReceived=typeof financeSum==='function'?financeSum(sid,'RECEIVED'):0;
 return Math.max(0,earned-paid-reserved-balanceSpent-legacyAds-legacySubs-adjReceived);
}
function dashPayouts(){
 const sid=currentSeller().id,earned=sellerEarnings(sid);
 const received=(S.payouts||[]).filter(x=>x.sellerId===sid&&["APPROVED","PAID","SUCCESS","RECEIVED"].includes(payoutStatusUpper(x))).reduce((a,x)=>a+Number(x.amount||0),0)+(typeof financeSum==='function'?financeSum(sid,'RECEIVED'):0);
 const available=sellerAvailableBalance(sid);
 const minPayout=Math.max(30,Number(advState().payoutMin||30));
 const maxPayout=Number(advState().payoutMax||0);
 return dashShell("payouts",`<div class="dash-card" style="background:#111a2d;color:#fff"><div style="display:flex;justify-content:space-between"><h3>Your Earnings Overview</h3><span class="pill" style="background:#143d3a;color:#1ac18a">Secure Wallet</span></div><div class="metric-grid" style="margin-top:20px"><div class="metric" style="background:#1d293c;color:#fff;border:0"><span class="metric-label total">Lifetime Earnings</span><h2 style="color:#69a8ff">${money(earned)}</h2></div><div class="metric" style="background:#1d293c;color:#fff;border:0"><span class="metric-label receive">Available To Receive</span><h2 style="color:#ffb31a">${money(available)}</h2></div><div class="metric" style="background:#1d293c;color:#fff;border:0"><span class="metric-label received">Already Received</span><h2 style="color:#6be0ae">${money(received)}</h2></div></div></div>
 <div class="dash-card"><h3>Request Payout</h3><p class="small muted">Available To Receive: <b>${money(available)}</b> · Minimum: ${money(minPayout)}${maxPayout?` · Maximum: ${money(maxPayout)}`:""}</p><div class="field"><label>Amount (${S.settings.currency})</label><input id="poAmt" type="number" min="${minPayout}" ${maxPayout?`max="${maxPayout}"`:""} placeholder="Minimum payout ${money(minPayout)}"></div><div class="field"><label>Payout UPI ID</label><input id="poUpi" value="${esc(currentSeller().upi||"")}" placeholder="yourname@upi"></div><div class="field"><label>Note to Admin (Optional)</label><input id="poNote" maxlength="50" placeholder="e.g. Urgent payout"></div><button class="btn primary" style="width:100%" onclick="requestPayout()">₹ Request Payout</button><div class="small muted" style="text-align:center;margin-top:10px">Payout will be received within 24 hours after admin approval.</div></div>
 <div class="dash-card" style="padding:0;overflow:hidden"><h3 style="padding:18px;margin:0">Payout Requests</h3><div class="se-scroll-panel"><table class="dash-table"><thead><tr><th>Requested</th><th>Approved</th><th>Status</th><th>Date</th><th>Note</th></tr></thead><tbody>${[...(S.payouts||[])].filter(x=>x.sellerId===sid).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).map(x=>`<tr><td>${money(x.amount)}</td><td>${["APPROVED","PAID","SUCCESS","RECEIVED"].includes(payoutStatusUpper(x))?money(x.amount):"—"}</td><td><span class="status ${payoutStatusUpper(x)==="CANCELLED"?'cancelled':(['PENDING','PROCESSING','UNDER REVIEW','ON HOLD'].includes(payoutStatusUpper(x))?'pending':'success')}">${esc(x.status||'PENDING')}</span></td><td>${x.date?new Date(x.date).toLocaleString('en-IN'):'-'}</td><td>${esc(x.note||"")}${x.utr?`<div class="small muted">Ref: ${esc(x.utr)}</div>`:""}${x.cancelReason?`<div class="small muted">Reason: ${esc(x.cancelReason)}</div>`:""}</td></tr>`).join("")||`<tr><td colspan="5">No payout requests yet.</td></tr>`}</tbody></table></div></div>`)
}
async function seFreshBalance(){
 /* Pull the newest server copy first so a stale browser tab can never over-withdraw. */
 try{
  if(typeof ONLINE_READY==='undefined'||!ONLINE_READY||!seOnline())return false;
  if(ONLINE_LOCAL_DIRTY)await pushOnlineState();
  await pollOnlineState(true);
  return true;
 }catch(e){return false}
}
async function requestPayout(){
 if(window.__payoutBusy)return;
 if(!systemGuard('withdrawals','Withdrawals are temporarily disabled by Admin'))return;
 window.__payoutBusy=true;
 const btn=document.querySelector('button[onclick="requestPayout()"]');if(btn)btn.disabled=true;
 try{
  if(!S.currentUser){toast('Please sign in first');return}
  if(window.adminSellerPreview&&isAdmin()){toast('Admin preview: only the seller can request a payout');return}
  const sid=currentSeller()?.id;if(!sid){toast('Seller dashboard access required');return}
  if(S.sellers?.[sid]?.suspended){toast('Your seller account is suspended. Contact support.');return}
  const rawAmt=String(document.getElementById("poAmt")?.value||'').trim(),upi=(document.getElementById("poUpi")?.value||"").trim(),note=(document.getElementById("poNote")?.value||"").trim().slice(0,50);
  if(!/^\d{1,9}(\.\d{1,2})?$/.test(rawAmt)){toast('Enter a valid amount (up to 2 decimals)');return}
  const amt=r2(Number(rawAmt));
  const cfg=(typeof ensurePlatformConfig==='function'?ensurePlatformConfig():{})||{},pcf=cfg.payout||{},rul=cfg.rules||{};
  const minPayout=Math.max(30,Number(pcf.min||0),Number(rul.minWithdrawal||0),Number(advState().payoutMin||0));
  const caps=[pcf.max,rul.maxWithdrawal,advState().payoutMax].map(Number).filter(v=>Number.isFinite(v)&&v>0),maxPayout=caps.length?Math.min(...caps):0;
  if(amt<minPayout){toast(`Minimum payout is ${money(minPayout)}`);return}
  if(maxPayout>0&&amt>maxPayout){toast(`Maximum payout is ${money(maxPayout)}`);return}
  if(!/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,40}$/.test(upi)){toast('Enter a valid payout UPI ID');return}
  if(!(await seFreshBalance())){toast('Could not verify your latest balance from the server. Check internet and try again.');return}
  const L=sellerLedger(sid);
  if(L.deficit>0){toast('Your account balance is under review. Please contact support.');return}
  if(amt>L.available+0.0001){toast('Amount exceeds Available To Receive');return}
  const mine=(S.payouts||[]).filter(x=>x.sellerId===sid);
  if(mine.filter(x=>payoutReservesBalance(x)).length>=3){toast('You already have 3 pending requests. Wait for Admin to process them.');return}
  if(mine.some(x=>Date.now()-new Date(x.date||0).getTime()<30000)){toast('Please wait a few seconds before another request');return}
  if(mine.some(x=>payoutReservesBalance(x)&&Number(x.amount)===amt&&String(x.upi||'').toLowerCase()===upi.toLowerCase())){toast('Same payout request is already under review');return}
  S.payouts=S.payouts||[];
  const payout={id:uid('pay'),sellerId:sid,userId:S.currentUser?.userId||S.currentUser?.authId||S.currentUser?.id||null,amount:amt,note,status:'PENDING',date:nowISO(),upi,paymentVerified:false,manualPayout:true,
   snapshot:{sales:L.sales,gross:L.gross,fee:L.fee,earned:L.earned,paidBefore:L.paid,pendingBefore:L.pending,spentOnServices:L.spent,adjustments:L.adj,availableBefore:L.available,availableAfter:r2(L.available-amt)},
   history:[{at:nowISO(),by:S.currentUser?.id||null,action:'REQUESTED',amount:amt}]};
  S.payouts.unshift(payout);
  if(sellerLedger(sid).raw<-0.0001){S.payouts.shift();toast('Balance check failed. Request not created.');return}
  if(currentSeller())currentSeller().upi=upi;

  // Payouts are financial records: write directly to the normalized Supabase
  // payouts table first, then mirror the request into the shared app state.
  // This avoids a race where pushOnlineState() is still busy and a subsequent
  // read sees the old shared-state snapshot.
  save();
  try{
    if(!SUPABASE_READY||!window.supabaseClient)throw new Error('Supabase is not ready');
    const {data:{session}}=await supabaseClient.auth.getSession();
    const authUserId=session?.user?.id;
    if(!authUserId)throw new Error('Authenticated Supabase session not found');
    const payoutRow={
      id:String(payout.id),
      user_id:String(authUserId),
      amount:Number(payout.amount||0),
      status:'pending',
      payment_method:'UPI',
      payment_details:{upi:String(payout.upi||''),note:String(payout.note||''),seller_id:String(payout.sellerId||''),snapshot:payout.snapshot||{},manual_payout:true},
      returned_amount:0,
      cancelled_at:null,
      created_at:payout.date||new Date().toISOString(),
      updated_at:new Date().toISOString()
    };
    const {error:writeError}=await supabaseClient.from('payouts').insert(payoutRow);
    if(writeError)throw writeError;
    const {data:confirmed,error:readError}=await supabaseClient.from('payouts').select('id,user_id,amount,status,created_at').eq('id',String(payout.id)).maybeSingle();
    if(readError)throw readError;
    if(!confirmed||String(confirmed.id)!==String(payout.id))throw new Error('Payout row was not confirmed in Supabase');
    ONLINE_LOCAL_DIRTY=true; seDirtySince=Date.now(); queueOnlineSync();
    try{await persistNormalizedFinancials();}catch(e){console.warn('Normalized payout mirror delayed:',e)}
    try{await hydrateNormalizedFinancials();}catch(e){console.warn('Normalized payout refresh delayed:',e)}
  }catch(e){
    S.payouts=(S.payouts||[]).filter(x=>String(x.id)!==String(payout.id));
    sePersist();
    const reason=String(e?.message||e||'Cloud payout save failed').slice(0,180);
    toast('Payout could not be saved: '+reason);
    console.warn('Payout Supabase direct submit failed:',e);
    return;
  }
  toast('Payout request submitted. Admin can now see it in Withdrawals.');
  render();
 }finally{window.__payoutBusy=false;if(btn)btn.disabled=false}
}

function dashSubscription(){
 const s=currentSeller(),history=(S.subscriptions||[]).filter(x=>x.sellerId===s.id);
 const cfgPlans=(ensurePlatformConfig().plans||[]).slice(0,3);const plans=cfgPlans.filter(p=>p.active!==false&&!p.archived).map(p=>[p.id,p.name,p.monthly,Number(p.commissionPct||0)/100,(Array.isArray(p.featureText)&&p.featureText.length?p.featureText:[`Upload limit: ${p.uploadLimit}`,`Storage limit: ${p.storageLimit} MB`,p.prioritySupport?"Priority support":"Standard support"])])
 return dashShell("subscription",`<div class="plans">${plans.map(p=>`<div class="plan ${s.plan===p[0]?"current":""}"><h2>${p[1]}</h2><div class="plan-price">${money(p[2])}${p[0]!=="FREE"?" / month":""}</div><div style="text-align:center" class="pill">${Math.round(p[3]*100)}% Platform Fee</div><ul>${p[4].map(x=>`<li>${x}</li>`).join("")}</ul><button class="btn ${s.plan===p[0]?"":"primary"}" style="width:100%;margin-top:25px" onclick="${s.plan===p[0]?"toast('This plan is already active')":"buySubscription('"+p[0]+"')"}">${s.plan===p[0]?"Current Active Plan":"Purchase Plan"}</button></div>`).join("")}</div>
 <div class="dash-card"><h3>Referral Code</h3><p class="muted">Apply a referral code once. A valid referral gives 10% off the subscription; the referrer receives 5% of the final paid amount.</p><div style="display:flex;gap:8px"><input id="refCode" style="flex:1;border:1px solid var(--line);border-radius:11px;padding:11px" placeholder="ENTER CODE"><button class="btn" onclick="applyReferral()">Apply</button></div></div>
 <div class="dash-card" style="padding:0;overflow:hidden"><h3 style="padding:18px;margin:0">Subscription Pay History</h3><table class="dash-table"><thead><tr><th>Plan</th><th>Amount</th><th>Discount</th><th>Payment</th><th>Date</th><th>Status</th></tr></thead><tbody>${history.map(x=>{const end=subscriptionEndDate(x);const active=end&&Date.now()<end.getTime();return `<tr><td>${esc(x.plan)}</td><td>${money(x.amount)}</td><td>${money(x.discount||0)}</td><td>${esc(x.paymentSource||"ONLINE")}</td><td>${new Date(x.date).toLocaleString('en-IN')}</td><td><span class="status ${active?"success":"cancelled"}">${active?"ACTIVE":"EXPIRED"}</span></td></tr>`}).join("")||`<tr><td colspan="6" style="text-align:center;padding:30px">No subscription payment history yet.</td></tr>`}</tbody></table></div>`)
}
function buySubscription(plan){
 if(!systemGuard("subscriptions","Subscriptions are temporarily disabled by Admin"))return;
 const cp=(ensurePlatformConfig().plans||[]).find(x=>x.id===plan);if(!cp||cp.active===false||cp.archived){toast("This subscription plan is unavailable");return}const price=Number(cp.monthly||0);
 if(plan==="FREE"){currentSeller().plan="FREE";save();render();return}
 const used=S.settings.referralUsedBy?.[S.currentUser.id],discount=used?price*.10:0,final=price-discount;
 servicePaymentPanel("subscription",final,{plan,discount,basePrice:price});
}
function planContact(){go("contact")}
function dashAds(){
 const sid=currentSeller().id,ads=S.ads.filter(a=>a.sellerId===sid);
 return dashShell("ads",`<button class="btn primary" onclick="openAdCampaign()">＋ NEW AD CAMPAIGN</button><h3 style="margin-top:25px">ACTIVE CAMPAIGNS</h3><table class="dash-table"><thead><tr><th>Product</th><th>Placement</th><th>Clicks</th><th>End Date</th><th>Status</th></tr></thead><tbody>${activeAds().filter(a=>a.sellerId===sid).map(a=>`<tr><td>${esc(product(a.productId)?.title||"—")}</td><td>${esc(a.placement)}</td><td>${a.clicks||0}</td><td>${new Date(a.endDate).toLocaleDateString()}</td><td><span class="status success">ACTIVE</span></td></tr>`).join("")||`<tr><td colspan="5">NO ACTIVE CAMPAIGNS RUNNING</td></tr>`}</tbody></table>
 <h3 style="margin-top:25px">AD PAYMENT HISTORY</h3><table class="dash-table"><thead><tr><th>Product</th><th>Dates</th><th>Placement</th><th>Cost</th><th>Payment</th></tr></thead><tbody>${ads.map(a=>`<tr><td>${esc(product(a.productId)?.title||"—")}</td><td>${new Date(a.startDate).toLocaleDateString()} → ${new Date(a.endDate).toLocaleDateString()}</td><td>${esc(a.placement)}</td><td>${money(a.cost||0)}</td><td>${esc(a.paymentSource||"ONLINE")}</td></tr>`).join("")||`<tr><td colspan="5">NO AD PAYMENT HISTORY</td></tr>`}</tbody></table>`)
}
function openAdCampaign(state={}){
 const ps=S.products.filter(p=>p.sellerId===currentSeller().id);
 const draft=window.pendingAdDraft||{};
 const selectedProduct=state.productId||draft.productId||ps[0]?.id||"";
 const selectedType=state.type||draft.type||"";
 const selectedDays=Math.max(1,Number(state.days??draft.days)||7);
 const selectedSearch=state.search??draft.search??"";
 const packages=(ensurePlatformConfig().ads?.packages||[]).filter(x=>x.active!==false);
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal"><button class="btn iconbtn close" onclick="closeModal()">×</button><h2>New Ad</h2><div class="field"><label>Search Product</label><input id="adSearch" placeholder="Type product name" oninput="filterAdProducts();saveAdDraft()" value="${esc(selectedSearch)}"></div><div class="field"><label>Select Product</label><select id="adProduct" onchange="saveAdDraft();updateAdTotal()">${ps.map(p=>`<option value="${p.id}" ${p.id===selectedProduct?'selected':''}>${esc(p.title)}</option>`).join("")}</select></div><div class="field"><label>Ad Type</label><select id="adType" onchange="saveAdDraft();updateAdTotal()">${packages.map(x=>`<option value="${esc(x.name)}" data-price="${Number(x.price||0)}" ${x.name===selectedType?'selected':''}>${esc(x.name)} · ${money(Number(x.price||0))}/day</option>`).join("")}</select></div><div class="field"><label>Duration (days)</label><input id="adDays" type="number" min="1" value="${selectedDays}" oninput="saveAdDraft();updateAdTotal()"></div><div class="dash-card" style="margin:10px 0"><b>Total Ad Cost: <span id="adTotal">₹0.00</span></b><div class="small muted">Choose Pay Online or Pay from Available Balance at checkout.</div></div><div class="modal-footer"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="createAd()">Continue to Payment</button></div></div></div>`;
 saveAdDraft();
 updateAdTotal();
}
function saveAdDraft(){
 const productId=document.getElementById("adProduct")?.value||"";
 const type=document.getElementById("adType")?.value||"";
 const days=Math.max(1,Number(document.getElementById("adDays")?.value)||1);
 const search=document.getElementById("adSearch")?.value||"";
 window.pendingAdDraft={productId,type,days,search};
}
function filterAdProducts(){const q=(document.getElementById("adSearch")?.value||"").toLowerCase();document.querySelectorAll("#adProduct option").forEach(o=>o.hidden=!o.textContent.toLowerCase().includes(q));}
function updateAdTotal(){const sel=document.getElementById("adType");if(!sel||!sel.selectedOptions[0])return;const price=Number(sel.selectedOptions[0].dataset.price||0),days=Math.max(1,Number(document.getElementById("adDays")?.value)||1);const total=document.getElementById("adTotal");if(total)total.textContent=money(price*days)}
function createAd(){
 if(!systemGuard('ads','Advertising is temporarily disabled by Admin'))return;
 saveAdDraft();
 const sid=currentSeller().id,sel=document.getElementById("adType"),type=sel.value,rate=Number(sel.selectedOptions[0].dataset.price||0),days=Math.max(1,Number(document.getElementById("adDays").value)||1),cost=rate*days,productId=document.getElementById("adProduct").value;
 if(!productId){toast("Select a product");return}
 servicePaymentPanel("ad",cost,{productId,type,rate,days,search:document.getElementById("adSearch")?.value||""});
}
function dashFollowers(){
 const sid=currentSeller().id;
 const ids=Object.keys(S.follows||{}).filter(k=>k.endsWith("_"+sid)).map(k=>k.split("_")[0]);
 const rows=ids.length?ids.map(id=>{const u=S.users.find(x=>x.id===id);return `<div class="security-row"><div><b>${esc(u?.name||"User")}</b><div class="small muted">User ID: ${esc(id)} · ${esc(u?.email||"")}</div></div><button class="btn" onclick="go('account')">View</button></div>`}).join(""): `<div class="account-empty"><div class="empty-icon">♧</div><h2>No Followers Yet</h2><p class="muted">Followers will appear here after users follow your seller page.</p></div>`;
 return dashShell("followers",`<div class="dash-card"><div class="section-head"><div><h2>Store Followers</h2><p>Follower IDs and account information</p></div><span class="pill">♧ ${ids.length} Followers</span></div>${rows}</div>`);
}
const REFERRAL_UPGRADE_PRICES={6:60,7:70,8:80,9:90,10:30,11:110,12:120,13:130,14:140,15:40,16:160,17:170,18:180,19:190,20:50};
function referralRate(s=currentSeller()){return 5}
function nextReferralRate(s=currentSeller()){return null}
function referralUpgradePrice(rate){return Number(REFERRAL_UPGRADE_PRICES[rate]||0)}
function referralUpgradeTotal(fromRate,toRate){let total=0;for(let r=fromRate+1;r<=toRate;r++)total+=referralUpgradePrice(r);return total}
function openReferralUpgrade(targetRate){ if(!systemGuard('referrals','Referral system is temporarily disabled by Admin'))return; if(ensurePlatformConfig().referral?.enabled===false){toast("Referral upgrades are disabled by Admin");return;}
 const s=currentSeller(),cur=referralRate(s),requested=Number(targetRate||nextReferralRate(s)||20);if(requested!==cur+1){toast("Only the next referral level can be purchased");return}const target=requested;
 if(cur>=20){toast("You are already at the maximum 20% referral rate");return}
 const total=referralUpgradeTotal(cur,target),available=sellerAvailableBalance(s.id),steps=Array.from({length:target-cur},(_,i)=>cur+i+1);
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal ref-upgrade-modal"><button class="btn iconbtn close" onclick="closeModal()">×</button><div class="ref-upgrade-head"><div><div class="small muted">REFERRAL RATE UPGRADE</div><h2 style="margin:5px 0">Choose Your Referral %</h2><p class="muted" style="margin:0">Only the next referral level can be purchased. Complete levels one by one.</p></div><div class="ref-rate-badge">${cur}% → ${target}%</div></div><div class="ref-level-grid">${Array.from({length:16},(_,i)=>{const r=i+5,p=r===5?0:referralUpgradePrice(r),selected=r===target,availableLevel=r>cur;return `<button class="ref-level ${r===cur?'current':''} ${selected?'next':''}" ${availableLevel?'onclick="openReferralUpgrade('+r+')"':''} style="text-align:left;cursor:${availableLevel?'pointer':'default'};opacity:${availableLevel?1:.72}"><b>${r}%</b><div class="small muted">${r===5?'Starting':money(p)}</div>${r===cur?'<div class="small">Current</div>':''}${selected?'<div class="small">Selected</div>':''}${r>cur?'<div class="small">Click to select</div>':''}</button>`}).join('')}</div><div class="dash-card" style="margin-top:18px"><div class="security-row"><span>Current referral rate</span><b>${cur}%</b></div><div class="security-row"><span>Selected referral rate</span><b>${target}%</b></div><div class="security-row"><span>Upgrade levels</span><b>${steps.map(r=>r+'%').join(' + ')}</b></div><div class="security-row"><span>Upgrade amount</span><b>${money(total)}</b></div><div class="security-row"><span>Available balance</span><b>${money(available)}</b></div></div><div class="dash-card" style="margin-top:12px;background:rgba(240,180,41,.08);border-color:rgba(240,180,41,.35)"><b>How the charge works</b><p class="small muted" style="margin:7px 0 0">Example: if you are at 5% and select 7%, you pay the 6% price + 7% price together. The customer discount stays 10%, and your selected rate applies only to future eligible referrals.</p></div><div class="modal-footer"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn" onclick="payReferralUpgradeOnline(${target},${total})">Pay Online</button><button class="btn primary" onclick="payReferralUpgradeBalance(${target},${total})">Pay from Available Balance</button></div></div></div>`;
}
function payReferralUpgradeBalance(rate,price){const available=sellerAvailableBalance(currentSeller().id);if(price>available){toast("Insufficient Available Balance");return}const cur=referralRate();document.getElementById("modalRoot").innerHTML=`<div class="modal-bg"><div class="modal"><button class="btn iconbtn close" onclick="openReferralUpgrade(${rate})">×</button><h2>Confirm Referral Upgrade</h2><div class="dash-card" style="text-align:center"><div class="small muted">Selected Referral Rate</div><h2>${cur}% → ${rate}%</h2><div class="small muted">Upgrade levels: ${Array.from({length:rate-cur},(_,i)=>cur+i+1).join('% + ')}%</div><div style="margin-top:8px">Total payment: <b>${money(price)}</b></div><div class="small muted">Available balance: ${money(available)} · Remaining: ${money(available-price)}</div></div><div class="modal-footer"><button class="btn" onclick="openReferralUpgrade(${rate})">Back</button><button class="btn primary" onclick="completeReferralUpgradeBalance(${rate},${price})">Confirm & Pay</button></div></div></div>`}
function completeReferralUpgradeBalance(rate,price){ if(!systemGuard('payments','Payments are temporarily disabled by Admin'))return;
 const sid=currentSeller().id,available=sellerAvailableBalance(sid);if(price>available){toast("Insufficient Available Balance");return}
 const cur=referralRate();if(rate!==cur+1){toast("Only the next referral level can be purchased");return}
 const refId=uid("ru"),tx=fakeGatewayCreate("referralUpgrade",price,{refId,sellerId:sid,fromRate:cur,toRate:rate,recipient:"INTERNAL_LEDGER",source:"BALANCE"});
 document.getElementById("modalRoot").innerHTML=`<div class="modal-bg"><div class="modal" style="text-align:center;padding:34px"><div style="font-size:42px">⏳</div><h2>Verifying Balance Payment</h2><p class="muted">Checking available balance and upgrade transaction...</p></div></div>`;
 setTimeout(()=>{
   if(!fakeGatewayMarkSuccess(tx.id)){fakeGatewayFail(tx.id,"Balance ledger did not report success");toast("Balance payment failed");return}
   setTimeout(()=>{
     if(!fakeGatewayVerify(tx.id,{userId:sid,amount:price,kind:"referralUpgrade",recipient:"INTERNAL_LEDGER",refId})){fakeGatewayFail(tx.id,"Balance verification mismatch");toast("Balance payment verification failed");return}
     if(sellerAvailableBalance(sid)<price){fakeGatewayFail(tx.id,"Insufficient balance at verification");toast("Insufficient Available Balance");return}
     const cur2=referralRate();if(rate!==cur2+1){toast("Referral level changed. Payment not applied.");return}
     S.balancePayments=S.balancePayments||[];S.balancePayments.unshift({id:uid("bal"),sellerId:sid,amount:price,kind:"referralUpgrade",source:"BALANCE",status:"SUCCESS",paymentVerified:true,gatewayPaymentId:tx.id,date:nowISO(),meta:{fromRate:cur2,toRate:rate,levels:[rate]}});currentSeller().referralPercent=rate;S.referralUpgrades=S.referralUpgrades||[];S.referralUpgrades.unshift({id:refId,sellerId:sid,fromRate:cur2,toRate:rate,amount:price,paymentSource:"BALANCE",paymentStatus:"SUCCESS",paymentVerified:true,gatewayPaymentId:tx.id,date:nowISO(),levels:[rate]});save();showReferralUpgradeSuccess(rate,price,"BALANCE",cur2)
   },500)
 },500)
}
function payReferralUpgradeOnline(rate,price){window.refUpgrade={rate,price,id:uid("ru"),fromRate:referralRate()};window.payMethod="UPI";window.paymentDeadline=Date.now()+Number(ensurePlatformConfig().payment?.timeoutMinutes||10)*60*1000;clearInterval(window.paymentTimer);const qr=encodeURIComponent(`upi://pay?pa=${S.settings.websiteUpi||"saleearn.demo@upi"}&pn=Sale%20Earn&am=${price.toFixed(2)}&cu=INR`);document.getElementById("modalRoot").innerHTML=`<div class="modal-bg"><div class="modal payment-modal-wide"><button class="btn iconbtn close" onclick="cancelReferralUpgradePayment()">×</button><div class="payment-layout"><aside class="payment-left"><div class="payment-left-title"><span class="logo-mark">SE</span><span>Sale Earn Checkout</span></div><div class="payment-total"><span>Referral Rate</span><span>${referralRate()}% → ${rate}%</span></div><div class="payment-total"><span>Upgrade Levels</span><span>${Array.from({length:rate-referralRate()},(_,i)=>referralRate()+i+1).join('% + ')}%</span></div><div class="payment-total"><span>Total</span><span>${money(price)}</span></div><div class="payment-methods"><h4>Pay Online</h4><button class="pay-opt active" onclick="selectReferralUpgradePay(this,'UPI')">🔶 <span>UPI</span></button><button class="pay-opt" onclick="selectReferralUpgradePay(this,'Card')">▣ <span>Debit/Credit Card</span></button><button class="pay-opt" onclick="selectReferralUpgradePay(this,'Paytm')">◉ <span>Paytm</span></button><button class="pay-opt" onclick="selectReferralUpgradePay(this,'Net Banking')">▤ <span>Net Banking / Wallet</span></button></div><div style="margin-top:auto;border-top:1px solid #e7e9ef;padding-top:15px;text-align:center;color:#7a8599;font-size:11px">Razorpay Test Mode · No real charge</div></aside><section class="payment-right"><div class="payment-right-inner"><h2>Referral Upgrade Payment</h2><div id="refUpgradePayForm">${referralUpgradePayForm("UPI",qr,price)}</div><div class="modal-footer"><button class="btn" onclick="openReferralUpgrade(${rate})">← Change Level</button><button class="btn primary" onclick="completeReferralUpgradeOnline()">Pay ${money(price)} with Cashfree</button></div></div><div class="payment-footer-time">◷ Expires in <span id="refUpgradeTimer">${String(Number(ensurePlatformConfig().payment?.timeoutMinutes||10)).padStart(2,"0")}:00</span></div></section></div></div></div>`;window.paymentTimer=setInterval(()=>{const left=Math.max(0,window.paymentDeadline-Date.now()),el=document.getElementById("refUpgradeTimer");if(el)el.textContent=Math.floor(left/60000)+":"+String(Math.floor(left%60000/1000)).padStart(2,"0");if(left<=0)cancelReferralUpgradePayment(true)},250)}
function selectReferralUpgradePay(btn,type){document.querySelectorAll(".pay-opt").forEach(b=>b.classList.remove("active"));btn.classList.add("active");document.getElementById("refUpgradePayForm").innerHTML=referralUpgradePayForm(type,"",window.refUpgrade?.price||0);window.payMethod=type}
function referralUpgradePayForm(type,qrData,amount){if(type==="UPI")return `<div style="text-align:center"><h3>Pay Sale Earn via UPI</h3><p class="small muted">UPI ID: <b>${esc(S.settings.websiteUpi||"saleearn.demo@upi")}</b></p><div class="payment-qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${qrData}" alt="Sale Earn UPI QR"></div></div>`;if(type==="Card")return `<div class="form-grid"><div class="field"><label>Card Number</label><input inputmode="numeric" placeholder="Test card number"></div><div class="field"><label>Expiry</label><input placeholder="MM/YY"></div><div class="field"><label>Name on Card</label><input placeholder="Demo User"></div><div class="field"><label>CVV</label><input inputmode="numeric" placeholder="123"></div></div><p class="small muted">Prototype/test mode only. Do not enter a real card.</p>`;return `<div class="field"><label>Payment method</label><select><option>${esc(type)}</option></select></div><p class="small muted">Prototype/test mode only.</p>`}

async function completeReferralUpgradeOnline(){
 if(!systemGuard('payments','Payments are temporarily disabled by Admin'))return;
 const x=window.refUpgrade;if(!x)return;
 const sid=currentSeller()?.id;if(!sid)return;
 const ok=await startRazorpayCheckout({
   amount:x.price,
   description:razorpaySafeDescription("Sale Earn - Referral upgrade"),
   customerName:S.currentUser?.name||currentSeller()?.name||"",
   customerEmail:S.currentUser?.email||"",
   metadata:{
     kind:"referralUpgrade",
     referenceId:x.id||uid("ru"),
     sellerId:sid,
     fromRate:x.fromRate,
     toRate:x.rate
   },
   onVerified:async(response)=>{
     const verified={...x,gatewayPaymentId:response.razorpay_payment_id,razorpayOrderId:response.razorpay_order_id,paymentVerified:true};
     window.refUpgrade=null;
     window.applyReferralUpgradePayment(verified,"RAZORPAY_TEST");
     toast("Referral upgrade test payment verified.");
   }
 });
 if(!ok)closeModal();
}

function cancelReferralUpgradePayment(expired=false){clearInterval(window.paymentTimer);window.refUpgrade=null;closeModal();if(expired)toast("Payment session expired")}
function showReferralUpgradeSuccess(rate,price,source,fromRate=rate-1){document.getElementById("modalRoot").innerHTML=`<div class="modal-bg"><div class="modal" style="text-align:center;padding:34px"><div style="font-size:58px">✓</div><h2>Referral Rate Upgraded</h2><p class="muted">Your referral rate is now <b>${rate}%</b>.</p><div class="dash-card"><b>Paid ${money(price)}</b><div class="small muted">Upgrade: ${fromRate}% → ${rate}%</div><div class="small muted">Payment: ${esc(source)}</div><div class="small muted">This rate applies to future eligible referrals only.</div></div><button class="btn primary" onclick="closeModal();render()">Done</button></div></div>`}
function dashReferral(){
 const sid=currentSeller().id,s=currentSeller(),code=s.referralCode||((s.owner||"SE").replace(/\W/g,"").slice(0,4).toUpperCase()+"-"+sid.slice(-4).toUpperCase()),refs=S.referrals.filter(x=>x.sellerId===sid),rate=referralRate(s),next=nextReferralRate(s),nextPrice=next?referralUpgradePrice(next):0,upgrades=(S.referralUpgrades||[]).filter(x=>x.sellerId===sid);
 return dashShell("referral",`<div class="ad-banner"><div><div style="font-size:25px">♧</div><p>Invite customers to Sale Earn. Customers get 10% off eligible subscriptions, while you earn your current referral percentage on their actual paid amount.</p></div><h2>Referral Program</h2></div>
 <div class="ref-upgrade-card"><div class="ref-upgrade-head"><div><div class="small muted">REFERRAL PROGRAM</div><h2 style="margin:5px 0">Your Referral Rate</h2><p class="muted" style="margin:0">Fixed rate: <b>${rate}%</b> on eligible referred payments.</p></div></div></div>
 <div class="ref-top"><div class="dash-card"><h3>Your Referral Code</h3><div class="field"><input readonly value="${esc(code)}"></div><button class="btn" onclick="navigator.clipboard?.writeText('${code}');toast('Referral code copied')">Copy</button><p class="small muted">Share this code with new vendors.</p></div><div class="dash-card"><h3>Apply Referral Code</h3><div style="display:flex;gap:8px"><input id="refCode" style="flex:1;border:1px solid var(--line);border-radius:11px;padding:11px" placeholder="ENTER CODE"><button class="btn primary" onclick="applyReferral()">Apply Code</button></div><p class="small muted">A code can be used once per account.</p></div></div>
 <div class="ref-stats">${[["♧",refs.length,"USED YOUR CODE"],["✓",refs.filter(x=>x.status==="ACTIVE").length,"PURCHASED PLAN"],["₹",money(refs.reduce((a,x)=>a+Number(x.commission||0),0)),"TOTAL COMMISSION"],["%",rate+"%","CURRENT REFERRAL RATE"]].map(x=>`<div class="ref-stat"><div>${x[0]}</div><h2>${x[1]}</h2><div class="small muted">${x[2]}</div></div>`).join("")}</div>
 <div class="dash-card" style="padding:0;overflow:hidden"><h3 style="padding:18px;margin:0">Referral History</h3><table class="dash-table"><thead><tr><th>Referred User</th><th>Commission</th><th>Status</th><th>Date</th></tr></thead><tbody>${refs.map(r=>`<tr><td>${esc(r.userName)}</td><td>${money(r.commission)}</td><td>${esc(r.status)}</td><td>${new Date(r.date).toLocaleString('en-IN')}</td></tr>`).join("")||`<tr><td colspan="4" style="text-align:center;padding:50px">No referral history found.</td></tr>`}</tbody></table></div>
`)
}
function applyReferral(){ if(!systemGuard('referrals','Referral system is temporarily disabled by Admin'))return;const c=document.getElementById("refCode")?.value.trim().toUpperCase();if(!c){toast("Enter a code");return}if(S.settings.referralUsedBy?.[S.currentUser.id]){toast("Referral code can only be used once");return}const match=Object.keys(S.sellers).find(id=>(seller(id).referralCode||((seller(id).owner||"SE").replace(/\W/g,"").slice(0,4).toUpperCase()+"-"+id.slice(-4).toUpperCase()))===c);if(!match){toast("Invalid referral code");return}if(match===currentSeller()?.id){toast("You cannot use your own code");return}S.settings.referralUsedBy=S.settings.referralUsedBy||{};S.settings.referralUsedBy[S.currentUser.id]={code:c,sellerId:match,date:nowISO()};save();toast("Referral code applied: 10% subscription discount. Your referrer earns on your successful payment.");render()}
function previewLogo(e){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{currentSeller().logo=r.result;save();document.getElementById("logoPreview").innerHTML=`<img src="${r.result}">`;};r.readAsDataURL(f)}
function saveSettings(){const s=currentSeller();s.name=document.getElementById("setName").value.trim()||s.name;s.support=document.getElementById("setContact").value.trim();s.upi=document.getElementById("setUpi").value.trim();s.bio=document.getElementById("setBio").value;save();toast("Settings saved");render()}

/* -------------------- ADD / EDIT PRODUCT -------------------- */
const tagSuggestions=["Entertainment","Viral Reels","AI Reels","Editing","Transitions","SFX","Cartoon","Devotional","Hindi","Comedy","Templates","Creator Tools","Education","Course","HD Reels","YouTube","Animals"];
/* -------------------- PRODUCT SAFETY / MODERATION -------------------- */
const SALE_EARN_PROHIBITED_PATTERNS=[
  /(^|\b)(pirated|piracy|crack(ed|ing)?|keygen|serial key|activation key|nulled|warez|leak(ed)?|stolen|counterfeit|fake license|bypass license|unlock(ed|ing)?)(\b|$)/i,
  /(^|\b)(software download|downloadable software|software license|license key|activation code|app license|desktop software|paid software)(\b|$)/i,
  /(^|\b)(spam|bulk email|email list|mailing list|mass mailing|unsolicited email)(\b|$)/i,
  /(^|\b)(gambling|betting|lottery|casino|sports bet|online game for money|real money game)(\b|$)/i,
  /(^|\b)(hack(ing|er)?|crack(ing|er)?|exploit|credential theft|phishing|malware|ransomware|virus|keylogger|botnet)(\b|$)/i,
  /(^|\b)(fake id|fake passport|fake diploma|forged document|stolen account|account hack)(\b|$)/i,
  /(^|\b)(illegal|illicit|unauthorized copy|unauthorised copy|copyright infringement|pirated content|pirated media|movie clip|movie clips|tv clip|tv clips|cartoon clip|cartoon clips|song download|music download|book pdf|leaked course|leaked content)(\b|$)/i,
  /(^|\b)(adult|sexually explicit|pornographic|escort)(\b|$)/i,
  /(^|\b)(weapon|firearm|ammunition|explosive|knife)(\b|$)/i,
  /(^|\b)(get rich quick|pyramid scheme|matrix scheme|easy money guaranteed|guaranteed income)(\b|$)/i
];
const SALE_EARN_SUSPICIOUS_PATTERNS=[
  /(^|\b)(free premium|premium for free|paid software free|full version free|lifetime license free)(\b|$)/i,
  /(^|\b)(100% guaranteed|guaranteed profit|instant money|make money fast)(\b|$)/i
];
function productSafetyScan(data){
  const fields=[data?.title,data?.description,data?.category,...(data?.tags||[]),...(data?.linkTitles||[]),...(data?.links||[])].filter(Boolean).join(' ');
  const reasons=[];
  SALE_EARN_PROHIBITED_PATTERNS.forEach((re,i)=>{if(re.test(fields))reasons.push('Prohibited or unauthorized-content indicator');});
  SALE_EARN_SUSPICIOUS_PATTERNS.forEach(re=>{if(re.test(fields))reasons.push('Suspicious or misleading marketing indicator');});
  if((data?.links||[]).some(u=>{try{return new URL(u).protocol!=='https:'}catch(e){return true}}))reasons.push('Non-HTTPS delivery link');
  if((data?.links||[]).some(u=>!validSecureUrl(u)))reasons.push('Unapproved delivery provider');
  if(String(data?.category||'').toLowerCase()==='software')reasons.push('Software downloads/intangible software goods are not eligible for this payment setup');
  return {flagged:reasons.length>0,reasons:[...new Set(reasons)]};
}
function markProductPendingReview(p,reason='Seller product submitted or edited'){
  if(!p)return;
  p.approvalStatus='PENDING';
  p.hiddenByAdmin=false;
  p.approvalReason=reason;
  p.adminReviewedAt=null;
  p.adminReviewedBy=null;
  const scan=productSafetyScan(p);
  p.safetyStatus=scan.flagged?'FLAGGED':'CLEAR';
  p.safetyFlags=scan.reasons;
  p.submittedForReviewAt=nowISO();
}
function approveProductByAdmin(p){
  if(!p)return false;
  const scan=productSafetyScan(p);
  if(scan.flagged){p.safetyStatus='FLAGGED';p.safetyFlags=scan.reasons;return false;}
  p.approvalStatus='APPROVED';p.hiddenByAdmin=false;p.approvalReason='Approved after admin review';p.adminReviewedAt=nowISO();p.adminReviewedBy=S.currentUser?.id||'admin';p.safetyStatus='CLEAR';p.safetyFlags=[];
  delete p.sellerReviewRequested;
  return true;
}
function rejectProductByAdmin(p,reason='Product does not meet Sale Earn marketplace rules'){
  if(!p)return;
  p.approvalStatus='REJECTED';p.approvalReason=reason;p.adminReviewedAt=nowISO();p.adminReviewedBy=S.currentUser?.id||'admin';p.hiddenByAdmin=true;
  delete p.sellerReviewRequested;
}
function productApprovalLabel(p){const st=p?.approvalStatus||'APPROVED';return st==='PENDING'?'Pending Review':st==='REJECTED'?'Rejected':'Approved'}

function productForm(step=1,editId=null){
 const blank={title:"",category:"Reel Content Pack",tags:[],price:"",oldPrice:"",description:"",links:[""],linkTitles:["File 1"],faq:[["What is included?",""]],image:"",fileSizeValue:"",fileSizeUnit:"MB",fileCount:1,rightsConfirmed:false,approvalStatus:'PENDING',safetyStatus:'CLEAR',safetyFlags:[]};
 const edit=editId?product(editId):null;
 if(editId&&edit&&S.draft?._editId!==editId)S.draft={...structuredClone(edit),_editId:editId,links:[...(edit.links||[""])],linkTitles:(edit.linkTitles||edit.links?.map((_,i)=>`File ${i+1}`)||["File 1"]).slice()};
 const d=S.draft||blank,x=editId?(S.draft||edit||blank):d,plan=currentSeller()?.plan||"FREE",fee=({FREE:.20,CE:.10,PRIME:.10,ENTERPRISE:.05}[plan]??.20),rev=Number(x.price||0)*(1-fee),discount=x.oldPrice>0&&x.price<x.oldPrice?Math.max(0,Math.round((1-x.price/x.oldPrice)*100)):0;
 return dashShell(editId?"products":"add",`<div class="dash-form"><div class="stepper"><span class="step ${step===1?"active":""}">1 · Product Information</span><span class="step ${step===2?"active":""}">2 · Files & Details</span><span class="step ${step===3?"active":""}">3 · Pricing</span></div>
 ${step===1?`<div class="field"><label>Product Title *</label><input id="pfTitle" maxlength="400" value="${esc(x.title)}" oninput="v21InputCount('pfTitle',400)"><small class="char-count" data-count-for="pfTitle">${String(x.title||"").length}/400</small></div><div class="form-grid"><div class="field"><label>Category *</label><select id="pfCategory" onchange="S.draft=S.draft||{};S.draft.category=this.value;save()">${["Courses","Reel Content Pack","Editing Assets","Templates"].map(c=>`<option value="${c}" ${x.category===c?"selected":""}>${c}</option>`).join("")}</select></div><div class="field"><label>Tags / Keywords *</label><input id="tagInput" value="${esc((x.tags||[]).join(", "))}" placeholder="Entertainment, AI Reels"></div></div><div class="tag-suggest">${tagSuggestions.map(t=>`<button type="button" onclick="addDraftTag('${t}')">＋ ${t}</button>`).join("")}</div><div class="field"><label>Description *</label><textarea id="pfDesc">${esc(x.description||"")}</textarea></div><div class="dash-card"><h3 style="margin-top:0">Seller Product Checklist</h3><ul class="muted" style="line-height:1.8;padding-left:20px;margin-bottom:0"><li>Title, image, description, category and tags accurately describe the product.</li><li>Every delivery link has been tested and is expected to remain accessible.</li><li>The product contains only content you have the right or permission to distribute.</li><li>The listing does not contain prohibited, illegal, misleading or unauthorized material.</li><li>You are prepared to support buyers with reasonable product-specific questions.</li></ul></div>
 <div class="dash-card" style="background:rgba(81,70,229,.05);border-color:rgba(81,70,229,.2)"><label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input id="pfRights" type="checkbox" ${x.rightsConfirmed?'checked':''} style="margin-top:4px"><span><b>I confirm I have the right/permission to sell or distribute this product.</b><br><small class="muted">I will not submit unauthorized copyrighted media/software, misleading products, spam-enabling products, illegal products, or other prohibited content.</small></span></label></div><div class="modal-footer"><button type="button" class="btn" onclick="goBack('dashboard/products')">← Back</button><button type="button" class="btn primary" onclick="saveStep1('${editId||""}')">Continue →</button></div>`
 :step===2?`<div class="field"><label>Product Image (max 2 MB, images only)</label><input type="file" accept="image/*" onchange="previewProductImage(event)" ${x.image?"":"required"}><div id="productPreview" class="logo-upload" style="width:260px;height:170px;margin-top:10px">${x.image?`<img src="${esc(x.image)}">`:"🖼️"}</div><small class="muted">JPG, PNG, WebP, GIF and other browser-recognized image formats. Maximum 2 MB.</small></div>
 <div class="form-grid"><div class="field"><label>Total Files</label><input id="pfCount" type="number" min="1" max="50" step="1" value="${esc(Math.min(50,x.fileCount||x.links?.length||1))}" oninput="syncFileLinksFromCount()"></div><div class="field"><label>File Size</label><div style="display:flex;gap:8px"><input id="pfSizeValue" type="number" min="0" step="0.01" value="${esc(x.fileSizeValue??(String(x.fileSize||"").match(/^([0-9.]+)/)?.[1]||""))}" placeholder="250" style="flex:1"><select id="pfSizeUnit" style="width:110px"><option ${String(x.fileSizeUnit||"MB")==="MB"?"selected":""}>MB</option><option ${String(x.fileSizeUnit||"MB")==="GB"?"selected":""}>GB</option></select></div><small class="muted">Enter numbers only, e.g. 250 MB or 1.5 GB.</small></div></div>
 <div class="field"><label>Secure Delivery Links * <span class="small muted">(up to 50)</span></label><div id="fileLinksWrap">${Array.from({length:Math.min(50,Math.max(1,Number(x.fileCount||x.links?.length||1)))},(_,i)=>`<div class="repeat-row file-link-row" data-index="${i}"><div class="file-link-fields"><div><label class="small">Link Title *</label><input class="pfLinkTitle" value="${esc((x.linkTitles||[])[i]||`File ${i+1}`)}" placeholder="e.g. Download Bundle"></div><div><label class="small">Secure URL *</label><input class="pfLink" value="${esc((x.links||[])[i]||"")}" placeholder="https://drive.google.com/..."></div></div><button type="button" class="btn danger" onclick="removeFileLink(${i})">Remove</button></div>`).join("")}</div><button type="button" class="btn" style="margin-top:10px" onclick="addFileLink()">＋ Add File Link</button><small class="muted">Give every link a clear buyer-facing title, then add its HTTPS URL. Approved providers: Google Drive, Dropbox, OneDrive, MediaFire, Mega, Box, pCloud, etc.</small></div>
 <div class="field"><label>FAQ</label>${(x.faq||[]).map((f,i)=>`<div class="repeat-row"><input class="faqQ" value="${esc(f[0])}" placeholder="Question"><input class="faqA" value="${esc(f[1])}" placeholder="Answer"></div>`).join("")}</div>
 <div class="modal-footer"><button type="button" class="btn" onclick="saveStep2Back('${editId||""}')">← Previous</button><button type="button" class="btn" onclick="saveDraftFromForm()">Save as Draft</button><button type="button" class="btn primary" onclick="saveStep2('${editId||""}')">Continue →</button></div>`
 :`<div class="form-grid"><div class="field"><label>Regular / Original Price (₹) *</label><input id="pfOld" type="number" min="0" step="0.01" value="${esc(x.oldPrice||"")}" oninput="updatePricingPreview()"></div><div class="field"><label>Current Price (₹) *</label><input id="pfPrice" type="number" min="0" step="0.01" value="${esc(x.price||"")}" oninput="updatePricingPreview()"></div></div>
 <div class="dash-card"><h3>Product Coupon</h3><p class="muted">Add an optional coupon that buyers can use on this product. The coupon discount is applied before platform commission.</p><div class="form-grid"><div class="field"><label>Coupon Code</label><input id="pfCouponCode" value="${esc(x.couponDraft?.code??x.coupon?.code??"")}" placeholder="MYSALE10"></div><div class="field"><label>Discount %</label><input id="pfCouponValue" type="number" min="0" max="100" step="0.01" value="${esc(x.couponDraft?.value??x.coupon?.value??"")}" placeholder="10"></div><div class="field"><label>Max Uses</label><input id="pfCouponMax" type="number" min="1" value="${esc(x.couponDraft?.maxUses??x.coupon?.maxUses??100)}"></div><div class="field"><label>Expires</label><input id="pfCouponExpiry" type="date" value="${esc(x.couponDraft?.expiresAt??(x.coupon?.expiresAt?String(x.coupon.expiresAt).slice(0,10):""))}"></div></div></div>
 <div class="dash-card"><h3>Automatic Discount</h3><p class="muted">Original: <b id="priceOldPreview">${money(x.oldPrice||0)}</b> → Current: <b id="priceCurrentPreview">${money(x.price||0)}</b> · Discount: <b id="discountPreview">${discount}% OFF</b></p></div>
 <div class="dash-card"><h3>Platform Fee</h3><p class="muted">Current plan: <b>${esc(plan)}</b> · Fee: <b>${Math.round(fee*100)}%</b></p><p>Estimated Revenue: <b id="revenuePreview" style="color:var(--green)">${money(rev)}</b></p></div>
 <div class="modal-footer"><button type="button" class="btn" onclick="go('dashboard/add2${editId?"?edit="+editId:""}')">← Previous</button><button type="button" class="btn" onclick="saveDraftFromForm()">Save as Draft</button><span class="small muted" style="margin-right:auto">After publishing, your product will show as “Pending Review” until Admin approves it.</span><button type="button" class="btn primary" onclick="publishProduct('${editId||""}')">${editId?"Save Changes":"Publish Product"}</button></div>`}</div>`)
}
function updatePricingPreview(){
 const old=Number(document.getElementById("pfOld")?.value||0),price=Number(document.getElementById("pfPrice")?.value||0),fee=feeRate(),discount=old>0&&price<old?Math.max(0,Math.round((1-price/old)*100)):0;
 const d=document.getElementById("discountPreview"),r=document.getElementById("revenuePreview"),po=document.getElementById("priceOldPreview"),pc=document.getElementById("priceCurrentPreview");
 if(d)d.textContent=discount+"% OFF";if(r)r.textContent=money(price*(1-fee));if(po)po.textContent=money(old);if(pc)pc.textContent=money(price);
}
function validSecureUrl(url){
 try{
   const u=new URL(url);if(u.protocol!=="https:")return false;
   const host=u.hostname.toLowerCase().replace(/^www\./,"");
   const allowed=["drive.google.com","docs.google.com","dropbox.com","mediafire.com","1drv.ms","onedrive.live.com","mega.nz","box.com","pcloud.com","file.io","pixeldrain.com"];
   return allowed.some(d=>host===d||host.endsWith("."+d));
 }catch(e){return false}
}
function saveStep2(editId){
 collectStep2();
 const d=S.draft||{},rawLinks=Array.isArray(d.links)?d.links:[],rawTitles=Array.isArray(d.linkTitles)?d.linkTitles:[],records=rawLinks.map((v,i)=>({url:String(v||"").trim(),title:String(rawTitles[i]||"").trim()})).filter(x=>x.url),links=records.map(x=>x.url),titles=records.map((x,i)=>x.title||`File ${i+1}`),size=Number(d.fileSizeValue),unit=d.fileSizeUnit||"MB";
 if(!d.image){toast("Product image is required");return}
 if(!links.length||links.length>50){toast("Add at least 1 file link (maximum 50)");return}
 if(titles.some(x=>!x.trim())){toast("Add a title for every delivery link");return}
 const invalid=links.find(link=>!validSecureUrl(link));
 if(invalid){toast("Please enter a valid HTTPS storage-provider link for every file");return}
 if(!d.rightsConfirmed){toast("Product rights confirmation is required");return}
 d.links=links;d.linkTitles=titles;
 const scan=productSafetyScan(d);d.safetyStatus=scan.flagged?'FLAGGED':'CLEAR';d.safetyFlags=scan.reasons;if(scan.flagged){save();toast("Safety check flagged this product. It will stay hidden until Admin reviews it.");}
 if(!scan.flagged)d.safetyStatus='CLEAR';d.safetyFlags=scan.reasons;
 if(!Number.isFinite(size)||size<=0){toast("Enter file size as a number");return}
 d.links=links;d.linkTitles=titles;d.fileSizeValue=size;d.fileSizeUnit=["MB","GB"].includes(unit)?unit:"MB";d.fileSize=`${size} ${d.fileSizeUnit}`;d.fileCount=links.length;save();go(`dashboard/add3${editId?"?edit="+editId:""}`)
}
function addDraftTag(t){S.draft=S.draft||{};S.draft.tags=S.draft.tags||[];if(!S.draft.tags.includes(t))S.draft.tags.push(t);render()}
function removeDraftTag(t){if(S.draft?.tags)S.draft.tags=S.draft.tags.filter(x=>x!==t);render()}
function saveStep1(editId){
 const titleEl=document.getElementById("pfTitle"),tagEl=document.getElementById("tagInput"),descEl=document.getElementById("pfDesc"),catEl=document.getElementById("pfCategory");
 if(!titleEl||!tagEl||!descEl||!catEl){toast("Product form is not ready. Please reopen Add Product.");return}
 const title=titleEl.value.trim(),tags=tagEl.value.split(",").map(x=>x.trim()).filter(Boolean),desc=descEl.value.trim(),rights=!!document.getElementById("pfRights")?.checked;
 if(!title||!desc||!tags.length){toast("Title, tags and description are required");return}
 if(!rights){toast("Please confirm that you have the right to sell or distribute this product");return}
 const previous=S.draft||{};
 S.draft={...previous,title,category:catEl.value,tags,description:desc,rightsConfirmed:true};
 const scan=productSafetyScan(S.draft);S.draft.safetyStatus=scan.flagged?'FLAGGED':'CLEAR';S.draft.safetyFlags=scan.reasons;
 if(editId){
   const p=product(editId);
   if(!p){toast("Product could not be found. Please reopen Edit.");return}
   S.draft._editId=editId;
 }
 save();
 const next=`dashboard/add2${editId?"?edit="+encodeURIComponent(editId):""}`;
 if(routeNow()!==next){
   go(next);
 }
}
function addDraftTag(t){const el=document.getElementById("tagInput");if(!el)return;const a=el.value.split(",").map(x=>x.trim()).filter(Boolean);if(!a.includes(t))a.push(t);el.value=a.join(", ");S.draft=S.draft||{};S.draft.tags=a;save()}
function saveStep2Back(editId){collectStep2();save();go(editId?`dashboard/edit/${encodeURIComponent(editId)}`:"dashboard/add")}
function collectStep2(){
 if(!S.draft)return;
 // Do not overwrite saved file/link data when this helper is called from Step 3.
 // Step 3 does not render the file-link inputs, so an unconditional collection here
 // would replace existing links with an empty link and trigger the publish error.
 const linksWrap=document.getElementById("fileLinksWrap");
 if(!linksWrap)return;
 S.draft.image=S.draft.image||"";
 const countEl=document.getElementById("pfCount"), requested=Math.min(50,Math.max(1,Math.floor(Number(countEl?.value)||1)));
 if(countEl)countEl.value=requested;
 const linkEls=[...document.querySelectorAll(".pfLink")],titleEls=[...document.querySelectorAll(".pfLinkTitle")];
 const links=linkEls.slice(0,requested).map(x=>String(x.value||"").trim()),titles=titleEls.slice(0,requested).map((x,i)=>String(x.value||"").trim()||`File ${i+1}`);
 while(links.length<requested)links.push("");while(titles.length<requested)titles.push(`File ${titles.length+1}`);
 const sizeInput=document.getElementById("pfSizeValue"),sizeValue=sizeInput?Number(sizeInput.value):Number(S.draft.fileSizeValue);
 const unitSelect=document.getElementById("pfSizeUnit"),unit=unitSelect?.value||S.draft.fileSizeUnit||"MB";
 S.draft.links=links;S.draft.linkTitles=titles;S.draft.fileCount=links.filter(Boolean).length||requested;
 if(Number.isFinite(sizeValue)&&sizeValue>0){S.draft.fileSizeValue=sizeValue;S.draft.fileSizeUnit=["MB","GB"].includes(unit)?unit:"MB";S.draft.fileSize=`${sizeValue} ${S.draft.fileSizeUnit}`}
 S.draft.faq=[...document.querySelectorAll(".faqQ")].map((q,i)=>[q.value.trim(),document.querySelectorAll(".faqA")[i]?.value.trim()||""]).filter(x=>x[0]);
 save();
}
function currentFileLinkRows(){const links=[...document.querySelectorAll(".pfLink")],titles=[...document.querySelectorAll(".pfLinkTitle")];return links.map((x,i)=>({url:x.value.trim(),title:titles[i]?.value.trim()||`File ${i+1}`}))}
function fileLinkRowMarkup(row,i){return `<div class="repeat-row file-link-row" data-index="${i}"><div class="file-link-fields"><div><label class="small">Link Title *</label><input class="pfLinkTitle" value="${esc(row.title||`File ${i+1}`)}" placeholder="e.g. Download Bundle"></div><div><label class="small">Secure URL *</label><input class="pfLink" value="${esc(row.url||"")}" placeholder="https://drive.google.com/..."></div></div><button type="button" class="btn danger" onclick="removeFileLink(${i})">Remove</button></div>`}
function renderFileLinks(rows=null){
 const wrap=document.getElementById("fileLinksWrap");if(!wrap)return;
 const current=rows||currentFileLinkRows(),count=Math.min(50,Math.max(1,Math.floor(Number(document.getElementById("pfCount")?.value)||1)));
 const vals=current.slice(0,count);while(vals.length<count)vals.push({title:`File ${vals.length+1}`,url:""});
 wrap.innerHTML=vals.map(fileLinkRowMarkup).join("");persistProductDraftFromDOM(false);
}
function syncFileLinksFromCount(){renderFileLinks()}
function addFileLink(){const c=document.getElementById("pfCount");if(!c)return;const rows=currentFileLinkRows(),n=Math.min(50,(Number(c.value)||1)+1);c.value=n;rows.push({title:`File ${n}`,url:""});renderFileLinks(rows)}
function removeFileLink(i){const rows=currentFileLinkRows();if(rows.length<=1){toast("At least 1 file link is required");return}rows.splice(i,1);const c=document.getElementById("pfCount");if(c)c.value=rows.length;renderFileLinks(rows);persistProductDraftFromDOM(true)}

function readFileAsDataURL(file){
 return new Promise((resolve,reject)=>{
  const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error("Could not read this image"));r.readAsDataURL(file);
 });
}
function loadImageFromDataURL(dataUrl){
 return new Promise((resolve,reject)=>{
  const img=new Image();img.decoding="async";img.onload=()=>resolve(img);img.onerror=()=>reject(new Error("This image could not be decoded by the browser"));img.src=dataUrl;
 });
}
async function prepareProductImage(file){
 const original=await readFileAsDataURL(file);
 const img=await loadImageFromDataURL(original);
 if(!img.naturalWidth||!img.naturalHeight)throw new Error("Invalid image");
 // Keep the exact aspect ratio. No crop, no forced square/landscape ratio.
 // Resize only the longest side so large 5 MB images do not overflow localStorage.
 const MAX_SIDE=1800;
 const scale=Math.min(1,MAX_SIDE/Math.max(img.naturalWidth,img.naturalHeight));
 const w=Math.max(1,Math.round(img.naturalWidth*scale));
 const h=Math.max(1,Math.round(img.naturalHeight*scale));
 const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Image processing is not supported");
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(img,0,0,w,h);
 // WebP keeps transparency and usually makes the stored preview much smaller.
 let dataUrl=canvas.toDataURL("image/webp",0.86);
 if(!dataUrl||dataUrl==="data:,")dataUrl=canvas.toDataURL("image/jpeg",0.86);
 // If the browser still produces a large data URL, progressively lower quality.
 if(dataUrl.length>1900000)dataUrl=canvas.toDataURL("image/webp",0.72);
 if(dataUrl.length>1900000)dataUrl=canvas.toDataURL("image/jpeg",0.68);
 return {dataUrl,width:img.naturalWidth,height:img.naturalHeight};
}
async function previewProductImage(e){
 const f=e.target.files?.[0];if(!f)return;
 if(!f.type.startsWith("image/")){e.target.value="";toast("Only image files are allowed");return}
 if(f.size>2*1024*1024){e.target.value="";toast("Image must be 2 MB or smaller");return}
 const input=e.target; input.disabled=true; toast("Uploading product image…");
 try{
  const {dataUrl,width,height}=await prepareProductImage(f);
  const publicUrl=await uploadSaleEarnPublicImage(dataUrlToBlob(dataUrl),"products","webp");
  S.draft=S.draft||{}; S.draft.image=publicUrl;
  S.draft.imageWidth=width; S.draft.imageHeight=height;
  save();
  const el=document.getElementById("productPreview");
  if(el)el.innerHTML=`<img src="${esc(publicUrl)}" alt="Product image" title="${width} × ${height}px">`;
  toast("Product image uploaded");
 }catch(err){ console.warn(err); toast(err?.message||"Product image upload failed"); }
 finally{input.disabled=false}
}
function publishProduct(editId){ if(!systemGuard('productUploads','Product uploads are temporarily disabled by Admin'))return; const rr=ensurePlatformConfig().rules||{}; const publishPrice=Number(document.getElementById("pfPrice")?.value||0); if(Number.isFinite(publishPrice)&&publishPrice<Number(rr.minProductPrice||0)){toast("Product price is below the Admin minimum");return} if(Number.isFinite(publishPrice)&&publishPrice>Number(rr.maxProductPrice||1e15)){toast("Product price exceeds the Admin maximum");return}
 collectStep2();const d=S.draft||{},old=Number(document.getElementById("pfOld")?.value),price=Number(document.getElementById("pfPrice")?.value);
 if(!Array.isArray(d.links)||!d.links.length||d.links.length>50||d.links.some(link=>!validSecureUrl(link))){toast("Every file needs a valid HTTPS storage-provider URL");return}
 if(!d.fileSizeValue||!["MB","GB"].includes(d.fileSizeUnit)){toast("Valid numeric file size is required");return}
 if(!d.rightsConfirmed){toast("Product rights confirmation is required");return}
 const safety=productSafetyScan(d);d.safetyStatus=safety.flagged?'FLAGGED':'CLEAR';d.safetyFlags=safety.reasons;
 if(!price||price<=0||!old||old<=0){toast("Original and current price are required");return}
 if(price>old){toast("Current price cannot be higher than original price");return}
 d.oldPrice=old;d.price=price;d.featured=!!d.featured;
 // Editing an already-approved product only returns to Admin review when the
 // product image or secure delivery link(s) changed. Title, tags, description,
 // category, price, coupon, FAQ and other listing metadata keep the current
 // approval state. A brand-new product is always submitted as Pending.
 const existingProduct=editId?product(editId):null;
 const beforeImage=String(existingProduct?.image||'');
 const beforeLinks=JSON.stringify((existingProduct?.links||[]).map(x=>String(x||'').trim()));
 const afterImage=String(d.image||'');
 const afterLinks=JSON.stringify((d.links||[]).map(x=>String(x||'').trim()));
 const sensitiveDeliveryChange=!!editId && (beforeImage!==afterImage || beforeLinks!==afterLinks);
 if(!editId){
   markProductPendingReview(d,'New product submitted for admin safety review');
   /* Public marketplace visibility is independent from Admin moderation for
      brand-new listings: the product goes live immediately, while Admin still
      receives a Pending notification and the seller sees Pending. */
   d.publicLive=true;
   d.sellerReviewRequested=true;
 }else if(sensitiveDeliveryChange){
   markProductPendingReview(d,'Product image or secure delivery link changed; admin review required');
   d.publicLive=false;
   d.sellerReviewRequested=true;
 }else if(existingProduct){
   d.approvalStatus=existingProduct.approvalStatus||'APPROVED';
   d.hiddenByAdmin=!!existingProduct.hiddenByAdmin;
   d.approvalReason=existingProduct.approvalReason||'';
   d.adminReviewedAt=existingProduct.adminReviewedAt||null;
   d.adminReviewedBy=existingProduct.adminReviewedBy||null;
   if(existingProduct.sellerReviewRequested===true)d.sellerReviewRequested=true;else delete d.sellerReviewRequested;
 }
 const cc=(document.getElementById('pfCouponCode')?.value||d.couponDraft?.code||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'');const cv=Number(document.getElementById('pfCouponValue')?.value||d.couponDraft?.value||0);const cmu=Math.max(1,Number(document.getElementById('pfCouponMax')?.value||d.couponDraft?.maxUses||1));const cex=document.getElementById('pfCouponExpiry')?.value||d.couponDraft?.expiresAt||'';if(cc){if(cv<=0||cv>100){toast('Product coupon discount must be between 0 and 100%');return}d.coupon={id:'pcc_'+(editId||uid('pc')),code:cc,type:'percent',value:cv,maxUses:cmu,used:Number(d.coupon?.used||0),active:true,scope:'PRODUCT',sellerId:currentSeller().id,productId:editId||null,expiresAt:cex?new Date(cex+'T23:59:59').toISOString():null};}else d.coupon=null;
 delete d._editId;delete d.couponDraft;
 if(editId){if(d.coupon)d.coupon.productId=editId;Object.assign(product(editId),d);logProductActivity(editId,'Product updated',{sellerId:currentSeller().id});toast("Product updated")}else{const newId=uid("p");S.products.push({...d,id:newId,sellerId:currentSeller().id,sales:0});logProductActivity(newId,'Product published',{sellerId:currentSeller().id});toast("Product published")}
 const localOk=sePersist();save();if(!localOk&&!ONLINE_READY){toast("Product saved for this session, but browser storage is full. Free browser storage or enable cloud sync before closing.");render();return;}S.draft=null;sePersist();save();window.__skipProductDraftPersist=true;go("dashboard/products");window.__skipProductDraftPersist=false
}
function startNewProduct(){S.draft=null;save();go('dashboard/add')}
function addProductPage(editId=null){
 const r=route(),is2=r.startsWith("dashboard/add2"),is3=r.startsWith("dashboard/add3"),step=is3?3:is2?2:1;return productForm(step,editId)
}
function editIdFromRoute(){const r=route();return r.startsWith("dashboard/edit/")?r.split("/")[2]:null}

/* -------------------- ROUTER -------------------- */
function notFound(){return `${header()}<main class="page"><div class="container auth-box"><h2>Page not found</h2><button class="btn primary" onclick="go('home')">Go Home</button></div></main>${footer()}`}
function applyPlatformConfig(){
 const c=ensurePlatformConfig(),b=c.branding||{},cm=c.cms||{};
 document.documentElement.style.setProperty('--brand',b.primaryColor||'#5146e5');
 document.documentElement.style.setProperty('--brand2',b.secondaryColor||'#6d63f5');
 if(b.font)document.body.style.fontFamily=b.font+', Inter, system-ui, sans-serif';
 document.title=(b.websiteName||'Sale Earn')+' — Digital Marketplace';
 document.querySelectorAll('.logo span:not(.logo-mark),.mobile-logo span:not(.logo-mark)').forEach(el=>{if(el.textContent.trim()!=='SE')el.textContent=b.websiteName||'Sale Earn'});
 const r=route();
 if(r==='home'){
   const map={hero:'home-hero',categories:'home-categories',trending:'home-trending', 'top-sellers':'home-trending',subscriptions:'home-subscriptions',testimonials:'home-testimonials',faq:'home-faq'};
   (c.sections||[]).slice().sort((a,b)=>Number(a.order||0)-Number(b.order||0)).forEach(sec=>{const id=map[sec.id];const el=id&&document.getElementById(id);if(el)el.style.display=sec.enabled===false?'none':''});
   const hero=document.querySelector('#home-hero h1'),sub=document.querySelector('#home-hero p');if(hero)hero.textContent=cm.heroTitle||hero.textContent;if(sub)sub.textContent=cm.heroSubtitle||sub.textContent;
 }
 if(c.announcement?.enabled&&c.announcement.message&&!document.querySelector('.platform-announcement')){
   const bar=document.createElement('div');bar.className='platform-announcement';bar.style.cssText='position:sticky;top:0;z-index:1200;padding:10px 16px;text-align:center;background:var(--brand);color:#fff;font-weight:800;font-size:13px';bar.innerHTML='<b>'+esc(c.announcement.title||'Announcement')+'</b> · '+esc(c.announcement.message);document.body.prepend(bar);
 }
}

function guestGate(){
 if(S.currentUser)return false;
 const r=route();
 if(r.startsWith("admin"))return false;
 if(!SUPABASE_READY&&supabaseClient){
   document.getElementById("app").innerHTML=`<main class="page"><div class="container auth-box" style="max-width:560px;margin:70px auto;text-align:center"><div class="logo-mark" style="margin:0 auto 16px">SE</div><h2>Checking your sign-in…</h2><p class="muted">Please wait a moment.</p></div></main>`;
   return true;
 }
 document.getElementById("app").innerHTML=`<main class="page"><div class="container auth-box" style="max-width:560px;margin:70px auto;text-align:center"><div class="logo-mark" style="margin:0 auto 16px">SE</div><h1>Sign in to Sale Earn</h1><p class="muted">Please sign in to continue to the website. Your account is required to access Sale Earn.</p><div class="hero-actions" style="justify-content:center"><button class="btn primary" onclick="openAuth('signin','login')">Sign In</button><button class="btn" onclick="openAuth('signup','login')">Create Account</button></div></div></main>`;
 return true;
}
function render(){
 enforceAdminScore100();
 const __active=document.activeElement;
 const __focusId=__active?.id||'';
 const __focusSelStart=(typeof __active?.selectionStart==='number')?__active.selectionStart:null;
 const __focusSelEnd=(typeof __active?.selectionEnd==='number')?__active.selectionEnd:null;
 const __focusValue=(__active&&'value' in __active)?__active.value:null;
 syncSubscriptionPlans();
 applyTheme();
 try{productStateData(S.currentUser?.sellerId||currentSeller()?.id||"");}catch(e){}
 const r=route();
 const pcfg=ensurePlatformConfig();
 // Sale Earn requires authentication before the website can be used.
 // Keep the existing Supabase/admin/session logic untouched.
 if(!S.currentUser&&!r.startsWith("admin")&&guestGate())return;
 if((r==='account'||r.startsWith('account/'))&&!S.currentUser){document.getElementById("app").innerHTML=`${header()}<main class="page"><div class="container"><div class="auth-box" style="max-width:560px;margin:70px auto;text-align:center"><div class="logo-mark" style="margin:0 auto 16px">SE</div><h1>Sign in to use your account</h1><p class="muted">You can keep exploring Sale Earn without signing in. Sign in only when you want account features, orders or saved items.</p><div class="hero-actions" style="justify-content:center"><button class="btn primary" onclick="openAuth('signin','login')">Sign In</button><button class="btn" onclick="openAuth('signup','login')">Create Account</button></div></div></div></main>${footer()}`;applyPlatformConfig();return;}
 if(r.startsWith('dashboard')&&!S.currentUser){openAuth('signin','seller');return;}
 if(pcfg.features?.maintenanceMode&&r!=="admin"&&!r.startsWith("admin")){document.getElementById("app").innerHTML=`${header()}<main class="page"><div class="container auth-box"><h2>Website Maintenance</h2><p class="muted">Sale Earn is temporarily under maintenance. Please try again later.</p></div></main>${footer()}`;applyPlatformConfig();return}
 if(r.startsWith("admin")&&!isAdmin()){
  // On a hard refresh, Supabase may still be restoring the existing admin
  // session. Do NOT treat the temporary null S.currentUser as a logged-out
  // state, otherwise the admin route opens the Sign In modal before the
  // session restore finishes. Keep the current admin route in a lightweight
  // loading state and let restoreSupabaseSession() render it when ready.
  if(!S.currentUser&&!SUPABASE_READY&&supabaseClient){
    const app=document.getElementById("app");
    if(app)app.innerHTML=`<main class="page"><div class="container auth-box" style="max-width:560px;margin:70px auto;text-align:center"><div class="logo-mark" style="margin:0 auto 16px">SE</div><h2>Restoring Admin Session…</h2><p class="muted">Please wait a moment.</p></div></main>`;
    return;
  }
  // Only show the Admin sign-in gate after the authoritative Supabase
  // session check has completed.
  if(S.currentUser){S.currentUser=null;try{save()}catch(e){}}
  go("home");
  setTimeout(()=>openAuth("signin","admin"),0);
  return;
}
 if(r.startsWith("admin")&&isAdmin()&&!seAdminPwUnlocked()){
  const app=document.getElementById('app');
  if(app)app.innerHTML=`<main class="page"><div class="container auth-box" style="max-width:560px;margin:70px auto;text-align:center"><div class="logo-mark" style="margin:0 auto 16px">SE</div><h1>Admin Password Required</h1><p class="muted">This private Admin area is locked. Enter the Admin password to continue.</p><button class="btn primary" onclick="seAdminPwOpen()">Enter Admin Password</button></div></main>`;
  setTimeout(async()=>{try{if(await seAdminPwNeedsSetup())seAdminPwOpen('setup');else seAdminPwOpen()}catch{seAdminPwOpen()}},0);
  return;
 }
 let out="";
 if(r==="home")out=home();
 else if(r==="market")out=market();
 else if(r==="cart")out=cart();
 else if(r==="account"||r.startsWith("account/"))out=account();
 else if(r==="contact")out=policyPage('contact');
 else if(r.startsWith('policy/'))out=policyPage(r.split('/')[1]);
 else if(r.startsWith("product/"))out=detail(r.split("/")[1]);
 else if(r.startsWith("seller/"))out=sellerProfile(r.split("/")[1]);
 else if(r.startsWith("success/"))out=success(r.split("/")[1]);
 else if(r.startsWith("cancelled/"))out=cancelled(r.split("/")[1]);
 else if(r==="admin")out=adminPage();
 else if(r==="admin/control")out=typeof adminControlCenter==='function'?adminControlCenter():adminPage();
 else if(r==="admin/money")out=adminMoneyOverview();
 else if(r==="admin/emergency")out=adminEmergency();
 else if(r==="admin/risk")out=adminRisk();
 else if(r==="admin/analytics")out=adminAnalytics();
 else if(r==="admin/ranking")out=adminRanking();
 else if(r==="admin/growth")out=adminGrowth();
 else if(r==="admin/smartreviews")out=adminSmartReviews();
 else if(r==="admin/coupons")out=adminCoupons();
 else if(r==="admin/security")out=adminSecurity();
 else if(r==="admin/users")out=adminUsers();
 else if(r.startsWith("admin/user/"))out=adminUserDetail(r.split("/")[2]);
 else if(r==="admin/products")out=adminProducts();
 else if(r.startsWith("admin/product/"))out=adminProductDetail(r.split("/")[2]);
 else if(r==="admin/orders")out=adminOrders();
 else if(r.startsWith("admin/order/"))out=adminOrderDetail(r.split("/")[2]);
 else if(r==="admin/reviews")out=adminReviews();
 else if(r==="admin/sales")out=adminSales();
 else if(r.startsWith("admin/seller/"))out=adminSellerDetail(r.split("/")[2]);
 else if(r==="admin/payouts")out=adminPayouts();
 else if(r==="admin/warnings")out=adminWarnings();
 else if(r==="admin/deleted")out=adminDeleted();
 else if(r==="admin/commission")out=adminCommission();
 else if(r==="admin/audit")out=adminAuditPage();
  else if(r==="admin/mail")out=mailPanel();
 else if(r==="admin/system")out=adminSystem();
 else if(r==="dashboard/overview")out=dashOverview();
 else if(r==="dashboard/products")out=dashProducts();
 else if(r==="dashboard/drafts")out=productManager("drafts");
 else if(r==="dashboard/recycle")out=productManager("recycle");
 else if(r==="dashboard/orders")out=dashOrders();
 else if(r==="dashboard/payouts")out=dashPayouts();
 else if(r==="dashboard/subscription")out=dashSubscription();
 else if(r==="dashboard/ads")out=dashAds();
 else if(r==="dashboard/followers")out=dashFollowers();
 else if(r==="dashboard/referral")out=dashReferral();
 else if(r==="dashboard/settings")out=dashStoreSettings();
 else if(r==="dashboard/growth")out=sellerGrowthDashboard();
 else if(r==="dashboard/warnings")out=dashWarnings();
 else if(r==="dashboard/add")out=productForm(1,null);
 else if(r.startsWith("dashboard/add2")){const q=new URLSearchParams(r.split("?")[1]||"");out=productForm(2,q.get("edit")||null);}
 else if(r.startsWith("dashboard/add3")){const q=new URLSearchParams(r.split("?")[1]||"");out=productForm(3,q.get("edit")||null);}
 else if(r.startsWith("dashboard/edit/"))out=productForm(1,editIdFromRoute());
 else out=notFound();
 document.getElementById("app").innerHTML=out;
 applyPlatformConfig();
 if(r.startsWith("admin")) bindAdminScroll();
 requestAnimationFrame(()=>{
   if(__focusId){const f=document.getElementById(__focusId);if(f){if(__focusValue!==null&&'value' in f&&f.value!==__focusValue)f.value=__focusValue;f.focus({preventScroll:true});if(__focusSelStart!==null&&'setSelectionRange' in f){try{f.setSelectionRange(__focusSelStart,__focusSelEnd)}catch(e){}}}}

 });
 maybeRecycleDraftReminder();
}
function maybeRecycleDraftReminder(){try{if(!S.currentUser||!route().startsWith('dashboard'))return;const sid=currentSeller()?.id;const n=(S.deletedProducts||[]).filter(x=>x.sellerId===sid&&x.recycledFrom==='drafts').length;if(n&&!sessionStorage.getItem('SE_RECYCLE_DRAFT_REMINDER')){sessionStorage.setItem('SE_RECYCLE_DRAFT_REMINDER','1');setTimeout(()=>showPMConfirm('Recycle Bin Drafts',`You have <b>${n}</b> draft(s) in Recycle Bin.`,[`<button class="btn" onclick="closeModal()">Close</button>`,`<button class="btn danger" onclick="closeModal();deleteAllDraftsFromRecycleBin()">Delete All Drafts from Recycle Bin</button>`]),120)}}catch(e){}}
function closeModal(){clearInterval(window.paymentTimer);document.getElementById("modalRoot").innerHTML="";window.pendingBuy=null}
if(!sessionStorage.getItem("SE_NAV_STACK")){saveNavStack([routeNow()])}
/* Startup deferred until Admin Studio is ready. */

(function(){
 const loader=document.getElementById("siteLoader");if(!loader)return;
 let ready=false,shown=false;
 const slowTimer=setTimeout(()=>{if(!ready){shown=true;loader.classList.add("show")}},150);
 function hide(){ready=true;clearTimeout(slowTimer);if(shown){loader.classList.remove("show");setTimeout(()=>loader.remove(),230)}else loader.remove()}
 window.hideSaleEarnLoader=hide;
 window.addEventListener("load",hide,{once:true});
 setTimeout(()=>{if(!ready)hide()},12000);
})();

function filterSaleEarnFaq(query){
 const q=String(query||'').trim().toLowerCase();
 const items=[...document.querySelectorAll('.se-faq-item')];
 let visible=0;
 items.forEach(d=>{const text=d.textContent.toLowerCase();const ok=!q||text.includes(q);d.style.display=ok?'':'none';if(ok)visible++});
 document.querySelectorAll('.se-faq-group').forEach(g=>{const count=[...g.querySelectorAll('.se-faq-item')].filter(x=>x.style.display!=='none').length;g.style.display=count?'':'none'});
 const empty=document.getElementById('faqEmpty');if(empty)empty.style.display=(q&&visible===0)?'block':'none';
}

async function sendContactUsMessage(){
  const userIdEl=document.getElementById('contactUserId');
  const messageEl=document.getElementById('contactMessage');
  const userId=(userIdEl?.value||'').trim();
  const message=(messageEl?.value||'').trim();
  if(!message){
    alert('Please enter your message.');
    messageEl?.focus();
    return;
  }
  const btn=document.getElementById('contactSendBtn');
  if(btn){ btn.disabled=true; btn.dataset.oldText=btn.textContent; btn.textContent='Sending...'; }
  try{
    const endpoint=window.SALE_EARN_CONTACT_ENDPOINT || '/api/contact';
    const res=await fetch(endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        userId,
        message,
        to:"MohitGhasoliya90014@gmail.com"
      })
    });
    if(!res.ok) throw new Error('Contact service unavailable');
    alert('Message sent successfully.');
    if(messageEl) messageEl.value='';
  }catch(err){
    alert('Message could not be sent right now. Please try again later.');
    console.error('Contact Us send failed:',err);
  }finally{
    if(btn){ btn.disabled=false; btn.textContent=btn.dataset.oldText||'Send Message'; }
  }
}


function referralLevelPrice(level){
  return Number((window.REFERRAL_UPGRADE_PRICES||REFERRAL_UPGRADE_PRICES)[Number(level)]||0);
}

function referralCanSelectLevel(level){
  const cur=referralCurrentPercent();
  return Number(level)===cur+1;
}
function referralLevelStatus(level){
  const cur=referralCurrentPercent(), n=Number(level);
  if(n<=cur) return "unlocked";
  if(n===cur+1) return "next";
  return "locked";
}
function referralUpgradeAmountTo(level){
  const cur=referralCurrentPercent(), target=Number(level);
  if(target<=cur) return 0;
  let total=0;
  for(let p=cur+1;p<=target;p++) total+=referralLevelPrice(p);
  return total;
}


/* Referral level-selection rules:
   5% is the starting level; only one next percentage can be purchased at a time.
   The panel may display all levels, but future levels are visually locked. */
function selectReferralUpgradeLevel(level){
  const n=Number(level), cur=referralCurrentPercent();
  if(n<=cur){
    if(typeof openReferralUpgradePanel==="function") return openReferralUpgradePanel(cur+1);
    return;
  }
  if(n!==cur+1){
    alert("Please unlock the levels one by one. Your next available level is "+(cur+1)+"%.");
    return;
  }
  if(typeof openReferralUpgradePanel==="function") openReferralUpgradePanel(n);
  else if(typeof referralUpgradePanel==="function") referralUpgradePanel(n);
}

