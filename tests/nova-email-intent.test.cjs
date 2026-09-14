const test = require('node:test');
const assert = require('node:assert/strict');
const { isEmailTriage, triageEmails } = require('../server-nova-email-triage.cjs');
const { beginRequest, isCurrentTurn, requestedTaskStatus, taskStatusMatches } = require('../server-assistant-intent.cjs');
const user = { id: 'owner-email-test', organisation: 'jsinnovia', role: 'superadmin' };
const task = { id: 'task-client-list', titre: 'Ajouter et compléter la liste des clients', organisation_id: 'jsinnovia', statut: 'a_faire' };
const action = { type: 'update_task_status', id: task.id, payload: { statut: 'en_cours' } };
const boxes = [
  { id: 'store', label: 'JS Store', email: 'info@jsinnovia.store' },
  { id: 'assurances', label: 'Assurances Dour', email: 'info@assurances-dour.be' },
];
function mailboxFixture() {
  const calls = [];
  const deps = { mailboxes: async () => ({ boxes }), read: async id => {
    calls.push(id);
    return { total: 200, emails: [
      { uid: 1, subject: 'Facture abonnement', from: 'billing@example.test' },
      { uid: 2, subject: 'Demande de devis', from: 'client@example.test' },
      { uid: 3, subject: 'Build succeeded', from: 'notifications@github.com' },
      { uid: 4, subject: 'Bonjour', from: 'contact@example.test' },
    ] };
  } };
  return { deps, calls, run: options => triageEmails({ message: 'triller les emails', user, deps, ...options }) };
}

test('la formulation exacte triller les emails est reconnue et ne désigne aucune tâche', () => {
  for (const text of ['triller les emails', 'Trier les e-mails', 'classe les courriels']) assert.equal(isEmailTriage(text), true);
  assert.equal(requestedTaskStatus('triller les emails'), null);
  assert.equal(taskStatusMatches('triller les emails', action, task), false);
  assert.equal(isEmailTriage('Ajouter et compléter la liste des clients'), false);
});

test('sans boîte sélectionnée, Elynea demande laquelle au lieu de choisir une autre entreprise', async () => {
  const f = mailboxFixture(); const result = await f.run();
  assert.equal(result.confirmation, null); assert.equal(result.success, false);
  assert.match(result.content, /Quelle boîte/); assert.equal(f.calls.length, 0);
});

test('la boîte affichée est préclassée en lecture seule avec preuves par UID et sans modèle', async () => {
  const f = mailboxFixture(); const result = await f.run({ mailbox: 'store' });
  assert.equal(result.success, true); assert.equal(result.result.read_only, true);
  assert.equal(result.result.inspected, 4); assert.equal(result.result.total, 200);
  assert.deepEqual(f.calls, ['store']);
  assert.ok(Object.values(result.result.groups).every(group => group.length === 1));
  assert.match(result.content, /Aucun message déplacé/);
  assert.equal(result.confirmation, null);
});

test('une adresse explicite prime sur la boîte affichée, une adresse inconnue ou multiple ne bascule pas ailleurs', async () => {
  const f = mailboxFixture();
  assert.equal((await f.run({ message: 'Trier les emails de info@assurances-dour.be', mailbox: 'store' })).result.mailbox, 'assurances');
  for (const message of ['Trier les emails de inconnu@example.test', 'Trier les emails de info@assurances-dour.be et inconnu@example.test']) {
    assert.equal((await f.run({ message, mailbox: 'store' })).success, false);
  }
  assert.equal(f.calls.length, 1);
});

test('droits insuffisants, autre organisation ou négation n’accèdent pas aux boîtes', async () => {
  const f = mailboxFixture();
  for (const actor of [{ ...user, role: 'client' }, { ...user, role: 'admin' }, { ...user, organisation: 'other' }]) assert.equal((await f.run({ user: actor, mailbox: 'store' })).success, false);
  assert.equal((await f.run({ message: 'Ne trie pas les emails', mailbox: 'store' })).success, false);
  assert.equal(f.calls.length, 0);
});

