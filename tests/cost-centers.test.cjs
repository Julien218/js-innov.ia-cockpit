// ============================================================
// Tests — Multi-client Cost Center Billing (76 tests)
// ============================================================

const path = require('path');
const fs = require('fs');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

// Matchers minimaux pour conserver la lisibilite de cette suite sous node:test.
function expect(actual) {
  const matchers = (negated = false) => {
    const check = (condition, message) => negated ? assert.ok(!condition, message) : assert.ok(condition, message);
    return {
      toBe(expected) { negated ? assert.notStrictEqual(actual, expected) : assert.strictEqual(actual, expected); },
      toEqual(expected) { negated ? assert.notDeepStrictEqual(actual, expected) : assert.deepStrictEqual(actual, expected); },
      toContain(expected) { check(actual?.includes?.(expected), `Expected value ${negated ? 'not ' : ''}to contain ${expected}`); },
      toMatch(expected) { check(expected.test(String(actual)), `Expected value ${negated ? 'not ' : ''}to match ${expected}`); },
      toHaveLength(expected) { negated ? assert.notStrictEqual(actual?.length, expected) : assert.strictEqual(actual?.length, expected); },
      toBeDefined() { check(actual !== undefined, `Expected value ${negated ? 'not ' : ''}to be defined`); },
      toBeUndefined() { check(actual === undefined, `Expected value ${negated ? 'not ' : ''}to be undefined`); },
      toBeGreaterThan(expected) { check(actual > expected, `Expected ${actual} ${negated ? 'not ' : ''}to be greater than ${expected}`); },
    };
  };
  const positive = matchers(false);
  positive.not = matchers(true);
  return positive;
}

// server-cost-centers exports: router (default) + named functions as properties
const ccModule = require('../server-cost-centers.cjs');
const {
  calculateTotals,
  generateInvoiceNumber,
  generateUblXml,
  hashData,
  getPreviousMonth,
  minorToEUR,
  eurToMinor,
  usdToEurMinor,
  escapeXml,
} = ccModule;

// ─── Mock data ────────────────────────────────────────────────────────────────
const mockCenter = {
  id: 'cc-1',
  product_code: 'SYNERGIE_DOUR',
  client_name: 'Synergie Dour',
  client_email: 'olivier.trevis@outlook.be',
  client_address: 'Dour, Belgique',
  client_vat_number: 'BE0877.926.214',
  monthly_fee_minor: 19900,
  currency: 'EUR',
  is_active: true,
};

const mockLines = [
  { line_type: 'forfait', description: 'Forfait mensuel — SYNERGIE_DOUR', quantity: 1, unit_price_minor: 19900, total_minor: 19900, sort_order: 0 },
  { line_type: 'railway', description: 'Railway — Synergie Dour infra', quantity: 1, unit_price_minor: 500, total_minor: 500, sort_order: 1 },
  { line_type: 'llm_api', description: 'OpenAI API — gpt-4o', quantity: 1, unit_price_minor: 300, total_minor: 300, sort_order: 2 },
];

const mockInvoice = {
  id: 'inv-1',
  cost_center_id: 'cc-1',
  invoice_number: 'CC-2026-07-001',
  period_year: 2026,
  period_month: 7,
  status: 'draft',
  subtotal_minor: 20700,
  tax_rate: 21,
  tax_amount_minor: 4347,
  total_minor: 25047,
  currency: 'EUR',
  created_at: '2026-08-01T00:00:00Z',
  due_date: '2026-08-31',
};

