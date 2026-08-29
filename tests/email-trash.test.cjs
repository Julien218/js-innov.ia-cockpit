const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findTrashMailbox, flattenMailboxes } = require('../server-email-trash-core.cjs');

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
