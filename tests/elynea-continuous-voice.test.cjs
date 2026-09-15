const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('Elynea continuous voice uses continuous recognition and auto-restart', () => {
  const voice = source('src/components/ElyneaContinuousVoice.jsx');
  assert.match(voice, /recognition\.continuous\s*=\s*true/);
  assert.match(voice, /recognition\.onend\s*=/);
  assert.match(voice, /startRecognitionRef\.current/);
  assert.match(voice, /Reprise de l’écoute/);
});

test('Elynea pauses listening while speaking and resumes afterwards', () => {
  const voice = source('src/components/ElyneaContinuousVoice.jsx');
  assert.match(voice, /speakingRef\.current\s*=\s*true/);
  assert.match(voice, /if \(!activeRef\.current \|\| speakingRef\.current \|\| sendingRef\.current/);
  assert.match(voice, /utterance\.onend\s*=\s*finish/);
  assert.match(voice, /setStatus\('Elynea parle…'\)/);
});

test('continuous voice is part of the single Elynea companion', () => {
  const wrapper = source('src/components/RoleAwareFloatingAgent.jsx');
  assert.match(wrapper, /ElyneaContinuousVoice/);
  assert.match(wrapper, /<ElyneaContinuousVoice \/>/);
  assert.match(wrapper, /sans créer un second agent/);
});

test('continuous voice sends turns through the canonical assistant route', () => {
  const voice = source('src/components/ElyneaContinuousVoice.jsx');
  assert.match(voice, /fetch\('\/api\/assistant\/chat'/);
  assert.match(voice, /source:\s*'elynea-continuous-voice'/);
  assert.doesNotMatch(voice, /\/api\/base44-agents/);
});
