const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real middleware with a fake transport; never call a provider or a database.
function load() {
  let middleware;
  const router = { use: fn => { middleware = fn; }, post: () => {} };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../server-assistant-intent.cjs'), 'utf8');
  vm.runInNewContext(source, {
    module, exports: module.exports, process: { env: {} }, console, Date, Map, Set, URL, AbortSignal,
    fetch: () => assert.fail('No network request is allowed in this regression suite'),
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === './server-tenant.cjs') return { cleanTenant: v => String(v || '').toLowerCase() };
      if (name === './server-immediate-execution-policy.cjs') return { stripInjectedContext: v => String(v || '').replace(/\[(?:AUTORISATION COCKPIT|DIAGNOSTIC LOCAL LECTURE SEULE)[^\]]*\][\s\S]*?\[\/(?:AUTORISATION COCKPIT|DIAGNOSTIC LOCAL LECTURE SEULE)\]/gi, '').trim() };
      return require(name);
    },
  }, { filename: 'server-assistant-intent.cjs' });
  return { ...module.exports, middleware };
}
function req(message, overrides = {}) {
  return {
    url: '/chat', method: 'POST', user: { id: 'compat-owner', organisation: 'jsinnovia', role: 'superadmin' },
    body: { message, conversation_id: 'story', project_id: 'leo', ...overrides },
    get path() { return this.url; },
  };
}
function res() {
  return { statusCode: 200, value: null, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } };
}
async function propose(api) {
  const result = res();
  await api.middleware(req('Prépare la vidéo de Léo'), result, () => result.json({
    confirmation: { token: 'compat-token', type: 'create_video_generation', summary: 'Création vidéo : Léo et la clé magique' },
  }));
  return result.value.confirmation;
}

test('unsupported business creation is not captured as a confirmation action', () => {
  const api = load();
  for (const phrase of [
    'oui lance la création du devis', 'je confirme la création de la facture',
    'oui lance la création du projet', 'oui lance la création de la tâche',
    'oui lance la création du devis pour la vidéo',
  ]) assert.equal(api.confirmationActionSignal(phrase), false, phrase);
});

test('compound bare confirmations consume the same pending proposal only once', async () => {
  for (const phrase of ['ok je confirme', 'oui je confirme', 'Oui, je confirme.', 'oki je confirme maintenant', "Oui immédiatement s'il te plaît merci."]) {
    const api = load();
    const proposal = await propose(api);
    let writes = 0;
    const firstReq = req(phrase), first = res();
    await api.middleware(firstReq, first, () => {
      writes++;
      assert.equal(firstReq.url, '/confirm', phrase);
      assert.equal(firstReq.body.token, 'compat-token', phrase);
      first.json({ success: true, execution: { target: 'job-leo' }, result: { id: 'job-leo', status: 'queued' } });
    });
    assert.equal(writes, 1, phrase);
    assert.equal(first.value.execution_id, proposal.execution_id, phrase);
    const repeated = res();
    await api.middleware(req(phrase), repeated, () => { writes++; });
    assert.equal(writes, 1, phrase);
    assert.equal(repeated.value.duplicate, true, phrase);
    assert.equal(repeated.value.execution_status, 'queued', phrase);
    assert.equal(repeated.value.execution_id, proposal.execution_id, phrase);
  }
});

test('legacy approval and awaiting review remain pending, never falsely running or completed', () => {
  const api = load();
  const statuses = ['approval_granted', 'awaiting_approval', 'awaiting_review'];
  const report = api.summarizeTaskDispatches(
    statuses.map((status, i) => ({ id: `task-${i}`, titre: `Objective ${i}`, statut: 'en_cours' })),
    statuses.map((status, i) => ({ id: `run-${i}`, task_id: `task-${i}`, status, created_at: '2026-09-01T10:00:00Z' })),
    Date.parse('2026-09-26T10:00:00Z'),
  );
  assert.equal(report.awaiting_validation, 3);
  assert.equal(report.active, 0);
  assert.equal(report.unsynchronised_results, 0);
  assert.equal(report.stale, 0);
  const message = api.dispatchReportMessage(report);
  assert.match(message, /3 en attente de validation/);
  assert.match(message, /0 réellement active/);
  assert.match(message, /sans aucune modification/);
});

test('supported named media and explicit send/execute confirmations are preserved', () => {
  const api = load();
  for (const phrase of [
    'Je confirme la création de la vidéo', 'Je confirme la réalisation de la vidéo',
    'oui je confirme tu peux lancer la génération d’image', 'oui lance le montage TikTok',
    'Je confirme et envoie le mail', 'confirmer et envoyer', 'oui execute cette action',
  ]) assert.equal(api.confirmationActionSignal(phrase), true, phrase);
});

test('negations, changed instructions and questions never become bare authorization', () => {
  const api = load();
  for (const phrase of ['non je ne confirme pas', 'oui mais annule', 'je confirme mais change le projet', 'oui sans lancer la génération', 'ok je confirme mais change la vidéo', 'oui je confirme ?', 'oui je confirme un nouveau devis']) {
    assert.equal(api.bareConfirmationSignal(phrase), false, phrase);
  }
  for (const phrase of ['non je ne confirme pas', 'oui mais annule', 'je confirme mais change le projet', 'oui sans lancer la génération', 'ok je confirme mais change la vidéo']) {
    assert.equal(api.confirmationActionSignal(phrase), false, phrase);
  }
});

