'use strict';
// Sumber tunggal dokumentasi mesin-baca (JSON) + prompt AI siap salin.
// Dipakai oleh: GET /docs.json (unduh) dan views/docs.ejs (bagian "Prompt AI").
// Token {{BASE_URL}} dan {{SPEC_URL}} diganti saat dirender/diunduh.

const APIKEY = { name: 'apikey', in: 'query', type: 'string', required: true, description: 'API Key akun (menu Profil). Alternatif: header x-api-key, atau parameter api_key.' };
const p = (name, type, required, description) => ({ name, in: 'query', type, required, description });

const ENDPOINTS = [
  // ---- Saldo & Topup ----
  { id: 'balance', group: 'Saldo & Topup', title: 'Cek Saldo', method: 'GET', path: '/api/balance', params: [APIKEY],
    response_example: { username: 'your_username', email: 'name@gmail.com', balance: 150000 } },
  { id: 'invoice_create', group: 'Saldo & Topup', title: 'Buat Invoice (QRIS)', method: 'GET', path: '/api/invoice',
    description: 'Membuat invoice deposit QRIS. Minimal sesuai pengaturan admin, maksimal Rp 1.000.000.',
    params: [APIKEY, p('amount', 'integer', true, 'Nominal deposit (Rupiah).')],
    response_example: { success: true, invoice_id: '64c8d9e...', amount: 50000, fee: 500, total: 50500, qris_image: 'https://...', payment_link: 'https://.../payment/64c8d9e...', expired_at: '2025-01-01 12:00:00', callback_url: '' } },
  { id: 'invoice_status', group: 'Saldo & Topup', title: 'Cek Status Invoice', method: 'GET', path: '/api/invoice/status',
    params: [APIKEY, p('invoice_id', 'string', true, 'ID dari endpoint Buat Invoice (alias: id).')],
    response_example: { invoice_id: '64c8d9e...', amount: 50000, fee: 500, total: 50500, status: 'paid', qris_image: 'https://...', payment_link: 'https://...', expired_at: '2025-01-01 12:00:00', created_at: '2025-01-01 11:30:00' } },

  // ---- Penarikan ----
  { id: 'withdraw_methods', group: 'Penarikan', title: 'Metode Withdraw', method: 'GET', path: '/api/withdraw/methods', params: [APIKEY],
    response_example: { manual_methods: [{ name: 'Dana', method: 'dana', fee: 100, min: 10000, max: 1000000 }], instant_methods: [{ name: 'Dana', method: 'dana', fee: 100, open_denom: false, products: [{ code: 'd10', amount: 10000 }] }, { name: 'DANA Bebas', method: 'dana bebas', fee: 100, open_denom: true, min: 10000, max: 1000000 }] } },
  { id: 'withdraw_create', group: 'Penarikan', title: 'Melakukan Withdraw', method: 'GET', path: '/api/withdraw',
    params: [APIKEY, p('amount', 'integer', true, 'Nominal penarikan. Untuk instant metode open_denom:true (Bebas Nominal) bebas di antara min-max metode; untuk instant nominal tetap harus cocok salah satu produk.'), p('method', 'string', true, 'Kode metode dari endpoint Metode Withdraw.'), p('account_number', 'string', true, 'Nomor rekening / e-wallet tujuan.'), p('instant', 'boolean', false, 'Default false (manual, diproses admin).')],
    response_example: { success: true, message: 'Permintaan penarikan berhasil diajukan.', data: { id: 'WDc4e3f2a1b2c3', amount: 50000, fee: 1000, method: 'Dana', account_number: '08123456789', status: 'pending', created_at: '2025-01-01T12:00:00.000Z' } } },
  { id: 'withdraw_status', group: 'Penarikan', title: 'Cek Status Withdraw', method: 'GET', path: '/api/withdraw/status',
    params: [APIKEY, p('id', 'string', true, 'ID withdraw.')],
    response_example: { id: 'WDc4e3f2a1b2c3', amount: 50000, fee: 1000, method: 'Dana', account_number: '08123456789', instant: false, status: 'success', admin_note: null, created_at: '2025-01-01T12:00:00.000Z', completed_at: '2025-01-01T12:30:00.000Z' } },

  // ---- Layanan: Nokos / Dibanana ----
  { id: 'nokos_servers', group: 'Nokos', title: 'Pilih Server', method: 'GET', path: '/api/nokos/servers', params: [APIKEY] },
  { id: 'nokos_countries', group: 'Nokos', title: 'Daftar Lengkap Negara', method: 'GET', path: '/api/nokos/countries', params: [APIKEY], description: 'Daftar lengkap 249 negara/wilayah ISO ditambah Kosovo (xk). Field code dipakai untuk request; Britania Raya memakai uk sesuai dokumentasi provider. Ketersediaan dan stok mengikuti server/layanan.' },
  { id: 'nokos_services', group: 'Nokos', title: 'Layanan per Server', method: 'GET', path: '/api/nokos/services', params: [APIKEY, p('server', 'string', true, 'ekonomi, premium, khusus, atau wa_luar.')] },
  { id: 'nokos_products', group: 'Nokos', title: 'Harga dan Stok', method: 'GET', path: '/api/nokos/products', params: [APIKEY, p('server', 'string', true, 'Server terpilih.'), p('service', 'string', true, 'Kode dari services; server khusus dapat berupa angka dalam string.'), p('country', 'string', true, 'Kode negara, mis. id, my, sg, us, uk.')], response_example: {success:true,data:[{id:'opaque-id-dari-provider',quote_id:'abcdef0123456789abcdef0123456789abcd',price:5400,stock:318,server:'ekonomi'}]} },
  { id: 'nokos_order', group: 'Nokos', title: 'Beli Nomor', method: 'POST', path: '/api/nokos/order', params: [APIKEY, p('quote_id', 'string', true, 'Dari products, berlaku 5 menit untuk akun yang sama. Harga rupiah sudah termasuk markup.'), p('operator', 'string', false, 'Premium saja: any, telkomsel, indosat, axis, three, smartfren, byu.')], response_example: {success:true,data:{_id:'NOKOSB...',phoneNumber:'6281234567890',status:'ACTIVE',sellPrice:5400}} },
  { id: 'nokos_status', group: 'Nokos', title: 'Cek OTP', method: 'GET', path: '/api/nokos/status', params: [APIKEY, p('id', 'string', true, 'ID lokal _id dari order. Poll setiap 3–5 detik. OTP pertama: otpCode, kedua: otpCode2.')] },
  { id: 'nokos_cancel', group: 'Nokos', title: 'Batalkan Nomor', method: 'POST', path: '/api/nokos/cancel', params: [APIKEY, p('id', 'string', true, 'ID lokal. Minimal 120 detik, belum ada OTP. Refund satu kali ke saldo asal.')] },
  { id: 'nokos_resend', group: 'Nokos', title: 'Minta OTP Kedua', method: 'POST', path: '/api/nokos/resend', params: [APIKEY, p('id', 'string', true, 'ID lokal. Setelah OTP pertama; maksimal sekali, tanpa biaya tambahan.')] },

  // ---- Layanan: Gacha Nokos (butuh approval) ----
  { id: 'gacha_status', group: 'Gacha Nokos', access: 'Hanya akun yang disetujui admin', title: 'Cek Status Akses', method: 'GET', path: '/api/gacha-nokos/status', params: [APIKEY] },
  { id: 'gacha_tarik', group: 'Gacha Nokos', access: 'Hanya akun yang disetujui admin', title: 'Tarik Nomor Acak', method: 'POST', path: '/api/gacha-nokos/tarik', params: [APIKEY],
    description: 'Saldo terpotong sesuai biaya per-tarik yang diset admin (0 = gratis).' },
  { id: 'gacha_otp', group: 'Gacha Nokos', access: 'Hanya akun yang disetujui admin', title: 'Cek OTP', method: 'GET', path: '/api/gacha-nokos/otp', params: [APIKEY, p('id', 'string', true, 'ID transaksi dari Tarik.')] },
  { id: 'gacha_release', group: 'Gacha Nokos', access: 'Hanya akun yang disetujui admin', title: 'Lepas Nomor', method: 'POST', path: '/api/gacha-nokos/release', params: [APIKEY, p('id', 'string', true, 'ID transaksi yang ingin dilepas lebih awal.')] },
  { id: 'gacha_riwayat', group: 'Gacha Nokos', access: 'Hanya akun yang disetujui admin', title: 'Riwayat Tarik', method: 'GET', path: '/api/gacha-nokos/riwayat', params: [APIKEY] },

  // ---- Layanan: Fix No / Unban WA (butuh akses) ----
  { id: 'fixno_status', group: 'Fix No / Unban WA', access: 'Hanya akun dengan akses Fix No', title: 'Cek Status Akses & Paket Global', method: 'GET', path: '/api/fix-no/status', params: [APIKEY] },
  { id: 'fixno_paket', group: 'Fix No / Unban WA', access: 'Hanya akun dengan akses Fix No', title: 'Daftar Paket Sender Global', method: 'GET', path: '/api/fix-no/paket', params: [APIKEY] },
  { id: 'fixno_kirim', group: 'Fix No / Unban WA', access: 'Hanya akun dengan akses Fix No', title: 'Kirim Permohonan', method: 'POST', path: '/api/fix-no/kirim',
    params: [APIKEY,
      { name: 'jenis', in: 'body', type: 'string', required: true, description: 'fix_merah atau unban.' },
      { name: 'phone_number', in: 'body', type: 'string', required: true, description: 'Nomor WhatsApp yang kena merah/banned.' },
      { name: 'sender_type', in: 'body', type: 'string', required: true, description: 'private atau global.' },
      { name: 'private_email', in: 'body', type: 'string', required: false, description: 'Wajib jika sender_type = private (Gmail).' },
      { name: 'private_password', in: 'body', type: 'string', required: false, description: 'Wajib jika sender_type = private (App Password).' }] },
  { id: 'fixno_cek', group: 'Fix No / Unban WA', access: 'Hanya akun dengan akses Fix No', title: 'Cek Status Pengiriman', method: 'GET', path: '/api/fix-no/cek/{id}', params: [APIKEY, { name: 'id', in: 'path', type: 'string', required: true, description: 'ID permohonan.' }] },
  { id: 'fixno_riwayat', group: 'Fix No / Unban WA', access: 'Hanya akun dengan akses Fix No', title: 'Riwayat Permohonan', method: 'GET', path: '/api/fix-no/riwayat', params: [APIKEY] },

  // ---- Layanan: Panel Hosting ----
  { id: 'ptero_panels', group: 'Panel Hosting', title: 'Daftar Server Panel', method: 'GET', path: '/api/pterodactyl/panels', params: [APIKEY] },
  { id: 'ptero_packages', group: 'Panel Hosting', title: 'Daftar Paket', method: 'GET', path: '/api/pterodactyl/packages', params: [APIKEY, p('panel_id', 'string', false, 'Filter paket milik satu server panel.')] },
  { id: 'ptero_eggs', group: 'Panel Hosting', title: 'Daftar Egg', method: 'GET', path: '/api/pterodactyl/eggs',
    params: [APIKEY, p('panel_id', 'string', true, 'Dari Daftar Server Panel.'), p('package_id', 'string', false, 'Dari Daftar Paket; egg mengikuti Nest & egg default paket.')] },
  { id: 'ptero_order', group: 'Panel Hosting', title: 'Beli Panel', method: 'GET', path: '/api/pterodactyl/order',
    params: [APIKEY, p('panel_id', 'string', true, 'Dari Daftar Server Panel.'), p('package_id', 'string', true, 'Dari Daftar Paket.'), p('username', 'string', true, 'Huruf/angka/underscore, 3-20 karakter.'), p('email', 'string', true, 'Email pemilik akun panel.'), p('password', 'string', false, '8-32 karakter tanpa spasi; jika kosong dibuatkan otomatis dan dikembalikan di response.'), p('egg_id', 'string', false, 'Opsional; dibaca server, lihat Daftar Egg.')] },
  { id: 'ptero_status', group: 'Panel Hosting', title: 'Cek Status Panel', method: 'GET', path: '/api/pterodactyl/status', params: [APIKEY, p('id', 'string', true, 'ID transaksi dari Beli Panel.')] },
  { id: 'ptero_claim', group: 'Panel Hosting', title: 'Klaim Garansi', method: 'GET', path: '/api/pterodactyl/claim-warranty', params: [APIKEY, p('id', 'string', true, 'ID transaksi.')] },

  // ---- Layanan: Aplikasi Premium ----
  { id: 'premium_products', group: 'Aplikasi Premium', title: 'Daftar Produk Premium', method: 'GET', path: '/api/premium/products', params: [APIKEY] },
  { id: 'premium_stock', group: 'Aplikasi Premium', title: 'Cek Stok', method: 'GET', path: '/api/premium/stock', params: [APIKEY, p('product_id', 'integer', true, 'Dari Daftar Produk.')] },
  { id: 'premium_order', group: 'Aplikasi Premium', title: 'Buat Pesanan Premium', method: 'GET', path: '/api/premium/order', params: [APIKEY, p('product_id', 'integer', true, 'Dari Daftar Produk.'), p('qty', 'integer', false, 'Default 1.')] },
  { id: 'premium_status', group: 'Aplikasi Premium', title: 'Cek Status Premium', method: 'GET', path: '/api/premium/status', params: [APIKEY, p('id', 'string', true, 'ID transaksi dari Buat Pesanan.')] },

  // ---- Layanan: Suntik Sosmed ----
  { id: 'sosmed_services', group: 'Suntik Sosmed', title: 'Daftar Layanan Sosmed', method: 'GET', path: '/api/sosmed/services', params: [APIKEY] },
  { id: 'sosmed_order', group: 'Suntik Sosmed', title: 'Buat Pesanan Sosmed', method: 'GET', path: '/api/sosmed/order',
    params: [APIKEY, p('service_id', 'integer', true, 'Dari Daftar Layanan.'), p('target', 'string', true, 'Link/username/ID target.'), p('quantity', 'integer', true, 'Harus di antara min/max layanan.')] },
  { id: 'sosmed_status', group: 'Suntik Sosmed', title: 'Cek Status Sosmed', method: 'GET', path: '/api/sosmed/status', params: [APIKEY, p('id', 'string', true, 'ID transaksi.')] },
  { id: 'sosmed_refill', group: 'Suntik Sosmed', title: 'Ajukan Refill', method: 'GET', path: '/api/sosmed/refill', params: [APIKEY, p('id', 'string', true, 'ID transaksi Suntik Sosmed (bukan ID refill).')] },
  { id: 'sosmed_refill_status', group: 'Suntik Sosmed', title: 'Cek Status Refill', method: 'GET', path: '/api/sosmed/refill/status', params: [APIKEY, p('id', 'string', true, 'ID transaksi Suntik Sosmed (bukan ID refill).')] },

  // ---- Produk & Reseller (role panel) ----
  { id: 'produk_list', group: 'Produk & Reseller', access: 'Khusus role Reseller / Admin Panel', title: 'Daftar Produk', method: 'GET', path: '/api/produk/list', params: [APIKEY] },
  { id: 'produk_beli', group: 'Produk & Reseller', access: 'Khusus role Reseller / Admin Panel', title: 'Beli Produk', method: 'GET', path: '/api/produk/beli', params: [APIKEY, p('id', 'string', true, 'ID produk dari Daftar Produk (alias: produk_id).')] },
  { id: 'produk_status', group: 'Produk & Reseller', access: 'Khusus role Reseller / Admin Panel', title: 'Cek Status Produk', method: 'GET', path: '/api/produk/status', params: [APIKEY, p('id', 'string', true, 'order_id dari Beli Produk (alias: order_id).')] },
  { id: 'panel_servers', group: 'Produk & Reseller', access: 'Khusus role Reseller / Admin Panel', title: 'Daftar Server Panel Role', method: 'GET', path: '/api/panel/servers', params: [APIKEY] },
  { id: 'panel_eggs', group: 'Produk & Reseller', access: 'Khusus role Reseller / Admin Panel', title: 'Daftar Egg Server', method: 'GET', path: '/api/panel/eggs', params: [APIKEY, p('slot', 'integer', true, '1, 2, atau 3 dari Daftar Server.')] },
  { id: 'panel_add_server', group: 'Produk & Reseller', access: 'Khusus role Reseller', title: 'Tambah Server', method: 'POST', path: '/api/panel/add-server',
    params: [APIKEY, { name: 'slot', in: 'body', type: 'integer', required: true, description: '1, 2, atau 3.' }, { name: 'account_id', in: 'body', type: 'integer', required: true, description: 'ID user Pterodactyl yang sudah dibuat.' }, { name: 'egg_id', in: 'body', type: 'integer', required: false, description: 'Jika kosong/tidak valid, memakai egg default server.' }] },
  { id: 'panel_create_admin', group: 'Produk & Reseller', access: 'Khusus role Admin Panel', title: 'Buat Akun Admin Panel', method: 'POST', path: '/api/panel/create-admin',
    params: [APIKEY, { name: 'slot', in: 'body', type: 'integer', required: true, description: 'Server tujuan.' }, { name: 'username', in: 'body', type: 'string', required: true, description: 'Huruf/angka/underscore, 3-20 karakter.' }, { name: 'email', in: 'body', type: 'string', required: true, description: 'Email akun admin.' }] }
];

