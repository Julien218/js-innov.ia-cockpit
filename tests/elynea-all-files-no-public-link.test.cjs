const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docs = fs.readFileSync(path.resolve(__dirname, '../server-documents.cjs'), 'utf8');

test('document status continues to advertise no public Dropbox links', () => {
  assert.ok(docs.includes('publicLinks: false'));
});
