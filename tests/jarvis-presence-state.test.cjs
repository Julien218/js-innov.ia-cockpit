const { test } = require('node:test');
const assert = require('node:assert/strict');
test('Home receives the current mode, suppresses duplicates and unsubscribes', async () => {
  const { getJarvisMode, subscribeJarvisMode, publishJarvisMode } = await import('../src/lib/jarvisPresenceStore.js');
  let updates = 0;
  const unsubscribe = subscribeJarvisMode(() => updates++);
  publishJarvisMode('listening');
  assert.equal(getJarvisMode(), 'listening');
  publishJarvisMode('listening');
  publishJarvisMode('invalid');
  assert.equal(updates, 1);
  unsubscribe();
  publishJarvisMode('idle');
  assert.equal(updates, 1);
  assert.equal(getJarvisMode(), 'idle');
});
test('Jarvis follows conversation activity rather than wake-word standby', async () => {
  const { getJarvisPresenceState: state } = await import('../src/lib/jarvisPresenceState.js');
  assert.equal(state({ wakeStatus: 'armed' }), 'idle');
  assert.equal(state({ wakeStatus: 'command' }), 'listening');
  assert.equal(state({ isListening: true }), 'listening');
  assert.equal(state({ isListening: true, voicePhase: 'transcribing' }), 'thinking');
  assert.equal(state({ wakeStatus: 'armed', loading: true }), 'thinking');
  assert.equal(state({ wakeStatus: 'working' }), 'thinking');
  assert.equal(state({ speaking: true, loading: true }), 'speaking');
  assert.equal(state({}), 'idle');
});
