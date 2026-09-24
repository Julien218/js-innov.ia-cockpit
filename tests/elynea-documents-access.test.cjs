const test = require('node:test');
const assert = require('node:assert/strict');
process.env.AGENT_API_KEY = 'test-only';
const { listDocumentsForUser, getDocumentForUser } = require('../server-documents.cjs');
test('real document adapters enforce rights, tenant, deletion state and safe identifiers', async () => {
  const original = global.fetch;
  let calls = 0, rows = [];
  global.fetch = async () => { calls++; return new Response(JSON.stringify(rows)); };
  const user = { id: 'staff', role: 'collaborateur', organisation: 'alpha', permission_overrides: [{ permission_code: 'documents', enabled: true }] };
  try {
    await assert.rejects(listDocumentsForUser({ ...user, role: 'client' }), /non autorisé/);
    assert.equal(calls, 0);
    rows = [{ id: 'a', organisation: 'alpha', filename: 'a.pdf', category: 'facture', secret: 'not-in-output' }, { id: 'b', organisation: 'beta', filename: 'b.pdf' }, { id: 'c', organisation: 'alpha', filename: 'c.pdf', deleted_at: 'today' }];
    assert.deepEqual(await listDocumentsForUser(user), [{ id: 'a', filename: 'a.pdf', category: 'facture' }]);
    rows = [{ id: 'b', organisation: 'beta', filename: 'b.pdf' }];
    await assert.rejects(getDocumentForUser(user, 'b'), /non autorisé/);
    rows = [{ id: 'c', organisation: 'alpha', filename: 'c.pdf', deleted_at: 'today' }];
    await assert.rejects(getDocumentForUser(user, 'c'), /introuvable/);
    const before = calls;
    await assert.rejects(getDocumentForUser(user, '../a?x=y'), /invalide/);
    assert.equal(calls, before);
  } finally { global.fetch = original; }
});
