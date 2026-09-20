const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Vite proxies local /api requests to the Cockpit backend instead of index.html', () => {
  const vite = read('vite.config.js');
  assert.match(vite, /['"]\/api['"]\s*:/);
  assert.match(vite, /127\.0\.0\.1:3001/);
  assert.match(vite, /COCKPIT_LOCAL_API_URL/);
});

test('mail errors translate HTML-instead-of-JSON failures into an actionable diagnostic', () => {
  const mailError = read('src/lib/mailError.js');
  assert.match(mailError, /html_instead_of_json/);
  assert.match(mailError, /127\.0\.0\.1:3001/);
  assert.match(mailError, /proxy \/api/);
});

test('safe API decoder rejects HTML before attempting JSON business logic', () => {
  const safeApi = read('src/lib/safeApiJson.js');
  assert.match(safeApi, /<!doctype/);
  assert.match(safeApi, /html_instead_of_json/);
  assert.match(safeApi, /content-type/);
});

test('Elynea TTS reads complete replies in chunks and no longer truncates at 500 or 800 chars', () => {
  const floating = read('src/components/FloatingAgent.jsx');
  const continuous = read('src/components/ElyneaContinuousVoice.jsx');
  const speech = read('src/lib/speechText.js');
  assert.match(floating, /speakAll/);
  assert.match(continuous, /speakAll/);
  assert.doesNotMatch(floating, /slice\(0,\s*500\)/);
  assert.doesNotMatch(continuous, /slice\(0,\s*800\)/);
  assert.match(speech, /chunkSpeechText/);
  assert.match(speech, /Extended_Pictographic/);
});

test('floating Elynea microphone prefers the local Whisper pipeline', () => {
  const floating = read('src/components/FloatingAgent.jsx');
  const localVoice = read('src/lib/localVoiceTranscriber.js');
  assert.match(floating, /createLocalVoiceRecorder/);
  assert.match(floating, /localSttSupported/);
  assert.match(localVoice, /127\.0\.0\.1:8788/);
  assert.match(localVoice, /127\.0\.0\.1:8787/);
  assert.match(localVoice, /\/api\/music-motion\/production\/assets/);
  assert.match(localVoice, /\/api\/music-motion\/production\/jobs/);
  assert.match(localVoice, /transcription\?\.transcript/);
});

test('offline Dropbox upload never claims a cloud archive succeeded', () => {
  const floating = read('src/components/FloatingAgent.jsx');
  assert.match(floating, /Mode hors ligne : le fichier n’est pas envoyé vers Dropbox/);
  assert.match(floating, /navigator\.onLine\s*===\s*false/);
});
