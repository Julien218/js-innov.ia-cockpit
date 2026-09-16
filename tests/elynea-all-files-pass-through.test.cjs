const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = fs.readFileSync(path.resolve(__dirname, '../src/components/FloatingAgent.jsx'), 'utf8');
test('file bytes go through authenticated Cockpit route', () => {
  assert.ok(ui.includes("credentials: 'include'"));
  assert.ok(ui.includes('body: file'));
});
