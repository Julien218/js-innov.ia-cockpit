import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { chooseNovaVoice } from '@/lib/nova-voice';
import { ELYNEA_CONTINUOUS_VOICE_KEY, ELYNEA_VOICE_PREFERENCES_EVENT, ELYNEA_VOICE_STATUS_EVENT, readElyneaVoicePreferences } from '@/lib/elyneaVoicePreferences';

const ENABLED_KEY = ELYNEA_CONTINUOUS_VOICE_KEY;
const CONVERSATION_KEY = 'agent_conversation_id';
const WAKE_TIMEOUT_MS = 10000;
const WAKE_WORD_ALIASES = ['elynea', 'elyna', 'elina', 'elena'];
const STANDBY_STATUS = 'En veille — dites « Elynea »';

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function cleanForSpeech(text) {
  return String(text || '')
    .replace(/\[Contexte Dropbox[^\]]*\]/gi, '')
    .replace(/[#*_~`]/g, '')
    .replace(/https?:\/\/\S+/gi, 'lien internet')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, 'identifiant du journal')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, 800);
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
  const preferencesRef = useRef(readElyneaVoicePreferences());
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
    const cleanText = cleanForSpeech(text);
    const prefs = preferencesRef.current;
    if (!prefs.ttsEnabled || !cleanText || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onDone?.();
      return;
    }

    speakingRef.current = true;
    setStatus('Elynea parle…');
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = chooseNovaVoice(voices, prefs.voiceName);
    utterance.lang = selectedVoice?.lang || 'fr-BE';
    utterance.rate = 0.96;
    utterance.pitch = 1.0;
    if (selectedVoice) utterance.voice = selectedVoice;
    const finish = () => {
      speakingRef.current = false;
      onDone?.();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
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
      setError('La reconnaissance vocale n’est pas disponible dans ce navigateur.');
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

  useEffect(() => {
    const applyPreferences = (event) => {
      const next = event?.detail || readElyneaVoicePreferences();
      preferencesRef.current = { ...preferencesRef.current, ...next };
      if (!supported) return;
      if (next.handsFree === true && !activeRef.current) enable();
      if (next.handsFree === false && activeRef.current) disable();
    };
    window.addEventListener(ELYNEA_VOICE_PREFERENCES_EVENT, applyPreferences);
    return () => window.removeEventListener(ELYNEA_VOICE_PREFERENCES_EVENT, applyPreferences);
  }, [disable, enable, supported]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(ELYNEA_VOICE_STATUS_EVENT, {
      detail: { supported, active, status, error },
    }));
  }, [active, error, status, supported]);

  useEffect(() => () => {
    activeRef.current = false;
    awakeRef.current = false;
    clearWakeTimeout();
    stopRecognition();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [clearWakeTimeout, stopRecognition]);

  if (!user) return null;

  // Le contrôle visuel a été déplacé dans Paramètres > Elynea.
  // Ce composant reste monté en arrière-plan pour assurer la veille vocale.
  return (
    <span
      aria-hidden="true"
      data-elynea-voice-supported={supported ? "true" : "false"}
      data-elynea-voice-active={active ? "true" : "false"}
      data-elynea-voice-status={status}
      data-elynea-voice-error={error}
      style={{ display: "none" }}
    />
  );
}
