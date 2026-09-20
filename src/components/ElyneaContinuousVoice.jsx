import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { speakAll } from '@/lib/speechText';

const ENABLED_KEY = 'elynea_continuous_voice_enabled';
const CONVERSATION_KEY = 'agent_conversation_id';
const WAKE_TIMEOUT_MS = 10000;
const WAKE_WORD_ALIASES = ['elynea', 'elyna', 'elina', 'elena'];
const STANDBY_STATUS = 'En veille — dites « Elynea »';

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function normalizeWakeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWakeCommand(text) {
  const original = String(text || '').trim();
  const normalized = normalizeWakeText(original);
  if (!normalized) return { matched: false, command: '' };

  const words = normalized.split(' ');
  const wakeIndex = words.findIndex((word) => WAKE_WORD_ALIASES.includes(word));
  if (wakeIndex < 0) return { matched: false, command: '' };

  // La commande est extraite depuis la version normalisée afin d'éviter qu'une
  // variation de ponctuation du moteur vocal soit renvoyée comme mot de réveil.
  return {
    matched: true,
    command: words.slice(wakeIndex + 1).join(' ').trim(),
  };
}

function parseAudioCommand(text) {
  const command = normalizeWakeText(text);
  if (!command) return null;

  if (/^(?:musique|mets? la musique|lance la musique|joue la musique|reprends? la musique)$/.test(command)) {
    return { action: 'play' };
  }
  if (/^(?:pause musique|pause la musique|mets? la musique en pause|coupe la musique|arrete la musique|stop musique)$/.test(command)) {
    return { action: 'pause' };
  }
  if (/^(?:musique suivante|morceau suivant|titre suivant|prochaine musique)$/.test(command)) {
    return { action: 'next' };
  }
  if (/^(?:musique precedente|morceau precedent|titre precedent|musique d avant)$/.test(command)) {
    return { action: 'previous' };
  }
  const playlist = command.match(/^(?:(?:mets?|lance|joue)\s+)?(?:la\s+)?playlist\s+(.+)$/);
  if (playlist?.[1]) return { action: 'playlist', name: playlist[1].trim() };
  return null;
}

