const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findTrashMailbox, flattenMailboxes, shouldTrashImapPromotion } = require('../server-email-trash-core.cjs');

test('finds a provider-declared IMAP trash mailbox first', () => {
  const boxes = {
    INBOX: { attribs: ['\\HasNoChildren'], delimiter: '/' },
    Archive: { attribs: ['\\HasNoChildren'], delimiter: '/' },
    Bin: { attribs: ['\\Trash'], delimiter: '/' },
  };
  assert.equal(findTrashMailbox(boxes), 'Bin');
});

test('supports localized and nested trash mailbox names', () => {
  const boxes = {
    INBOX: { attribs: [], delimiter: '.', children: {
      Corbeille: { attribs: [], delimiter: '.' },
    } },
  };
  assert.equal(findTrashMailbox(boxes), 'INBOX.Corbeille');
  assert.deepEqual(flattenMailboxes(boxes).map((item) => item.name), ['INBOX', 'INBOX.Corbeille']);
});

test('never guesses a destination when no trash mailbox exists', () => {
  assert.equal(findTrashMailbox({ INBOX: { attribs: [], delimiter: '/' }, Archive: { attribs: [], delimiter: '/' } }), null);
});

test('moves only high-confidence IONOS promotions', () => {
  const result = shouldTrashImapPromotion({
    from: 'Boutique <promo@example.com>',
    subject: 'Newsletter — offre exclusive',
    text: 'Profitez de notre promotion. Se désabonner.',
    listUnsubscribe: '<mailto:unsubscribe@example.com>',
  });
  assert.equal(result.eligible, true);
  assert.ok(result.confidence >= 0.99);
});

test('protects invoices, requests, attachments and trusted senders', () => {
  assert.equal(shouldTrashImapPromotion({ subject: 'Votre facture', text: 'Promotion annuelle' }).reason, 'business_or_accounting_signal');
  assert.equal(shouldTrashImapPromotion({ subject: 'Demande client', text: 'Newsletter' }).reason, 'business_or_accounting_signal');
  assert.equal(shouldTrashImapPromotion({ subject: 'Newsletter promotion', hasAttachment: true }).reason, 'attachment_protected');
  assert.equal(shouldTrashImapPromotion({ from: 'client@safe.be', subject: 'Newsletter promotion soldes' }, ['@safe.be']).reason, 'protected_sender');
});

test('refuses ambiguous marketing-looking messages', () => {
  assert.equal(shouldTrashImapPromotion({ subject: 'Une offre pour vous', text: 'Bonjour' }).eligible, false);
});
