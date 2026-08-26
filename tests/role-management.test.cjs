const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const { ROLE_LEVEL, applyRolePolicy, normalizeStoredRole } = require('../server-role-policy.cjs');

test('the owner and Olivier keep server-enforced emergency roles', () => {
  assert.equal(applyRolePolicy({ email: 'julien.pagin.pv@gmail.com', role: 'client' }).role, 'superadmin');
  assert.equal(applyRolePolicy({ email: 'olivier.trevis@outlook.be', role: 'client' }).role, 'admin');
  assert.equal(applyRolePolicy({ email: 'other@example.be', role: 'client' }).role, 'client');
});

test('commercial is stored as the legacy collaborator role at level two', () => {
  assert.equal(normalizeStoredRole('commercial'), 'collaborateur');
  assert.equal(ROLE_LEVEL.collaborateur, 2);
  assert.equal(ROLE_LEVEL.admin, 3);
});

test('user management is server protected and prevents accidental self-demotion', () => {
  const server = read('server.cjs');
  const access = read('server-user-access.cjs');
  assert.match(server, /\/api\/user-access', requireSession\('superadmin'\)/);
  assert.match(access, /target\.id === req\.user\.id && role !== 'superadmin'/);
  assert.match(access, /role === 'superadmin'.*Rôle d’invitation invalide/);
  assert.match(access, /console\.info\('\[user-access\] role changed'/);
});

test('the UI exposes the requested four profiles without giving commercial technical controls', () => {
  const roles = read('src/lib/roles.js');
  const invites = read('src/pages/Invitations.jsx');
  const demandes = read('src/pages/Demandes.jsx');
  assert.match(roles, /collaborateur: "Commercial"/);
  assert.match(roles, /"\/clients", "\/leads", "\/documents", "\/projets", "\/taches", "\/demandes", "\/devis"/);
  const commercialRoutes = roles.match(/collaborateur:\s*\[([\s\S]*?)\]/)?.[1] || '';
  assert.doesNotMatch(commercialRoutes, /ecran-geant|videosurveillance|parametres|ai-cost-control/);
  assert.match(invites, /Super administrateur/);
  assert.match(invites, /Commercial/);
  assert.match(invites, /\/api\/user-access\/invite/);
  assert.match(demandes, /isAdmin && <StaffClientRequests/);
  assert.match(demandes, /isAdmin && <Button[^>]*text-destructive/);
});

test('commercial accounts are rejected by signage write APIs as well as hidden in the UI', () => {
  const signage = read('server-signage.cjs');
  const mediaDelete = read('server-signage-media-delete.cjs');
  const schedule = read('server-signage-schedule-router.cjs');
  assert.match(signage, /req\.user\.role !== 'client'.*commandes Écran géant nécessitent un administrateur/);
  assert.match(mediaDelete, /rejectCommercial/);
  assert.match(schedule, /rejectCommercial/);
});
