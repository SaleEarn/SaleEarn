
/* Featured products: seller selects from a click-to-open product picker. */
(function(){
  const previousDashStoreSettings = window.dashStoreSettings;
  window.dashStoreSettings = function(){
    const html = previousDashStoreSettings();
    const s = currentSeller();
    if(!s) return html;
    const t = storeTheme(s.id);
    const ownProducts = (S.products||[]).filter(p=>String(p.sellerId)===String(s.id));
    const selected = new Set((t.featuredProducts||[]).map(String));

    const options = ownProducts.length ? ownProducts.map(p=>`
      <label class="featured-product-option">
        <input type="checkbox" class="featured-product-check" value="${esc(p.id)}" ${selected.has(String(p.id))?'checked':''}>
        <span>${esc(p.title||p.id)}${p.price!=null?' · '+money(p.price):''}</span>
      </label>`).join('') : '<div class="muted" style="padding:10px">No products available</div>';

    const selectedNames = ownProducts.filter(p=>selected.has(String(p.id))).map(p=>p.title||p.id);
    const displayText = selectedNames.length ? selectedNames.join(', ') : 'Select products';

    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const input = tpl.content.querySelector('#v19Featured');
    if(input){
      const field = input.closest('.field');
      if(field){
        field.outerHTML = `<div class="field featured-product-picker-field">
          <label>Featured Products</label>
          <input type="hidden" id="v19Featured" value="${esc([...selected].join(','))}">
          <div class="featured-product-picker" id="featuredProductPicker">
            <button type="button" class="featured-product-selectbar" id="featuredProductSelectBar" aria-expanded="false">
              <span id="featuredProductSelectText">${esc(displayText)}</span><span class="featured-product-chevron">⌄</span>
            </button>
            <div class="featured-product-menu" id="featuredProductMenu" hidden>
              <div class="featured-product-menu-head">Select products</div>
              <div class="featured-product-options">${options}</div>
            </div>
          </div>
          <small class="muted">Click the bar to choose one or more of your products.</small>
        </div>`;
      }
    }
    return tpl.innerHTML;
  };

  const previousSaveV19Store = window.saveV19Store;
  window.saveV19Store = function(){
    const hidden = document.getElementById('v19Featured');
    if(!hidden) return previousSaveV19Store();
    const checks = [...document.querySelectorAll('#featuredProductPicker .featured-product-check:checked')];
    const selected = checks.map(x=>x.value).filter(Boolean);
    const s = currentSeller();
    if(!s) return previousSaveV19Store();
    const ownIds = new Set((S.products||[]).filter(p=>String(p.sellerId)===String(s.id)).map(p=>String(p.id)));
    const featured = selected.filter(id=>ownIds.has(String(id)));
    hidden.value = featured.join(',');
    return previousSaveV19Store();
  };

  function bindPicker(){
    const picker=document.getElementById('featuredProductPicker');
    const bar=document.getElementById('featuredProductSelectBar');
    const menu=document.getElementById('featuredProductMenu');
    const text=document.getElementById('featuredProductSelectText');
    const hidden=document.getElementById('v19Featured');
    if(!picker||!bar||!menu||!text||!hidden||bar.dataset.bound==='1') return;
    bar.dataset.bound='1';

    const update=()=>{
      const checked=[...picker.querySelectorAll('.featured-product-check:checked')];
      const names=checked.map(x=>x.closest('label')?.querySelector('span')?.textContent?.trim()||'').filter(Boolean);
      hidden.value=checked.map(x=>x.value).join(',');
      text.textContent=names.length ? names.join(', ') : 'Select products';
    };
    bar.addEventListener('click',()=>{
      const open=!menu.hidden;
      menu.hidden=open;
      bar.setAttribute('aria-expanded',String(!open));
    });
    picker.querySelectorAll('.featured-product-check').forEach(c=>c.addEventListener('change',update));
    document.addEventListener('click',e=>{
      if(!picker.contains(e.target) && !menu.hidden){
        menu.hidden=true;
        bar.setAttribute('aria-expanded','false');
      }
    });
    update();
  }

  const oldRender=window.render;
  window.render=function(){
    const r=oldRender.apply(this,arguments);
    setTimeout(bindPicker,0);
    return r;
  };
  setTimeout(bindPicker,0);
})();