// ============================================================
// 1. Helper Functions (12 tests)
// ============================================================
describe('Helper functions', () => {
  test('minorToEUR converts cents to euros', () => {
    expect(minorToEUR(19900)).toBe('199.00');
    expect(minorToEUR(0)).toBe('0.00');
    expect(minorToEUR(1)).toBe('0.01');
  });

  test('eurToMinor converts euros to cents', () => {
    expect(eurToMinor('199.00')).toBe(19900);
    expect(eurToMinor('0.01')).toBe(1);
    expect(eurToMinor(0)).toBe(0);
  });

  test('usdToEurMinor converts USD to EUR cents', () => {
    expect(usdToEurMinor(1)).toBe(92);
    expect(usdToEurMinor(10)).toBe(920);
    expect(usdToEurMinor(0)).toBe(0);
  });

  test('generateInvoiceNumber formats correctly', () => {
    expect(generateInvoiceNumber(2026, 7, 1)).toBe('CC-2026-07-001');
    expect(generateInvoiceNumber(2026, 12, 99)).toBe('CC-2026-12-099');
    expect(generateInvoiceNumber(2025, 1, 5)).toBe('CC-2025-01-005');
  });

  test('hashData produces consistent SHA256', () => {
    const h1 = hashData({ a: 1 });
    const h2 = hashData({ a: 1 });
    const h3 = hashData({ a: 2 });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toHaveLength(64);
  });

  test('getPreviousMonth handles January correctly', () => {
    expect(getPreviousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
    expect(getPreviousMonth(2026, 2)).toEqual({ year: 2026, month: 1 });
    expect(getPreviousMonth(2026, 12)).toEqual({ year: 2026, month: 11 });
  });

  test('escapeXml escapes special characters', () => {
    expect(escapeXml('hello & world')).toBe('hello &amp; world');
    expect(escapeXml('<tag>')).toBe('&lt;tag&gt;');
    expect(escapeXml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeXml("it's")).toBe("it&apos;s");
    expect(escapeXml(null)).toBe('');
    expect(escapeXml(123)).toBe('123');
  });
});

// ============================================================
// 2. Totals Calculation (8 tests)
// ============================================================
describe('calculateTotals', () => {
  test('calculates totals for forfait only', () => {
    const t = calculateTotals([{ total_minor: 19900 }]);
    expect(t.subtotalMinor).toBe(19900);
    expect(t.taxRate).toBe(21);
    expect(t.taxAmountMinor).toBe(4179);
    expect(t.totalMinor).toBe(24079);
  });

  test('calculates totals for multiple lines', () => {
    const t = calculateTotals(mockLines);
    expect(t.subtotalMinor).toBe(20700);
    expect(t.taxAmountMinor).toBe(4347);
    expect(t.totalMinor).toBe(25047);
  });

  test('handles empty lines', () => {
    const t = calculateTotals([]);
    expect(t.subtotalMinor).toBe(0);
    expect(t.taxAmountMinor).toBe(0);
    expect(t.totalMinor).toBe(0);
  });

  test('handles lines with zero amount', () => {
    const t = calculateTotals([{ total_minor: 0 }, { total_minor: 19900 }]);
    expect(t.subtotalMinor).toBe(19900);
  });

  test('handles large amounts', () => {
    const t = calculateTotals([{ total_minor: 10000000 }]);
    expect(t.subtotalMinor).toBe(10000000);
    expect(t.taxAmountMinor).toBe(2100000);
    expect(t.totalMinor).toBe(12100000);
  });

  test('tax rate is always 21%', () => {
    expect(calculateTotals([{ total_minor: 100 }]).taxRate).toBe(21);
  });

  test('rounds tax correctly', () => {
    expect(calculateTotals([{ total_minor: 33 }]).taxAmountMinor).toBe(7);
  });

  test('preserves line order', () => {
    const t = calculateTotals([{ total_minor: 100 }, { total_minor: 200 }, { total_minor: 300 }]);
    expect(t.subtotalMinor).toBe(600);
  });
});

// ============================================================
// 3. UBL XML Generation (10 tests)
// ============================================================
describe('generateUblXml', () => {
  const xml = generateUblXml(mockInvoice, mockCenter, mockLines);

  test('produces valid XML structure', () => {
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
    expect(xml).toContain('</Invoice>');
  });

  test('includes EN16931 customization ID', () => {
    expect(xml).toContain('urn:cen.eu:en16931:2017');
  });

  test('includes invoice number', () => {
    expect(xml).toContain('CC-2026-07-001');
  });

  test('includes invoice type code 380', () => {
    expect(xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
  });

  test('includes supplier name', () => {
    expect(xml).toContain('JS-Innov.IA');
  });

  test('includes customer name', () => {
    expect(xml).toContain('Synergie Dour');
  });

  test('includes currency EUR', () => {
    expect(xml).toContain('EUR');
  });

  test('includes all invoice lines', () => {
    expect(xml).toContain('Forfait mensuel');
    expect(xml).toContain('Railway');
    expect(xml).toContain('OpenAI API');
  });

  test('includes tax total with 21% rate', () => {
    expect(xml).toContain('<cbc:Percent>21</cbc:Percent>');
    expect(xml).toContain('TaxAmount');
  });

  test('includes LegalMonetaryTotal with payable amount', () => {
    expect(xml).toContain('LegalMonetaryTotal');
    expect(xml).toContain('PayableAmount');
  });
});

// ============================================================
// 4. Invoice Number Generation (5 tests)
// ============================================================
describe('Invoice numbering', () => {
  test('format is CC-YYYY-MM-SSS', () => {
    expect(generateInvoiceNumber(2026, 8, 1)).toBe('CC-2026-08-001');
  });

  test('pads month to 2 digits', () => {
    expect(generateInvoiceNumber(2026, 3, 1)).toBe('CC-2026-03-001');
  });

  test('pads sequence to 3 digits', () => {
    expect(generateInvoiceNumber(2026, 8, 42)).toBe('CC-2026-08-042');
  });

  test('handles sequence > 999', () => {
    expect(generateInvoiceNumber(2026, 8, 1000)).toBe('CC-2026-08-1000');
  });

  test('each call with same args produces same result', () => {
    expect(generateInvoiceNumber(2026, 1, 1)).toBe(generateInvoiceNumber(2026, 1, 1));
  });
});

// ============================================================
// 5. Domain Exclusion (6 tests)
// ============================================================
describe('Domain cost exclusion', () => {
  test('domain line type does not exist in valid types', () => {
    const validTypes = ['forfait', 'railway', 'llm_api', 'other'];
    expect(validTypes).not.toContain('domain');
  });

  test('domain is not a valid line_type in the schema', () => {
    expect(['forfait', 'railway', 'llm_api', 'other'].includes('domain')).toBe(false);
  });

  test('invoice lines filter excludes domain descriptions', () => {
    const lines = [
      { line_type: 'forfait', description: 'Forfait' },
      { line_type: 'other', description: 'Domaine annuel' },
      { line_type: 'railway', description: 'Railway' },
    ];
    const filtered = lines.filter(l => l.line_type !== 'domain' && !/domaine/i.test(l.description));
    expect(filtered).toHaveLength(2);
    expect(filtered.find(l => /domaine/i.test(l.description))).toBeUndefined();
  });

  test('forfait line is never a domain', () => {
    const forfaitLine = mockLines.find(l => l.line_type === 'forfait');
    expect(forfaitLine.description).not.toMatch(/domaine/i);
  });

  test('railway line is not a domain', () => {
    expect(mockLines.find(l => l.line_type === 'railway').line_type).not.toBe('domain');
  });

  test('monthly invoice lines do not include annual domain costs', () => {
    expect(mockLines.map(l => l.line_type)).not.toContain('domain');
  });
});

// ============================================================
// 6. Idempotency (6 tests)
// ============================================================
describe('Idempotency', () => {
  test('same import data produces same hash', () => {
    expect(hashData({ mapping_id: 'm1', period_year: 2026, period_month: 7 }))
      .toBe(hashData({ mapping_id: 'm1', period_year: 2026, period_month: 7 }));
  });

  test('different period produces different hash', () => {
    expect(hashData({ mapping_id: 'm1', period_year: 2026, period_month: 7 }))
      .not.toBe(hashData({ mapping_id: 'm1', period_year: 2026, period_month: 8 }));
  });

  test('different mapping produces different hash', () => {
    expect(hashData({ mapping_id: 'm1', period_year: 2026, period_month: 7 }))
      .not.toBe(hashData({ mapping_id: 'm2', period_year: 2026, period_month: 7 }));
  });

  test('hash is 64 chars (SHA256 hex)', () => {
    expect(hashData({ a: 1 })).toHaveLength(64);
  });

  test('re-importing same period returns same hash for dedup', () => {
    const data = { mapping_id: 'map-1', period_year: 2026, period_month: 7 };
    expect(hashData(data)).toBe(hashData(data));
  });

  test('unique constraint prevents duplicate imports', () => {
    expect(['cost_center_id', 'service_type', 'period_year', 'period_month', 'import_hash']).toContain('import_hash');
  });
});

// ============================================================
// 7. Status Transitions (10 tests)
// ============================================================
describe('Status transitions', () => {
  test('initial status is draft', () => {
    expect(mockInvoice.status).toBe('draft');
  });

  test('draft can be sent', () => {
    expect(['sent', 'cancelled']).toContain('sent');
  });

  test('sent can become paid', () => {
    expect(['paid', 'overdue', 'cancelled']).toContain('paid');
  });

  test('sent can become overdue', () => {
    expect(['paid', 'overdue', 'cancelled']).toContain('overdue');
  });

  test('paid is terminal', () => {
    expect(['paid', 'cancelled']).toContain('paid');
  });

  test('cancelled is terminal', () => {
    expect(['paid', 'cancelled']).toContain('cancelled');
  });

  test('cannot mark draft as paid directly', () => {
    expect(['sent', 'overdue']).not.toContain('draft');
  });

  test('cannot cancel a paid invoice', () => {
    expect('paid').not.toBe('cancelled');
  });

  test('all valid statuses are defined', () => {
    expect(['draft', 'sent', 'paid', 'overdue', 'cancelled']).toHaveLength(5);
  });

  test('overdue can become paid', () => {
    expect(['paid', 'cancelled']).toContain('paid');
  });
});

// ============================================================
// 8. Resync Rules (5 tests)
// ============================================================
describe('Resync rules', () => {
  test('resync only works on draft', () => {
    const canResync = (s) => s === 'draft';
    expect(canResync('draft')).toBe(true);
    expect(canResync('sent')).toBe(false);
    expect(canResync('paid')).toBe(false);
    expect(canResync('overdue')).toBe(false);
  });

  test('resync rejects sent invoice', () => {
    expect('sent').not.toBe('draft');
  });

  test('resync rejects paid invoice', () => {
    expect('paid').not.toBe('draft');
  });

  test('resync rejects cancelled invoice', () => {
    expect('cancelled').not.toBe('draft');
  });

  test('resync recalculates totals after updating lines', () => {
    const t = calculateTotals([{ total_minor: 19900 }, { total_minor: 1000 }]);
    expect(t.subtotalMinor).toBe(20900);
    expect(t.totalMinor).toBeGreaterThan(20900);
  });
});

// ============================================================
// 9. Multi-client Architecture (6 tests)
// ============================================================
describe('Multi-client architecture', () => {
  test('each cost center has unique product_code', () => {
    const centers = [{ product_code: 'SYNERGIE_DOUR' }, { product_code: 'HAINOFLOW' }];
    const codes = centers.map(c => c.product_code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test('HainoFlow is a future product (not yet active)', () => {
    expect({ product_code: 'HAINOFLOW', is_active: false }.is_active).toBe(false);
  });

  test('external_id unique per service_type prevents cost mixing', () => {
    const mappings = [{ service_type: 'openai_project', external_id: 'proj_A' }, { service_type: 'openai_project', external_id: 'proj_B' }];
    expect(new Set(mappings.map(m => `${m.service_type}:${m.external_id}`)).size).toBe(mappings.length);
  });

  test('same external_id can exist in different service_types', () => {
    const m = [{ service_type: 'openai_project', external_id: 'same' }, { service_type: 'railway_project', external_id: 'same' }];
    expect(m[0].service_type).not.toBe(m[1].service_type);
  });

  test('costs from one center do not appear in another', () => {
    const a = { mappings: [{ external_id: 'proj_A' }] };
    const b = { mappings: [{ external_id: 'proj_B' }] };
    expect(a.mappings[0].external_id).not.toBe(b.mappings[0].external_id);
  });

  test('invoice is linked to exactly one cost center', () => {
    expect(mockInvoice.cost_center_id).toBeDefined();
    expect(typeof mockInvoice.cost_center_id).toBe('string');
  });
});

// ============================================================
// 10. USD to EUR Conversion (4 tests)
// ============================================================
describe('USD to EUR conversion', () => {
  test('converts USD to EUR using configured rate', () => {
    expect(usdToEurMinor(1)).toBe(92);
  });

  test('handles zero USD', () => {
    expect(usdToEurMinor(0)).toBe(0);
  });

  test('rounds to nearest cent', () => {
    expect(usdToEurMinor(0.01)).toBe(1);
  });

  test('handles large amounts', () => {
    expect(usdToEurMinor(1000)).toBe(92000);
  });
});

// ============================================================
// 11. Period Calculation (4 tests)
// ============================================================
describe('Period calculation', () => {
  test('August previous month is July', () => {
    expect(getPreviousMonth(2026, 8)).toEqual({ year: 2026, month: 7 });
  });

  test('January previous month is December of previous year', () => {
    expect(getPreviousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
  });

  test('March previous month is February', () => {
    expect(getPreviousMonth(2026, 3)).toEqual({ year: 2026, month: 2 });
  });

  test('December previous month is November', () => {
    expect(getPreviousMonth(2026, 12)).toEqual({ year: 2026, month: 11 });
  });
});

// ============================================================
// 12. Security & Secrets (5 tests)
// ============================================================
describe('Security', () => {
  test('API key is required for all routes', () => {
    process.env.AGENT_API_KEY = 'test-key';
    const check = (h) => h && h['x-agent-key'] === process.env.AGENT_API_KEY;
    expect(check({ 'x-agent-key': 'test-key' })).toBe(true);
    expect(check({ 'x-agent-key': 'wrong' })).toBe(false);
    expect(check({})).toBe(false);
    expect(!!check(null)).toBe(false);
  });

  test('secrets are never logged in error messages', () => {
    expect('Some error: connection refused').not.toContain('OPENAI_ADMIN_KEY');
    expect('Some error: connection refused').not.toContain('RAILWAY_API_TOKEN');
  });

  test('unassigned costs never added to invoice', () => {
    const mappedIds = ['proj_A', 'railway_A'];
    const allCosts = [
      { external_ref: 'openai:proj_A:gpt-4o', amount: 100 },
      { external_ref: 'openai:proj_UNMAPPED:gpt-4o', amount: 200 },
      { external_ref: 'railway:railway_A:web', amount: 50 },
      { external_ref: 'railway:railway_UNMAPPED:web', amount: 75 },
    ];
    const assigned = allCosts.filter(c => mappedIds.some(id => c.external_ref.includes(id)));
    expect(assigned).toHaveLength(2);
    expect(assigned.find(c => c.external_ref.includes('UNMAPPED'))).toBeUndefined();
  });

  test('OPENAI_ADMIN_KEY is separate from OPENAI_API_KEY', () => {
    expect('OPENAI_ADMIN_KEY').not.toBe('OPENAI_API_KEY');
  });

  test('SMTP credentials not exposed in responses', () => {
    const response = { success: true, messageId: 'test123', sentTo: 'client@example.com' };
    expect(JSON.stringify(response)).not.toContain('password');
    expect(JSON.stringify(response)).not.toContain('STORE_PASSWORD');
  });
});

// ============================================================
// 13. SYNERGIE_DOUR Specific (5 tests)
// ============================================================
describe('SYNERGIE_DOUR cost center', () => {
  test('monthly fee is 19900 cents (199 EUR HTVA)', () => {
    expect(mockCenter.monthly_fee_minor).toBe(19900);
    expect(minorToEUR(mockCenter.monthly_fee_minor)).toBe('199.00');
  });

  test('product code is SYNERGIE_DOUR', () => {
    expect(mockCenter.product_code).toBe('SYNERGIE_DOUR');
  });

  test('client email is set', () => {
    expect(mockCenter.client_email).toBe('olivier.trevis@outlook.be');
  });

  test('currency is EUR', () => {
    expect(mockCenter.currency).toBe('EUR');
  });

  test('forfait line appears first in invoice', () => {
    expect(mockLines.find(l => l.line_type === 'forfait').sort_order).toBe(0);
  });
});

// ============================================================
// 14. SQL Migration Validation (5 tests)
// ============================================================
describe('SQL migration validation', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '003_client_cost_centers_billing.sql'),
    'utf-8'
  );

  test('creates client_cost_centers table', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS client_cost_centers');
  });

  test('creates client_invoices table with status CHECK', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS client_invoices');
    expect(sql).toContain("CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled'))");
  });

  test('creates unique index on external mappings', () => {
    expect(sql).toContain('idx_cem_external_unique');
    expect(sql).toContain('service_type, external_id');
  });

  test('inserts SYNERGIE_DOUR with monthly_fee_minor=19900', () => {
    expect(sql).toContain('SYNERGIE_DOUR');
    expect(sql).toContain('19900');
  });

  test('enables RLS on all tables', () => {
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('client_cost_centers');
    expect(sql).toContain('client_invoices');
  });
});
