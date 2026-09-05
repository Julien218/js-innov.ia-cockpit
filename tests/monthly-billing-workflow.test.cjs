const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  previousMonth,
  buildInvoiceSnapshot,
  monthWindow,
  BILLING_VAT_PERCENT,
} = require('../server-monthly-billing.cjs');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const client = {
  id: '11111111-1111-4111-8111-111111111111',
  denomination_legale: 'Client Test SRL',
  adresse: 'Rue de Test 12',
  code_postal: '7370',
  ville: 'Dour',
  pays: 'Belgique',
  numero_entreprise: '0123456789',
  numero_tva: 'BE0123456789',
  email_facturation: 'billing@example.invalid',
  facturation_statut: 'verifie',
};
const center = {
  id: '22222222-2222-4222-8222-222222222222',
  client_id: client.id,
  is_active: true,
  name: 'HainoFlow',
  monthly_fee_minor: 19900,
  metadata: { billable: true },
};
const event = {
  id: '33333333-3333-4333-8333-333333333333',
  client_id: client.id,
  cost_center_id: center.id,
  source_type: 'railway',
  description: 'Railway service',
  actual_cost_minor: 100,
  billable_minor: 100,
  billable: true,
  external_ref: 'railway:test',
  metadata: { evidence_status: 'actual', verification_ref: 'railway-api:test' },
};

test('le cycle cible toujours le mois précédent, y compris en janvier', () => {
  assert.equal(previousMonth(new Date('2026-09-05T10:00:00Z')), '2026-08');
  assert.equal(previousMonth(new Date('2027-01-01T05:00:00Z')), '2026-12');
});

test('le brouillon additionne forfait mensuel et coûts prouvés avec TVA belge à 21%', () => {
  const snapshot = buildInvoiceSnapshot({
    client,
    centers: [center],
    events: [event],
    window: monthWindow('2026-08'),
  });
  assert.equal(BILLING_VAT_PERCENT, 21);
  assert.equal(snapshot.amountHt, 200);
  assert.equal(snapshot.vatAmount, 42);
  assert.equal(snapshot.amountTtc, 242);
  assert.equal(snapshot.blockers.length, 0);
  assert.deepEqual(snapshot.eventIds, [event.id]);
  assert.deepEqual(snapshot.feeCenters, [center.id]);
});

test('une dépense non justifiée reste visible comme blocage et ne devient jamais facturable', () => {
  const unverified = {
    ...event,
    id: '44444444-4444-4444-8444-444444444444',
    external_ref: 'railway:unverified',
    actual_cost_minor: 500,
    billable_minor: 0,
    billable: false,
    metadata: { evidence_status: 'unverified' },
  };
  const snapshot = buildInvoiceSnapshot({ client, centers: [center], events: [event, unverified], window: monthWindow('2026-08') });
  assert.equal(snapshot.amountHt, 200);
  assert.ok(snapshot.blockers.some(item => item.code === 'UNVERIFIED_COST'));
  assert.equal(snapshot.eventIds.includes(unverified.id), false);
});

test('l’empreinte est déterministe et change dès que le ledger change', () => {
  const args = { client, centers: [center], events: [event], window: monthWindow('2026-08') };
  const first = buildInvoiceSnapshot(args);
  const second = buildInvoiceSnapshot(args);
  const changed = buildInvoiceSnapshot({ ...args, events: [{ ...event, billable_minor: 101, actual_cost_minor: 101 }] });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.fingerprint, changed.fingerprint);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
});

test('le runner mensuel prépare seulement des brouillons et ne contient aucun envoi SMTP', () => {
  const runner = read('monthly-billing-runner.cjs');
  const monthly = read('server-monthly-billing.cjs');
  assert.match(runner, /runMonthlyBilling/);
  assert.doesNotMatch(runner, /sendMail|nodemailer|approve-and-send/);
  assert.match(monthly, /statut: 'brouillon'/);
  assert.match(monthly, /billing_review_status/);
});

test('les factures automatiques exigent la route de validation dédiée', () => {
  const billing = read('server-billing.cjs');
  const ui = read('src/pages/Factures.jsx');
  assert.match(billing, /AUTO_BILLING_REQUIRES_APPROVAL/);
  assert.match(billing, /createBillingReviewRouter/);
  assert.match(ui, /approve-and-send/);
  assert.match(ui, /refresh-auto-draft/);
  assert.match(ui, /Valider & envoyer/);
  assert.match(ui, /avoir ouvert et vérifié le PDF/);
});

test('la migration interdit deux factures automatiques actives pour le même client et le même mois', () => {
  const migration = read('supabase/migrations/20260905154500_monthly_invoice_review_workflow.sql');
  assert.match(migration, /billing_fingerprint/);
  assert.match(migration, /billing_review_status/);
  assert.match(migration, /create unique index if not exists idx_facture_auto_month_unique/i);
  assert.match(migration, /client_id, periode/);
  assert.match(migration, /auto_generation is true/);
});

test('le schéma Facture conserve la TVA à 21% et les champs d’audit mensuel', () => {
  const raw = read('base44/entities/Facture.jsonc');
  const schema = JSON.parse(raw);
  assert.equal(schema.properties.tva.default, 21);
  assert.ok(schema.properties.montant_tva);
  assert.ok(schema.properties.billing_fingerprint);
  assert.ok(schema.properties.billing_blockers);
  assert.ok(schema.properties.billing_validated_by);
});
