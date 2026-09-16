const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const documents = fs.readFileSync(path.resolve(__dirname, '../server-documents.cjs'), 'utf8');

test('download is private attachment delivery from Dropbox', () => {
  assert.ok(documents.includes("router.get('/:id/download'"));
  assert.ok(documents.includes('assertDocumentAccess(req.user, record)'));
  assert.ok(documents.includes("Cache-Control', 'private, no-store'"));
  assert.ok(documents.includes('attachment; filename*=UTF-8'));
});
