const test = require('node:test');
const assert = require('node:assert/strict');
const { processSpecialistMessage, taskIntent } = require('../server-specialist-tasks.cjs');
const { AGENT_REGISTRY } = require('../server-agent-registry.cjs');
const { executeSiteTask, siteExecutorForTask } = require('../server-nova-executors.cjs');
const agent = AGENT_REGISTRY.find(item => item.key === 'fashionistart');
const user = { id: 'owner', role: 'superadmin', organisation: 'jsinnovia' };
const original = "hello, analyse le depot pour comprendre la structure du site nous devons apporter au site une galeries connecter ou les exposants pourrais a titre gratuits mettre leurs oeuvres en vente et nous serions charger de cree du contenus sur facebook instagramme et tik tok linnkeding afin de faire decouvrire la plateforme; avec paiement en ligne dispatché directement aux bonne personne artiste 80% - 10 a Starligth asbl et 10 a Js-Innov.IA automatiser le maximum de processus le tout relier a mon cockpit et espace clients starligth + artiste membre fashionist'ART - Artistes non membre artiste 70% - 15 a starligth 15 a js-innov.ia";

function storage() {
  const state = { tasks: [], runs: [], logs: [] };
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const agentFetch = async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    if (path.startsWith('/data/Tache?')) return response(state.tasks);
    if (path === '/data/Tache' && options.method === 'POST') {
      const task = { ...body, id: `task-${state.tasks.length + 1}` };
      state.tasks.push(task); return response(task, 201);
    }
    if (path === '/agent-runs' && options.method === 'POST') {
      const run = { ...body, id: `run-${state.runs.length + 1}` };
      state.runs.push(run); return response(run, 201);
    }
    if (path.startsWith('/data/Tache/') && options.method === 'PATCH') {
      const task = state.tasks.find(item => path.endsWith(item.id));
      Object.assign(task, body); return response(task);
    }
    if (path === '/data/LogAction') { state.logs.push(body); return response({ id: 'log-1' }, 201); }
    throw new Error(`Unexpected request ${path}`);
  };
  return { state, agentFetch };
}

test('la demande réelle produit quatre tâches assignées et journalisées même si le modèle ne fournit que du texte', async () => {
  const { state, agentFetch } = storage();
  const args = { agent, user, tenant: 'jsinnovia', conversationId: 'session', requestId: 'request-1', message: original, agentFetch,
    chat: async actions => { assert.deepEqual(actions, ['create_task_batch']); return { response: 'Je vais créer les tâches maintenant.' }; } };
  const result = await processSpecialistMessage(args);
  assert.equal(state.tasks.length, 4);
  assert.equal(state.runs.length, 4);
  assert.equal(state.logs.length, 1);
  assert.ok(state.tasks.every(task => task.statut === 'a_faire' && task.description.includes(original)));
  assert.ok(state.runs.every(run => run.agent_id === 'nova-site-ops:fashionistart' && run.status === 'awaiting_approval'));
  assert.match(result.content, /task-1/);
  assert.match(result.content, /run-4/);
  assert.doesNotMatch(result.content, /Je vais créer/);
  await processSpecialistMessage({ ...args, requestId: 'request-2' });
  assert.equal(state.tasks.length, 4, 'pas de nouvelles tâches sur répétition');
  assert.equal(state.runs.length, 4, 'pas de nouvelle assignation sur répétition');
});

test('un merci ne déclenche rien et ne reproduit pas une promesse inventée', async () => {
  const { state, agentFetch } = storage();
  const result = await processSpecialistMessage({ agent, user, message: 'merci', agentFetch,
    chat: async actions => { assert.deepEqual(actions, []); return { response: 'Je vais maintenant procéder à la création et à l’assignation des tâches.' }; } });
  assert.equal(state.tasks.length, 0);
  assert.match(result.content, /Aucune tâche créée/);
  assert.doesNotMatch(result.content, /Je vais/);
});

test('la lecture seule et les formulations de diagnostic ne créent aucun lot', () => {
  for (const message of ['Analyse uniquement la galerie', 'Ne crée pas de tâches pour la galerie', 'Explique comment créer des tâches', 'Vérifie si elle a créé les tâches', 'Sans créer de tâches, analyse le dépôt']) assert.equal(taskIntent(message), false, message);
});

