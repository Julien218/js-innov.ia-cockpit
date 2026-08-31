const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDemandeWrite } = require('../server-demande-status.cjs');
// Demande_statut_check read from pg_constraint on 2026-08-31 and all five
// transitions verified against PostgreSQL in a rolled-back subtransaction.
const databaseStatuses = ['nouveau', 'lu', 'en_cours', 'traite', 'archive'];

test('les options et filtres du formulaire correspondent à la contrainte PostgreSQL', async () => {
  const { DEMANDE_STATUS_OPTIONS, DEMANDE_STATUS_FILTERS, demandeFormData, demandeStatus } = await import('../src/lib/demandePresentation.js');
  assert.deepEqual(DEMANDE_STATUS_OPTIONS.map(option => option.value), databaseStatuses);
  assert.deepEqual(Object.keys(DEMANDE_STATUS_FILTERS), databaseStatuses);
  for (const statut of databaseStatuses) assert.equal(demandeFormData({ statut }).statut, statut);
  assert.equal(demandeStatus({ statut: 'ferme' }), 'archive');
  assert.equal(demandeFormData({ statut: 'ferme' }).statut, 'archive');
});

test('le serveur accepte les anciens libellés sans jamais transmettre un statut invalide', () => {
  for (const [legacy, canonical] of Object.entries({ ferme: 'archive', ouverte: 'nouveau', en_traitement: 'en_cours', resolue: 'traite' })) {
    assert.equal(normalizeDemandeWrite({ statut: legacy }).statut, canonical);
  }
  for (const statut of ['unknown', '', null, 42, {}, '__proto__', 'constructor']) {
    assert.throws(() => normalizeDemandeWrite({ statut }), error => error.status === 422);
  }
  assert.deepEqual(normalizeDemandeWrite({ nom: 'Contact' }), { nom: 'Contact' });
  assert.deepEqual(normalizeDemandeWrite({ nom: 'Contact' }, 'POST'), { nom: 'Contact', statut: 'nouveau' });
});

test('chaque choix du formulaire traverse la vraie route HTTP, avec compatibilité et permissions', async () => {
  process.env.AGENT_API_KEY = 'local-test-key';
  const express = require('express');
  const router = require('../server-data-proxy.cjs');
  const { DEMANDE_STATUS_OPTIONS, demandeFormData } = await import('../src/lib/demandePresentation.js');
  const nativeFetch = global.fetch;
  let upstreamCalls = 0;
  let user = { id: 'test-user', role: 'superadmin', email: 'test@example.test', organisation: 'jsinnovia' };
  global.fetch = async (url, options) => {
    upstreamCalls++;
    assert.match(new URL(url).pathname, /^\/data\/Demande/);
    const payload = JSON.parse(options.body);
    assert.equal(payload.organisation_id, 'jsinnovia');
    assert.equal(options.headers['x-organisation-id'], 'jsinnovia');
    assert.ok(!Object.hasOwn(payload, 'statut') || databaseStatuses.includes(payload.statut), 'Would violate Demande_statut_check');
    return new Response(JSON.stringify({ id: 'request-test', ...payload }), { headers: { 'Content-Type': 'application/json' } });
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/data', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const request = (body, method = 'PATCH') => nativeFetch(`http://127.0.0.1:${server.address().port}/api/data/Demande${method === 'POST' ? '' : '/request-test'}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    for (const { value } of DEMANDE_STATUS_OPTIONS) {
      const response = await request(demandeFormData({ nom: 'Contact original', message: 'À conserver', statut: value }));
      assert.equal(response.status, 200);
      const saved = await response.json();
      assert.equal(saved.statut, value);
      assert.equal(saved.message, 'À conserver');
    }
    const legacy = await request({ statut: 'ferme' });
    assert.equal(legacy.status, 200);
    assert.equal((await legacy.json()).statut, 'archive');
    const partial = await request({ telephone: '0123456789' });
    assert.ok(!Object.hasOwn(await partial.json(), 'statut'));
    const created = await request({ nom: 'Contact' }, 'POST');
    assert.equal((await created.json()).statut, 'nouveau');
    const beforeRefusals = upstreamCalls;
    assert.equal((await request({ statut: 'invalid' })).status, 422);
    assert.equal((await request({ statut: 'archive', organisation_id: 'other' })).status, 403);
    user = { ...user, role: 'client' };
    assert.equal((await request({ statut: 'archive' })).status, 403);
    assert.equal(upstreamCalls, beforeRefusals);
  } finally {
    global.fetch = nativeFetch;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
