const test = require('node:test');
const assert = require('node:assert');
const { buildSpec, AI_PROMPTS } = require('../lib/docs-spec');

test('spec JSON valid, base URL terisi, tanpa token tersisa', () => {
  const spec = buildSpec('https://pay.example.com/', 'AVERPAY');
  const json = JSON.stringify(spec);
  assert.doesNotThrow(() => JSON.parse(json));
  assert.strictEqual(spec.base_url, 'https://pay.example.com');
  assert.ok(spec.endpoints.length >= 40);
  assert.ok(!/\{\{(BASE_URL|SPEC_URL)\}\}/.test(json));
  assert.ok(spec.ai_prompts.every((p) => p.prompt.length > 50));
});

test('setiap endpoint punya method, path, dan parameter apikey', () => {
  const spec = buildSpec('https://x.test', 'X');
  for (const e of spec.endpoints) {
    assert.match(e.method, /^(GET|POST)$/);
    assert.ok(e.path.startsWith('/api/'));
    assert.ok(e.parameters.some((p) => p.name === 'apikey'));
  }
  assert.strictEqual(new Set(spec.endpoints.map((e) => e.id)).size, spec.endpoints.length);
});

test('prompt mentah memakai token yang dikenali', () => {
  for (const p of AI_PROMPTS) assert.match(p.prompt, /\{\{(BASE_URL|SPEC_URL)\}\}/);
});
