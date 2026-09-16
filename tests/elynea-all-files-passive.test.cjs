const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const helper = fs.readFileSync(path.resolve(__dirname, '../server-dropbox-helper.cjs'), 'utf8');

test('generic files are classified without process execution primitives', () => {
  for (const primitive of ['child_process', 'execFile(', 'spawn(', 'fork(']) {
    assert.equal(helper.includes(primitive), false, primitive);
  }
});
