const test = require('node:test');
const assert = require('node:assert/strict');

const { monthValue, eurMinorFromUsd } = require('../server-project-costs.cjs');
const { shouldPrepareMonthlyDrafts, localDateParts } = require('../server-monthly-billing-scheduler.cjs');

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