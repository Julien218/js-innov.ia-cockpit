const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const { ROLE_LEVEL, applyRolePolicy, normalizeStoredRole } = require('../server-role-policy.cjs');

test('the requested owner and administrator roles are enforced by the server', () => {
  assert.equal(applyRolePolicy({ email: 'julien.pagin.pv@gmail.com', role: 'client' }).role, 'superadmin');
  assert.equal(applyRolePolicy({ email: 'olivier.trevis@outlook.be', role: 'client' }).role, 'admin');
  assert.equal(applyRolePolicy({ email: 'other@example.be', role: 'client' }).role, 'client');
  assert.equal(normalizeStoredRole('commercial'), 'collaborateur');
  assert.equal(ROLE_LEVEL.collaborateur, 2);
});

test('only the super administrator manages team roles', () => {
  const server = read('server.cjs');
  const access = read('server-user-access.cjs');
  assert.match(server, /\/api\/user-access', requireSession\('superadmin'\)/);
  assert.match(access, /target\.id === req\.user\.id && role !== 'superadmin'/);
  assert.match(access, /role === 'superadmin'.*Rôle d’invitation invalide/);
});

test('commercial access includes work views but excludes sensitive controls', () => {
  const roles = read('src/lib/roles.js');
  const commercialRoutes = roles.match(/collaborateur:\s*\[([\s\S]*?)\]/)?.[1] || '';
  assert.match(roles, /collaborateur: "Commercial"/);
  assert.match(commercialRoutes, /clients/);
  assert.match(commercialRoutes, /devis/);
  assert.doesNotMatch(commercialRoutes, /factures|emails|ecran-geant|parametres|ai-cost-control/);
});

test('invitations have a complete activation flow', () => {
  const invites = read('src/pages/Invitations.jsx');
  const register = read('src/pages/Register.jsx');
  const auth = read('server-auth.cjs');
  assert.match(invites, /Commercial/);
  assert.match(invites, /\/api\/user-access\/invite/);
  assert.match(register, /\/api\/auth\/activate/);
  assert.match(auth, /router\.get\('\/invite'/);
  assert.match(auth, /router\.post\('\/activate'/);
});
