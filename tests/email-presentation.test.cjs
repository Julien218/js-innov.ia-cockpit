const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const fs = require('node:fs');
const { parseMailHeaders, decodeMailHeader, presentMailboxEmail } = require('../server-email-presentation.cjs');
const { gmailMessageToEmail } = require('../server-google-mail-core.cjs');

const headers = 'From: =?utf-8?B?T2xpdmllciBUcsOpdmlz?= <olivier@example.test>\r\n'
  + 'To: "Équipe" <team@example.test>\r\n'
  + 'Subject: =?UTF-8?Q?Fwd=3A_Nouveau_client_professionnel_=E2=80=94_NB_Soins_Infir?=\r\n'
  + ' =?UTF-8?Q?miers_=C3=A0_Dour?=\r\nDate: Wed, 26 Aug 2026 10:00:00 +0200\r\n\r\n';

test('RFC 2047: Q/B, accents et objets pliés sont décodés entièrement', () => {
  const decoded = parseMailHeaders(Buffer.from(headers));
  assert.equal(decoded.subject, 'Fwd: Nouveau client professionnel — NB Soins Infirmiers à Dour');
  assert.equal(decoded.from, 'Olivier Trévis <olivier@example.test>');
  assert.equal(decoded.to, '"Équipe" <team@example.test>');
  assert.equal(decodeMailHeader('=?ISO-8859-1?Q?V=E9rification_assistance?='), 'Vérification assistance');
  assert.equal(decodeMailHeader('Fwd: Proposition par DVV'), 'Fwd: Proposition par DVV');
  assert.equal(parseMailHeaders('Subject:\r\n\t=?UTF-8?Q?Objet_repli=C3=A9?=\r\n').subject, 'Objet replié');
});

test('en-têtes incomplets : pas de date invalide ni disparition du texte', () => {
  assert.equal(parseMailHeaders('Date: invalid\r\n', '2026-08-01T00:00:00Z').date, '2026-08-01T00:00:00.000Z');
  assert.equal(parseMailHeaders('').date, null);
  assert.equal(decodeMailHeader('objet =? encodage incomplet'), 'objet =? encodage incomplet');
});

test('les anciens mails sont classés sans suppression, déplacement ni modification du lu', () => {
  const examples = [
    ['Facture INV-2026', 'invoices'], ['Fwd: Proposition par DVV', 'requests'],
    ['Fwd: Nouveau client professionnel', 'client_records'], ['Vérification assistance véhicule', 'client_records'],
    ['Deployment notification', 'notifications'], ['Bonjour', 'other'],
  ];
  for (const [subject, category] of examples) {
    const input = { uid: 12, subject, seen: false, date: '2020-01-01', body: 'facture (corps non décodé)', from: 'Contact <a@example.test>' };
    const output = presentMailboxEmail(input);
    assert.equal(output.classification.category, category);
    assert.equal(output.classification.indicative, true);
    assert.equal(output.seen, false);
    assert.equal(input.classification, undefined);
    assert.equal(output.uid, 12);
  }
});

test('Gmail reçoit le même décodage et les mêmes catégories, même sans corps', () => {
  const message = gmailMessageToEmail({ id: 'google-1', labelIds: ['INBOX', 'UNREAD'], payload: { headers: [
    { name: 'From', value: '=?utf-8?B?T2xpdmllciBUcsOpdmlz?= <a@example.test>' },
    { name: 'Subject', value: '=?UTF-8?Q?Demande_de_devis_=C3=A0_Dour?=' },
  ] } });
  assert.equal(message.subject, 'Demande de devis à Dour');
  assert.equal(message.classification.category, 'requests');
  assert.equal(message.seen, false);
  assert.match(message.from, /Olivier Trévis/);
});

test('la liste IMAP réelle utilise les en-têtes complets et préserve les octets coupés entre paquets', async () => {
  const OriginalImap = require('imap');
  const originalLoad = Module._load;
  const instances = [];
  class FakeImap extends EventEmitter {
    static parseHeader = OriginalImap.parseHeader;
    constructor() { super(); instances.push(this); this.seq = { fetch: (range, options) => this.fetchList(range, options) }; }
    connect() { queueMicrotask(() => this.emit('ready')); }
    end() {}
    openBox(folder, readOnly, cb) { assert.equal(readOnly, true); cb(null, { messages: { total: 1 } }); }
    search(criteria, cb) { cb(null, [21]); }
    fetchList(range, options) {
      assert.equal(options.markSeen, false);
      const fetcher = new EventEmitter();
      queueMicrotask(() => {
        const msg = new EventEmitter();
        fetcher.emit('message', msg);
        msg.emit('attributes', { uid: 21, flags: [], date: '2026-08-26', struct: [[{ disposition: { type: 'ATTACHMENT' } }]] });
        const stream = new EventEmitter();
        msg.emit('body', stream, { which: 'HEADER.FIELDS (FROM TO SUBJECT DATE)' });
        const bytes = Buffer.from(headers);
        // Break every UTF-8 sequence across packets, as a network may do.
        for (let index = 0; index < bytes.length; index++) stream.emit('data', bytes.subarray(index, index + 1));
        stream.emit('end'); msg.emit('end'); fetcher.emit('end');
      });
      return fetcher;
    }
  }
  const previousPassword = process.env.EMAIL_PASSWORD_ASSURANCES;
  process.env.EMAIL_PASSWORD_ASSURANCES = 'fake-test-password';
  const modulePath = require.resolve('../server-email.cjs');
  const previousCache = require.cache[modulePath];
  delete require.cache[modulePath];
  try {
    Module._load = function(name, ...args) { return name === 'imap' ? FakeImap : originalLoad.call(this, name, ...args); };
    const { fetchEmails } = require('../server-email.cjs');
    Module._load = originalLoad;
    const result = await fetchEmails('assurances');
    assert.equal(result.total, 1);
    assert.equal(result.unread, 1);
    assert.equal(result.emails[0].subject, 'Fwd: Nouveau client professionnel — NB Soins Infirmiers à Dour');
    assert.match(result.emails[0].to, /Équipe/);
    assert.equal(result.emails[0].classification.category, 'client_records');
    assert.equal(result.emails[0].hasAttachment, true);
    assert.equal(result.emails[0].seen, false);
    assert.equal(instances.length, 1);
  } finally {
    Module._load = originalLoad;
    if (previousCache) require.cache[modulePath] = previousCache; else delete require.cache[modulePath];
    if (previousPassword === undefined) delete process.env.EMAIL_PASSWORD_ASSURANCES; else process.env.EMAIL_PASSWORD_ASSURANCES = previousPassword;
  }
});

test('les filtres de boîte comptent et recherchent les objets décodés sans mélanger les catégories', async () => {
  const { filterMailboxEmails, mailCategoryCounts } = await import('../src/lib/mailboxCategories.js');
  const emails = ['Facture août', 'Demande de devis', 'Nouveau client'].map(subject => presentMailboxEmail({ subject }));
  assert.equal(mailCategoryCounts(emails).all, 3);
  assert.equal(mailCategoryCounts(emails).invoices, 1);
  assert.equal(filterMailboxEmails(emails, 'invoices', 'AOÛT').length, 1);
  assert.equal(filterMailboxEmails(emails, 'requests', 'AOÛT').length, 0);
  assert.equal(filterMailboxEmails(emails, 'client_records', '')[0].subject, 'Nouveau client');
  const dockerfile = fs.readFileSync(require.resolve('../Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY --from=builder \/app\/server-email-presentation\.cjs/);
});
