const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server-billing.cjs'), 'utf8');

test('le PDF est archivé une seule fois puis relu depuis Dropbox', () => {
  assert.match(source, /if \(doc\.pdf_document_id\)/);
  assert.match(source, /getDocumentBufferForUser/);
  assert.match(source, /storeBuffer/);
  assert.match(source, /pdf_version: 'official-v2'/);
});

test('les générations, téléchargements et envois sont tracés', () => {
  assert.match(source, /pdf_genere_at/);
  assert.match(source, /date_dernier_telechargement/);
  assert.match(source, /date_premier_envoi/);
  assert.match(source, /date_dernier_envoi/);
  assert.match(source, /historique_documents/);
});
