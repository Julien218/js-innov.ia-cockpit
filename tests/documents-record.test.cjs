const test = require('node:test');
const assert = require('node:assert/strict');
const { firstDocumentRecord } = require('../server-documents.cjs');

test('accepte une réponse Agent sous forme d objet unique', () => {
  const record = { id: 'doc-1', filename: 'facture.pdf', deleted_at: null };
  assert.deepEqual(firstDocumentRecord(record), record);
});

test('accepte une réponse Supabase sous forme de tableau', () => {
  const record = { id: 'doc-2', filename: 'devis.pdf', deleted_at: null };
  assert.deepEqual(firstDocumentRecord([record]), record);
});

test('ignore les résultats absents, supprimés ou en erreur', () => {
  assert.equal(firstDocumentRecord([]), null);
  assert.equal(firstDocumentRecord(null), null);
  assert.equal(firstDocumentRecord({ id: 'doc-3', deleted_at: '2026-08-15T00:00:00Z' }), null);
  assert.equal(firstDocumentRecord({ error: 'not found' }), null);
});
