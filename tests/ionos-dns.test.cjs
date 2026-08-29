const test = require('node:test');
const assert = require('node:assert/strict');

const ionos = require('../server-ionos-dns.cjs');
const managed = { 'letourdedour.com': {} };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('le connecteur IONOS n’accepte que CNAME/TXT sur un domaine géré', () => {
  const result = ionos.validateChanges('letourdedour.com', [
    { name: 'www', type: 'CNAME', content: 'letourdedour-site-production.up.railway.app', ttl: 300 },
    { name: '_railway-verify.www', type: 'TXT', content: 'railway-verify=nouvelle-valeur', ttl: 300 },
  ], managed);
  assert.equal(result.changes[0].name, 'www.letourdedour.com');
  assert.equal(result.changes[1].name, '_railway-verify.www.letourdedour.com');
  assert.throws(() => ionos.validateChanges('evil.example', [{ name: 'www', type: 'CNAME', content: 'example.com' }], managed), /non géré/);
  assert.throws(() => ionos.validateChanges('letourdedour.com', [{ name: '@', type: 'MX', content: 'mx.example.com' }], managed), /Type DNS interdit/);
});

test('la préparation relit IONOS et produit un plan sans écrire', async () => {
  const previous = process.env.IONOS_API_KEY;
  process.env.IONOS_API_KEY = `${'a'.repeat(32)}.${'b'.repeat(64)}`;
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/zones')) return jsonResponse([{ id: 'zone-1', type: 'NATIVE', zoneName: 'letourdedour.com' }]);
    return jsonResponse({ id: 'zone-1', records: [{ id: 'record-1', name: 'www.letourdedour.com', type: 'CNAME', content: 'old.railway.app', ttl: 3600, disabled: false }] });
  };
  try {
    const prepared = await ionos.prepareChangeSet('letourdedour.com', [{ name: 'www', type: 'CNAME', content: 'new.railway.app', ttl: 300 }], managed, fetchMock);
    assert.equal(prepared.plan[0].action, 'update');
    assert.equal(prepared.plan[0].before.content, 'old.railway.app');
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.options.method === 'GET'));
    assert.equal(calls[0].options.headers['X-API-Key'], process.env.IONOS_API_KEY);
  } finally {
    if (previous === undefined) delete process.env.IONOS_API_KEY;
    else process.env.IONOS_API_KEY = previous;
  }
});

test('l’application met à jour le record exact puis vérifie par relecture', async () => {
  const previous = process.env.IONOS_API_KEY;
  process.env.IONOS_API_KEY = `${'c'.repeat(32)}.${'d'.repeat(64)}`;
  let updated = false;
  const fetchMock = async (url, options) => {
    if (options.method === 'PUT') {
      updated = true;
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload, { content: 'new.railway.app', ttl: 300, prio: 0, disabled: false });
      return jsonResponse({ id: 'record-1', ...payload });
    }
    if (url.endsWith('/zones')) return jsonResponse([{ id: 'zone-1', zoneName: 'letourdedour.com' }]);
    return jsonResponse({ records: [{ id: 'record-1', name: 'www.letourdedour.com', type: 'CNAME', content: updated ? 'new.railway.app' : 'old.railway.app', ttl: 300, disabled: false }] });
  };
  try {
    const result = await ionos.applyPreparedChangeSet({
      domain: 'letourdedour.com',
      zoneId: 'zone-1',
      plan: [{ action: 'update', recordId: 'record-1', before: null, after: { name: 'www.letourdedour.com', type: 'CNAME', content: 'new.railway.app', ttl: 300, disabled: false } }],
    }, fetchMock);
    assert.equal(result.success, true);
    assert.equal(result.verified, true);
  } finally {
    if (previous === undefined) delete process.env.IONOS_API_KEY;
    else process.env.IONOS_API_KEY = previous;
  }
});

test('une erreur IONOS ne révèle jamais la clé API', async () => {
  const previous = process.env.IONOS_API_KEY;
  const secret = `${'e'.repeat(32)}.${'f'.repeat(64)}`;
  process.env.IONOS_API_KEY = secret;
  try {
    await assert.rejects(
      ionos.ionosRequest('/zones', {}, async () => jsonResponse({ message: 'accès refusé' }, 401)),
      (error) => !error.message.includes(secret) && /HTTP 401/.test(error.message),
    );
  } finally {
    if (previous === undefined) delete process.env.IONOS_API_KEY;
    else process.env.IONOS_API_KEY = previous;
  }
});

test('Nova expose l’action DNS uniquement au superadmin et conserve la confirmation', () => {
  const assistant = require('../server-assistant.cjs');
  const proposed = {
    type: 'manage_dns_records',
    payload: { domain: 'letourdedour.com', changes: [{ name: 'www', type: 'CNAME', content: 'new.railway.app', ttl: 300 }] },
  };
  assert.equal(assistant.sanitizeAction(proposed, { role: 'admin' }), null);
  const action = assistant.sanitizeAction(proposed, { role: 'superadmin' });
  assert.equal(action.type, 'manage_dns_records');
  assert.equal(action.payload.changes[0].name, 'www.letourdedour.com');
  assert.equal(action.definition.serverAction, 'ionos_dns');
});
