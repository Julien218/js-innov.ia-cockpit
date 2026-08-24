const test = require('node:test');
const assert = require('node:assert/strict');

const bce = require('../server-bce.cjs');

test('normalise et valide les numéros d’entreprise belges', () => {
  assert.equal(bce.normalizeEnterpriseNumber('BE 0415.805.049'), '0415805049');
  assert.equal(bce.formatEnterpriseNumber('0415805049'), '0415.805.049');
  assert.equal(bce.isValidEnterpriseNumber('0415.805.049'), true);
  assert.equal(bce.isValidEnterpriseNumber('0415.805.048'), false);
});

test('normalise une réponse BCE sans inventer de données', () => {
  const record = bce.normalizeBceRecord({
    enterpriseNumber: '0415805049',
    vatNumber: '0415805049',
    legalName: 'Entreprise Exemple SA',
    status: 'ACTIVE',
    address: { street: 'Rue du Test', house_number: '12', box: '3', postal_code: '7000', city: 'Mons' },
  });
  assert.deepEqual(record, {
    numero_entreprise: '0415.805.049',
    numero_tva: 'BE0415805049',
    denomination_legale: 'Entreprise Exemple SA',
    adresse: 'Rue du Test 12 boîte 3',
    code_postal: '7000',
    ville: 'Mons',
    pays: 'Belgique',
    statut_bce: 'active',
    actif: true,
  });
});

test('refuse une réponse ambiguë au lieu de choisir arbitrairement', async () => {
  const previousUrl = process.env.BCE_LOOKUP_URL;
  process.env.BCE_LOOKUP_URL = 'https://bce-adapter.example.test/lookup';
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ results: [
      { enterpriseNumber: '0415805049', legalName: 'Un' },
      { enterpriseNumber: '0403206398', legalName: 'Deux' },
    ] }),
  });
  await assert.rejects(
    () => bce.lookupBce({ name: 'Exemple' }, fakeFetch),
    (error) => error.code === 'bce_ambiguous' && error.status === 409
  );
  if (previousUrl === undefined) delete process.env.BCE_LOOKUP_URL;
  else process.env.BCE_LOOKUP_URL = previousUrl;
});
