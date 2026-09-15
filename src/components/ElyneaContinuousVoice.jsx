import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';

const ENABLED_KEY = 'elynea_continuous_voice_enabled';
const CONVERSATION_KEY = 'agent_conversation_id';

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

export default function ElyneaContinuousVoice() {
  const { user } = useAuth();
  const recognitionRef = useRef(null);
  const activeRef = useRef(false);
  const restartingRef = useRef(false);
  const speakingRef = useRef(false);
  const sendingRef = useRef(false);
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('Prêt');
  const [error, setError] = useState('');

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognition()) && typeof window !== 'undefined' && 'speechSynthesis' in window);
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
    if (!cleanText || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onDone?.();
      return;
    }

    speakingRef.current = true;
    setStatus('Elynea parle…');
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'fr-BE';
    utterance.rate = 0.96;
    utterance.pitch = 1.0;
    const finish = () => {
      speakingRef.current = false;
      onDone?.();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  }, []);

  const sendTranscript = useCallback(async (transcript) => {
    const text = String(transcript || '').trim();
    if (!text || sendingRef.current) return;
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
          source: 'elynea-continuous-voice',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const answer = String(data.message || data.response || data.reply || data.content || data.text || '').replace(/\bNOVA\b/gi, 'Elynea');
      if (!answer) throw new Error('Réponse vocale vide');

      speak(answer, () => {
        sendingRef.current = false;
        if (activeRef.current) {
          setStatus('Écoute…');
          window.setTimeout(() => startRecognitionRef.current?.(), 250);
        } else {
          setStatus('Prêt');
        }
      });
    } catch (err) {
      sendingRef.current = false;
      setError(err?.message || 'Dialogue vocal indisponible');
      if (activeRef.current) {
        setStatus('Reconnexion du micro…');
        window.setTimeout(() => startRecognitionRef.current?.(), 800);
      } else {
        setStatus('Prêt');
      }
    }
  }, [speak, user]);

  const startRecognitionRef = useRef(null);
  const startRecognition = useCallback(() => {
    if (!activeRef.current || speakingRef.current || sendingRef.current || restartingRef.current) return;
    const SR = getSpeechRecognition();
    if (!SR) {
      setError('La reconnaissance vocale continue n’est pas disponible dans ce navigateur.');
      setStatus('Indisponible');
      activeRef.current = false;
      setActive(false);
      return;
    }

    restartingRef.current = true;
    const recognition = new SR();
    recognition.lang = 'fr-BE';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;
    let finalTranscript = '';

    recognition.onstart = () => {
      restartingRef.current = false;
      setStatus('Écoute…');
      setError('');
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i]?.[0]?.transcript || '';
        if (event.results[i].isFinal) finalTranscript += transcript;
        else interim += transcript;
      }
      if (interim.trim()) setStatus('Je vous écoute…');
      if (finalTranscript.trim()) {
        const complete = finalTranscript.trim();
        finalTranscript = '';
        stopRecognition();
        void sendTranscript(complete);
      }
    };

    recognition.onerror = (event) => {
      restartingRef.current = false;
      const code = String(event?.error || 'unknown');
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        activeRef.current = false;
        setActive(false);
        localStorage.setItem(ENABLED_KEY, 'false');
        setStatus('Micro bloqué');
        setError('Autorisez le microphone pour utiliser le dialogue continu avec Elynea.');
        return;
      }
      if (code !== 'no-speech' && code !== 'aborted') setError(`Micro : ${code}`);
    };

    recognition.onend = () => {
      restartingRef.current = false;
      recognitionRef.current = null;
      if (activeRef.current && !speakingRef.current && !sendingRef.current) {
        setStatus('Reprise de l’écoute…');
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
  }, [sendTranscript, stopRecognition]);

  useEffect(() => {
    startRecognitionRef.current = startRecognition;
  }, [startRecognition]);

  const disable = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    localStorage.setItem(ENABLED_KEY, 'false');
    stopRecognition();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    speakingRef.current = false;
    sendingRef.current = false;
    setStatus('Prêt');
  }, [stopRecognition]);

  const enable = useCallback(() => {
    if (!supported) return;
    setError('');
    activeRef.current = true;
    setActive(true);
    localStorage.setItem(ENABLED_KEY, 'true');
    setStatus('Activation du micro…');
    startRecognition();
  }, [startRecognition, supported]);

  const toggle = useCallback(() => {
    if (activeRef.current) disable();
    else enable();
  }, [disable, enable]);

  useEffect(() => () => {
    activeRef.current = false;
    stopRecognition();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [stopRecognition]);

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
        title={active ? 'Arrêter le dialogue vocal continu' : 'Activer le dialogue vocal continu avec Elynea'}
        style={{
          height: 38, padding: '0 12px', borderRadius: 20,
          border: `1px solid ${active ? '#06B6D4' : 'rgba(212,175,55,.45)'}`,
          background: active ? 'rgba(6,182,212,.16)' : 'rgba(11,11,15,.94)',
          color: active ? '#67e8f9' : '#e5c75c', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700,
          boxShadow: '0 5px 22px rgba(0,0,0,.38)', backdropFilter: 'blur(8px)',
        }}
      >
        <span aria-hidden="true">{active ? '🔴' : '🎙️'}</span>
        <span>{active ? status : 'Dialogue continu'}</span>
      </button>
    </div>
  );
}
