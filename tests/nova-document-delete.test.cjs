const test = require('node:test');
const assert = require('node:assert/strict');
const { deleteFromMessage, explicitDeletion, resolveDocument, router } = require('../server-nova-document-delete.cjs');

const user = { id: 'owner', email: 'owner@example.test', role: 'superadmin', organisation: 'jsinnovia' };
const document = {
  id: '11111111-1111-4111-a111-111111111111', organisation: 'jsinnovia',
  filename: 'Img 4136 - portrait - 2026-08-29 - 7930aa4932.png',
  dropbox_file_id: 'id:test_image', dropbox_path: '/Application/Cockpit/A_Classer/Images/Img 4136 - portrait - 2026-08-29 - 7930aa4932.png',
};
const message = `Supprime le fichier Dropbox ${document.filename}`;
const copy = value => JSON.parse(JSON.stringify(value));
const absent = () => Object.assign(new Error('Dropbox not_found'), { dropboxNotFound: true });

function fixture(options = {}) {
  const state = { documents: [copy(document)], tasks: [], runs: [], logs: [], calls: [], deleted: 0, present: true };
  const deps = {
    async request(path, settings = {}, tenant) {
      const body = settings.body || {};
      state.calls.push({ path, method: settings.method || 'GET', body: copy(body), tenant });
      assert.equal(tenant, 'jsinnovia');
      if (options.fail?.(path, settings, state)) throw new Error('Storage unavailable');
      if (path.startsWith('/data/DocumentIndex?')) return copy(state.documents);
      if (path.startsWith('/data/Tache?')) return copy(state.tasks.filter(task => task.titre === new URL(path, 'https://test').searchParams.get('titre')));
      if (path.startsWith('/data/DocumentIndex/')) {
        const doc = state.documents.find(item => path.endsWith(item.id));
        if (settings.method === 'PATCH') Object.assign(doc, body);
        return copy(doc);
      }
      if (path === '/data/Tache' && settings.method === 'POST') {
        const task = { ...copy(body), id: `task-${state.tasks.length + 1}`, organisation_id: tenant };
        state.tasks.push(task); return copy(task);
      }
      if (path === '/agent-runs' && settings.method === 'POST') {
        const run = { ...copy(body), id: `run-${state.runs.length + 1}`, organisation: tenant };
        state.runs.push(run); return copy(run);
      }
      if (path === '/data/LogAction') {
        const log = { ...copy(body), id: `log-${state.logs.length + 1}` };
        state.logs.push(log); return copy(log);
      }
      if (path.startsWith('/data/Tache/') || path.startsWith('/agent-runs/')) {
        const records = path.startsWith('/data/Tache/') ? state.tasks : state.runs;
        const record = records.find(item => path.endsWith(item.id));
        Object.assign(record, copy(body)); return copy(record);
      }
      throw new Error(`Unexpected request ${path}`);
    },
    async dropbox(route, body) {
      state.calls.push({ route, body: copy(body) });
      assert.equal(body.path, document.dropbox_file_id);
      if (options.dropbox) return options.dropbox(route, body, state);
      if (route === 'get_metadata') {
        if (!state.present) throw absent();
        return { '.tag': 'file', id: document.dropbox_file_id, name: document.filename, rev: 'rev1', path_display: document.dropbox_path };
      }
      if (route === 'delete_v2') {
        assert.deepEqual(body, { path: document.dropbox_file_id, parent_rev: 'rev1' });
        state.present = false; state.deleted++;
        return { metadata: { '.tag': 'file', id: document.dropbox_file_id } };
      }
      throw new Error(`Unexpected Dropbox route ${route}`);
    },
  };
  return { deps, state, execute: (extra = {}) => deleteFromMessage({ message, user, deps, ...extra }) };
}

test('suppression réelle par ID/révision, disparition vérifiée, index retiré et tâche/exécution clôturées', async () => {
  const { state, execute } = fixture();
  const result = await execute();
  assert.equal(result.success, true);
  assert.equal(result.result.verified, true);
  assert.equal(state.deleted, 1);
  assert.ok(state.documents[0].deleted_at);
  assert.equal(state.tasks[0].statut, 'terminee');
  assert.equal(state.runs[0].status, 'completed');
  assert.equal(state.runs[0].agent_id, 'nova-document-delete');
  assert.equal(state.logs[0].details.dropbox_deleted, true);
  assert.match(result.content, /Journal : log-1/);
  const deletion = state.calls.findIndex(call => call.route === 'delete_v2');
  assert.ok(state.calls.findIndex(call => call.path === '/agent-runs') < deletion);
  assert.equal(state.calls[deletion + 1].route, 'get_metadata');
  assert.ok(state.calls.findIndex(call => call.path === '/data/LogAction') > deletion);
});

