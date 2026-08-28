const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isVideoExecutionRequest,
  authorizeImmediateExecutionMessage,
} = require('../server-immediate-execution-policy.cjs');

test('detects an explicit video execution request', () => {
  assert.equal(isVideoExecutionRequest('Lance maintenant la vidéo avec Grok Imagine 1.5'), true);
  assert.equal(isVideoExecutionRequest('Explique moi simplement le workflow vidéo'), false);
});

test('injects a hard proof guard for explicit video production', () => {
  const output = authorizeImmediateExecutionMessage('Crée et lance immédiatement la vidéo avec nova-video-production');
  assert.match(output, /VERROU PREUVE VIDEO/);
  assert.match(output, /n est jamais simulee/i);
  assert.match(output, /N invente jamais de video_job_id/i);
  assert.match(output, /finalized=true/);
  assert.match(output, /verified=true/);
  assert.match(output, /SHA-256/);
});

test('does not inject the video proof guard for a non-video action', () => {
  const output = authorizeImmediateExecutionMessage('Corrige immédiatement la page frontend');
  assert.doesNotMatch(output, /VERROU PREUVE VIDEO/);
});