// Voucher applies only to paid service purchases, never balance operations.
const VOUCHER_ROUTES = new Set(['/api/nokos/order', '/api/gacha-nokos/tarik', '/api/pterodactyl/order', '/api/premium/order', '/api/sosmed/order', '/api/produk/beli']);
ENDPOINTS.filter(e => VOUCHER_ROUTES.has(e.path)).forEach(e => e.params.push(p('voucherCode', 'string', false, 'Kode voucher aktif untuk layanan ini, contoh VOCHER10. Harga dipotong sesuai persen voucher. Top up, penarikan, dan transfer saldo tidak termasuk.')));

const WEBHOOK = {
  description: 'Jika Callback URL diisi di Profil, server mengirim POST JSON ke URL tersebut (timeout 5 detik, tanpa retry) setiap ada perubahan status.',
  method: 'POST',
  content_type: 'application/json',
  body_shape: { event: 'string', data: 'object', timestamp: 'ISO 8601' },
  events: {
    'deposit.paid': { invoice_id: 'string', amount: 'integer', fee: 'integer', total: 'integer', status: 'paid', balance_after: 'integer' },
    'withdraw.success': { withdraw_id: 'string', amount: 'integer', fee: 'integer', method: 'string', status: 'success', balance_after: 'integer' },
    'withdraw.rejected': { withdraw_id: 'string', amount: 'integer', fee: 'integer', method: 'string', reason: 'string', status: 'rejected', balance_after: 'integer' }
  },
  note: 'Selalu verifikasi ulang status lewat GET /api/invoice/status sebelum memberi barang/saldo; jangan hanya percaya isi webhook.'
};

