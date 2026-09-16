const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assistant = fs.readFileSync(path.resolve(__dirname, '../server-assistant.cjs'), 'utf8');
const documents = fs.readFileSync(path.resolve(__dirname, '../server-documents.cjs'), 'utf8');

test('all-file storage remains bounded to 100 MiB', () => {
  assert.ok(assistant.includes('100 * 1024 * 1024'));
  assert.ok(documents.includes('100 * 1024 * 1024'));
});
