const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { COLLECTIONS, canAccessCollection, recordsToCsv, isoWeekKey } = require('../server-project-data.cjs');

test('les données Tour de Dour sont cloisonnées à Olivier et au superadministrateur', () => {
  const collection = COLLECTIONS.find((item) => item.key === 'tour-de-dour-mascotte');
  assert.ok(collection);
  assert.equal(canAccessCollection({ role: 'superadmin', email: 'owner@example.com' }, collection), true);
  assert.equal(canAccessCollection({ role: 'client', email: 'olivier.trevis@outlook.be' }, collection), true);
  assert.equal(canAccessCollection({ role: 'admin', email: 'autre-client@example.com' }, collection), false);
});

test('l’export CSV est compatible Excel et neutralise les formules injectées', () => {
  const csv = recordsToCsv([{ suggested_name: '=2+2', reason: 'raison', display_name: 'Habitant', status: 'pending', created_at: '2026-08-29T10:00:00Z' }]);
  assert.match(csv, /^\uFEFF/);
  assert.match(csv, /"'=2\+2"/);
  assert.match(csv, /Prénom proposé/);
});

test('la sauvegarde hebdomadaire utilise un nom déterministe', () => {
  assert.equal(isoWeekKey(new Date('2026-08-29T12:00:00Z')), '2026-S35');
});

test('le module est branché dans le serveur, le cockpit et l’image Railway', () => {
  assert.match(read('server.cjs'), /\/api\/project-data/);
  assert.match(read('src/App.jsx'), /donnees-projets/);
  assert.match(read('src/components/layout/Sidebar.jsx'), /Données projets/);
  assert.match(read('Dockerfile'), /server-project-data\.cjs/);
  const catalog = JSON.parse(read('permission-catalog.json'));
  assert.ok(catalog.some((permission) => permission.code === 'project_data'));
});
