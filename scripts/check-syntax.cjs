'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ejs = require('ejs');
const root = path.join(__dirname, '..');
let count = 0;
function check(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'vendor', 'uploads'].includes(ent.name)) continue;
    const file = path.join(dir, ent.name);
    if (ent.isDirectory()) { check(file); continue; }
    if (/\.(js|cjs)$/.test(file)) {
      const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (r.status) { process.stderr.write(r.stderr); process.exit(1); }
      count++;
    }
    if (/\.ejs$/.test(file)) { ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file }); count++; }
  }
}
check(root);
JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
console.log('Syntax OK: ' + count + ' JavaScript/EJS files.');
