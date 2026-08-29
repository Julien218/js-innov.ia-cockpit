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
    "Votre demande sera prise en charge dès que possible par l’équipe.",
    "Votre demande a bien été prise en compte.",
    "L’équipe JS-Innov.IA reviendra vers vous avec un retour personnalisé.",
    "Vous recevrez un retour personnalisé avec des propositions adaptées.",
    "Votre demande est bien complète et transmise à l’équipe JS-Innov.IA.",
  ]) {
    const answer = elynea.safePublicAnswer(unsafe, qualification);
    assert.doesNotMatch(answer, /je vais transmettre|nous allons envoyer|sera transmise|je transmets|prise en charge|prise en compte|reviendra vers vous|vous recevrez|complète et transmise/i);
    assert.match(answer, /formulaire sécurisé/i);
    assert.match(answer, /référence Cockpit vérifiable/i);
  }
});

test('Elynea closes politely when the visitor declines instead of returning a security warning', () => {
  const messages = [{ role: 'user', content: 'NON MERCI' }];
  const answer = elynea.safePublicAnswer(
    "L’équipe JS-Innov.IA reviendra vers vous.",
    { can_submit: true },
    messages,
  );
  assert.match(answer, /Bien compris/i);
  assert.match(answer, /Aucune demande n’a été transmise/i);
  assert.doesNotMatch(answer, /environnement interne|reviendra vers vous/i);
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

test('Elynea preserves an automatic stock reorder instead of reducing it to an alert', () => {
  const messages = [
    { role: 'user', content: 'Je veux une boutique en ligne.' },
    { role: 'assistant', content: 'Combien de produits ?' },
    { role: 'user', content: 'Environ 10 produits avec une commande automatique quand il ne reste que 2 produits en stock.' },
  ];
  const qualification = elynea.analyzeQualification(messages);
  assert.equal(qualification.product_count, 10);
  assert.equal(qualification.stock_reorder_requested, true);
  assert.equal(qualification.stock_reorder_threshold, 2);
  assert.match(elynea.PUBLIC_POLICY, /Ne transforme jamais une commande ou un réapprovisionnement automatique en simple alerte/i);

  const payload = elynea.buildRequestPayload({
    requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    messages,
    contact: { name: 'Client Test', email: 'client@example.test', company: '', phone: '' },
    qualification,
  });
  assert.match(payload.message, /Réapprovisionnement automatique demandé au seuil de 2 unité\(s\)/i);
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
  assert.equal(payload.nom, 'Client Test');
  assert.equal(payload.email, 'client@example.test');
  assert.equal(payload.entreprise, 'Entreprise Test');
  assert.equal(payload.type, 'elynea_commerciale');
  assert.equal(payload.statut, 'nouveau');
  assert.match(payload.message, /10 référence\(s\)/);
  assert.match(payload.message, /Rendez-vous refusé : oui/);
  assert.doesNotMatch(payload.message, /devis (?:envoyé|créé)|e-mail envoyé/i);
  assert.equal('titre' in payload, false);
  assert.equal('contenu' in payload, false);
});

test('the Cockpit request page uses the real Demande schema returned by the agent', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/Demandes.jsx'), 'utf8');
  const proxy = fs.readFileSync(path.join(root, 'server-data-proxy.cjs'), 'utf8');
  for (const field of ['nom', 'email', 'telephone', 'entreprise', 'message', 'type', 'statut']) {
    assert.match(page, new RegExp(`key: ["']${field}["']`));
    assert.match(proxy, new RegExp(`["']${field}["']`));
  }
  assert.doesNotMatch(page, /key: ["'](?:titre|contenu|client_nom|client_email)["']/);
});

test('the write endpoint requires a long server-only shared key', () => {
  const key = 'x'.repeat(48);
  assert.equal(elynea.authorizedSiteKey(key, key), true);
  assert.equal(elynea.authorizedSiteKey('wrong', key), false);
  assert.equal(elynea.authorizedSiteKey('', ''), false);
  assert.throws(() => elynea.cleanContact({ name: 'X', email: 'not-an-email' }), /Nom requis|invalide/);
});
