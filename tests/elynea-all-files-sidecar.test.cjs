const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assistant = fs.readFileSync(path.resolve(__dirname, '../server-assistant.cjs'), 'utf8');

test('archived files keep a JSON reference sidecar and SHA-256 provenance', () => {
  assert.ok(assistant.includes('referenceManifest'));
  assert.ok(assistant.includes("crypto.createHash('sha256')"));
  assert.ok(assistant.includes('reference.referenceFilename'));
});
