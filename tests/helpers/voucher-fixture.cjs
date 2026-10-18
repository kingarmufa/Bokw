'use strict';
// Isolated adapters: no database connection, external request, or real payment.
const fs = require('fs'), path = require('path'), vm = require('vm');
const lib = require('../../lib/vouchers');
const source = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const ID = '123456789012345678901234';
function query(value) {
  return { select() { return this; }, sort() { return this; }, skip(n) { if (Array.isArray(value)) value = value.slice(n); return this; }, limit(n) { if (Array.isArray(value)) value = value.slice(0, n); return this; }, lean() { return Promise.resolve(value); }, then(a, b) { return Promise.resolve(value).then(a, b); } };
}
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => value && value.$gt ? new Date(doc[key]) > value.$gt : (Array.isArray(doc[key]) ? doc[key].includes(value) : doc[key] === value));
}
function fixture() {
  const state = { vouchers: [], orders: [], calls: [], user: { _id: ID, role: 'user', email: 'test@example.test', username: 'tester', balance: 100000, topupBalance: 100000, heldBalance: 3000, gachaNokosStatus: 'approved', fixNoAccess: true }, failProvider: false, failCreate: false };
  let serial = 0;
  const Voucher = {
    init: async () => {},
    findOne: filter => query(state.vouchers.find(v => matches(v, filter)) || null),
    find: filter => query(state.vouchers.filter(v => matches(v, filter))),
    async create(input) { if (state.vouchers.some(v => v.code === input.code)) throw Object.assign(new Error('duplicate'), { code: 11000 }); const v = { ...input, _id: (++serial).toString(16).padStart(24, '0'), createdAt: new Date() }; state.vouchers.push(v); return v; },
    async findByIdAndUpdate(id, update) { const v = state.vouchers.find(v => v._id === id); if (v) { if (state.vouchers.some(other => other._id !== id && other.code === update.$set.code)) throw Object.assign(new Error('duplicate'), { code: 11000 }); Object.assign(v, update.$set); } return v; }
  };
  const model = name => ({ create: async data => { if (state.failCreate) throw new Error('Database unavailable (test)'); const doc = { ...data, _id: (++serial).toString(16).padStart(24, '0'), createdAt: new Date() }; state.orders.push({ model: name, ...doc }); return doc; } });
  const vouchers = lib.createEngine({ Voucher, ServicePurchase: model('ServicePurchase') });
  const product = { _id: ID, id: 1, name: 'Produk Uji', price: 10000, active: true, available: 20, status: 'available', stock: 20, fullUp: false, downloadLink: 'https://example.test/download' };
  const pkg = { _id: ID, key: 'bulanan', name: 'Paket Uji', label: 'Paket Uji', price: 10000, durationDays: 30, days: 30, active: true, ram: 1024, disk: 1024, cpu: 50 };
  const settings = { name: 'AVERPAY', title: 'Payment Gateway', themeTemplate: 'default', logoUrl: '/icon.png', aiBubbleEnabled: false, smscodeEnabled: true, smscodeApiKey: 'mock', premkuEnabled: true, premkuApiKey: 'mock', gachaNokosEnabled: true, gachaNokosApiKey: 'mock', gachaNokosCost: 10000, gachaNokosRegistrationMode: 'paid', gachaNokosRegistrationFee: 10000, fixNoAccessPrice: 10000, fixNoGlobalPackages: [pkg] };
  function docUser() {
    const data = { ...state.user }, initial = { ...state.user };
    data.save = async () => { for (const key of Object.keys(data)) if (key !== 'save' && data[key] !== initial[key]) state.user[key] = data[key]; return data; };
    return data;
  }
  const updateUser = (filter, update) => {
    for (const [key, val] of Object.entries(filter)) if (val && val.$gte !== undefined && (state.user[key] || 0) < val.$gte) return null;
    for (const [key, val] of Object.entries(update.$inc || {})) state.user[key] = (state.user[key] || 0) + val;
    Object.assign(state.user, update.$set || {}); return { ...state.user };
  };
  const User = { findById: () => query(docUser()), updateOne: async (filter, update) => updateUser(filter, update), findOneAndUpdate: (filter, update) => query(updateUser(filter, update)) };
  async function provide(name, value) { state.calls.push(name); if (state.failProvider) throw new Error('Provider rejected (test)'); return value; }
  const next = (req, res, next) => next();
  const context = { console, require, Date, Math, Promise, mongoose: require('mongoose'), voucherLib: lib, vouchers, User,
    isAuth: next, isUserOrMerchant: next, ApiLimiter: next, apiAuth: next, apiRequireResellerOrAdmin: next,
    getSettings: async () => settings, botManager: null, waNotifyUserId: async () => {}, paketRuleFor: async () => null, paketAddFee: (rule, price) => price,
    paketAssignUser: async () => provide('paket', true), Paket: { findById: () => query(pkg) },
    Produk: { findOne: () => query(product) }, PteroPackage: { findOne: () => query(pkg) }, PteroPanel: { findOne: () => query({ _id: ID, name: 'Panel Uji', domain: 'https://example.test' }) },
    pteroCheckPanelOnline: async () => true, pteroExpireDate: () => null, createPterodactylAccount: async () => provide('panel', { username: 'tester', password: 'mock-password' }),
    applyNokosMarkup: price => price, applyPremiumMarkup: price => price,
    smscodeClient: () => ({ get: async () => ({ data: { data: [product] } }), post: async () => provide('nokos', { data: { data: { orders: [{ id: 'remote', phone_number: '620000', status: 'ACTIVE' }] } } }) }),
    premkuRequest: async (settings, action) => action === 'products' ? { products: [product] } : provide('premium', { invoice: 'remote' }),
    gachaNokosClient: () => ({ get: async () => ({ data: { services: [{ name: 'test', available: 1 }] } }), post: async () => provide('gacha', { data: { number: '620000', country: 'ID' } }) }),
    sosmedReady: () => true, sosmedServices: async () => [{ id: 1, name: 'Service', rate: 10000, min: 1, max: 10000 }], calcSosmedCostPrice: (rate, quantity) => Math.ceil(rate * quantity / 1000), calcSosmedSellPrice: (rate, quantity) => Math.ceil(rate * quantity / 1000), sosmedCreateOrder: async () => provide('sosmed', { orderId: 'remote' }),
    nokosErrorMessage: e => e.message, premiumErrorMessage: e => e.message, sosmedErrorMessage: e => e.message, gachaNokosErrorMessage: e => e.message,
    getResellerSetting: async () => ({ mode: 'permanent', permanentPrice: 10000 }), getAdminRoleSetting: async () => ({ mode: 'permanent', permanentPrice: 10000 }), withAdminRoleLock: async fn => fn(), ADMIN_ROLE: 'adminpanel', getAdminRoleAvailability: async () => ({ open: true }), resolveAdminRolePackage: () => pkg,
    generateCustomId: () => 'test-ref', startId: { nokos: 'N', premium: 'P' },
  };
  for (const name of ['PaketOrder','NokosOrder','GachaNokosOrder','PremiumOrder','PteroOrder','SosmedOrder','ProdukOrder','ResellerOrder','AdminRoleOrder']) context[name] = model(name);
  const balanceStart = source.indexOf('function spendField('), balanceEnd = source.indexOf('\n}', source.indexOf('async function spendUserBalance(')) + 2;
  vm.runInNewContext(source.slice(balanceStart, balanceEnd), context);
  function route(routePath, method) {
    const start = source.search(new RegExp("app\\." + (method || "(?:get|post)") + "\\('" + routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'"));
    if (start < 0) throw new Error('Missing route ' + routePath);
    const end = source.indexOf('\n});', start) + 4;
    let handler;
    context.app = { get: (p, ...fn) => { handler = fn.at(-1); }, post: (p, ...fn) => { handler = fn.at(-1); } };
    vm.runInNewContext(source.slice(start, end), context);
    return handler;
  }
  async function invoke(routePath, { code = 'VOCHER10', fields = {}, query: queryInput = {}, user = {} } = {}) {
    Object.assign(state.user, user);
    const data = { product_id: '1', country_id: '1', qty: '2', id: ID, panel_id: ID, package_id: ID, username: 'tester', email: 'test@example.test', password: 'mock-password', service_id: '1', target: 'test', quantity: '1000', setuju: 'on', voucherCode: code, ...fields };
    const req = { body: routePath.startsWith('/api/') ? {} : data, query: routePath.startsWith('/api/') ? { ...data, ...queryInput } : queryInput, params: { id: ID, packageId: ID }, session: { userId: ID }, apiUser: ID, apiUserDoc: docUser() };
    const res = { locals: { settings }, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, redirect(to) { this.location = to; return this; } };
    await route(routePath)(req, res); return { req, res };
  }
  return { state, vouchers, Voucher, settings, User, product, pkg, route, invoke, context, ID };
}
module.exports = { fixture, query, ID };