const AI_PROMPTS = [
  {
    id: 'website-lengkap',
    title: 'Website Payment Gateway Lengkap',
    description: 'Frontend + backend: checkout QRIS, status otomatis, dan halaman saldo.',
    prompt: [
      'Buatkan website payment gateway (checkout QRIS) yang terhubung ke API AVERPAY di {{BASE_URL}}.',
      '',
      'Dokumentasi lengkap (JSON): {{SPEC_URL}}',
      'Baca dokumentasi itu dulu dan ikuti persis nama endpoint, parameter, dan format response-nya. Jangan mengarang endpoint.',
      '',
      'Fitur yang saya mau:',
      '1. Halaman checkout: input nominal -> panggil GET /api/invoice -> tampilkan gambar QRIS (qris_image), total bayar, dan hitung mundur sampai expired_at.',
      '2. Cek status otomatis tiap 5 detik lewat GET /api/invoice/status sampai status = paid atau kedaluwarsa, lalu tampilkan halaman sukses.',
      '3. Halaman dashboard: saldo (GET /api/balance) dan riwayat invoice yang dibuat lewat website ini.',
      '4. Endpoint webhook (POST /webhook/averpay) untuk menerima event deposit.paid; verifikasi ulang ke /api/invoice/status sebelum menandai lunas.',
      '',
      'Aturan penting:',
      '- API Key HANYA dipakai di backend (simpan di file .env), jangan pernah muncul di kode frontend.',
      '- Browser memanggil backend saya, backend saya yang memanggil API AVERPAY.',
      '- Validasi nominal di server. Tampilkan pesan error yang ramah dari field "error".',
      '- Gunakan Node.js + Express dan HTML/CSS/JS biasa. Beri struktur folder, isi tiap file, dan cara menjalankannya.'
    ].join('\n')
  },
  {
    id: 'integrasi-checkout',
    title: 'Integrasi Checkout ke Toko yang Sudah Ada',
    description: 'Tambahkan pembayaran QRIS ke aplikasi/toko online milik kamu.',
    prompt: [
      'Saya sudah punya aplikasi toko online. Tambahkan pembayaran QRIS memakai API AVERPAY ({{BASE_URL}}).',
      'Dokumentasi (JSON): {{SPEC_URL}}',
      '',
      'Yang perlu dibuat:',
      '- Fungsi createInvoice(orderId, amount) memanggil GET /api/invoice, simpan invoice_id di tabel pesanan.',
      '- Fungsi checkInvoice(invoiceId) memanggil GET /api/invoice/status.',
      '- Route webhook menerima POST {event, data, timestamp}. Untuk event deposit.paid, cari pesanan berdasarkan invoice_id, verifikasi ulang lewat checkInvoice, lalu ubah status pesanan menjadi "dibayar" (idempotent: aman dipanggil dua kali).',
      '- Cron/job ulang untuk pesanan pending yang webhook-nya tidak masuk.',
      '',
      'Bahasa/framework saya: [ISI: mis. Laravel / Express / Next.js / Flask]. Berikan kode lengkap yang siap tempel beserta contoh .env. API Key tidak boleh bocor ke frontend.'
    ].join('\n')
  },
  {
    id: 'bot-topup',
    title: 'Bot Telegram / WhatsApp Top-up',
    description: 'Bot yang bisa cek saldo, buat QRIS, dan cek status pembayaran.',
    prompt: [
      'Buatkan bot [ISI: Telegram / WhatsApp] yang terhubung ke API AVERPAY di {{BASE_URL}}.',
      'Dokumentasi (JSON): {{SPEC_URL}}',
      '',
      'Perintah bot:',
      '- /saldo -> GET /api/balance',
      '- /topup <nominal> -> GET /api/invoice, kirim gambar QRIS dan total bayar',
      '- /cek <invoice_id> -> GET /api/invoice/status',
      '- Otomatis kirim notifikasi ke chat begitu invoice berstatus paid (polling tiap 5-10 detik, berhenti saat expired).',
      '',
      'API Key disimpan di .env. Tambahkan penanganan error dari field "error" dan rate limit sederhana per pengguna. Berikan kode lengkap + cara menjalankan.'
    ].join('\n')
  },
  {
    id: 'dashboard-merchant',
    title: 'Dashboard Merchant + Withdraw',
    description: 'Panel untuk memantau saldo, membuat invoice, dan menarik saldo.',
    prompt: [
      'Buatkan dashboard merchant sederhana di atas API AVERPAY ({{BASE_URL}}). Dokumentasi (JSON): {{SPEC_URL}}',
      '',
      'Halaman:',
      '1. Ringkasan: saldo dari GET /api/balance.',
      '2. Buat invoice: nominal -> GET /api/invoice, tampilkan QRIS dan status live.',
      '3. Withdraw: ambil GET /api/withdraw/methods, tampilkan fee/min/max per metode, lalu GET /api/withdraw; halaman status memakai GET /api/withdraw/status.',
      '4. Penerima webhook untuk deposit.paid, withdraw.success, withdraw.rejected yang memperbarui tampilan.',
      '',
      'Semua panggilan API lewat backend (API Key di .env). Validasi min/max withdraw dan nominal sebelum kirim. Berikan struktur project dan kode lengkap.'
    ].join('\n')
  },
  {
    id: 'toko-otomatis',
    title: 'Toko Digital Otomatis (Premium / Nokos / Sosmed)',
    description: 'Jual ulang layanan AVERPAY dengan alur beli otomatis.',
    prompt: [
      'Buatkan toko digital otomatis yang menjual ulang layanan dari API AVERPAY ({{BASE_URL}}). Dokumentasi (JSON): {{SPEC_URL}}',
      '',
      'Layanan yang saya mau: [ISI: Aplikasi Premium / Nokos OTP / Suntik Sosmed].',
      'Ikuti urutan endpoint dari dokumentasi (mis. Premium: products -> stock -> order -> status; Nokos: servers -> services -> countries -> products -> order -> status).',
      '',
      'Syarat:',
      '- Harga jual = harga modal + margin yang bisa saya atur di file config.',
      '- Cek saldo (GET /api/balance) dan stok sebelum order; tampilkan pesan jelas jika tidak cukup.',
      '- Simpan setiap transaksi (id AVERPAY, status, waktu) di database, polling status sampai selesai.',
      '- API Key hanya di backend (.env).',
      'Berikan kode lengkap dan langkah menjalankan.'
    ].join('\n')
  },
  {
    id: 'ringkas',
    title: 'Prompt Ringkas (Cukup Link Dokumentasi)',
    description: 'Untuk AI yang bisa membuka link. Ganti bagian [ISI] sesuai kebutuhan.',
    prompt: [
      'Baca dokumentasi API ini: {{SPEC_URL}}',
      'Lalu buatkan [ISI: apa yang ingin dibuat, mis. website payment gateway seperti AVERPAY].',
      'Gunakan hanya endpoint yang ada di dokumentasi, simpan API Key di backend/.env, dan jelaskan cara menjalankannya.'
    ].join('\n')
  }
];

