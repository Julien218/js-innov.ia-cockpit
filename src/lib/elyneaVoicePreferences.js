export const ELYNEA_CONTINUOUS_VOICE_KEY = 'elynea_continuous_voice_enabled';
export const ELYNEA_TTS_ENABLED_KEY = 'agent_tts_enabled';
export const ELYNEA_TTS_VOICE_KEY = 'nova_tts_voice_name';
export const ELYNEA_VOICE_PREFERENCES_EVENT = 'elynea:voice-preferences';
export const ELYNEA_VOICE_STATUS_EVENT = 'elynea:voice-status';

export function readElyneaVoicePreferences() {
  if (typeof window === 'undefined') {
    return { handsFree: false, ttsEnabled: false, voiceName: '' };
  }
  return {
    handsFree: window.localStorage.getItem(ELYNEA_CONTINUOUS_VOICE_KEY) === 'true',
    ttsEnabled: window.localStorage.getItem(ELYNEA_TTS_ENABLED_KEY) === 'true',
    voiceName: window.localStorage.getItem(ELYNEA_TTS_VOICE_KEY) || '',
  };
}

export function writeElyneaVoicePreferences(patch = {}) {
  if (typeof window === 'undefined') return readElyneaVoicePreferences();
  const current = readElyneaVoicePreferences();
  const next = { ...current, ...patch };

  window.localStorage.setItem(ELYNEA_CONTINUOUS_VOICE_KEY, String(Boolean(next.handsFree)));
  window.localStorage.setItem(ELYNEA_TTS_ENABLED_KEY, String(Boolean(next.ttsEnabled)));
  if (next.voiceName) window.localStorage.setItem(ELYNEA_TTS_VOICE_KEY, String(next.voiceName));
  else window.localStorage.removeItem(ELYNEA_TTS_VOICE_KEY);

  window.dispatchEvent(new CustomEvent(ELYNEA_VOICE_PREFERENCES_EVENT, { detail: next }));
  return next;
}