test('permission insuffisante et rôle client refusés avant tout accès externe', async () => {
  for (const actor of [{ ...user, role: 'client' }, { ...user, role: 'admin' }, { ...user, organisation: '' }, { ...user, id: null }]) {
    const f = fixture();
    assert.equal((await f.execute({ user: actor })).success, false);
    assert.equal(f.state.calls.length, 0);
  }
});

test('négation, diagnostic, historique, suppression définitive et dossiers n’exécutent rien', async () => {
  for (const text of ['Ne supprime pas ce fichier', 'Comment supprimer ce fichier ?', 'Hier je demandais de supprimer le fichier', 'Supprime définitivement le fichier', 'Supprime le dossier Dropbox', 'Supprime tous les fichiers Dropbox', 'Supprime le fichier si possible']) {
    const f = fixture();
    assert.equal(explicitDeletion(text), false, text);
    assert.equal((await f.execute({ message: `${text} ${document.filename}` })).success, false);
    assert.equal(f.state.calls.length, 0);
  }
});

test('nom exact ambigu, nom partiel, mauvais chemin et autre organisation sont refusés', () => {
  const other = { ...document, id: 'other', dropbox_file_id: 'id:other', dropbox_path: '/Other/' + document.filename };
  assert.throws(() => resolveDocument(message, [document, other], 'jsinnovia'), /Plusieurs/);
  assert.throws(() => resolveDocument('Supprime le fichier Img 4136', [document], 'jsinnovia'), /Aucun/);
  assert.throws(() => resolveDocument(`Supprime /Wrong/${document.filename}`, [document], 'jsinnovia'), /Aucun/);
  assert.throws(() => resolveDocument(message, [{ ...document, organisation: 'other' }], 'jsinnovia'), /Aucun/);
  assert.equal(resolveDocument(`Supprime ${document.dropbox_path}`, [document, other], 'jsinnovia').id, document.id);
  assert.equal(resolveDocument(`Supprime /Cockpit/A\\_Classer/Images/${document.filename}`, [document, other], 'jsinnovia').id, document.id);
});

test('un identifiant documentaire permet une lecture ciblée avec contrôle de l’organisation', async () => {
  const f = fixture();
  assert.equal((await f.execute({ message: `Supprime le fichier Dropbox ${document.id}` })).success, true);
  assert.equal(f.state.calls[0].path, `/data/DocumentIndex/${document.id}`);
  const other = fixture(); other.state.documents[0].organisation = 'other';
  assert.equal((await other.execute({ message: `Supprime le fichier Dropbox ${document.id}` })).success, false);
  assert.equal(other.state.deleted, 0);
});

test('un dossier, un renommage, un déplacement ou un ID différent ne peut pas être supprimé', async () => {
  for (const changes of [{ '.tag': 'folder' }, { name: 'renamed.png' }, { path_display: '/moved/image.png' }, { id: 'id:other' }, { rev: '' }]) {
    const f = fixture({ dropbox: async (route) => {
      assert.equal(route, 'get_metadata');
      return { '.tag': 'file', id: document.dropbox_file_id, name: document.filename, rev: 'rev1', path_display: document.dropbox_path, ...changes };
    } });
    assert.equal((await f.execute()).success, false);
    assert.equal(f.state.tasks.length, 0);
    assert.ok(!f.state.documents[0].deleted_at);
  }
});

test('une révision concurrente refusée par Dropbox bloque la tâche sans cacher le fichier', async () => {
  const f = fixture();
  const original = f.deps.dropbox;
  f.deps.dropbox = async (route, body) => { if (route === 'delete_v2') throw new Error('Dropbox revision mismatch'); return original(route, body); };
  assert.equal((await f.execute()).success, false);
  assert.equal(f.state.tasks[0].statut, 'bloquee');
  assert.equal(f.state.runs[0].status, 'failed');
  assert.ok(!f.state.documents[0].deleted_at);
});

test('une panne du journal avant suppression empêche toute suppression Dropbox', async () => {
  const f = fixture({ fail: path => path === '/agent-runs' });
  assert.equal((await f.execute()).success, false);
  assert.equal(f.state.deleted, 0);
  assert.equal(f.state.tasks[0].statut, 'bloquee');
});

test('un fichier toujours présent ou une panne de vérification ne devient jamais un succès', async () => {
  for (const networkError of [false, true]) {
    const f = fixture(); const original = f.deps.dropbox;
    f.deps.dropbox = async (route, body) => {
      if (route === 'get_metadata' && f.state.deleted) {
        if (networkError) throw new Error('Dropbox timeout');
        return { '.tag': 'file', id: document.dropbox_file_id };
      }
      return original(route, body);
    };
    const result = await f.execute();
    assert.equal(result.success, false);
    assert.equal(result.result.verified, false);
    assert.ok(!f.state.documents[0].deleted_at);
    assert.equal(f.state.tasks[0].statut, 'bloquee');
  }
});

