const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = fs.readFileSync(path.resolve(__dirname, '../src/components/FloatingAgent.jsx'), 'utf8');
test('Elynea attachment picker has no accept restriction', () => {
  const input = ui.match(/<input[\s\S]*?ref=\{fileInputRef\}[\s\S]*?\/?>/);
  assert.ok(input);
  assert.equal(/\baccept=/.test(input[0]), false);
});
