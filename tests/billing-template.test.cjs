const test = require('node:test');
const assert = require('node:assert/strict');
const pdfParse = require('pdf-parse');
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
  commercial_highlight: {
    id: 'signelya-launch',
    eyebrow: 'NOUVEAUTÉ JS-Innov.IA',
    title: 'Découvrez notre nouvelle APP',
    description: 'Signelya — conçue pour vous simplifier la vie.',
    cta: 'Découvrir Signelya',
    url: 'https://signelya.jsinnovia.com/',
  },
};

for (const type of ['facture', 'devis']) {
  test(`génère un ${type} A4 avec le modèle officiel`, async () => {
    const pdf = await generateInvoicePDF(sample, type);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 50_000, 'le logo et la signature officiels doivent être intégrés');

    const parsed = await pdfParse(pdf);
    assert.equal(parsed.numpages, 1, 'le document officiel doit tenir sur une page A4');
    assert.match(parsed.text, type === 'facture' ? /FACTURE/ : /DEVIS/);
    assert.match(parsed.text, /info@jsinnovia\.store/);
    assert.match(parsed.text, /NOUVEAUTÉ JS-Innov\.IA/);
    assert.match(parsed.text, /Découvrez notre nouvelle APP/);
    assert.match(parsed.text, /Signelya/);
  });
}
