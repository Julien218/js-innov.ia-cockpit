const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const helper = fs.readFileSync(path.resolve(__dirname, '../server-dropbox-helper.cjs'), 'utf8');

test('unmatched files keep a deterministic A_Classer fallback', () => {
  assert.ok(helper.includes('`${ROOT_PATH}/A_Classer/${docType}`'));
  assert.ok(helper.includes("let docType = 'Fichiers'"));
});
