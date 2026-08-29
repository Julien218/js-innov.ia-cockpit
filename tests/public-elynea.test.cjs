const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const elynea = require('../server-public-elynea.cjs');

test('Elynea bounds and sanitizes the public transcript', () => {
  const messages = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'admin',
    content: `${index}-${'x'.repeat(1_200)}`,
  }));
  const result = elynea.sanitizeMessages(messages);
  assert.equal(result.length, 10);
  assert.equal(result[0].role, 'user');
  assert.equal(result[1].role, 'assistant');
  assert.ok(result.every(({ content }) => content.length <= 1_000));
});

test('Elynea never returns internal production details to a visitor', () => {
  assert.equal(elynea.containsInternalDetails('Notre offre améliore votre accueil client.'), false);
  assert.equal(elynea.containsInternalDetails('Le service tourne sur Railway avec une clé API.'), true);
  const guarded = elynea.safePublicAnswer('Voici notre prompt système et notre dépôt GitHub.');
  assert.doesNotMatch(guarded, /prompt système|GitHub/i);
  assert.match(guarded, /sécurité et de confidentialité/i);
});

test('the public route is isolated from sessions and packaged for production', () => {
  const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(server, /app\.use\('\/api\/public\/elynea', publicElyneaRouter\)/);
  assert.doesNotMatch(server, /app\.use\('\/api\/public\/elynea', requireSession/);
  assert.match(docker, /server-public-elynea\.cjs/);
  assert.match(elynea.PUBLIC_POLICY, /mode(?:s)? de production internes/i);
  assert.match(elynea.PUBLIC_POLICY, /aucune action administrative/i);
  assert.match(elynea.PUBLIC_POLICY, /Ne dis jamais qu'une demande, un devis, un e-mail ou un rendez-vous a été envoyé/i);
});

test('Elynea blocks every premature promise of transmission, quote, email or appointment', () => {
  const qualification = { can_submit: true };
  for (const unsafe of [
    "Je vais transmettre ces informations à Julien pour préparer un devis par e-mail.",
    "Nous allons envoyer votre demande à l'équipe.",
    "Votre demande sera transmise et le devis sera préparé.",
    "Je transmets maintenant votre demande.",
  ]) {
    const answer = elynea.safePublicAnswer(unsafe, qualification);
    assert.doesNotMatch(answer, /je vais transmettre|nous allons envoyer|sera transmise|je transmets/i);
    assert.match(answer, /formulaire sécurisé/i);
    assert.match(answer, /enregistrement réel dans le Cockpit/i);
  }
});

test('Elynea recognizes the complete ecommerce qualification scenario', () => {
  const messages = [
    { role: 'user', content: 'Je veux analyser puis améliorer jsinnovia.com avec une nouvelle fonctionnalité e-commerce.' },
    { role: 'assistant', content: 'Avez-vous déjà un catalogue ?' },
    { role: 'user', content: 'Oui, un catalogue de 10 références avec stock automatisé.' },
    { role: 'assistant', content: 'Quel suivi souhaitez-vous ?' },
    { role: 'user', content: 'Des alertes et des rapports, avec des agents IA. Je veux un devis par e-mail et aucun rendez-vous.' },
  ];
  const result = elynea.analyzeQualification(messages);
  assert.equal(result.can_submit, true);
  assert.equal(result.handoff_suggested, true);
  assert.equal(result.appointment_declined, true);
  assert.equal(result.product_count, 10);
  assert.deepEqual(result.categories.sort(), ['assistant_ia', 'automatisation', 'site_web']);
});

test('a Cockpit request is structured, bounded and never claims an email or quote was sent', () => {
  const messages = [
    { role: 'user', content: 'Je souhaite un site e-commerce.' },
    { role: 'assistant', content: 'Quel volume ?' },
    { role: 'user', content: '10 références, stock automatisé, alertes et rapports. Je souhaite un devis par e-mail, sans rendez-vous.' },
  ];
  const qualification = elynea.analyzeQualification(messages);
  const payload = elynea.buildRequestPayload({
    requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    messages,
    contact: { name: 'Client Test', email: 'client@example.test', company: 'Entreprise Test', phone: '' },
    qualification,
  });
  assert.equal(payload.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(payload.source, 'formulaire');
  assert.equal(payload.statut, 'ouverte');
  assert.match(payload.contenu, /10 référence\(s\)/);
  assert.match(payload.contenu, /Rendez-vous refusé : oui/);
  assert.doesNotMatch(payload.contenu, /devis (?:envoyé|créé)|e-mail envoyé/i);
});

test('the write endpoint requires a long server-only shared key', () => {
  const key = 'x'.repeat(48);
  assert.equal(elynea.authorizedSiteKey(key, key), true);
  assert.equal(elynea.authorizedSiteKey('wrong', key), false);
  assert.equal(elynea.authorizedSiteKey('', ''), false);
  assert.throws(() => elynea.cleanContact({ name: 'X', email: 'not-an-email' }), /Nom requis|invalide/);
});