test('le rôle client et un collaborateur sans permission ne peuvent pas créer de tâches', async () => {
  for (const role of ['client', 'collaborateur']) {
    const result = await processSpecialistMessage({ agent, user: { id: 'other', role }, message: original,
      chat: () => { throw new Error('Must not call model'); } });
    assert.match(result.content, /refusée/);
  }
});

test('un lot invalide ne produit aucune fausse confirmation', async () => {
  const { state, agentFetch } = storage();
  const result = await processSpecialistMessage({ agent, user, message: 'Crée les tâches pour ajouter une page', agentFetch,
    chat: async () => ({ response: 'Tout est créé.', proposed_action: { type: 'create_task_batch', payload: { tasks: [{ description: 'Sans titre' }] } } }) });
  assert.equal(state.tasks.length, 0);
  assert.match(result.content, /Aucune tâche créée/);
});

test('le modèle ne peut ni choisir un autre agent ni modifier une tâche existante par son identifiant', async () => {
  const { state, agentFetch } = storage();
  await processSpecialistMessage({ agent, user, tenant: 'jsinnovia', conversationId: 'session', requestId: 'request', message: 'Crée une tâche pour la galerie', agentFetch,
    chat: async () => ({ proposed_action: { type: 'create_task_batch', payload: { tasks: [{ titre: 'Nouvelle galerie', description: 'Autre référence cockpit.jsinnovia.com', task_id: 'victim', projet_id: 'secret-project', provider: 'remote', agent_name: 'other' }] } } }) });
  assert.equal(state.tasks[0].projet_id, null);
  assert.equal(state.runs[0].agent_id, 'nova-site-ops:fashionistart');
});

test('un site sain ne prouve pas la livraison d’une galerie ou des paiements', async () => {
  let probes = 0;
  const task = { titre: 'Développer la galerie connectée fashionistartdour.be' };
  const result = await executeSiteTask(siteExecutorForTask(task), task, { analyze: async () => { probes++; return { healthy: true }; } });
  assert.equal(result.completed, false);
  assert.equal(result.blocked, true);
  assert.equal(result.result.verified, false);
  assert.equal(probes, 0);
});

test('une panne de stockage ne se transforme pas en promesse de travail en arrière-plan', async () => {
  await assert.rejects(processSpecialistMessage({ agent, user, tenant: 'jsinnovia', conversationId: 'session', requestId: 'request', message: original,
    chat: async () => ({ response: 'Je vais créer' }), agentFetch: async () => new Response('{"error":"database unavailable"}', { status: 503 }) }), /database unavailable/);
});

test('le chat HTTP crée réellement le lot, isole les conversations et rejoue la preuve sans doublon', async t => {
  process.env.JSINNOVIA_AGENT_KEY = 'test-only';
  const express = require('express');
  const { router } = require('../server-base44-agents.cjs');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { ...user, id: req.headers['x-test-user'] || user.id }; next(); });
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const networkFetch = global.fetch;
  const { state, agentFetch } = storage();
  let chatCalls = 0;
  global.fetch = async (url, options = {}) => {
    const target = new URL(url);
    if (target.hostname === '127.0.0.1') return networkFetch(url, options);
    if (target.pathname === '/chat') {
      chatCalls++;
      const body = JSON.parse(options.body);
      assert.deepEqual(body.available_actions, ['create_task_batch']);
      assert.equal(body.user_context.id, user.id);
      return new Response(JSON.stringify({ response: 'Je vais créer les tâches.' }));
    }
    assert.equal(options.headers['x-organisation-id'], 'jsinnovia');
    return agentFetch(target.pathname + target.search, options);
  };
  t.after(() => { global.fetch = networkFetch; server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/fashionistart/conversations`;
  const created = await networkFetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json());
  const send = (id = user.id) => networkFetch(`${base}/${created.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': id }, body: JSON.stringify({ content: original, request_id: 'stable-request' }) });
  assert.equal((await send('another-user')).status, 404);
  const first = await send().then(r => r.json());
  const replay = await send().then(r => r.json());
  assert.deepEqual(replay, first);
  assert.equal(chatCalls, 1);
  assert.equal(state.tasks.length, 4);
  assert.equal(first.execution_result.results.length, 4);
  assert.match(first.content, /run-1/);
});
