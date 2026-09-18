const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isExplicitEmailSendRequest,
  normalizeEmailMailbox,
  parseDraftEmail,
  latestDraftEmail,
} = require('../server-email-action-recovery.cjs');

test('détecte un ordre explicite d’envoi sans confondre une négation', () => {
  assert.equal(isExplicitEmailSendRequest('tu peux envoyer merci'), true);
  assert.equal(isExplicitEmailSendRequest('confirmer et envoyer le merci'), true);
  assert.equal(isExplicitEmailSendRequest("n'envoie pas encore"), false);
});

test('normalise les anciennes boîtes vers les identifiants SMTP réels', () => {
  assert.equal(normalizeEmailMailbox('julien', 'true'), 'store');
  assert.equal(normalizeEmailMailbox('contact', 'true'), 'store');
  assert.equal(normalizeEmailMailbox('assurances', 'true'), 'assurances');
  assert.equal(normalizeEmailMailbox('jsinnovia', 'false'), 'jsinnovia');
});

test('récupère le destinataire, l’objet et le corps du dernier brouillon Elynea', () => {
  const draft = parseDraftEmail([
    "J'ai préparé l'email. Voici le contenu :",
    '---',
    '**À :** paginjulien@gmail.com',
    '**Objet :** Dîner ensemble demain ?',
    '',
    'Bonjour Julien,',
    '',
    'Je voulais savoir si tu serais disponible demain vers 14h au restaurant vietnamien.',
    '',
    'À bientôt,',
    'Julien',
    '---',
    "Souhaites-tu que j'envoie cet email ?",
  ].join('\n'));
  assert.equal(draft.to, 'paginjulien@gmail.com');
  assert.equal(draft.subject, 'Dîner ensemble demain ?');
  assert.match(draft.text, /Bonjour Julien/);
  assert.doesNotMatch(draft.text, /Souhaites-tu/);
});

test('retrouve seulement un brouillon assistant récent', () => {
  const draft = latestDraftEmail([
    { role: 'user', content: 'rédige un email' },
    { role: 'assistant', content: '**À :** test@example.com\n**Objet :** Test\n\nBonjour,\nMessage.' },
  ]);
  assert.deepEqual(draft, { to: 'test@example.com', subject: 'Test', text: 'Bonjour,\nMessage.' });
});
