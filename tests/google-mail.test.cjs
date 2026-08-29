const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  encryptToken, decryptToken, encodeState, decodeState,
  gmailMessageToEmail, shouldTrashPromotion,
} = require('../server-google-mail-core.cjs');

function gmailMessage({ id = 'm1', labels = ['INBOX', 'CATEGORY_PROMOTIONS'], from = 'Promo <promo@example.com>', subject = 'Offre du week-end', snippet = 'Découvrez nos nouveautés' } = {}) {
  return {
    id, threadId: `t-${id}`, labelIds: labels, snippet, internalDate: String(Date.now()),
    payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: from }, { name: 'To', value: 'info@jsinnovia.com' }, { name: 'Subject', value: subject }], body: { data: Buffer.from(snippet).toString('base64url') } },
  };
}

test('Google refresh tokens are encrypted with authenticated encryption', () => {
  const first = encryptToken('refresh-secret', 'server-secret');
  const second = encryptToken('refresh-secret', 'server-secret');
  assert.notEqual(first, second);
  assert.equal(decryptToken(first, 'server-secret'), 'refresh-secret');
  assert.throws(() => decryptToken(`${first}tampered`, 'server-secret'));
});

test('OAuth state is signed, scoped and expires', () => {
  const state = encodeState({ user_id: 'owner', brand: 'js-innov-ia' }, 'state-secret');
  assert.equal(decodeState(state, 'state-secret').user_id, 'owner');
  assert.throws(() => decodeState(`${state}x`, 'state-secret'));
  assert.throws(() => decodeState(state, 'state-secret', -1), /expiré/);
});

test('Gmail payload is normalized for the existing Cockpit email UI', () => {
  const email = gmailMessageToEmail(gmailMessage());
  assert.equal(email.uid, 'm1');
  assert.equal(email.subject, 'Offre du week-end');
  assert.equal(email.text, 'Découvrez nos nouveautés');
  assert.equal(email.seen, true);
});

test('only high-confidence Gmail promotions are eligible for automatic trash', () => {
  assert.deepEqual(shouldTrashPromotion(gmailMessage()), { eligible: true, confidence: 0.98, reason: 'gmail_category_promotions' });
  assert.equal(shouldTrashPromotion(gmailMessage({ labels: ['INBOX'] })).eligible, false);
  assert.equal(shouldTrashPromotion(gmailMessage({ labels: ['INBOX', 'CATEGORY_PROMOTIONS', 'STARRED'] })).reason, 'important_or_starred');
  assert.equal(shouldTrashPromotion(gmailMessage({ subject: 'Votre facture Proximedia' })).reason, 'accounting_or_business_signal');
  assert.equal(shouldTrashPromotion(gmailMessage({ from: 'Fournisseur <billing@safe.be>' }), ['@safe.be']).reason, 'protected_sender');
});

test('Google mailbox migration is server-only and RLS protected', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260829173000_google_mailboxes.sql'), 'utf8');
  assert.match(sql, /google_mail_accounts enable row level security/i);
  assert.match(sql, /google_mail_cleanup_log enable row level security/i);
  assert.match(sql, /revoke all on table public\.google_mail_accounts from anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.google_mail_accounts to service_role/i);
});

test('Google mailbox routes are permission guarded and packaged in Docker', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');
  const docker = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
  assert.match(server, /app\.use\('\/api\/google-mail', requireSession\('admin'\), requirePermission\('emails', 'admin'\)/);
  assert.match(docker, /server-google-mail-core\.cjs/);
  assert.match(docker, /server-google-mail\.cjs/);
});

test('Settings and Emails pages expose multi-Google mailbox integration', () => {
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Parametres.jsx'), 'utf8');
  const emails = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Emails.jsx'), 'utf8');
  assert.match(settings, /Ajouter une boîte e-mail/);
  assert.match(settings, /api\/google-mail\/status/);
  assert.match(settings, /URI de redirection autorisée/);
  assert.match(settings, /auto_trash_promotions/);
  assert.match(settings, /Restaurer/);
  assert.match(emails, /googleAccounts/);
  assert.match(emails, /api\/google-mail\/messages/);
});

test('connected Google mailboxes feed NOVA daily accounting and Dropbox archive', () => {
  const accounting = fs.readFileSync(path.join(__dirname, '..', 'server-email-accounting.cjs'), 'utf8');
  assert.match(accounting, /fetchGoogleAccounts/);
  assert.match(accounting, /fetchGoogleEmailById\(account\.id, summary\.uid, true\)/);
  assert.match(accounting, /source: 'google-email-accounting'/);
  assert.match(accounting, /google_account_id: account\.id/);
});
