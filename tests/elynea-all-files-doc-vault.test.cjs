const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/Documents.jsx'), 'utf8');

test('Centre Documents retains per-file download action', () => {
  assert.ok(page.includes('Télécharger'));
  assert.ok(page.includes('/download'));
});
