const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../server-social-content-agent.cjs');

test('validation WhatsApp exige une action et conserve le code', () => {
  assert.deepEqual(_test.parseApprovalCommand('VALIDER A1B2C3D4'), {
    action: 'approved', code: 'A1B2C3D4', note: 'VALIDER A1B2C3D4'
  });
});

test('demande de modification est detectee sans publier', () => {
  const result = _test.parseApprovalCommand('Modifier A1B2C3D4 : raccourcir la fin');
  assert.equal(result.action, 'changes_requested');
  assert.equal(result.code, 'A1B2C3D4');
});

test('refus est detecte', () => {
  const result = _test.parseApprovalCommand('REFUSER DEADBEEF');
  assert.equal(result.action, 'rejected');
  assert.equal(result.code, 'DEADBEEF');
});

test('un simple OK sans code ne suffit pas pour identifier un contenu', () => {
  const result = _test.parseApprovalCommand('OK');
  assert.equal(result.action, 'approved');
  assert.equal(result.code, null);
});

test('numero WhatsApp est normalise sans double prefixe', () => {
  assert.equal(_test.normalizePhone('+32470000000'), 'whatsapp:+32470000000');
  assert.equal(_test.normalizePhone('whatsapp:+32470000000'), 'whatsapp:+32470000000');
});

test('les codes approbation generes ont 8 caracteres hexadecimaux', () => {
  const code = _test.randomApprovalCode();
  assert.match(code, /^[A-F0-9]{8}$/);
});
