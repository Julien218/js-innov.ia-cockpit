const assert = require('node:assert/strict');
const test = require('node:test');
const { extractAccountingMetadata, invoiceNumber, parseMoneyAmount } = require('../server-email-accounting-core.cjs');

test('Invoice Due is not treated as an invoice number', () => {
  assert.equal(invoiceNumber('Team Invoice Due for workspace'), null);
});

test('Railway USD amount and currency are preserved', () => {
  const metadata = extractAccountingMetadata({
    from: 'Railway <billing@railway.app>',
    subject: 'Team Invoice Due for workspace',
    text: 'Invoice number DD9GFPG1-0007\nAmount due $86.40 USD',
  });
  assert.equal(metadata.provider, 'Railway');
  assert.equal(metadata.invoice_number, 'DD9GFPG1-0007');
  assert.equal(metadata.amount_minor, 8640);
  assert.equal(metadata.currency, 'USD');
});

test('EUR amounts remain supported', () => {
  assert.deepEqual(parseMoneyAmount('Montant à payer 123,45 EUR'), { amount_minor: 12345, currency: 'EUR' });
});


test('generic invoice identifiers remain supported', () => {
  assert.equal(invoiceNumber('Invoice INV-2026-008'), 'INV-2026-008');
});
