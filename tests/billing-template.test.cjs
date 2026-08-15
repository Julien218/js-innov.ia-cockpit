const test = require('node:test');
const assert = require('node:assert/strict');
const { generateInvoicePDF } = require('../server-billing-template.cjs');

const sample = {
  numero: 'FAC-2026-TEST',
  date_emission: '2026-08-15',
  date_echeance: '2026-09-14',
  date_validite: '2026-09-14',
  periode: '15/08/2026 – 14/08/2027',
  client_nom: 'Client test',
  client_adresse: 'Rue du Test 1',
  client_ville: '7370 Dour, Belgique',
  client_tva: 'BE 0000.000.000',
  objet: 'Validation du modèle officiel unique',
  montant_ht: 100,
  montant_tva: 21,
  montant_ttc: 121,
  tva: 21,
  items: [{
    description: 'Prestation de test',
    periode: '2026–2027',
    unit_price_ht: 100,
    total_ttc: 121,
    tva: 21,
  }],
};

for (const type of ['facture', 'devis']) {
  test(`génère un ${type} A4 avec le modèle officiel`, async () => {
    const pdf = await generateInvoicePDF(sample, type);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 100_000, 'les visuels officiels doivent être intégrés');
  });
}
