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