function fill(str, baseUrl) {
  return String(str).replace(/\{\{BASE_URL\}\}/g, baseUrl).replace(/\{\{SPEC_URL\}\}/g, baseUrl + '/docs.json');
}

function buildSpec(baseUrl, siteName) {
  baseUrl = String(baseUrl || '').replace(/\/+$/, '');
  return {
    name: (siteName || 'AVERPAY') + ' — Dokumentasi API',
    version: '1.0',
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    spec_url: baseUrl + '/docs.json',
    authentication: {
      type: 'API Key',
      how_to_get: 'Login ke dashboard, buka menu Profil, salin API Key.',
      accepted: ['query: apikey=KEY', 'query: api_key=KEY', 'header: x-api-key: KEY'],
      security_note: 'Jangan taruh API Key di frontend/aplikasi publik. Panggil API dari backend.'
    },
    conventions: {
      success: '{ "success": true, "data": {...} } (beberapa endpoint mengembalikan field langsung tanpa "data")',
      error: '{ "error": "pesan error" } — cek field "error" / "success" sebelum memproses data',
      note_auth_errors: 'HTTP 401: API key hilang/tidak valid.'
    },
    webhook: WEBHOOK,
    endpoints: ENDPOINTS.map((e) => ({
      id: e.id,
      group: e.group,
      title: e.title,
      method: e.method,
      path: e.path,
      url: baseUrl + e.path,
      access: e.access || 'Semua akun',
      description: e.description || undefined,
      parameters: e.params,
      example_request: e.method === 'GET'
        ? `curl -X GET '${baseUrl}${e.path.replace('{id}', 'ID')}?apikey=YOUR_API_KEY${e.params.filter((x) => x.in === 'query' && x.name !== 'apikey' && x.required).map((x) => '&' + x.name + '=' + x.name.toUpperCase()).join('')}'`
        : `curl -X POST '${baseUrl}${e.path}?apikey=YOUR_API_KEY'${e.params.filter((x) => x.in === 'body').length ? ' -d "' + e.params.filter((x) => x.in === 'body' && x.required).map((x) => x.name + '=' + x.name.toUpperCase()).join('&') + '"' : ''}`,
      response_example: e.response_example || undefined
    })),
    ai_prompts: AI_PROMPTS.map((x) => ({ id: x.id, title: x.title, description: x.description, prompt: fill(x.prompt, baseUrl) }))
  };
}

module.exports = { buildSpec, AI_PROMPTS, ENDPOINTS, fill };
