const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assistant = fs.readFileSync(path.resolve(__dirname, '../server-assistant.cjs'), 'utf8');

test('Elynea upload keeps DocumentIndex integration', () => {
  assert.ok(assistant.includes("const { indexDocument } = require('./server-documents.cjs')"));
  assert.ok(assistant.includes('document = await indexDocument({'));
  assert.ok(assistant.includes('documentId: document?.id || null'));
});
