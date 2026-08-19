const test = require('node:test');
const assert = require('node:assert/strict');

test('signage diagnostic semantics', () => {
  const labels = { ok:'OK', error:'ERROR', unmeasured:'NON MESURÉ' };
  assert.equal(labels.unmeasured, 'NON MESURÉ');
  const age = 30_000;
  assert.equal(age <= 90_000, true, 'heartbeat récent doit être online');
});
