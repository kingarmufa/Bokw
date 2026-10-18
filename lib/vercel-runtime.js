'use strict';
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const serverless = process.env.VERCEL === '1' || process.env.SERVERLESS === '1';
const backgroundEnabled = !serverless && process.env.ENABLE_BACKGROUND_JOBS !== 'false';
const dataRoot = serverless ? path.join(os.tmpdir(), 'averpay') : path.join(__dirname, '..');

function validateEnvironment() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI wajib diisi');
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET minimal 32 karakter');
}
function authorized(header, secret) {
  if (!secret || secret.length < 32 || typeof header !== 'string') return false;
  const actual = Buffer.from(header), expected = Buffer.from('Bearer ' + secret);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
// MongoDB primary-key uniqueness serializes ownership across Vercel instances.
// Lease exceeds the configured 300-second function lifetime. No background renewal is required.
async function withLease(connection, name, task, ttl = 360000) {
  const c = connection.db.collection('runtime_leases');
  const token = crypto.randomUUID();
  const now = new Date();
  try {
    await c.updateOne({ _id: name, expires: { $lte: now } },
      { $set: { token, expires: new Date(Date.now() + ttl) } }, { upsert: true });
  } catch (error) { if (error.code === 11000) return null; throw error; }
  try { return await task(); }
  finally { await c.deleteOne({ _id: name, token }); }
}
function installOperations(app, { connection, payments, maintenance, backfill }) {
  const jobs = { payments, maintenance, backfill };
  app.get('/api/cron/:job', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!authorized(req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).json({ error: 'Unauthorized' });
    const task = jobs[req.params.job];
    if (!task) return res.status(404).json({ error: 'Unknown job' });
    const result = await withLease(connection, 'job:' + req.params.job, async () => {
      await task();
      await connection.db.collection('runtime_jobs').updateOne({ _id: req.params.job }, { $set: { lastCompletedAt: new Date() } }, { upsert: true });
      return true;
    });
    res.json({ ok: true, skipped: result === null, job: req.params.job });
  });
  app.get('/api/runtime/status', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'admin') return res.status(403).json({ error: 'Admin only' });
    res.json({ mode: serverless ? 'vercel' : 'node', backgroundEnabled,
      jobs: await connection.db.collection('runtime_jobs').find().toArray(),
      uploads: serverless ? 'cloud-required; total-request <= 4 MB' : 'cloud-or-local',
      telegram: serverless ? 'requires-persistent-node-host' : 'polling', whatsapp: serverless ? 'requires-persistent-node-host' : 'baileys' });
  });
  app.post('/api/runtime/presence', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
    const c = connection.db.collection('web_presence');
    await c.updateOne({ _id: String(req.session.userId) }, { $set: { expires: new Date(Date.now() + 65000) } }, { upsert: true });
    const users = await c.find({ expires: { $gt: new Date() } }, { projection: { _id: 1 } }).limit(2000).toArray();
    res.json({ online: users.map(u => u._id) });
  });
}
module.exports = { serverless, backgroundEnabled, dataRoot, validateEnvironment, authorized, withLease, installOperations };
