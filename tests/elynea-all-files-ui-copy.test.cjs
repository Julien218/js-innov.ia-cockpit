const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/components/FloatingAgent.jsx'), 'utf8');

test('attachment UI no longer promises image/video-only behavior', () => {
  assert.equal(source.includes('accept="image/jpeg'), false);
  assert.ok(source.includes('classer') && source.includes('Dropbox'));
});