export default function ElyneaContinuousVoice() {
  const { user } = useAuth();
  const recognitionRef = useRef(null);
  const activeRef = useRef(false);
  const awakeRef = useRef(false);
  const restartingRef = useRef(false);
  const speakingRef = useRef(false);
  const sendingRef = useRef(false);
  const wakeTimeoutRef = useRef(null);
  const autoRestoreAttemptedRef = useRef(false);
  const speechCancelRef = useRef(null);
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('Prêt');
  const [error, setError] = useState('');

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognition()) && typeof window !== 'undefined' && 'speechSynthesis' in window);
  }, []);

  const clearWakeTimeout = useCallback(() => {
    if (wakeTimeoutRef.current) {
      window.clearTimeout(wakeTimeoutRef.current);
      wakeTimeoutRef.current = null;
    }
  }, []);

  const returnToStandby = useCallback(() => {
    clearWakeTimeout();
    awakeRef.current = false;
    if (activeRef.current) setStatus(STANDBY_STATUS);
    else setStatus('Prêt');
  }, [clearWakeTimeout]);

  const armWakeTimeout = useCallback(() => {
    clearWakeTimeout();
    wakeTimeoutRef.current = window.setTimeout(() => {
      awakeRef.current = false;
      if (activeRef.current && !speakingRef.current && !sendingRef.current) {
        setStatus(STANDBY_STATUS);
      }
    }, WAKE_TIMEOUT_MS);
  }, [clearWakeTimeout]);

  const playWakeChime = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.11);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
      oscillator.onended = () => context.close().catch(() => {});
    } catch {}
  }, []);

  const stopRecognition = useCallback(() => {
    restartingRef.current = false;
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try { recognition.stop(); } catch {}
    recognitionRef.current = null;
  }, []);

  const speak = useCallback((text, onDone) => {
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onDone?.();
      return;
    }

    speechCancelRef.current?.();
    speakingRef.current = true;
    setStatus('Elynea parle…');
    const finish = () => {
      speakingRef.current = false;
      speechCancelRef.current = null;
      onDone?.();
    };
    speechCancelRef.current = speakAll({
      text,
      lang: 'fr-BE',
      rate: 0.96,
      pitch: 1,
      onDone: finish,
      onError: finish,
    });
  }, []);

  const startRecognitionRef = useRef(null);

  const sendTranscript = useCallback(async (transcript) => {
    const text = String(transcript || '').trim();
    if (!text || sendingRef.current) return;

    const audioCommand = ['admin', 'superadmin'].includes(user?.role) ? parseAudioCommand(text) : null;
    if (audioCommand && typeof window !== 'undefined') {
      clearWakeTimeout();
      window.dispatchEvent(new CustomEvent('elynea:audio-command', { detail: audioCommand }));
      const labels = {
        play: 'Musique lancée',
        pause: 'Musique en pause',
        next: 'Morceau suivant',
        previous: 'Morceau précédent',
        playlist: `Playlist ${audioCommand.name || ''}`.trim(),
      };
      setStatus(labels[audioCommand.action] || 'Commande musique');
      window.setTimeout(() => {
        returnToStandby();
        if (activeRef.current) window.setTimeout(() => startRecognitionRef.current?.(), 250);
      }, 350);
      return;
    }

    clearWakeTimeout();
    sendingRef.current = true;
    setStatus('Elynea réfléchit…');
    setError('');

    try {
      const conversationId = localStorage.getItem(CONVERSATION_KEY) || `voice_${String(user?.organisation || user?.id || 'main').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: text,
          conversation_id: conversationId,
          source: 'elynea-wake-voice',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const answer = String(data.message || data.response || data.reply || data.content || data.text || '').replace(/\bNOVA\b/gi, 'Elynea');
      if (!answer) throw new Error('Réponse vocale vide');

      speak(answer, () => {
        sendingRef.current = false;
        returnToStandby();
        if (activeRef.current) window.setTimeout(() => startRecognitionRef.current?.(), 250);
      });
    } catch (err) {
      sendingRef.current = false;
      setError(err?.message || 'Dialogue vocal indisponible');
      returnToStandby();
      if (activeRef.current) {
        setStatus('Reconnexion du micro…');
        window.setTimeout(() => startRecognitionRef.current?.(), 800);
      }
    }
  }, [clearWakeTimeout, returnToStandby, speak, user]);

  const startRecognition = useCallback(() => {
    if (!activeRef.current || speakingRef.current || sendingRef.current || restartingRef.current) return;
    const SR = getSpeechRecognition();
    if (!SR) {
      setError('La reconnaissance vocale n’est pas disponible dans ce navigateur. Utilisez le micro du chat Elynea pour la transcription Whisper locale.');
      setStatus('Indisponible');
      activeRef.current = false;
      awakeRef.current = false;
      setActive(false);
      return;
    }

    restartingRef.current = true;
    const recognition = new SR();
    recognition.lang = 'fr-BE';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      restartingRef.current = false;
      setStatus(awakeRef.current ? 'Je vous écoute…' : STANDBY_STATUS);
      setError('');
    };

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = String(event.results[i]?.[0]?.transcript || '').trim();
        if (!transcript) continue;

        if (!event.results[i].isFinal) {
          if (awakeRef.current) setStatus('Je vous écoute…');
          else if (extractWakeCommand(transcript).matched) setStatus('Réveil d’Elynea…');
          continue;
        }

        if (!awakeRef.current) {
          const wake = extractWakeCommand(transcript);
          if (!wake.matched) {
            setStatus(STANDBY_STATUS);
            continue;
          }

          awakeRef.current = true;
          setStatus('Je vous écoute…');
          playWakeChime();

          if (wake.command) {
            clearWakeTimeout();
            stopRecognition();
            void sendTranscript(wake.command);
          } else {
            armWakeTimeout();
          }
          continue;
        }

        clearWakeTimeout();
        stopRecognition();
        void sendTranscript(transcript);
      }
    };

    recognition.onerror = (event) => {
      restartingRef.current = false;
      const code = String(event?.error || 'unknown');
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        activeRef.current = false;
        awakeRef.current = false;
        setActive(false);
        localStorage.setItem(ENABLED_KEY, 'false');
        clearWakeTimeout();
        setStatus('Micro bloqué');
        setError('Autorisez le microphone pour pouvoir appeler Elynea à la voix.');
        return;
      }
      if (code !== 'no-speech' && code !== 'aborted') setError(`Micro : ${code}`);
    };

    recognition.onend = () => {
      restartingRef.current = false;
      recognitionRef.current = null;
      if (activeRef.current && !speakingRef.current && !sendingRef.current) {
        setStatus(awakeRef.current ? 'Je vous écoute…' : 'Reprise de la veille vocale…');
        window.setTimeout(() => startRecognitionRef.current?.(), 350);
      }
    };

    try {
      recognition.start();
    } catch (err) {
      restartingRef.current = false;
      recognitionRef.current = null;
      setError(err?.message || 'Impossible de démarrer le microphone');
      if (activeRef.current) window.setTimeout(() => startRecognitionRef.current?.(), 800);
    }
  }, [armWakeTimeout, clearWakeTimeout, playWakeChime, sendTranscript, stopRecognition]);

  useEffect(() => {
    startRecognitionRef.current = startRecognition;
  }, [startRecognition]);

  const disable = useCallback(() => {
    activeRef.current = false;
    awakeRef.current = false;
    setActive(false);
    localStorage.setItem(ENABLED_KEY, 'false');
    clearWakeTimeout();
    stopRecognition();
    speechCancelRef.current?.();
    speechCancelRef.current = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    speakingRef.current = false;
    sendingRef.current = false;
    setStatus('Prêt');
  }, [clearWakeTimeout, stopRecognition]);

  const enable = useCallback(() => {
    if (!supported) return;
    setError('');
    activeRef.current = true;
    awakeRef.current = false;
    setActive(true);
    localStorage.setItem(ENABLED_KEY, 'true');
    setStatus('Activation de la veille vocale…');
    startRecognition();
  }, [startRecognition, supported]);

  const toggle = useCallback(() => {
    if (activeRef.current) disable();
    else enable();
  }, [disable, enable]);

  useEffect(() => {
    if (!supported || !user || autoRestoreAttemptedRef.current) return;
    autoRestoreAttemptedRef.current = true;
    if (localStorage.getItem(ENABLED_KEY) !== 'true') return;

    activeRef.current = true;
    awakeRef.current = false;
    setActive(true);
    setStatus('Réactivation de la veille vocale…');
    window.setTimeout(() => startRecognitionRef.current?.(), 300);
  }, [supported, user]);

  useEffect(() => () => {
    activeRef.current = false;
    awakeRef.current = false;
    clearWakeTimeout();
    stopRecognition();
    speechCancelRef.current?.();
    speechCancelRef.current = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [clearWakeTimeout, stopRecognition]);

  if (!user || !supported) return null;

  return (
    <div style={{
      position: 'fixed', right: 88, bottom: 24, zIndex: 100000,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5,
      fontFamily: 'Inter, -apple-system, sans-serif', pointerEvents: 'auto',
    }}>
      {error && (
        <div style={{
          maxWidth: 280, padding: '7px 10px', borderRadius: 8,
          background: 'rgba(127,29,29,.95)', color: '#fecaca', fontSize: 11,
          boxShadow: '0 6px 22px rgba(0,0,0,.35)',
        }}>{error}</div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-pressed={active}
        title={active ? 'Désactiver l’appel vocal « Elynea »' : 'Activer l’appel vocal « Elynea »'}
        style={{
          height: 38, padding: '0 12px', borderRadius: 20,
          border: `1px solid ${active ? '#06B6D4' : 'rgba(212,175,55,.45)'}`,
          background: active ? 'rgba(6,182,212,.16)' : 'rgba(11,11,15,.94)',
          color: active ? '#67e8f9' : '#e5c75c', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700,
          boxShadow: '0 5px 22px rgba(0,0,0,.38)', backdropFilter: 'blur(8px)',
        }}
      >
        <span aria-hidden="true">{active ? '🟢' : '🎙️'}</span>
        <span>{active ? status : 'Activer « Elynea »'}</span>
      </button>
    </div>
  );
}