test('une panne mail reste un échec explicite sans proposition CRM', async () => {
  const f = mailboxFixture(); f.deps.read = async () => { throw new Error('IMAP unavailable'); };
  const result = await f.run({ mailbox: 'store' });
  assert.equal(result.success, false); assert.equal(result.confirmation, null);
  assert.match(result.content, /indisponible/);
});

test('le préclassement mail ne bascule pas vers un modèle local sans accès aux boîtes', async () => {
  const { sendNovaChat } = await import('../src/lib/novaChatTransport.js');
  for (const offline of [true, false]) {
    await assert.rejects(sendNovaChat({ message: 'triller les emails', offline,
      sendCloud: async () => { throw new Error('Network error'); }, sendLocal: () => assert.fail('No local fallback'),
    }), error => error.emailVerification);
  }
});

test('une mise à jour de tâche exige le bon identifiant ou titre et le statut explicitement demandé', () => {
  assert.equal(taskStatusMatches(`Mets la tâche ${task.id} en cours`, action, task), true);
  assert.equal(taskStatusMatches(`Passe la tâche « ${task.titre} » en cours`, action, task), true);
  for (const text of [`Termine la tâche ${task.id}`, 'Mets la tâche autre-id en cours', `Explique comment mettre la tâche ${task.id} en cours`, `Délègue la tâche ${task.id} à NOVA`, 'Passe la tâche précédente en cours']) assert.equal(taskStatusMatches(text, action, task), false, text);
});

test('une nouvelle demande invalide le tour précédent, mais pas une autre conversation ou un autre compte', () => {
  const req = (id, conversation_id) => ({ user: { ...user, id }, body: { conversation_id } });
  const old = beginRequest(req('one', 'chat1'));
  const otherChat = beginRequest(req('one', 'chat2'));
  const otherUser = beginRequest(req('two', 'chat1'));
  beginRequest(req('one', 'chat1'));
  assert.equal(isCurrentTurn(old), false);
  assert.equal(isCurrentTurn(otherChat), true);
  assert.equal(isCurrentTurn(otherUser), true);
  assert.equal(isCurrentTurn(otherUser, { ...user, id: 'two', organisation: 'another-company' }), false);
  assert.equal(isCurrentTurn(otherUser, { ...user, id: 'two' }), true);
});

