const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../server-assistant-intent.cjs'), 'utf8');

// Isolated middleware harness: real intent module, fake Express transport, no external service.
function load() {
  let middleware;
  const router = { use: value => { middleware = value; }, post: () => {} };
  const module = { exports: {} };
  const context = {
    module, exports: module.exports, process, console, Date, Map, Set, URL, AbortSignal,
    fetch: () => { throw new Error('Network use is forbidden in this test'); },
    require: name => {
      if (name === 'express') return { Router: () => router };
      if (name === './server-tenant.cjs') return { cleanTenant: v => String(v || '').toLowerCase() };
      if (name === './server-immediate-execution-policy.cjs') return { stripInjectedContext: v => String(v || '').replace(/\[(?:AUTORISATION COCKPIT|DIAGNOSTIC LOCAL LECTURE SEULE)[^\]]*\][\s\S]*?\[\/(?:AUTORISATION COCKPIT|DIAGNOSTIC LOCAL LECTURE SEULE)\]/gi, '').trim() };
      return require(name);
    },
  };
  vm.runInNewContext(source, context, { filename: 'server-assistant-intent.cjs' });
  return { ...module.exports, middleware };
}
function request(url, body = {}, userId = 'u1') {
  return { url, method: 'POST', body, user: { id: userId, organisation: 'org1', role: 'superadmin' }, get path() { return this.url; } };
}
function response() {
  return { statusCode: 200, value: null, status(value) { this.statusCode = value; return this; }, json(value) { this.value = value; return this; } };
}
async function propose(api, conversation = 'one', token = 'valid-token', type = 'create_video_generation', summary = 'Création vidéo : Léo et la clé magique') {
  const req = request('/chat', { message: 'crée la vidéo', conversation_id: conversation });
  const res = response();
  await api.middleware(req, res, () => res.json({ message: 'Confirmez cette action.', confirmation: { token, type, summary, request_nonce: req.novaTurn?.nonce } }));
  return { req, res };
}

for (const phrase of ['Je confirme la création de la vidéo', 'Je confirme la réalisation de la vidéo', 'oui je confirme tu peux lancer la génération d’image']) {
  test(`recognizes named confirmation: ${phrase}`, () => assert.equal(load().confirmationActionSignal(phrase), true));
}
for (const phrase of ['non je ne confirme pas', 'oui mais annule', 'je confirme mais change le projet', 'oui sans lancer la génération']) {
  test(`does not authorize a negated or changed instruction: ${phrase}`, () => {
    const api = load();
    assert.equal(api.bareConfirmationSignal(phrase), false);
    assert.equal(api.confirmationActionSignal(phrase), false);
  });
}

test('polite immediate voice confirmation is recognized', () => {
  assert.equal(load().bareConfirmationSignal("Oui immédiatement s'il te plaît merci."), true);
});

test('named confirmation consumes the exact proposal only once', async () => {
  const api = load();
  await propose(api);
  let writes = 0;
  const firstReq = request('/chat', { message: 'Je confirme la réalisation de la vidéo', conversation_id: 'one' });
  const first = response();
  await api.middleware(firstReq, first, () => {
    writes++;
    assert.equal(firstReq.url, '/confirm');
    assert.equal(firstReq.body.token, 'valid-token');
    return first.json({ success: true, execution: { target: 'job1' }, result: { id: 'job1', status: 'queued' } });
  });
  const second = response();
  await api.middleware(request('/chat', { message: 'Je confirme', conversation_id: 'one' }), second, () => { writes++; });
  assert.equal(writes, 1);
  assert.equal(second.value.duplicate, true);
  assert.equal(second.value.execution_status, 'queued');
  assert.equal(second.value.execution_id, first.value.execution_id);
});

test('concurrent direct confirmations do not dispatch a client action twice', async () => {
  const api = load();
  await propose(api);
  let writes = 0;
  const first = response();
  await api.middleware(request('/confirm', { token: 'valid-token', conversation_id: 'one' }), first, () => { writes++; });
  const parallel = response();
  await api.middleware(request('/confirm', { token: 'valid-token', conversation_id: 'one' }), parallel, () => { writes++; });
  assert.equal(parallel.statusCode, 202);
  assert.equal(writes, 1);
  first.json({ success: true, client_action: { url: '/api/video-generation/jobs', method: 'POST' }, completion_token: 'completion' });
  const retry = response();
  await api.middleware(request('/confirm', { token: 'valid-token', conversation_id: 'one' }), retry, () => { writes++; });
  assert.equal(retry.value.execution_status, 'dispatched');
  assert.equal(retry.value.client_action, undefined);
  assert.equal(retry.value.completion_token, undefined);
  assert.equal(writes, 1);
});

test('direct confirm recovers the original conversation from an owned token', async () => {
  const api = load();
  await propose(api, 'specific');
  const req = request('/confirm', { token: 'valid-token' });
  let called = false;
  await api.middleware(req, response(), () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.body.conversation_id, 'specific');
});

test('a different user cannot consume or invalidate the original token', async () => {
  const api = load();
  await propose(api);
  const outsider = response();
  let calls = 0;
  await api.middleware(request('/confirm', { token: 'valid-token', conversation_id: 'one' }, 'u2'), outsider, () => { calls++; });
  assert.equal(outsider.statusCode, 400);
  await api.middleware(request('/confirm', { token: 'valid-token', conversation_id: 'one' }), response(), () => { calls++; });
  assert.equal(calls, 1);
});

