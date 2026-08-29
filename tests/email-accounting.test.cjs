const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../server-email-accounting-core.cjs');

test('NOVA classe une facture avec pièce jointe et exige une validation humaine', () => {
  const result = core.classifyEmail({ subject: 'Votre facture Railway INV-2026-008', text: 'Total TTC 24,20 EUR', attachments: [{ filename: 'invoice.pdf', size: 1200 }] });
  assert.equal(result.category, 'invoice');
  assert.equal(result.needsReview, true);
  assert.ok(result.confidence >= 0.9);
});

test('NOVA extrait montant, numéro et fournisseur sans inventer le client', () => {
  const result = core.extractAccountingMetadata({ from: 'Railway <billing@railway.app>', subject: 'Invoice INV-2026-008', text: 'Amount due: 24,20 EUR' });
  assert.equal(result.amount_minor, 2420);
  assert.equal(result.invoice_number, 'INV-2026-008');
  assert.match(result.provider, /Railway/i);
  assert.equal(result.client_id, undefined);
});

test('NOVA refuse les pièces jointes exécutables et accepte les preuves comptables', () => {
  assert.equal(core.shouldArchiveAttachment({ filename: 'facture.pdf', size: 1000 }), true);
  assert.equal(core.shouldArchiveAttachment({ filename: 'facture.exe', size: 1000 }), false);
});

test('le rapport quotidien indique validation, Dropbox et non-suppression', () => {
  const report = core.buildDailyDigest('2026-08-29', [{ mailbox: 'store', subject: 'Facture', sender: 'X', category: 'invoice', status: 'awaiting_review', document_id: 'doc-1' }]);
  assert.equal(report.counts.awaiting_review, 1);
  assert.equal(report.counts.archived, 1);
  assert.match(report.text, /Aucun e-mail n.a été supprimé/i);
});

test('le serveur lit les messages sans les marquer comme lus et protège le module', () => {
  const emailSource = fs.readFileSync(path.join(__dirname, '..', 'server-email.cjs'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');
  assert.match(emailSource, /markSeen = true/);
  assert.match(emailSource, /if \(markSeen\) imap\.addFlags/);
  assert.match(serverSource, /requirePermission\('email_accounting', 'admin'\)/);
});