test('HTTP : emails sans action parasite, vieille confirmation rejetée, nouveau statut vérifié et usage unique', async t => {
  process.env.JSINNOVIA_AGENT_KEY = 'test-only';
  const cost = require('../server-ai-cost.cjs');
  t.mock.method(cost, 'authorizeUsage', async () => ({ allowed: true }));
  t.mock.method(require('../server-companion-memory.cjs'), 'buildHistoricalMemoryContext', async () => '');
  t.mock.method(require('../server-dropbox-helper.cjs'), 'buildDropboxContext', async () => '');
  const imap = require('../server-email.cjs');
  t.mock.method(imap, 'getMailboxConfig', id => ({ ...boxes.find(box => box.id === id), password: id === 'jsinnovia' ? '' : 'fake' }));
  t.mock.method(require('../server-google-mail.cjs'), 'fetchGoogleAccounts', async () => []);
  const fixture = mailboxFixture(); t.mock.method(imap, 'fetchEmails', fixture.deps.read);
  const express = require('express'); const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/assistant', require('../server-assistant-intent.cjs').router);
  app.use('/api/assistant', require('../server-assistant-batch.cjs'));
  app.use('/api/assistant', require('../server-assistant.cjs'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const networkFetch = global.fetch; let modelCalls = 0, writes = 0, releaseSlow, enteredSlow;
  const slowStarted = new Promise(resolve => { enteredSlow = resolve; });
  const slowGate = new Promise(resolve => { releaseSlow = resolve; });
  global.fetch = async (url, settings = {}) => {
    const target = new URL(url);
    if (target.hostname === '127.0.0.1') return networkFetch(url, settings);
    if (target.pathname === '/chat') {
      modelCalls++;
      const request = JSON.parse(settings.body);
      if (request.message.endsWith('(lent)')) { enteredSlow(); await slowGate; }
      if (request.available_actions?.length === 1 && request.available_actions[0] === 'create_task_batch') {
        return Response.json({ response: 'Lot préparé', proposed_action: { type: 'create_task_batch', payload: { tasks: [{ titre: 'Audit des factures', description: 'Lecture seule', read_only: true }] } } });
      }
      return Response.json({ response: 'J’ai préparé la délégation de la liste des clients.', action_summary: 'Délégation de la tâche à NOVA', proposed_action: action });
    }
    if (target.pathname === `/data/Tache/${task.id}`) {
      assert.equal(settings.headers['x-organisation-id'], 'jsinnovia');
      if (settings.method === 'PATCH') writes++;
      return Response.json(task);
    }
    if (target.pathname === '/data/LogAction') return Response.json({ id: 'log' });
    if (target.pathname.startsWith('/data/')) return Response.json([]);
    throw new Error(`Unexpected upstream ${target.pathname}`);
  };
  t.after(() => { global.fetch = networkFetch; delete process.env.JSINNOVIA_AGENT_KEY; server.closeAllConnections(); server.close(); });
  const post = async (path, body) => {
    const response = await networkFetch(`http://127.0.0.1:${server.address().port}/api/assistant/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: 'regression', ...body }) });
    return { status: response.status, data: await response.json() };
  };
  const first = await post('chat', { message: `Mets la tâche ${task.id} en cours` });
  assert.ok(first.data.confirmation?.token); assert.doesNotMatch(first.data.message, /[Dd]élégation/);
  const email = await post('chat', { message: 'triller les emails', mailbox: 'store' });
  assert.equal(email.data.action_type, 'email_triage_preview'); assert.equal(email.data.success, true);
  assert.equal(email.data.confirmation, null); assert.equal(modelCalls, 1);
  assert.equal((await post('confirm', { token: first.data.confirmation.token })).status, 400);
  assert.equal(writes, 0);
  const bare = await post('chat', { message: 'oui' });
  assert.equal(bare.data.confirmation, null); assert.equal(modelCalls, 1);
  assert.match(bare.data.message, /Aucune action exécutable n’est en attente/);
  const unrelated = await post('chat', { message: 'Bonjour' });
  assert.equal(unrelated.data.confirmation, null); assert.match(unrelated.data.message, /bloquée/);
  const fresh = await post('chat', { message: `Mets la tâche ${task.id} en cours` });
  assert.equal((await post('confirm', { token: fresh.data.confirmation.token })).status, 200);
  assert.equal((await post('confirm', { token: fresh.data.confirmation.token })).status, 400);
  assert.equal(writes, 1);
  const cancelled = await post('chat', { message: `Mets la tâche ${task.id} en cours` });
  await post('cancel', { request_nonce: cancelled.data.confirmation.request_nonce });
  assert.equal((await post('confirm', { token: cancelled.data.confirmation.token })).status, 400);
  assert.equal(writes, 1);
  const batch = await post('chat', { message: 'Prépare plusieurs tâches pour les agents' });
  assert.equal(batch.data.confirmation?.type, 'create_task_batch');
  await post('chat', { message: 'triller les emails', mailbox: 'store' });
  assert.equal((await post('confirm', { token: batch.data.confirmation.token })).status, 400);
  const slow = post('chat', { message: `Mets la tâche ${task.id} en cours (lent)` });
  await slowStarted;
  await post('chat', { message: 'triller les emails', mailbox: 'store' });
  releaseSlow();
  assert.equal((await slow).status, 409);
  assert.equal(writes, 1);
});
