const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('Elynea voice keeps continuous recognition and auto-restart', () => {
  const voice = source('src/components/ElyneaContinuousVoice.jsx');
  assert.match(voice, /recognition\.continuous\s*=\s*true/);
  assert.match(voice, /recognition\.onend\s*=/);
  assert.match(voice, /startRecognitionRef\.current/);
  assert.match(voice, /Reprise de la veille vocale/);
});

test('Elynea wake word arms the conversation without sending the wake word as a prompt', () => {
  const voice = source('src/components/ElyneaContinuousVoice.jsx');
  assert.match(voice, /WAKE_WORD_ALIASES\s*=\s*\['elynea', 'elyna', 'elina', 'elena'\]/);
  assert.match(voice, /extractWakeCommand/);
  assert.match(voice, /wake\.matched/);
  assert.match(voice, /awakeRef\.current\s*=\s*true/);
  assert.match(voice, /setStatus\('Je vous écoute…'\)/);
  assert.match(voice, /void sendTranscript\(wake\.command\)/);
});

test('Elynea returns to wake-word standby after a command or timeout', () => {
  const voice = source('src/components/ElyneaContinuousVoice.jsx');
  assert.match(voice, /WAKE_TIMEOUT_MS\s*=\s*10000/);
  assert.match(voice, /STANDBY_STATUS\s*=\s*'En veille — dites « Elynea »'/);
  assert.match(voice, /returnToStandby/);
  assert.match(voice, /armWakeTimeout/);
});

test('Elynea pauses listening while speaking and resumes wake-word standby afterwards', () => {
  const voice = source('src/components/ElyneaContinuousVoice.jsx');
  assert.match(voice, /speakingRef\.current\s*=\s*true/);
  assert.match(voice, /if \(!activeRef\.current \|\| speakingRef\.current \|\| sendingRef\.current/);
  assert.match(voice, /utterance\.onend\s*=\s*finish/);
  assert.match(voice, /setStatus\('Elynea parle…'\)/);
  assert.match(voice, /returnToStandby\(\)/);
});

test('wake voice is part of the single Elynea companion', () => {
  const wrapper = source('src/components/RoleAwareFloatingAgent.jsx');
  assert.match(wrapper, /ElyneaContinuousVoice/);
  assert.match(wrapper, /<ElyneaContinuousVoice \/>/);
  assert.match(wrapper, /sans créer un second agent/);
});

test('wake voice sends turns through the canonical assistant route', () => {
  const voice = source('src/components/ElyneaContinuousVoice.jsx');
  assert.match(voice, /fetch\('\/api\/assistant\/chat'/);
  assert.match(voice, /source:\s*'elynea-wake-voice'/);
  assert.doesNotMatch(voice, /\/api\/base44-agents/);
});

test('wake-word preference is restored for the desktop/browser session when permission remains granted', () => {
  const voice = source('src/components/ElyneaContinuousVoice.jsx');
  assert.match(voice, /localStorage\.getItem\(ENABLED_KEY\) !== 'true'/);
  assert.match(voice, /Réactivation de la veille vocale/);
  assert.match(voice, /autoRestoreAttemptedRef/);
});
