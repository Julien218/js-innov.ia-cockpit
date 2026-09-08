const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server-billing.cjs'), 'utf8');

test('le PDF conforme v4 est archivé une seule fois puis relu depuis Dropbox', () => {
  assert.match(source, /const BILLING_PDF_VERSION = 'official-v4-dynamic'/);
  assert.match(source, /doc\.pdf_document_id && doc\.pdf_version === BILLING_PDF_VERSION && doc\.pdf_conformite_statut === 'conforme'/);
  assert.match(source, /getDocumentBufferForUser/);
  assert.match(source, /storeBuffer/);
  assert.match(source, /pdf_version: BILLING_PDF_VERSION/);
  assert.match(source, /pdf_conformite_statut: 'conforme'/);
  assert.match(source, /crypto\.createHash\('sha256'\)/);
});

test('les générations, téléchargements et envois sont tracés', () => {
  assert.match(source, /pdf_genere_at/);
  assert.match(source, /date_dernier_telechargement/);
  assert.match(source, /date_premier_envoi/);
  assert.match(source, /date_dernier_envoi/);
  assert.match(source, /historique_documents/);
});
