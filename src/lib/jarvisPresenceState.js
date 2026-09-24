export function getJarvisPresenceState({ speaking, loading, voicePhase, isListening, wakeStatus }) {
  if (speaking) return 'speaking';
  if (loading || voicePhase === 'transcribing' || wakeStatus === 'working') return 'thinking';
  if (isListening || wakeStatus === 'command' || wakeStatus === 'woken') return 'listening';
  return 'idle';
}
