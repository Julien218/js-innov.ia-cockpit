const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const helper = fs.readFileSync(path.resolve(__dirname, '../server-dropbox-helper.cjs'), 'utf8');

test('audio formats are routed into Audio category', () => {
  assert.ok(helper.includes("docType = 'Audio'"));
  assert.ok(helper.includes('mp3|wav|m4a|aac|ogg|oga|flac|opus'));
});
