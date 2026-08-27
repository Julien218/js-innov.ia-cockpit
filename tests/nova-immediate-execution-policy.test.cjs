const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasImmediateExecutionIntent,
  isSensitiveAction,
  authorizeImmediateExecutionMessage,
} = require('../server-immediate-execution-policy.cjs');

test('autorise une demande explicite de génération vidéo sans revalidation', () => {
  const message = 'Génère immédiatement les 3 vidéos avec la Fabrique vidéo écran géant.';
  assert.equal(hasImmediateExecutionIntent(message), true);
  const normalized = authorizeImmediateExecutionMessage(message);
  assert.match(normalized, /Je confirme explicitement l'exécution immédiate/i);
  assert.match(normalized, /Ne redemande pas de confirmation/i);
});

test('autorise crée / réalise / produis sur les tâches non sensibles', () => {
  assert.equal(hasImmediateExecutionIntent('Crée 3 vidéos maintenant'), true);
  assert.equal(hasImmediateExecutionIntent('Réalise la page web immédiatement'), true);
  assert.equal(hasImmediateExecutionIntent('Produis les visuels de suite'), true);
});

test('ne préautorise jamais les actions sensibles', () => {
  assert.equal(isSensitiveAction('Supprime le domaine et modifie le DNS'), true);
  assert.equal(hasImmediateExecutionIntent('Déploie en production immédiatement'), false);
  assert.equal(hasImmediateExecutionIntent('Envoie email au client immédiatement'), false);
});

test('ne modifie pas une demande purement informative', () => {
  const message = 'Analyse pourquoi la vidéo ne démarre pas';
  assert.equal(authorizeImmediateExecutionMessage(message), message);
});
