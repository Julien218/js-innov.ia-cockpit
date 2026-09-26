const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const runtimeSource = fs.readFileSync(path.join(__dirname, '../server-elynea-runtime.cjs'), 'utf8');
function load() {
  const module = { exports: {} };
  vm.runInNewContext(runtimeSource, {
    module, exports: module.exports, process, Buffer, Date, Intl, Map, Set, URL, AbortSignal, fetch,
    require: name => {
      if (name === './server-permission-policy.cjs') return { hasPermission: (user, permission) => user.role === 'superadmin' || Boolean(user.permissions?.[permission]) };
      if (name === './server-immediate-execution-policy.cjs') return { stripInjectedContext: v => String(v || '').replace(/\[DIAGNOSTIC LOCAL LECTURE SEULE[^\]]*\][\s\S]*?\[\/DIAGNOSTIC LOCAL LECTURE SEULE\]/gi, '').trim() };
      return require(name);
    },
  }, { filename: 'server-elynea-runtime.cjs' });
  return module.exports;
}
const owner = { id: 'owner', role: 'superadmin', organisation: 'jsinnovia' };
const googleEnv = { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_MAIL_ENCRYPTION_KEY: 'encrypted', SUPABASE_SERVICE_ROLE_KEY: 'never-send-this' };
function fixture(routes, env = {}) {
  const calls = [];
  const api = load();
  const runtime = api.createRuntime({ env, now: () => Date.parse('2026-09-26T00:30:00+02:00'),
    readCockpit: async (req, route) => { calls.push(route); if (!(route in routes)) throw Error('unavailable'); return routes[route]; },
    listDocuments: async () => [{ id: 'doc-1', filename: 'facture.pdf' }], getDocument: async () => ({ id: 'doc-1', filename: 'facture.pdf' }),
    github: async () => ({}), loadPreferences: async () => [], savePreference: async () => {},
  });
  const run = (message, user = owner, extra = {}) => runtime.handle({ user, body: { message, conversation_id: 'one', ...extra } });
  return { api, run, calls };
}

test('emails of the day are fetched, separated by mailbox and filtered in Europe/Brussels', async () => {
  const f = fixture({
    '/api/emails/mailboxes/list': { mailboxes: [{ id: 'store', label: 'Store', configured: true }, { id: 'jsinnovia', configured: true, isAlias: true }] },
    '/api/emails?mailbox=store&limit=100&offset=0': { emails: [
      { uid: 1, from: 'a@example.test', subject: 'Today in Brussels', date: '2026-09-25T22:15:00Z' },
      { uid: 2, from: 'b@example.test', subject: 'Yesterday in Brussels', date: '2026-09-25T21:15:00Z' },
    ] },
  });
  const result = await f.run('tu listes mes emails de jour');
  assert.equal(f.calls.length, 2);
  assert.equal(result.source, 'cockpit-email-api');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].subject, 'Today in Brussels');
  assert.match(result.message, /Europe\/Brussels/);
  assert.match(result.message, /100 messages/);
});

test('Gmail uses actual configured accounts and message endpoints', async () => {
  const f = fixture({
    '/api/google-mail/accounts': { accounts: [{ id: 'google-one', label: 'Gmail', active: true }] },
    '/api/google-mail/messages?account_id=google-one&limit=100': { emails: [{ id: 'mail1', subject: 'Actual message', date: '2026-09-26T00:00:00+02:00' }] },
  }, googleEnv);
  const result = await f.run('liste mes emails Gmail du jour');
  assert.equal(result.items[0].provider, 'google');
  assert.equal(f.calls.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /never-send-this|GOOGLE_CLIENT_SECRET/);
});

test('mailbox failure is explicit, not an empty successful inbox', async () => {
  const f = fixture({ '/api/emails/mailboxes/list': { mailboxes: [{ id: 'store', label: 'Store', configured: true }] } });
  const result = await f.run('liste mes emails du jour');
  assert.equal(result.partial, true);
  assert.equal(result.checked_mailboxes.length, 0);
  assert.match(result.message, /lecture impossible/);
  assert.doesNotMatch(result.message, /Aucun message correspondant/);
});

test('central mail reads cannot cross organisations or be exposed to a client', async () => {
  const f = fixture({});
  for (const user of [{ ...owner, role: 'client' }, { ...owner, organisation: 'other' }, { ...owner, role: 'admin', permissions: { emails: true } }]) {
    assert.match((await f.run('liste mes emails', user)).message, /compte propriétaire/);
  }
  assert.equal(f.calls.length, 0);
});

