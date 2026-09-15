const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const voice = fs.readFileSync(path.join(root, 'src/components/ElyneaContinuousVoice.jsx'), 'utf8');

test('le Cockpit autorise son propre microphone sans ouvrir caméra ni géolocalisation', () => {
  assert.match(
    dockerfile,
    /Permissions-Policy "camera=\(\), microphone=\(self\), geolocation=\(\)"/,
  );
  assert.doesNotMatch(dockerfile, /microphone=\(\)/);
});

test('la permission micro sert uniquement au Companion Elynea avec mot de réveil', () => {
  assert.match(voice, /WAKE_WORD_ALIASES/);
  assert.match(voice, /En veille — dites « Elynea »/);
  assert.match(voice, /SpeechRecognition|webkitSpeechRecognition/);
  assert.match(voice, /fetch\('\/api\/assistant\/chat'/);
});
