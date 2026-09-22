const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Elynea avatar is bundled in the Cockpit instead of using the stale remote portrait', () => {
  const brand = read('src/components/ElyneaBrandScope.jsx');
  assert.match(brand, /data:image\/webp;base64,/);
  assert.doesNotMatch(brand, /www\.jsinnovia\.com\/brand\/companion\/companion-avatar-256\.webp/);
});

test('staff Cockpit mounts only one always-on Elynea voice controller', () => {
  const roleAware = read('src/components/RoleAwareFloatingAgent.jsx');
  const occurrences = roleAware.match(/<ElyneaContinuousVoice \/>/g) || [];
  assert.equal(occurrences.length, 1, 'continuous voice must remain client-only; staff uses FloatingAgent wake mode');
  assert.match(roleAware, /<LocalAgentQueueBridge \/>[\s\S]*<FloatingAgent \/>/);
});

test('manual microphone prefers local Whisper and remains usable while wake mode is enabled', () => {
  const floating = read('src/components/FloatingAgent.jsx');
  const localVoice = read('src/lib/localVoiceTranscriber.js');

  assert.match(floating, /createLocalVoiceRecorder/);
  assert.match(floating, /localSttSupported/);
  assert.match(floating, /abortWakeRecognitions\(\)/);
  assert.match(floating, /rearmWakeWhenQuiet\(\)/);
  assert.doesNotMatch(floating, /disabled=\{loading \|\| wakeEnabled\}/);
  assert.match(floating, /disabled=\{loading \|\| voicePhase === 'transcribing'\}/);

  assert.match(localVoice, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(localVoice, /new MediaRecorder/);
  assert.match(localVoice, /127\.0\.0\.1:8788/);
  assert.match(localVoice, /127\.0\.0\.1:8787/);
  assert.match(localVoice, /\/api\/music-motion\/production\/assets/);
  assert.match(localVoice, /transcription\?\.transcript/);
});