test('fichier déjà absent : retrait de l’index sans appel de suppression', async () => {
  const f = fixture(); f.state.present = false;
  const result = await f.execute();
  assert.equal(result.success, true);
  assert.equal(result.result.already_absent, true);
  assert.equal(f.state.deleted, 0);
  assert.equal(f.state.tasks[0].statut, 'terminee');
});

test('reprise après panne d’index ou de journal : une seule suppression et même tâche', async () => {
  for (const failAt of ['index', 'audit', 'task']) {
    let failed = false;
    const f = fixture({ fail: (path, settings) => {
      const matches = failAt === 'index' ? path.startsWith('/data/DocumentIndex/') && settings.method === 'PATCH'
        : failAt === 'audit' ? path === '/data/LogAction' : path.startsWith('/data/Tache/') && settings.body?.statut === 'terminee';
      if (!failed && matches) { failed = true; return true; }
      return false;
    } });
    const first = await f.execute();
    assert.equal(first.success, false, failAt);
    assert.equal(first.result.dropbox_deleted, true);
    assert.equal((await f.execute()).success, true, failAt);
    assert.equal(f.state.deleted, 1);
    assert.equal(f.state.tasks.length, 1);
    assert.equal(f.state.tasks[0].statut, 'terminee');
    assert.equal(f.state.runs[0].status, 'failed');
    assert.equal(f.state.runs[1].status, 'completed');
  }
});

test('une répétition après succès vérifie l’absence sans créer de doublon', async () => {
  const f = fixture(); await f.execute();
  const result = await f.execute();
  assert.equal(result.success, true);
  assert.equal(f.state.deleted, 1);
  assert.equal(f.state.tasks.length, 1);
  assert.equal(f.state.runs.length, 1);
  assert.match(result.content, /déjà absent/);
});

test('un fichier restauré depuis une fiche supprimée est préservé', async () => {
  const f = fixture(); f.state.documents[0].deleted_at = '2026-08-30T10:00:00Z';
  assert.equal((await f.execute()).success, false);
  assert.equal(f.state.deleted, 0);
});

test('deux demandes simultanées ne lancent pas deux suppressions', async () => {
  const f = fixture(); const original = f.deps.dropbox;
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let first = true;
  f.deps.dropbox = async (...args) => { if (first) { first = false; started(); await gate; } return original(...args); };
  const pending = f.execute(); await entered;
  assert.match((await f.execute()).content, /déjà en cours/);
  assert.match((await f.execute()).content, /déjà en cours/);
  release();
  assert.equal((await pending).success, true);
  assert.equal(f.state.deleted, 1);
});

test('le chat HTTP et le spécialiste exécutent le même service sans appeler le modèle', async t => {
  process.env.JSINNOVIA_AGENT_KEY = 'test-agent-key';
  process.env.DROPBOX_ACCESS_TOKEN = 'test-dropbox-token';
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/assistant', router);
  app.post('/api/assistant/chat', (_req, res) => res.json({ model: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const networkFetch = global.fetch;
  let f = fixture();
  global.fetch = async (url, settings = {}) => {
    const target = new URL(url);
    if (target.hostname === '127.0.0.1') return networkFetch(url, settings);
    const body = settings.body ? JSON.parse(settings.body) : undefined;
    if (target.hostname === 'api.dropboxapi.com') {
      assert.equal(settings.headers.Authorization, 'Bearer test-dropbox-token');
      try { return Response.json(await f.deps.dropbox(target.pathname.split('/').pop(), body)); }
      catch (error) {
        if (error.dropboxNotFound) return Response.json({ error: { '.tag': 'path', path: { '.tag': 'not_found' } } }, { status: 409 });
        throw error;
      }
    }
    assert.equal(settings.headers['x-organisation-id'], user.organisation);
    assert.equal(settings.headers['x-agent-key'], 'test-agent-key');
    return Response.json(await f.deps.request(target.pathname + target.search, { ...settings, body }, user.organisation));
  };
  t.after(() => { global.fetch = networkFetch; delete process.env.JSINNOVIA_AGENT_KEY; delete process.env.DROPBOX_ACCESS_TOKEN; server.closeAllConnections(); server.close(); });
  const response = await networkFetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
  const data = await response.json();
  assert.equal(data.success, true); assert.equal(data.action_type, 'delete_dropbox_file'); assert.equal(f.state.deleted, 1);
  const { processSpecialistMessage } = require('../server-specialist-tasks.cjs');
  f = fixture();
  const outcome = await processSpecialistMessage({ user, message, chat: () => { throw new Error('Model must not be called'); } });
  assert.equal(outcome.success, true); assert.equal(f.state.deleted, 1);
  const normal = await networkFetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Bonjour' }) });
  assert.deepEqual(await normal.json(), { model: true });
});
