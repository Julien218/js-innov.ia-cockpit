const test = require('node:test');
const assert = require('node:assert/strict');
const { listMissDourRegistrations } = require('../server-miss-dour-data.cjs');
const { COLLECTIONS, canAccessCollection, recordsToCsv, publicCollection, backupCollection, router } = require('../server-project-data.cjs');
const express = require('express');
const collection = COLLECTIONS.find(row => row.key === 'miss-mister-dour-inscriptions');
process.env.MISS_DOUR_REGISTRATIONS_URL = 'https://example.invalid/api/integrations/cockpit/registrations';
process.env.MISS_DOUR_REGISTRATIONS_TOKEN = 'test-only-'.repeat(8);
const row = { id: 'candidate:0000000001', first_name: 'Test', last_name: 'Local', year: 2026, source: 'candidate' };
const response = (rows, nextCursor = null) => new Response(JSON.stringify({ collection: collection.key, year: 2026, records: rows, nextCursor }), { headers: { 'content-type': 'application/json' } });

test('Starlight Miss Dour est distinct de Tour de Dour, lecture seule et sans sauvegarde externe', async () => {
  assert.equal(collection.client, 'Starlight ASBL'); assert.equal(collection.project, 'Miss et Mister Dour');
  assert.equal(publicCollection(collection, { role: 'superadmin' }).canManage, false);
  assert.equal(publicCollection(collection, { role: 'superadmin' }).dropboxBackupConfigured, false);
  await assert.rejects(backupCollection(collection), /n’est pas activée/);
});
test('les comptes non autorisés restent exclus même avec un libellé Starlight', () => {
  assert.equal(canAccessCollection(null, collection), false);
  assert.equal(canAccessCollection({ role: 'client', email: 'other@example.invalid', organisation: 'Starlight ASBL' }, collection), false);
  assert.equal(canAccessCollection({ role: 'superadmin' }, collection), true);
  const scoped = { ...collection, allowedEmails: new Set(['client@example.invalid']) };
  assert.equal(canAccessCollection({ role: 'client', email: 'client@example.invalid' }, scoped), true);
  assert.equal(canAccessCollection({ role: 'admin', email: 'other@example.invalid' }, scoped), false);
});
test('pagination complète, secret uniquement serveur et projection des champs', async () => {
  let requests = 0;
  const records = await listMissDourRegistrations(async (url, options) => {
    requests += 1;
    assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    assert.ok(options.headers.Authorization.startsWith('Bearer '));
    assert.equal(url.searchParams.has('token'), false);
    return requests === 1 ? response([{ ...row, passwordHash: 'secret', ipAddressHash: 'private' }], row.id) : response([{ ...row, id: 'candidate:0000000002' }]);
  });
  assert.equal(records.length, 2); assert.equal(requests, 2);
  assert.equal('passwordHash' in records[0], false); assert.equal('ipAddressHash' in records[0], false);
});
test('une panne ne devient jamais une liste vide', async () => {
  await assert.rejects(listMissDourRegistrations(async () => new Response('failure', { status: 503 })), /indisponible/);
});
test('refuse les redirections masquées HTML et les autres éditions', async () => {
  await assert.rejects(listMissDourRegistrations(async () => new Response('<iframe>', { headers: { 'content-type': 'text/html' } })), /attendues/);
  await assert.rejects(listMissDourRegistrations(async () => response([{ ...row, year: 2027 }])), /invalide/);
});
test('une pagination répétée échoue au lieu de boucler ou dupliquer', async () => {
  await assert.rejects(listMissDourRegistrations(async () => response([row], row.id)), /Pagination/);
});
test('CSV contient les coordonnées mais ni clés ni mots de passe; formules neutralisées', () => {
  const csv = recordsToCsv([{ ...row, first_name: '=2+2', email: 'test@example.invalid', phone: '+320000', passwordHash: 'SECRET' }], collection);
  assert.match(csv, /Prénom/); assert.match(csv, /test@example.invalid/); assert.match(csv, /'\+320000/);
  assert.doesNotMatch(csv, /SECRET/); assert.match(csv, /'=2\+2/);
});
test('routes protégées : aucun accès aux lignes, CSV, sauvegarde ou modération pour un autre client', async () => {
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.user = { role: 'client', email: 'other@example.invalid' }; next(); });
  app.use('/data', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/data`;
    for (const [suffix, method] of [['records', 'GET'], ['export.csv', 'GET'], ['backup', 'POST'], ['records/any', 'PATCH']]) {
      const res = await fetch(`${base}/${collection.key}/${suffix}`, { method }); assert.equal(res.status, 404);
    }
    const res = await fetch(`${base}/collections`); assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual((await res.json()).collections, []);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
