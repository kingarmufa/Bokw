(() => {
  'use strict';
  const $ = id => document.getElementById('nd-' + id);
  if (!$('server')) return;
  let revision = 0, products = [];
  async function get(path, params) {
    const r = await fetch(path + '?' + new URLSearchParams(params));
    if (!r.ok) throw Error('Gagal memuat. Pastikan sudah login dan Nokos aktif.');
    const j = await r.json();
    if (!j.success) throw Error(j.error || 'Gagal memuat pilihan.');
    return j.data;
  }
  function reset() {
    revision++; products = [];
    $('product').replaceChildren(new Option('Muat harga dulu', ''));
    $('product').disabled = true;
    $('load').disabled = !$('service').value;
    $('code').textContent = 'Pilih produk untuk membuat contoh POST /api/nokos/order.';
    $('message').textContent = '';
  }
  $('server').addEventListener('change', async () => {
    reset(); const rev = revision;
    $('service').disabled = true; $('load').disabled = true; $('country').disabled = true;
    $('service').replaceChildren(new Option('Pilih layanan', ''));
    $('operator-wrap').hidden = $('server').value !== 'premium';
    $('operator').value = 'any';
    if (!$('server').value) { $('country').disabled = false; return; }
    $('message').textContent = 'Memuat layanan…';
    try {
      const rows = await get('/nokos/services', {server: $('server').value});
      if (rev !== revision) return;
      rows.forEach(s => $('service').add(new Option(s.name, s.code)));
      $('service').disabled = !rows.length;
      $('message').textContent = rows.length ? '' : 'Layanan belum tersedia.';
    } catch(e) { if (rev === revision) $('message').textContent = e.message; }
    finally { if (rev === revision) $('country').disabled = false; }
  });
  $('service').addEventListener('change', reset);
  $('country').addEventListener('change', reset);
  $('load').addEventListener('click', async () => {
    reset(); const rev = revision;
    $('load').disabled = true; $('message').textContent = 'Memuat harga…';
    try {
      const rows = await get('/nokos/products', {server:$('server').value,service:$('service').value,country:$('country').value});
      if (rev !== revision) return;
      products = rows;
      $('product').replaceChildren(new Option('Pilih harga', ''));
      rows.forEach((p, i) => $('product').add(new Option('Rp ' + Number(p.price).toLocaleString('id-ID') + ' • Stok ' + p.stock + ' • ' + p.server, String(i))));
      $('product').disabled = !rows.length;
      $('message').textContent = rows.length ? 'Pilih harga untuk mengisi ID otomatis.' : 'Stok kosong. Pilih server, layanan, atau negara lain.';
    } catch(e) { if (rev === revision) $('message').textContent = e.message; }
    finally { if (rev === revision) $('load').disabled = false; }
  });
  function example() {
    if ($('product').value === '') return;
    const p = products[Number($('product').value)]; if (!p) return;
    const body = {apikey:'API_KEY_WEBSITE_ANDA',quote_id:p.quote_id};
    if ($('server').value === 'premium') body.operator = $('operator').value;
    $('code').textContent = 'POST ' + location.origin + '/api/nokos/order\nContent-Type: application/json\n\n' + JSON.stringify(body, null, 2);
  }
  $('product').addEventListener('change', example);
  $('operator').addEventListener('change', example);
})();