test('a confirmation naming a different media kind or title is blocked', async () => {
  const api = load();
  await propose(api);
  for (const phrase of ['Je confirme la génération de l’image', 'Je confirme la création de la vidéo Espace C']) {
    const res = response();
    await api.middleware(request('/chat', { message: phrase, conversation_id: 'one' }), res, () => assert.fail('must not execute'));
    assert.equal(res.value.execution_status, 'target_mismatch');
  }
});

test('a confirmation cannot jump to another conversation', async () => {
  const api = load();
  await propose(api, 'one');
  const res = response();
  await api.middleware(request('/chat', { message: 'je confirme', conversation_id: 'two' }), res, () => assert.fail('must not execute'));
  assert.equal(res.value.execution_status, 'not_prepared');
});

test('unbacked named confirmation does not re-enter the model proposal loop', async () => {
  const api = load();
  const res = response();
  await api.middleware(request('/chat', { message: 'Je confirme la création de la vidéo' }), res, () => assert.fail('must not create another proposal'));
  assert.equal(res.value.execution_status, 'not_prepared');
});

test('explicit email-send recovery remains available without a token', async () => {
  const api = load();
  let called = false;
  await api.middleware(request('/chat', { message: 'Je confirme et envoie le mail' }), response(), () => { called = true; });
  assert.equal(called, true);
});

test('ready follow-up reports the last actual receipt instead of another subject', async () => {
  const api = load();
  await propose(api);
  const res = response();
  await api.middleware(request('/chat', { message: 'Je confirme', conversation_id: 'one' }), res,
    () => res.json({ success: true, execution: { target: 'job' }, result: { status: 'queued' } }));
  const status = response();
  await api.middleware(request('/chat', { message: "C'est prêt ?", conversation_id: 'one' }), status, () => assert.fail('must not ask the model to invent a status'));
  assert.equal(status.value.execution_status, 'queued');
  assert.equal(status.value.current_status_verified, false);
  assert.match(status.value.message, /file d’attente/);
});

test('a new subject clears an earlier confirmation receipt', async () => {
  const api = load();
  await propose(api);
  const res = response();
  await api.middleware(request('/chat', { message: 'Je confirme', conversation_id: 'one' }), res,
    () => res.json({ success: true, execution: { target: 'job' }, result: { status: 'queued' } }));
  await api.middleware(request('/chat', { message: 'liste mes emails', conversation_id: 'one' }), response(), () => {});
  const status = response();
  await api.middleware(request('/chat', { message: "C'est prêt ?", conversation_id: 'one' }), status, () => assert.fail('must not claim old job is the email request'));
  assert.equal(status.value.execution_status, 'unverified');
});

for (const phrase of ['Souhaitez-vous confirmer cette action ?', 'Souhaites-tu que je lance cette génération ?', 'Je vous demande de confirmer cette action.', 'Elle est en attente de confirmation.', 'Je confirme l’action pour générer cette image.']) {
  test(`removes confirmation language without an actual token: ${phrase}`, () => {
    const result = load().stripUnbackedConfirmationLanguage(phrase);
    assert.match(result, /Aucune action exécutable/);
  });
}

test('client completion report is explicitly not server-verified evidence', () => {
  const api = load();
  const req = request('/complete', { success: false });
  const payload = api.normalizeAssistantPayload(req, { success: true });
  assert.equal(payload.report_received, true);
  assert.equal(payload.execution_status, 'reported_failure');
  assert.equal(payload.verified, false);
});

test('same task title in two projects is not collapsed into a duplicate', () => {
  const report = load().summarizeTaskDispatches([
    { id: 'one', titre: 'Créer la vidéo', projet_id: 'story', statut: 'en_cours' },
    { id: 'two', titre: 'Créer la vidéo', projet_id: 'espace-c', statut: 'en_cours' },
  ], []);
  assert.equal(report.unique_tasks, 2);
  assert.equal(report.duplicate_task_rows, 0);
});

test('proposal and execution share a stable identifier', async () => {
  const api = load();
  const proposal = await propose(api);
  const res = response();
  await api.middleware(request('/confirm', { token: 'valid-token' }), res,
    () => res.json({ success: true, execution: { target: 'job' }, result: { status: 'queued' } }));
  assert.ok(proposal.res.value.confirmation.execution_id);
  assert.equal(res.value.execution_id, proposal.res.value.confirmation.execution_id);
});

test('receipt is not reused after switching projects in the same conversation', async () => {
  const api = load();
  await propose(api);
  const res = response();
  await api.middleware(request('/chat', { message: 'Je confirme', conversation_id: 'one' }), res,
    () => res.json({ success: true, execution: { target: 'job' }, result: { status: 'queued' } }));
  const status = response();
  await api.middleware(request('/chat', { message: "C'est prêt ?", conversation_id: 'one', project_id: 'other' }), status, () => assert.fail('wrong project'));
  assert.equal(status.value.execution_status, 'unverified');
  const replay = response();
  await api.middleware(request('/confirm', { token: 'valid-token', project_id: 'other' }), replay, () => assert.fail('wrong project'));
  assert.equal(replay.statusCode, 400);
});

test('rejected completion is not presented as an accepted report', () => {
  const payload = load().normalizeAssistantPayload(request('/complete', { success: true }), { error: 'invalid token' });
  assert.equal(payload.report_received, undefined);
});
