const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('Whisper GPU/CPU fallback passes Python behavioral regressions', () => {
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(__dirname, 'whisper_fallback_test.py')], { encoding:'utf8', windowsHide:true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
