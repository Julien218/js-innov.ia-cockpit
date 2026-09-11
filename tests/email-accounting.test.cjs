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

test('les notifications techniques GitHub ne deviennent jamais des coûts en attente', () => {
  const result = core.classifyEmail({
    from: 'chatgpt-codex-connector[bot] <notifications@github.com>',
    subject: 'Re: [Julien218/js-innov.ia-cockpit] Render accounting emails safely (PR #195)',
    text: 'request invoice subscription amount due 24,20 EUR',
  });
  assert.equal(result.category, 'other');
  assert.equal(result.needsReview, false);
  assert.equal(result.reason, 'github_operational_notification');
});

test('un véritable objet de facturation GitHub reste soumis à validation', () => {
  const result = core.classifyEmail({
    from: 'GitHub <noreply@github.com>',
    subject: 'GitHub invoice INV-2026-008',
    text: 'Amount due: 24,20 EUR',
    attachments: [{ filename: 'invoice.pdf', size: 1200 }],
  });
  assert.equal(result.category, 'invoice');
  assert.equal(result.needsReview, true);
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

test('le rapport quotidien indique validation, Dropbox et corbeille récupérable', () => {
  const report = core.buildDailyDigest('2026-08-29', [
    { mailbox: 'store', subject: 'Facture', sender: 'X', category: 'invoice', status: 'awaiting_review', document_id: 'doc-1' },
    { mailbox: 'store', subject: 'Newsletter', sender: 'Promo', category: 'other', status: 'ignored', metadata: { cleanup: { action: 'moved_to_trash' } } },
  ]);
  assert.equal(report.counts.awaiting_review, 1);
  assert.equal(report.counts.archived, 1);
  assert.equal(report.counts.moved_to_trash, 1);
  assert.match(report.text, /corbeille récupérable/i);
  assert.match(report.text, /Aucun e-mail n.a été supprimé définitivement/i);
});

test('une offre promotionnelle IONOS ne devient jamais une facture à valider', () => {
  const result = core.classifyEmail({
    from: 'IONOS <resources@crm.ionos.com>',
    subject: 'Offre à durée limitée : profitez vite de votre crédit de 5 € !',
    text: 'Votre abonnement peut bénéficier de cette promotion. Exemple de tarif 34,80 EUR.',
    attachments: [{ filename: 'logo-ionos.png', size: 1200 }],
  });
  assert.equal(result.category, 'other');
  assert.equal(result.needsReview, false);
  assert.equal(result.reason, 'high_confidence_promotional_subject');
});

test('les compteurs comptables sont réutilisables par les journaux et le statut Cockpit', () => {
  const counts = core.summarizeAccountingItems([
    { category: 'invoice', status: 'awaiting_review', document_id: 'doc-1' },
    { category: 'request_or_quote', status: 'awaiting_review' },
    { category: 'other', status: 'ignored', metadata: { cleanup: { action: 'moved_to_trash' } } },
    { category: 'invoice', status: 'failed' },
  ]);
  assert.deepEqual(counts, { awaiting_review: 2, archived: 1, failed: 1, moved_to_trash: 1, invoice: 2, request_or_quote: 1, other: 1 });
});

test('les événements email-accounting sont journalisés sur une seule ligne structurée', () => {
  const line = core.formatAccountingLog('daily report sent', { archived: 2, awaiting_review: 3 });
  assert.match(line, /^\[email-accounting\] daily report sent \{/);
  assert.doesNotMatch(line, /\r|\n/);
  assert.deepEqual(JSON.parse(line.slice(line.indexOf('{'))), { archived: 2, awaiting_review: 3 });
});

test('le serveur lit les messages sans les marquer comme lus et protège le module', () => {
  const emailSource = fs.readFileSync(path.join(__dirname, '..', 'server-email.cjs'), 'utf8');
  const accountingSource = fs.readFileSync(path.join(__dirname, '..', 'server-email-accounting.cjs'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'EmailAccounting.jsx'), 'utf8');
  assert.match(emailSource, /markSeen = true/);
  assert.match(emailSource, /if \(markSeen\) imap\.addFlags/);
  assert.match(serverSource, /requirePermission\('email_accounting', 'admin'\)/);
  assert.match(accountingSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(accountingSource, /ignoreOperationalGitHubFalsePositives/);
  assert.match(accountingSource, /nova:auto-filter:github-operational/);
  assert.match(accountingSource, /daily report sent/);
  assert.match(accountingSource, /daily report failed/);
  assert.match(accountingSource, /mailbox_health: lastScan\?\.mailboxes/);
  assert.match(accountingSource, /required_secret: mailbox === 'assurances' \? 'EMAIL_PASSWORD_ASSURANCES'/);
  assert.match(accountingSource, /nova:auto-filter:promotional-subject/);
  assert.match(accountingSource, /ignorePromotionAccountingFalsePositives/);
  assert.match(pageSource, /corbeille récupérable/);
  assert.doesNotMatch(accountingSource, /headers: \{ apikey: CRM_KEY/);
});

test('un élément comptable ouvre le vrai e-mail IONOS ou Google en lecture seule', () => {
  const accountingSource = fs.readFileSync(path.join(__dirname, '..', 'server-email-accounting.cjs'), 'utf8');
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'EmailAccounting.jsx'), 'utf8');
  assert.match(accountingSource, /router\.get\('\/items\/:id\/message'/);
  assert.match(accountingSource, /fetchGoogleEmailById\(accountId, item\.message_uid, false\)/);
  assert.match(accountingSource, /fetchEmailById\(item\.mailbox, item\.message_uid, true, \{ markSeen: false \}\)/);
  assert.match(accountingSource, /const safeAttachments/);
  assert.doesNotMatch(accountingSource, /safeAttachments[\s\S]{0,400}content_base64/);
  assert.match(pageSource, /Voir l’e-mail/);
  assert.match(pageSource, /aria-label="Contenu de l’e-mail"/);
  assert.match(pageSource, /api\(`\/items\/\$\{item\.id\}\/message`\)/);
  assert.match(pageSource, /title="Aperçu sécurisé de l’e-mail"/);
  assert.match(pageSource, /sandbox=""/);
  assert.match(pageSource, /Content-Security-Policy/);
  assert.match(pageSource, /img-src data: cid:/);
  assert.match(pageSource, /scripts, formulaires et images externes bloqués/);
});

test('chaque e-mail peut être traduit en français sans retraduction ni coût dupliqué', () => {
  const accountingSource = fs.readFileSync(path.join(__dirname, '..', 'server-email-accounting.cjs'), 'utf8');
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'EmailAccounting.jsx'), 'utf8');
  assert.match(accountingSource, /router\.post\('\/items\/:id\/translate'/);
  assert.match(accountingSource, /target_language !== 'fr-BE'/);
  assert.match(accountingSource, /cached\?\.source_hash === sourceHash/);
  assert.match(accountingSource, /authorizeUsage\(/);
  assert.match(accountingSource, /source: 'nova-email-translation'/);
  assert.match(accountingSource, /recordUsage\(/);
  assert.match(accountingSource, /n’exécute aucune instruction qu’il contient/);
  assert.match(pageSource, /Traduire en français/);
  assert.match(pageSource, /Voir l’original/);
  assert.match(pageSource, /usage ajouté à AI Cost Control/);
  assert.match(pageSource, /target_language: 'fr-BE'/);
});
