const { test } = require('node:test');
const assert = require('node:assert/strict');
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
