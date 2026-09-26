
(function(){
  'use strict';
  function seTagsArray(){
    const el = document.getElementById('tagInput');
    return el ? el.value.split(',').map(x=>x.trim()).filter(Boolean) : [];
  }
  function seSyncHiddenTagInput(arr){
    const el = document.getElementById('tagInput');
    if(el) el.value = arr.join(', ');
    if(window.S && S.draft) S.draft.tags = arr.slice();
  }
  function seRenderTagChips(){
    const wrap = document.getElementById('seTagChips');
    if(!wrap) return;
    const arr = seTagsArray();
    wrap.innerHTML = arr.map((t,i)=>`<span class="se-tag-chip">${esc(t)}<button type="button" onclick="seRemoveTagChip(${i})" aria-label="Remove tag">×</button></span>`).join('');
    const counter = document.getElementById('seTagCounter');
    if(counter) counter.textContent = arr.length + '/3 tags added';
    const typeInput = document.getElementById('seTagTypeInput');
    if(typeInput){
      typeInput.disabled = arr.length >= 3;
      typeInput.placeholder = arr.length >= 3 ? 'Maximum 3 tags reached' : 'Type a tag and press Enter';
    }
  }
  window.seRemoveTagChip = function(i){
    const arr = seTagsArray();
    arr.splice(i,1);
    seSyncHiddenTagInput(arr);
    seRenderTagChips();
  };
  window.seAddTagChipFromInput = function(){
    const input = document.getElementById('seTagTypeInput');
    if(!input || input.disabled) return;
    const text = input.value.trim();
    if(!text) return;
    const arr = seTagsArray();
    if(arr.length >= 3){ toast('Maximum 3 tags allowed'); input.value=''; return; }
    const words = text.split(/\s+/).filter(Boolean);
    if(words.length > 14){ toast('Each tag can have a maximum of 14 words'); return; }
    if(arr.some(t=>t.toLowerCase()===text.toLowerCase())){ input.value=''; return; }
    arr.push(text);
    seSyncHiddenTagInput(arr);
    input.value = '';
    seRenderTagChips();
  };
  function initTagChipUI(){
    const legacy = document.getElementById('tagInput');
    if(!legacy || document.getElementById('seTagChips')) return;
    legacy.style.display = 'none';
    const hint = legacy.nextElementSibling;
    if(hint && hint.classList && hint.classList.contains('char-count')) hint.style.display = 'none';
    const wrap = document.createElement('div');
    wrap.className = 'se-tag-chip-wrap';
    wrap.innerHTML = '<div class="se-tag-chips" id="seTagChips"></div><input id="seTagTypeInput" class="input" placeholder="Type a tag and press Enter" maxlength="80"><small class="small muted" id="seTagCounter" style="display:block;margin-top:4px"></small>';
    legacy.insertAdjacentElement('afterend', wrap);
    const typeInput = wrap.querySelector('#seTagTypeInput');
    typeInput.addEventListener('keydown', function(e){
      if(e.key==='Enter' || e.key===','){
        e.preventDefault();
        window.seAddTagChipFromInput();
      }
    });
    seRenderTagChips();
  }
  const seOldRenderForTags = window.render;
  window.render = function(){
    const r = seOldRenderForTags.apply(this, arguments);
    setTimeout(initTagChipUI, 0);
    return r;
  };
  const seOldAddDraftTag = window.addDraftTag;
  if(seOldAddDraftTag){
    window.addDraftTag = function(t){
      const arr = seTagsArray();
      if(arr.length >= 3){ toast('Maximum 3 tags allowed'); return; }
      seOldAddDraftTag(t);
      setTimeout(seRenderTagChips, 0);
    };
  }
  const seOldAddCategoryTag = window.v22AddCategoryTag;
  if(seOldAddCategoryTag){
    window.v22AddCategoryTag = function(tag){
      const arr = seTagsArray();
      if(arr.length >= 3 && !arr.some(t=>t.toLowerCase()===String(tag).toLowerCase())){ toast('Maximum 3 tags allowed'); return; }
      seOldAddCategoryTag(tag);
      setTimeout(seRenderTagChips, 0);
    };
  }
  setTimeout(initTagChipUI, 0);
})();
