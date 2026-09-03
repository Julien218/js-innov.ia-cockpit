const assert = require('node:assert/strict');
const test = require('node:test');
const { decodePdfBase64, isPdfBuffer, parseSupplierInvoiceText } = require('../server-supplier-invoice.cjs');

test('validates the PDF signature before processing', () => {
  const pdf = Buffer.from('%PDF-1.7\nminimal');
  assert.equal(isPdfBuffer(pdf), true);
  assert.deepEqual(decodePdfBase64(pdf.toString('base64')), pdf);
  assert.throws(() => decodePdfBase64(Buffer.from('not a pdf').toString('base64')), /PDF valide/);
});

test('parses a Railway supplier invoice without confusing amount due and total cost', () => {
  const invoice = parseSupplierInvoiceText(`Invoice\nInvoice number DD9GFPG1-0004\nDate of issue May 31, 2026\nDate due May 31, 2026\nRailway Corporation\nAgent Usage\nApr 30–May 31, 2026\n19,635,111 $0.000001 $19.64\nTotal $44.00\nApplied balance -$31.22\nAmount due $12.78 USD`, 'Invoice-DD9GFPG1-0004.pdf');
  assert.equal(invoice.invoice_number, 'DD9GFPG1-0004');
  assert.equal(invoice.currency, 'USD');
  assert.equal(invoice.total_amount, 44);
  assert.equal(invoice.applied_balance, -31.22);
  assert.equal(invoice.amount_due, 12.78);
  assert.equal(invoice.cost_basis_amount, 44);
  assert.equal(invoice.allocation_status, 'requires_review');
});


test('parses grouped US and European supplier amounts', () => {
  const usd = parseSupplierInvoiceText('Invoice INV-2026-008\nTotal $1,234.56\nAmount due $234.56 USD', 'invoice.pdf');
  assert.equal(usd.invoice_number, 'INV-2026-008');
  assert.equal(usd.total_amount, 1234.56);
  assert.equal(usd.amount_due, 234.56);

  const eur = parseSupplierInvoiceText('Facture numéro BE-2026-009\nTotal 1.234,56 EUR\nMontant à payer 234,56 EUR', 'facture.pdf');
  assert.equal(eur.invoice_number, 'BE-2026-009');
  assert.equal(eur.total_amount, 1234.56);
  assert.equal(eur.amount_due, 234.56);
});

test('prefers tax-inclusive totals and parses localized French dates', () => {
  const invoice = parseSupplierInvoiceText(
    'Facture numéro BE-2026-010\nDate d’émission 31 mai 2026\nDate d’échéance 15 juin 2026\nTotal HT 100,00 EUR\nTotal TTC 121,00 EUR',
    'facture-BE-2026-010.pdf',
  );
  assert.equal(invoice.issue_date, '31 mai 2026');
  assert.equal(invoice.due_date, '15 juin 2026');
  assert.equal(invoice.period, '2026-05');
  assert.equal(invoice.total_amount, 121);
  assert.equal(invoice.cost_basis_amount, 121);
});
