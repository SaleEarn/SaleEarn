
(function(){
  'use strict';
  const originalAdminSales=adminSales;
  function moneyForOrder(o){return Number(o?.amount||0)}
  function netForOrder(o){return o?.netSellerAmount!=null?Number(o.netSellerAmount):moneyForOrder(o)*(1-Number(o?.platformFeeRate??.20))}
  function sellerProducts(sid,orders){
    const grouped={};
    orders.filter(o=>String(o.sellerId||'')===String(sid)).forEach(o=>{
      const pid=String(o.productId||'deleted');
      if(!grouped[pid])grouped[pid]={orders:0,gross:0,net:0};
      grouped[pid].orders++;
      grouped[pid].gross+=moneyForOrder(o);
      grouped[pid].net+=netForOrder(o);
    });
    return Object.entries(grouped).map(([pid,v])=>({pid,...v,product:product(pid)})).sort((a,b)=>b.gross-a.gross);
  }
  function salesProductCard(x){
    const p=x.product,title=p?.title||'Deleted product', image=p?.image;
    return `<div class="sales-product-row"><div class="sales-product-thumb">${image?`<img src="${esc(image)}" alt="${esc(title)}">`:'🧩'}</div><div class="sales-product-info"><h4 title="${esc(title)}">${esc(title)}</h4><div class="small muted">${p?`${esc(p.category||'Product')} · ${esc(p.id)}`:'Product no longer live'}</div><div class="sales-product-money"><span>Orders <b>${x.orders}</b></span><span>Gross <b>${money(x.gross)}</b></span><span>Net <b>${money(x.net)}</b></span></div>${p?`<button class="btn sales-product-open" onclick="adminNav('product/${esc(encodeURIComponent(p.id))}')">Open Product</button>`:''}</div></div>`;
  }
  adminSales=function(){
    const st=adminStats(),orders=st.orders,today=new Date().toDateString();
    const todayOrders=orders.filter(x=>new Date(x.date).toDateString()===today);
    const bySeller={};
    orders.forEach(o=>{const sid=String(o.sellerId||'unknown');if(!bySeller[sid])bySeller[sid]={orders:0,gross:0,net:0};bySeller[sid].orders++;bySeller[sid].gross+=moneyForOrder(o);bySeller[sid].net+=netForOrder(o)});
    const sellerCards=Object.entries(bySeller).sort((a,b)=>b[1].gross-a[1].gross).map(([sid,v])=>{
      const ss=seller(sid),items=sellerProducts(sid,orders);
      return `<section class="sales-seller-card"><div class="sales-seller-head"><div class="sales-seller-name"><h3>@${esc(sid)}</h3><div class="small muted">${esc(ss?.name||'Seller store')}</div><div class="small muted">Owner: ${esc(ss?.owner||'-')}</div></div><div class="sales-seller-stats"><div class="sales-seller-stat"><small>Orders</small><b>${v.orders}</b></div><div class="sales-seller-stat"><small>Gross sales</small><b>${money(v.gross)}</b></div><div class="sales-seller-stat"><small>Net earnings</small><b>${money(v.net)}</b></div><button class="btn" onclick="adminNav('seller/${esc(encodeURIComponent(sid))}')">Seller Details</button></div></div><div class="sales-products-title">Products sold (${items.length})</div><div class="sales-products">${items.map(salesProductCard).join('')||'<div class="sales-empty">No product records found.</div>'}</div></section>`;
    }).join('');
    return adminLayout('sales','Sales & Earnings',`<div class="admin-kpis"><div class="admin-kpi"><span>Total Sales</span><b>${money(st.sales)}</b></div><div class="admin-kpi"><span>Net Seller Earnings</span><b>${money(st.earnings)}</b></div><div class="admin-kpi"><span>Today's Sales</span><b>${money(todayOrders.reduce((a,x)=>a+moneyForOrder(x),0))}</b></div><div class="admin-kpi"><span>Today's Orders</span><b>${todayOrders.length}</b></div></div><div class="admin-card"><div class="section-head"><div><h2>Seller-wise Sales</h2><div class="sub">Every sold product is shown as a separate card with image, title, orders and earnings.</div></div><span class="admin-pill success">${Object.keys(bySeller).length} Sellers</span></div><div class="sales-seller-grid">${sellerCards||'<div class="sales-empty">No successful sales.</div>'}</div></div>`);
  };
  setTimeout(()=>{if(route()==='admin/sales')render()},0);
})();
