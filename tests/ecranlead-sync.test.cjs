const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePayload, safeEqual } = require('../server-ecranlead.cjs');

test('rejects payload without external_id', () => {
  const result = normalizePayload({ nom: 'Dupont', email: 'test@example.com' });
  assert.equal(result.error, 'external_id requis');
});

test('normalizes EcranLead as central Cockpit lead', () => {
  const result = normalizePayload({
    external_id: 'screen-123',
    nom: 'Dupont',
    prenom: 'Jean',
    email: 'JEAN@example.com',
    telephone: '0470000000',
    entreprise: 'Espace C',
    secteur: 'Dour',
    contrat_signe: false,
    statut: 'qualifie',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.lead.source, 'ecran_led');
  assert.equal(result.lead.external_source, 'ecranlead');
  assert.equal(result.lead.external_id, 'screen-123');
  assert.equal(result.lead.email, 'jean@example.com');
  assert.equal(result.lead.statut, 'qualifie');
  assert.equal(result.lead.contrat_signe, false);
});

test('signed contract converts lead state to gagne by default', () => {
  const result = normalizePayload({
    external_id: 'screen-456',
    nom: 'Martin',
    email: 'martin@example.com',
    contrat_signe: true,
  });
  assert.equal(result.lead.statut, 'gagne');
  assert.equal(result.lead.contrat_signe, true);
});

test('sync key comparison is exact and timing-safe compatible', () => {
  assert.equal(safeEqual('a'.repeat(64), 'a'.repeat(64)), true);
  assert.equal(safeEqual('a'.repeat(64), 'b'.repeat(64)), false);
  assert.equal(safeEqual('short', 'different-length'), false);
});
