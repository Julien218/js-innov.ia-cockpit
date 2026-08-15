const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanTenant, resolveTenant } = require('../server-tenant.cjs');

test('normalise un identifiant organisation', () => {
  assert.equal(cleanTenant('Olivier Trevis SRL'), 'olivier-trevis-srl');
  assert.equal(cleanTenant('JS_Innov.IA'), 'js_innov-ia');
});

test('utilise jsinnovia comme organisation interne par défaut', () => {
  assert.equal(resolveTenant({ user: { role: 'superadmin' }, headers: {} }), 'jsinnovia');
});

test('refuse le changement d organisation hors superadmin', () => {
  assert.throws(() => resolveTenant({ user: { role: 'admin', organisation: 'client-a' }, headers: { 'x-managed-organisation': 'client-b' } }), /superadministrateur/);
});
