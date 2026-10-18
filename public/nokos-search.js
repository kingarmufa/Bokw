(() => {
  'use strict';
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  document.querySelectorAll('select[data-nokos-search]').forEach(select => {
    if (select.dataset.searchReady) return;
    select.dataset.searchReady = 'true';
    const box = document.createElement('div'); box.className = 'bn-search';
    const label = document.createElement('label'); label.htmlFor = select.id + '-search';
    label.className = 'bn-search-label'; label.textContent = 'Cari ' + select.dataset.nokosSearch;
    const input = document.createElement('input'); input.type = 'search'; input.id = label.htmlFor;
    input.placeholder = 'Ketik nama atau kode…'; input.autocomplete = 'off';
    const status = document.createElement('span'); status.className = 'bn-search-status'; status.setAttribute('role','status');
    const results = document.createElement('div'); results.className = 'bn-search-results'; results.id = select.id + '-results';
    results.setAttribute('role','group'); results.setAttribute('aria-label','Hasil pencarian ' + select.dataset.nokosSearch);
    input.setAttribute('aria-controls', results.id); results.hidden = true;
    box.append(label, input, status, results); select.before(box);
    function clear() { input.value = ''; results.replaceChildren(); results.hidden = true; status.textContent = ''; }
    function search() {
      results.replaceChildren();
      const q = normalize(input.value);
      if (!q || select.disabled) { results.hidden = true; status.textContent = ''; return; }
      const matches = Array.from(select.options).filter(o => o.value && !o.disabled && normalize(o.textContent + ' ' + o.value).includes(q));
      status.textContent = matches.length ? matches.length + ' pilihan ditemukan' : 'Tidak ditemukan. Coba nama atau kode lain.';
      results.hidden = !matches.length;
      matches.forEach(option => {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = option.textContent + (option.textContent.toLowerCase().includes('(' + option.value.toLowerCase() + ')') ? '' : ' (' + option.value + ')');
        button.addEventListener('click', () => {
          if (select.disabled || !Array.from(select.options).includes(option)) return;
          select.value = option.value;
          select.dispatchEvent(new Event('change', {bubbles:true}));
          clear(); input.focus();
        });
        results.append(button);
      });
    }
    input.addEventListener('input', search);
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { clear(); e.preventDefault(); }
      if (e.key === 'ArrowDown' && !results.hidden) { results.querySelector('button')?.focus(); e.preventDefault(); }
      if (e.key === 'Enter') { e.preventDefault(); if (!results.hidden) results.querySelector('button')?.focus(); }
    });
    select.addEventListener('change', clear);
    input.disabled = select.disabled;
    new MutationObserver(records => {
      input.disabled = select.disabled;
      if (select.disabled || records.some(r => r.type === 'childList')) clear();
    }).observe(select, {childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
  });
})();
