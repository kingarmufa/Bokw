(() => {
  const form=document.querySelector('.mt-form'); if(!form)return;
  const inputs=()=>Array.from(form.querySelectorAll('input[name=services]'));
  function update(){document.getElementById('mt-count').textContent=inputs().filter(x=>x.checked).length+' layanan dipilih';inputs().forEach(x=>x.closest('.mt-service').classList.toggle('selected',x.checked));}
  form.querySelectorAll('[data-select-services]').forEach(b=>b.addEventListener('click',()=>{inputs().forEach(x=>x.checked=b.dataset.selectServices==='all');update();}));
  form.addEventListener('change',update);
  form.addEventListener('submit',e=>{if(form.elements.enabled.checked&&form.elements.mode.value==='services'&&!inputs().some(x=>x.checked)){e.preventDefault();alert('Pilih minimal satu layanan untuk maintenance.');inputs()[0].focus();}});
  update();
})();
