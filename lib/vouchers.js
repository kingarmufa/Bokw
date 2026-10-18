'use strict';
const crypto = require('crypto');
const SERVICES = Object.freeze([
  { id: 'paket', label: 'Paket akun', href: '/paket' },
  { id: 'nokos', label: 'Nokos', href: '/nokos' },
  { id: 'gacha_access', label: 'Pendaftaran Gacha Nokos', href: '/gacha-nokos' },
  { id: 'gacha_nokos', label: 'Pembelian nomor Gacha', href: '/gacha-nokos' },
  { id: 'fix_access', label: 'Akses Fix No', href: '/fix-no' },
  { id: 'fix_package', label: 'Paket Sender Global', href: '/fix-no' },
  { id: 'panel', label: 'Panel Pterodactyl', href: '/panel' },
  { id: 'premium', label: 'Aplikasi premium', href: '/premium' },
  { id: 'sosmed', label: 'Sosmed / SMM', href: '/sosmed' },
  { id: 'produk', label: 'Produk digital', href: '/produk' },
  { id: 'reseller', label: 'Reseller Panel', href: '/reseller' },
  { id: 'admin_panel', label: 'Admin Panel', href: '/admin-panel' }
]);
const SERVICE_IDS = SERVICES.map(s => s.id);
const orderSchema = {
  voucherCode: { type: String, default: '' },
  voucherPercent: { type: Number, default: 0 },
  originalPrice: { type: Number, default: null },
  discountAmount: { type: Number, default: 0 }
};
function normalizeCode(value) {
  if (typeof value !== 'string') throw new Error('Kode voucher tidak valid.');
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new Error('Kode voucher harus 3–32 karakter: huruf, angka, _ atau -.');
  return code;
}
function calculate(amount, percent) {
  const originalPrice = Math.round(Number(amount));
  const bp = Math.round(Number(percent) * 100);
  if (!Number.isSafeInteger(originalPrice) || originalPrice < 0) throw new Error('Harga layanan tidak valid.');
  if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw new Error('Persentase voucher tidak valid.');
  const discountAmount = Number(BigInt(originalPrice) * BigInt(bp) / 10000n);
  return { originalPrice, discountAmount, total: originalPrice - discountAmount };
}
function parseWib(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Tanggal kedaluwarsa tidak valid.');
  const date = new Date(value + ':00+07:00');
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 16) !== value) throw new Error('Tanggal kedaluwarsa tidak valid.');
  return date;
}
function dateInput(value) { return new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 16); }
function validateAdmin(body, now = new Date()) {
  const code = normalizeCode(body.code);
  if (typeof body.percent !== 'string' || !/^\d{1,3}(\.\d{1,2})?$/.test(body.percent.trim())) throw new Error('Diskon harus angka 1–100, maksimal 2 angka desimal.');
  const percent = Number(body.percent);
  if (percent < 1 || percent > 100) throw new Error('Diskon harus 1–100 persen.');
  const expiresAt = parseWib(body.expiresAt);
  if (expiresAt <= now) throw new Error('Kedaluwarsa harus setelah waktu sekarang (WIB).');
  const selected = Array.isArray(body.services) ? body.services : [body.services];
  if (!selected.length || selected.some(s => !SERVICE_IDS.includes(s))) throw new Error('Pilih minimal satu layanan yang valid.');
  return { code, percent, expiresAt, services: [...new Set(selected)], published: body.published === 'on', active: body.active === 'on' };
}
function orderFields(quote) {
  return { originalPrice: quote.originalPrice, discountAmount: quote.discountAmount, voucherCode: quote.voucherCode, voucherPercent: quote.voucherPercent };
}
// Pemakaian voucher: SATU kali per akun (semua layanan). Dicatat di koleksi VoucherRedemption (unik per kode + user).
let redemptionModel = null;
function usagePlugin(schema) {
  schema.pre('save', function () { this.$locals.vcNew = this.isNew; });
  schema.post('save', async function (doc) {
    try {
      if (!doc.$locals.vcNew || !doc.voucherCode || !doc.userId || !redemptionModel) return;
      await redemptionModel.updateOne({ code: doc.voucherCode, userId: doc.userId }, { $set: { status: 'used', usedAt: new Date() } }, { upsert: true });
    } catch (err) { console.error('Voucher usage mark:', err.message); }
  });
}
function createService(mongoose) {
  const schema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^[A-Z0-9_-]{3,32}$/ },
    percent: { type: Number, required: true, min: 1, max: 100 },
    services: [{ type: String, enum: SERVICE_IDS }],
    expiresAt: { type: Date, required: true },
    published: { type: Boolean, default: false },
    active: { type: Boolean, default: true }
  }, { timestamps: true });
  schema.index({ active: 1, published: 1, expiresAt: 1 });
  const Voucher = mongoose.models.Voucher || mongoose.model('Voucher', schema);
  const purchaseSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    service: { type: String, enum: SERVICE_IDS, required: true },
    title: String, price: { type: Number, min: 0, required: true }, ...orderSchema
  }, { timestamps: true });
  usagePlugin(purchaseSchema);
  const ServicePurchase = mongoose.models.ServicePurchase || mongoose.model('ServicePurchase', purchaseSchema);
  const redemptionSchema = new mongoose.Schema({
    code: { type: String, required: true, uppercase: true, trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['reserved', 'used'], default: 'reserved' },
    reservedAt: Date, usedAt: Date
  }, { timestamps: true });
  redemptionSchema.index({ code: 1, userId: 1 }, { unique: true });
  const Redemption = mongoose.models.VoucherRedemption || mongoose.model('VoucherRedemption', redemptionSchema);
  redemptionModel = Redemption;
  return createEngine({ Voucher, ServicePurchase, Redemption });
}
const USED_MESSAGE = 'Voucher ini sudah pernah Anda pakai. Satu voucher hanya bisa dipakai satu kali per akun.';
const RESERVE_MS = 60 * 1000;
function createEngine({ Voucher, ServicePurchase, Redemption }) {
  async function assertUnused(code, userId) {
    if (!Redemption || !userId) return;
    if (await Redemption.findOne({ code, userId, status: 'used' }).select('_id').lean()) throw new Error(USED_MESSAGE);
  }
  // Kunci atomik saat checkout: mencegah dua pembelian bersamaan memakai kode yang sama. Dilepas otomatis setelah 1 menit
  // kalau pembelian batal/gagal; jadi 'used' setelah pesanan benar-benar tersimpan (usagePlugin).
  async function reserve(code, userId) {
    if (!Redemption) return;
    if (!userId) throw new Error('Sesi tidak valid. Silakan login kembali.');
    if (Redemption.init) await Redemption.init();
    const now = new Date();
    try {
      if (await Redemption.findOneAndUpdate({ code, userId, status: 'reserved', reservedAt: { $lt: new Date(now.getTime() - RESERVE_MS) } }, { $set: { reservedAt: now } })) return;
      await Redemption.create({ code, userId, status: 'reserved', reservedAt: now });
    } catch (err) {
      if (err && err.code === 11000) throw new Error('Voucher sedang dipakai di pembelian lain atau sudah pernah Anda pakai. Coba lagi dalam 1 menit.');
      throw err;
    }
  }
  async function usedCodes(userId) {
    if (!Redemption || !userId) return new Set();
    return new Set((await Redemption.find({ userId, status: 'used' }).select('code').lean()).map(r => r.code));
  }
  // Catat voucher dari pesanan lama (sebelum aturan 1x pakai) supaya tidak bisa dipakai lagi.
  async function backfill(models) {
    if (!Redemption) return 0;
    if (Redemption.init) await Redemption.init();
    let total = 0;
    for (const model of models) {
      const rows = await model.aggregate([{ $match: { voucherCode: { $nin: ['', null] }, userId: { $ne: null } } }, { $group: { _id: { c: '$voucherCode', u: '$userId' } } }]);
      const ops = rows.map(r => ({ updateOne: { filter: { code: String(r._id.c).toUpperCase(), userId: r._id.u }, update: { $setOnInsert: { status: 'used', usedAt: new Date() } }, upsert: true } }));
      if (ops.length) { await Redemption.bulkWrite(ops, { ordered: false }); total += ops.length; }
    }
    return total;
  }
  async function quote(value, service, amount, now = new Date(), userId = null) {
    if (!SERVICE_IDS.includes(service)) throw new Error('Voucher tidak berlaku untuk layanan ini. Top up, penarikan, dan transfer saldo tidak termasuk.');
    const base = { ...calculate(amount, 0), voucherCode: '', voucherPercent: 0 };
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return base;
    const code = normalizeCode(value);
    if (base.originalPrice === 0) throw new Error('Voucher hanya untuk pembelian berbayar.');
    const voucher = await Voucher.findOne({ code }).lean();
    if (!voucher || !voucher.active) throw new Error('Voucher tidak ditemukan atau tidak aktif.');
    if (!(new Date(voucher.expiresAt) > now)) throw new Error('Voucher sudah kedaluwarsa.');
    if (!voucher.services.includes(service)) throw new Error('Voucher tidak berlaku untuk layanan ini.');
    if (!(voucher.percent >= 1 && voucher.percent <= 100)) throw new Error('Persentase voucher tidak valid.');
    await assertUnused(code, userId);
    return { ...calculate(base.originalPrice, voucher.percent), voucherCode: code, voucherPercent: voucher.percent };
  }
  async function checkout(req, service, authoritativeAmount) {
    try {
      const value = req.body && Object.hasOwn(req.body, 'voucherCode') ? req.body.voucherCode : req.query?.voucherCode;
      const userId = req.session?.userId || req.apiUser || null;
      const result = await quote(value, service, authoritativeAmount, new Date(), userId);
      if (result.voucherCode) await reserve(result.voucherCode, userId);
      return result;
    } catch (err) {
      if (err.name && err.name !== 'Error') console.error('Voucher checkout:', err.message);
      return { error: err.name === 'Error' ? err.message : 'Voucher belum dapat diperiksa. Silakan coba lagi.' };
    }
  }
  async function publicList(service, userId = null) {
    if (service && !SERVICE_IDS.includes(service)) return [];
    const filter = { active: true, published: true, expiresAt: { $gt: new Date() } };
    if (service) filter.services = service;
    const list = await Voucher.find(filter).select('code percent services expiresAt').sort({ percent: -1, expiresAt: 1 }).limit(200).lean();
    if (!userId) return list;
    const used = await usedCodes(userId);
    return list.filter(v => !used.has(v.code));
  }
  function fail(req, res, message, path, json = false) {
    if (json) return res.status(400).json({ success: false, error: message });
    req.session.errorMsg = message;
    return res.redirect(path);
  }
  async function record(userId, service, title, pricing) {
    return ServicePurchase.create({ userId, service, title, price: pricing.total, ...orderFields(pricing) });
  }
  function mount(app, { isAuth, isAdmin }) {
    const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => {
      console.error('Voucher route:', err.message);
      if (req.path.startsWith('/api/')) return res.status(503).json({ success: false, error: 'Voucher belum dapat dimuat. Coba lagi.' });
      res.status(503).send('Voucher belum dapat dimuat. Silakan kembali dan coba lagi.');
    });
    const jsonAuth = (req, res, next) => req.session?.userId ? next() : res.status(401).json({ success: false, error: 'Sesi berakhir. Silakan login kembali.' });
    const token = req => req.session.voucherCsrf || (req.session.voucherCsrf = crypto.randomBytes(24).toString('hex'));
    const csrf = (req, res, next) => {
      if (!req.session.voucherCsrf || typeof req.body._csrf !== 'string' || req.body._csrf !== req.session.voucherCsrf) return res.status(403).send('Sesi formulir berakhir. Muat ulang halaman voucher.');
      next();
    };
    const locals = { services: SERVICES, dateInput, formatDate: value => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB' };
    app.get('/admin/vouchers', isAuth, isAdmin, asyncRoute(async (req, res) => {
      const page = Math.max(1, Math.min(10000, parseInt(req.query.page, 10) || 1));
      const vouchers = await Voucher.find({}).sort({ createdAt: -1 }).skip((page - 1) * 30).limit(31).lean();
      res.render('admin_vouchers', { ...locals, vouchers: vouchers.slice(0, 30), page, hasNext: vouchers.length > 30, csrfToken: token(req) });
    }));
    async function save(req, res, edit) {
      try {
        const input = validateAdmin(req.body);
        if (edit) {
          if (!/^[a-f0-9]{24}$/i.test(req.params.id)) throw new Error('Voucher tidak ditemukan.');
          if (!await Voucher.findByIdAndUpdate(req.params.id, { $set: input }, { runValidators: true })) throw new Error('Voucher tidak ditemukan.');
        } else {
          // Ensure uniqueness even on the first request after a fresh installation.
          if (Voucher.init) await Voucher.init();
          await Voucher.create(input);
        }
        req.session.successMsg = 'Voucher berhasil disimpan.';
      } catch (err) {
        req.session.errorMsg = err.code === 11000 ? 'Kode voucher sudah ada. Gunakan kode lain atau edit voucher tersebut.' : (err.name === 'Error' ? err.message : 'Voucher gagal disimpan. Periksa isian lalu coba lagi.');
      }
      res.redirect('/admin/vouchers');
    }
    app.post('/admin/vouchers', isAuth, isAdmin, csrf, asyncRoute((req, res) => save(req, res, false)));
    app.post('/admin/vouchers/:id/edit', isAuth, isAdmin, csrf, asyncRoute((req, res) => save(req, res, true)));
    app.post('/admin/vouchers/:id/disable', isAuth, isAdmin, csrf, asyncRoute(async (req, res) => {
      if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return fail(req, res, 'Voucher tidak ditemukan.', '/admin/vouchers');
      await Voucher.findByIdAndUpdate(req.params.id, { $set: { active: false } });
      req.session.successMsg = 'Voucher dinonaktifkan. Riwayat pembelian tetap tersimpan.';
      res.redirect('/admin/vouchers');
    }));
    app.get('/voucher', isAuth, asyncRoute(async (req, res) => res.render('vouchers', { ...locals, vouchers: await publicList('', req.session.userId) })));
    app.get('/api/vouchers/public', jsonAuth, asyncRoute(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await publicList(req.query.service || '', req.session.userId) });
    }));
    app.post('/api/vouchers/preview', jsonAuth, asyncRoute(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try { res.json({ success: true, estimate: true, data: await quote(req.body.voucherCode, req.body.service, req.body.amount, new Date(), req.session.userId) }); }
      catch (err) { fail(req, res, err.name === 'Error' ? err.message : 'Voucher belum dapat diperiksa.', '', true); }
    }));
  }
  return { Voucher, ServicePurchase, Redemption, quote, checkout, publicList, backfill, fail, record, mount };
}
module.exports = { SERVICES, SERVICE_IDS, orderSchema, normalizeCode, calculate, parseWib, dateInput, validateAdmin, orderFields, usagePlugin, createService, createEngine };