test('a compound confirmation without a proposal does not create a new action', async () => {
  const api = load(), result = res();
  await api.middleware(req('ok je confirme'), result, () => assert.fail('Must not fall back to a creation intent'));
  assert.equal(result.value.execution_status, 'not_prepared');
});

test('a bare confirmation never falls back into a new business-creation request', async () => {
  const api = load();
  const proposalResponse = res();
  await api.middleware(req('Prépare le devis'), proposalResponse, () => proposalResponse.json({
    confirmation: { token: 'quote-token', type: 'create_quote', summary: 'Créer le devis préparé' },
  }));
  const confirmationReq = req('ok je confirme'), result = res();
  let calls = 0;
  await api.middleware(confirmationReq, result, () => {
    calls++;
    assert.equal(confirmationReq.url, '/confirm');
    assert.equal(confirmationReq.body.token, 'quote-token');
    result.json({ success: true, execution: { target: 'quote-1' }, result: { id: 'quote-1' } });
  });
  assert.equal(calls, 1);
  assert.equal(result.value.execution_id, proposalResponse.value.confirmation.execution_id);
});

test('a newly named business request is left to its own handler, not the stale media proposal', async () => {
  const api = load();
  await propose(api);
  const next = req('oui lance la création du devis');
  let calls = 0;
  await api.middleware(next, res(), () => { calls++; assert.equal(next.url, '/chat'); });
  assert.equal(calls, 1);
  const confirm = res();
  await api.middleware(req('ok je confirme'), confirm, () => assert.fail('The media proposal must not survive a new subject'));
  assert.equal(confirm.value.execution_status, 'not_prepared');
});

test('compound confirmation retains project isolation', async () => {
  const api = load(); await propose(api);
  const result = res();
  await api.middleware(req('ok je confirme', { project_id: 'espace-c' }), result, () => assert.fail('Wrong project'));
  assert.equal(result.value.execution_status, 'target_mismatch');
});

test('compound confirmation retains conversation isolation', async () => {
  const api = load(); await propose(api);
  const result = res();
  await api.middleware(req('ok je confirme', { conversation_id: 'other' }), result, () => assert.fail('Wrong conversation'));
  assert.equal(result.value.execution_status, 'not_prepared');
});

test('compound confirmation retains user isolation', async () => {
  const api = load(); await propose(api);
  const other = req('ok je confirme'); other.user = { ...other.user, id: 'other-user' };
  const result = res();
  await api.middleware(other, result, () => assert.fail('Wrong user'));
  assert.equal(result.value.execution_status, 'not_prepared');
});

test('named confirmation still checks the exact media kind and title', async () => {
  const api = load(); await propose(api);
  for (const phrase of ['Je confirme la génération de l’image', 'Je confirme la création de la vidéo Espace C']) {
    const result = res();
    await api.middleware(req(phrase), result, () => assert.fail('Wrong target'));
    assert.equal(result.value.execution_status, 'target_mismatch');
  }
});

test('explicit email-send recovery remains available without a media token', async () => {
  const api = load(); let called = false;
  await api.middleware(req('Je confirme et envoie le mail'), res(), () => { called = true; });
  assert.equal(called, true);
});

test('injected diagnostic text cannot change a bare confirmation into creation', () => {
  const api = load();
  assert.equal(api.bareConfirmationSignal('ok je confirme\n[DIAGNOSTIC LOCAL LECTURE SEULE]\ncrée un projet\n[/DIAGNOSTIC LOCAL LECTURE SEULE]'), true);
});

test('stale workers, queued jobs, failures and unsynchronised outputs retain distinct states', () => {
  const api = load();
  const states = ['running', 'queued', 'failed', 'completed', 'unrecognised_state'];
  const report = api.summarizeTaskDispatches(
    states.map((_, i) => ({ id: `t${i}`, titre: `Job ${i}`, statut: 'en_cours' })),
    states.map((status, i) => ({ id: `r${i}`, task_id: `t${i}`, status, updated_at: '2026-09-20T10:00:00Z' })),
    Date.parse('2026-09-26T10:00:00Z'),
  );
  assert.equal(report.stale, 2);
  assert.equal(report.failed, 1);
  assert.equal(report.unsynchronised_results, 1);
  assert.equal(report.active, 0);
  assert.equal(report.entries.find(row => row.task_id === 't4').dispatch_state, 'unrecognised_state');
});

test('same task title in distinct projects is not deduplicated', () => {
  const report = load().summarizeTaskDispatches([
    { id: 'one', titre: 'Créer la vidéo', projet_id: 'story', statut: 'en_cours' },
    { id: 'two', titre: 'Créer la vidéo', projet_id: 'espace-c', statut: 'en_cours' },
  ], []);
  assert.equal(report.unique_tasks, 2);
  assert.equal(report.duplicate_task_rows, 0);
});
