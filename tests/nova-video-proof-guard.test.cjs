const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isVideoExecutionRequest,
  authorizeImmediateExecutionMessage,
  stripInjectedContext,
} = require('../server-immediate-execution-policy.cjs');

function withoutAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

test('detects an explicit video execution request', () => {
  assert.equal(isVideoExecutionRequest('Lance maintenant la vidéo avec Grok Imagine 1.5'), true);
  assert.equal(isVideoExecutionRequest('Explique moi simplement le workflow vidéo'), false);
});

test('injects a hard proof guard for explicit video production', () => {
  const output = authorizeImmediateExecutionMessage('Crée et lance immédiatement la vidéo avec nova-video-production');
  const normalized = withoutAccents(output);
  assert.match(normalized, /VERROU PREUVE VIDEO/);
  assert.match(normalized, /n.?est jamais simulee/i);
  assert.match(normalized, /n.?invente jamais de video_job_id/i);
  assert.match(output, /finalized=true/);
  assert.match(output, /verified=true/);
  assert.match(output, /SHA-256/);
});

test('does not inject the video proof guard for a non-video action', () => {
  const output = withoutAccents(authorizeImmediateExecutionMessage('Corrige immédiatement la page frontend'));
  assert.doesNotMatch(output, /VERROU PREUVE VIDEO/);
});

test('ignore le diagnostic local et les règles injectées pour décider une production vidéo', () => {
  const diagnostic = `vérifier et compléter : Synergie Dour ASBL

[DIAGNOSTIC LOCAL LECTURE SEULE — généré automatiquement par le Cockpit]
Mode vidéo: local.
ComfyUI 8188: en ligne.
[/DIAGNOSTIC LOCAL LECTURE SEULE]`;
  const enriched = `${diagnostic}

[AUTORISATION COCKPIT — ACTION NON SENSIBLE]
Exécute-la maintenant. Si la demande concerne la Fabrique vidéo, lance le flux réel.
[/AUTORISATION COCKPIT]`;

  assert.equal(isVideoExecutionRequest(diagnostic), false);
  assert.equal(isVideoExecutionRequest(enriched), false);
  assert.equal(stripInjectedContext(enriched), 'vérifier et compléter : Synergie Dour ASBL');
  assert.doesNotMatch(withoutAccents(authorizeImmediateExecutionMessage(diagnostic)), /AUTORISATION COCKPIT/);
});

test('conserve une demande vidéo explicite malgré le diagnostic local', () => {
  const message = `Génère la vidéo Synergie Dour avec Grok.

[DIAGNOSTIC LOCAL LECTURE SEULE — généré automatiquement par le Cockpit]
Mode vidéo: local.
[/DIAGNOSTIC LOCAL LECTURE SEULE]`;

  assert.equal(isVideoExecutionRequest(message), true);
});
