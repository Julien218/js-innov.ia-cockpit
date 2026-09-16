const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const helper = fs.readFileSync(path.resolve(__dirname, '../server-dropbox-helper.cjs'), 'utf8');

test('office and text extensions are classified as Documents', () => {
  assert.ok(helper.includes('pdf|doc|docx|odt|rtf|txt|md|csv|xls|xlsx|ods|ppt|pptx|odp'));
});
