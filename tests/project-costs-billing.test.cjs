const test = require('node:test');
const assert = require('node:assert/strict');

const { monthValue, eurMinorFromUsd, projectCostCenterCode } = require('../server-project-costs.cjs');
const { shouldPrepareMonthlyDrafts, localDateParts } = require('../server-monthly-billing-scheduler.cjs');
const { invoiceSequence, invoiceNumber } = require('../server-monthly-billing-preparer.cjs');

test('normalizes a valid cost month', () => {
  assert.equal(monthValue('2026-08'), '2026-08');
});

test('rejects malformed month by falling back to current month shape', () => {
  assert.match(monthValue('2026-99'), /^\d{4}-(0[1-9]|1[0-2])$/);
});

test('converts USD cost to EUR cents with configured rate', () => {
  assert.equal(eurMinorFromUsd(10), 920);
});

test('monthly preparation is enabled only on the first day in Brussels', () => {
  assert.equal(shouldPrepareMonthlyDrafts(new Date('2026-08-01T12:00:00Z')), true);
  assert.equal(shouldPrepareMonthlyDrafts(new Date('2026-08-02T12:00:00Z')), false);
});

test('scheduler resolves the Brussels local date', () => {
  const parts = localDateParts(new Date('2026-08-01T12:00:00Z'));
  assert.equal(parts.year, '2026');
  assert.equal(parts.month, '08');
  assert.equal(parts.day, '01');
});

test('project cost center code is stable and normalized', () => {
  assert.equal(projectCostCenterCode('abc-123', 'Projet été Dour'), 'PROJECT_PROJET_ETE_DOUR_ABC_123');
});

test('monthly invoice numbers advance across multiple projects', () => {
  const existing = [
    { invoice_number: 'CC-2026-07-001' },
    { invoice_number: 'CC-2026-07-002' },
    { invoice_number: 'CC-2026-06-099' },
  ];
  assert.equal(invoiceSequence(existing, 2026, 7), 3);
  assert.equal(invoiceNumber(2026, 7, 3), 'CC-2026-07-003');
});