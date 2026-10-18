'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'vercel.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
const paths = new Set(['/api/cron/payments', '/api/cron/maintenance']);
config.crons = (config.crons || []).filter(c => !paths.has(c.path)).concat([
  { path: '/api/cron/payments', schedule: '* * * * *' },
  { path: '/api/cron/maintenance', schedule: '*/5 * * * *' }
]);
fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
console.log('Jadwal Pro ditambahkan. Isi CRON_SECRET, commit vercel.json, lalu redeploy. Tidak kompatibel dengan jadwal Hobby.');
