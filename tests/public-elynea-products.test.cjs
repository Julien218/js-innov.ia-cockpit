const assert = require('node:assert/strict');
const test = require('node:test');

const elynea = require('../server-public-elynea.cjs');

test('Elynea routes clear billing requests to HainoFlow, including common typos', () => {
  for (const message of [
    'un programme de facturation ?',
    'je recherche un programme de faturations',
    'je veux un logiciel pour faire mes factures',
    'je cherche une solution e-facturation',
  ]) {
    const messages = [{ role: 'user', content: message }];
    const match = elynea.matchProductIntent(messages);
    assert.equal(match?.id, 'hainoflow');
    assert.equal(match?.category, 'facturation');
    const answer = elynea.productAnswer(match, messages);
    assert.match(answer, /HainoFlow/);
    assert.match(answer, /clients, devis, factures, documents\/archivage et le suivi des envois/i);
    assert.doesNotMatch(answer, /quelles fonctionnalités spécifiques|rapports financiers/i);
  }
});

test('Elynea never routes local communication or a generic commercial quote to HainoFlow', () => {
  const localCommunication = elynea.matchProductIntent([
    { role: 'user', content: 'Je veux gérer ma communication locale.' },
  ]);
  assert.notEqual(localCommunication?.id, 'hainoflow');

  const commercialQuote = elynea.matchProductIntent([
    { role: 'user', content: 'Je voudrais un devis pour refaire mon site.' },
  ]);
  assert.notEqual(commercialQuote?.id, 'hainoflow');
  assert.match(elynea.PUBLIC_POLICY, /HainoFlow ne doit jamais être présenté comme une solution de communication locale/i);
});

test('Elynea recognizes the current JS-Innov.IA service packs without overriding billing', () => {
  assert.equal(elynea.matchProductIntent([{ role: 'user', content: 'Je veux créer un site vitrine.' }])?.id, 'pack_starter');
  assert.equal(elynea.matchProductIntent([{ role: 'user', content: 'Je veux un site avec chatbot et CRM prospects.' }])?.id, 'pack_business');
  assert.equal(elynea.matchProductIntent([{ role: 'user', content: 'Je veux automatiser mes tâches répétitives avec un workflow.' }])?.id, 'pack_automation');
  assert.equal(elynea.matchProductIntent([{ role: 'user', content: 'Je veux automatiser ma facturation.' }])?.id, 'hainoflow');
});

test('billing qualification is explicit and records the matched product in the Cockpit request', () => {
  const messages = [
    { role: 'user', content: 'Je recherche un programme de facturation.' },
    { role: 'assistant', content: 'Vous facturez en tant qu’indépendant, société ou ASBL ?' },
    { role: 'user', content: 'Je suis indépendant.' },
  ];
  const qualification = elynea.analyzeQualification(messages);
  assert.ok(qualification.categories.includes('facturation'));
  assert.equal(qualification.product_match, null);

  const firstTurnQualification = elynea.analyzeQualification([messages[0]]);
  assert.equal(firstTurnQualification.product_match?.id, 'hainoflow');

  const payloadMessages = [
    messages[0],
    messages[1],
    { role: 'user', content: 'Je suis indépendant et je veux surtout mes factures.' },
  ];
  const payload = elynea.buildRequestPayload({
    requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    messages: payloadMessages,
    contact: { name: 'Client Test', email: 'client@example.test', company: '', phone: '' },
    qualification: elynea.analyzeQualification(payloadMessages),
  });
  assert.match(payload.message, /Produit pressenti : HainoFlow/);
});

test('HainoFlow advanced modules are not advertised as already active by policy', () => {
  assert.match(elynea.PUBLIC_POLICY, /Ne présente pas paiements, Peppol, relances automatisées ou fonctions comptables comme déjà actives/i);
});