for (const [message, table, rows] of [
  ['liste mes tâches', 'Tache', [{ id: 'task1', titre: 'Clé magique', statut: 'en_cours' }]],
  ['liste mes projets', 'Projet', [{ id: 'project1', nom: 'Espace C', statut: 'actif' }]],
  ['liste mes factures', 'Facture', [{ id: 'invoice1', numero: 'FAC-1', statut: 'brouillon' }]],
]) {
  test(`connected inventory: ${table}`, async () => {
    const route = `/api/data/${table}?sort=created_at&order=desc&limit=100`;
    const f = fixture({ [route]: rows });
    const result = await f.run(message);
    assert.deepEqual(f.calls, [route]);
    assert.equal(result.items[0].id, rows[0].id);
    assert.equal(result.source, 'cockpit-data-api');
  });
}

test('project filter does not substitute another project’s task', async () => {
  const f = fixture({ '/api/data/Tache?sort=created_at&order=desc&limit=100': [
    { id: 'story', titre: 'Vidéo', projet_id: 'story-project' }, { id: 'screen', titre: 'Vidéo', projet_id: 'screen-project' },
  ] });
  const result = await f.run('liste mes tâches', owner, { project_id: 'story-project' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'story');
});

test('failed business reads propagate instead of becoming invented lists', async () => {
  const f = fixture({});
  await assert.rejects(f.run('liste mes factures'), /unavailable/);
});

test('drafting, negated requests and unsupported date ranges do not make read calls', async () => {
  const f = fixture({});
  assert.equal(await f.run('prépare un email à Olivier'), null);
  assert.equal(await f.run('ne liste pas mes emails'), null);
  assert.match((await f.run('liste mes emails du mois dernier')).message, /autre période/);
  assert.equal(f.calls.length, 0);
});

test('document ordinal selection cannot cross project scope', async () => {
  const f = fixture({}, { DROPBOX_ACCESS_TOKEN: 'configured' });
  await f.run('liste les factures Dropbox', owner, { project_id: 'p1' });
  const other = await f.run('télécharge la première', owner, { project_id: 'p2' });
  assert.equal(other.download, undefined);
});

test('internal reader sends only GET to fixed loopback and forwards user session, not service tokens', async () => {
  const calls = [];
  const read = load().createCockpitReader({ env: { API_PORT: '3001', SUPABASE_SERVICE_ROLE_KEY: 'do-not-forward' }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ mailboxes: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const req = { user: owner, headers: { cookie: 'cockpit=session', 'x-agent-key': 'forbidden' } };
  await read(req, '/api/emails/mailboxes/list');
  assert.equal(calls[0].url, 'http://127.0.0.1:3001/api/emails/mailboxes/list');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Cookie, 'cockpit=session');
  assert.doesNotMatch(JSON.stringify(calls), /do-not-forward|forbidden/);
  await assert.rejects(read(req, 'https://outside.example/'), /non autorisée/);
  await assert.rejects(read(req, '/api/emails/send'), /non autorisée/);
  await assert.rejects(read({ user: owner, headers: {} }, '/api/emails/mailboxes/list'), /Session/);
  assert.equal(calls.length, 1);
});

test('HTTP and JSON error replies never become successful tool data', async () => {
  for (const response of [new Response('{}', { status: 403 }), new Response('not JSON'), new Response('{"success":false}')]) {
    const read = load().createCockpitReader({ fetchImpl: async () => response });
    await assert.rejects(read({ user: owner, headers: { cookie: 'session' } }, '/api/emails/mailboxes/list'));
  }
});

test('day calculation stays correct at Brussels daylight-saving transitions', () => {
  const day = load().localDay;
  assert.equal(day('2026-10-24T22:30:00Z'), '25/10/2026');
  assert.equal(day('2026-10-25T23:30:00Z'), '26/10/2026');
  assert.equal(day('invalid'), null);
});

test('email, invoice and confirmation requests never use local-model fallback after API failure', async () => {
  const transportCode = fs.readFileSync(path.join(__dirname, '../src/lib/novaChatTransport.js'), 'utf8');
  const { sendNovaChat } = await import(`data:text/javascript;base64,${Buffer.from(transportCode).toString('base64')}`);
  for (const message of ['liste mes emails du jour', 'liste mes factures', 'liste mes tâches', 'je confirme la création de la vidéo']) {
    let local = 0;
    await assert.rejects(sendNovaChat({ message, offline: false, requiresLocalTool: false, sendCloud: async () => { throw Error('API offline'); }, sendLocal: async () => { local++; } }));
    assert.equal(local, 0);
  }
});

test('an explicit local image request never first calls the cloud', async () => {
  const code = fs.readFileSync(path.join(__dirname, '../src/lib/novaChatTransport.js'), 'utf8');
  const { sendNovaChat } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  let local = 0;
  const result = await sendNovaChat({ message: 'génère une image en local', offline: false, requiresLocalTool: false,
    sendCloud: async () => assert.fail('cloud must not be called'), sendLocal: async () => { local++; return { route: 'local' }; } });
  assert.equal(result.route, 'local');
  assert.equal(local, 1);
});
