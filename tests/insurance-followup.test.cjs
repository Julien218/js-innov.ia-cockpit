const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const insuranceRouter = require('../server-insurance.cjs');
const { hasInsuranceAccess } = insuranceRouter;

test('Assurances-Dour access accepts superadmin', () => {
  assert.equal(hasInsuranceAccess({ role: 'superadmin', email: 'someone@example.com' }), true);
});

test('Assurances-Dour access accepts Olivier by exact email', () => {
  assert.equal(hasInsuranceAccess({ role: 'client', email: 'OLIVIER.TREVIS@PV.BE' }), true);
});

test('Assurances-Dour access rejects generic admin and collaborator', () => {
  assert.equal(hasInsuranceAccess({ role: 'admin', email: 'admin@example.com' }), false);
  assert.equal(hasInsuranceAccess({ role: 'collaborateur', email: 'other@example.com' }), false);
});

test('mailbox sync helper uses strict TLS and read-only mailbox access', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server-insurance-mailbox.cjs'), 'utf8');
  assert.match(source, /rejectUnauthorized:\s*true/);
  assert.match(source, /openBox\('INBOX',\s*true/);
  assert.match(source, /markSeen:\s*false/);
  assert.doesNotMatch(source, /addFlags|expunge|sendMail/);
});

test('mailbox sync is opt-in and not enabled by default', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server-insurance.cjs'), 'utf8');
  assert.match(source, /INSURANCE_EMAIL_SYNC_ENABLED\s*!==\s*'true'/);
});
