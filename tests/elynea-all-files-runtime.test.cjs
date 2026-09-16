const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const assistant = fs.readFileSync(path.join(root, 'server-assistant.cjs'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'server-dropbox-helper.cjs'), 'utf8');

test('assistant raw upload keeps 100 MiB bound and indexes archived files', () => {
  assert.ok(assistant.includes('MAX_NOVA_MEDIA_BYTES = 100 * 1024 * 1024'));
  assert.ok(assistant.includes("router.post('/upload-media'"));
  assert.ok(assistant.includes('indexDocument({'));
  assert.ok(assistant.includes("source: 'nova-assistant'"));
});

test('generic file acceptance still sanitizes names and never executes content', () => {
  assert.ok(helper.includes('safeUploadFilename(raw)'));
  assert.ok(helper.includes('jamais exécutés ou interprétés'));
  assert.equal(helper.includes('child_process'), false);
  assert.equal(helper.includes('exec('), false);
  assert.equal(helper.includes('spawn('), false);
});
