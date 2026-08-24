/**
 * FloatingAgent.jsx — Widget flottant NOVA pour le cockpit
 * 
 * Bulle de chat persistante en bas à droite, accessible sur toutes les pages.
 * Communique avec l'assistant local /api/assistant/chat (Railway, zéro Base44).
 * 
 * Fonctionnalités:
 * - Avatar NOVA (phoenix gold/cyan)
 * - Reconnaissance vocale (Web Speech API) — parler à NOVA
 * - Synthèse vocale (speechSynthesis) — NOVA lit à voix haute
 * - Persistance localStorage (50 derniers messages)
 * - Actions CRM avec confirmation
 * 
 * Design: dark theme cockpit — noir profond + or premium + cyan
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import novaAvatar from '@/assets/nova-avatar-128.png';

const LOCAL_NOVA_URLS = ['http://127.0.0.1:8788', 'http://127.0.0.1:8787'];
const LOCAL_TASK_SNAPSHOT_KEY = 'nova_local_task_snapshot_v1';
const LOCAL_NOVA_PROMPT = `Tu es NOVA, l’unique assistant visible du Cockpit JS-Innov.IA. Tu conserves le même nom et le même rôle en mode cloud et en mode local. Vérifie les outils réellement disponibles avant toute affirmation de capacité. Ne dis jamais que tu es une simple IA textuelle ni que tu ne peux rien exécuter uniquement parce qu’Internet est coupé.`;

const FloatingAgent = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('agent_chat_messages');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId] = useState(() => localStorage.getItem('agent_conversation_id') || 'floating');
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem('agent_tts_enabled') === 'true');
  const [speaking, setSpeaking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const sttSupported = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus on open
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  // Persist messages
  useEffect(() => {
    try { localStorage.setItem('agent_chat_messages', JSON.stringify(messages.slice(-50))); } catch {}
  }, [messages]);

  // Persist TTS preference
  useEffect(() => {
    localStorage.setItem('agent_tts_enabled', String(ttsEnabled));
  }, [ttsEnabled]);

  // Conserve une copie minimale des tâches pour que NOVA puisse les consulter hors connexion.
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined;
    const controller = new AbortController();
    fetch('/api/data/Tache?limit=100', { credentials: 'include', signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((payload) => {
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.items) ? payload.items : [];
        const tasks = rows.slice(0, 100).map((task) => ({
          id: task.id,
          titre: task.titre || task.title || task.nom,
          statut: task.statut || task.status,
          priorite: task.priorite || task.priority,
          date_echeance: task.date_echeance || task.due_date,
        }));
        localStorage.setItem(LOCAL_TASK_SNAPSHOT_KEY, JSON.stringify({ synced_at: new Date().toISOString(), tasks }));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Preload TTS voices
  useEffect(() => {
    if (ttsSupported) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
    return () => { if (ttsSupported) window.speechSynthesis.cancel(); };
  }, [ttsSupported]);

  // === Text-to-Speech ===
  const speak = useCallback((text) => {
    if (!ttsSupported || !ttsEnabled || !text) return;
    const cleanText = text
      .replace(/\[Contexte Dropbox[^\]]*\]/gi, '')
      .replace(/[#*_~`]/g, '')
      .replace(/⚠️/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .slice(0, 500);

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(cleanText);
    utter.lang = 'fr-FR';
    utter.rate = 1.05;
    utter.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const frVoice = voices.find(v => v.lang.startsWith('fr'));
    if (frVoice) utter.voice = frVoice;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  }, [ttsSupported, ttsEnabled]);

  const stopSpeaking = useCallback(() => {
    if (ttsSupported) { window.speechSynthesis.cancel(); setSpeaking(false); }
  }, [ttsSupported]);

  // === Speech Recognition ===
  const startListening = useCallback(() => {
    if (!sttSupported) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = 'fr-FR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    let finalTranscript = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += transcript;
        else interim += transcript;
      }
      setInput(finalTranscript + interim);
    };
    recognition.onend = () => {
      setIsListening(false);
      if (finalTranscript.trim()) {
        setInput(finalTranscript.trim());
        setTimeout(() => doSend(finalTranscript.trim()), 100);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.start();
    setIsListening(true);
  }, [sttSupported]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.stop(); setIsListening(false); }
  }, []);

  // === Chat ===
  const doSend = useCallback(async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    setInput('');
    stopSpeaking();
    setMessages(prev => [...prev, { role: 'user', content: msg, ts: Date.now() }]);
    setLoading(true);

    try {
      const sendCloud = async () => {
        const resp = await fetch('/api/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ message: msg, conversation_id: conversationId }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || 'Cockpit cloud indisponible');
        }
        return resp.json();
      };

      const sendLocal = async () => {
        let lastError;
        let taskSnapshot = null;
        try { taskSnapshot = JSON.parse(localStorage.getItem(LOCAL_TASK_SNAPSHOT_KEY) || 'null'); } catch {}
        for (const localUrl of LOCAL_NOVA_URLS) {
          try {
            const resp = await fetch(`${localUrl}/api/agent/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: msg,
                history: messages.slice(-20).map(({ role, content }) => ({ role, content })),
                system_prompt: LOCAL_NOVA_PROMPT,
                context: { source: 'cockpit-nova', conversation_id: conversationId, offline: true, task_snapshot: taskSnapshot },
              }),
              signal: AbortSignal.timeout(90000),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.error || `NOVA locale indisponible (${resp.status})`);
            return { ...data, local_fallback: true, local_endpoint: localUrl };
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError || new Error('NOVA locale indisponible');
      };

      let data;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        data = await sendLocal();
      } else {
        try {
          data = await sendCloud();
        } catch {
          data = await sendLocal();
        }
      }

      let content = data.message || data.response || data.reply || data.content || data.text || 'Réponse vide';
      if (data.local_fallback) content = `Mode local · ${content}`;
      if (data.confirmation) {
        content += '\n\n⚠️ Action proposée: ' + (data.confirmation.type || 'Action') + '. Confirme pour exécuter.';
      }

      setMessages(prev => [...prev, { role: 'assistant', content, ts: Date.now() }]);
      speak(content);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ NOVA cloud et locale sont injoignables : ' + err.message, ts: Date.now(), isError: true }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, conversationId, messages, speak, stopSpeaking]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  }, [doSend]);

  const resetConversation = useCallback(async () => {
    stopSpeaking();
    setMessages([]);
    localStorage.removeItem('agent_chat_messages');
    try {
      await fetch('/api/assistant/history?conversation_id=floating', { method: 'DELETE', credentials: 'include' });
    } catch {}
  }, [stopSpeaking]);

  // === File Upload → Classify → Dropbox ===
  const handleFileUpload = useCallback(async (file) => {
    if (!file || uploading) return;
    // Max 20MB
    if (file.size > 20 * 1024 * 1024) {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Fichier trop volumineux (max 20 Mo).', ts: Date.now(), isError: true }]);
      return;
    }

    setUploading(true);
    setMessages(prev => [...prev, { role: 'user', content: `📎 ${file.name} (${(file.size / 1024).toFixed(0)} Ko)`, ts: Date.now(), isFile: true }]);
    setMessages(prev => [...prev, { role: 'assistant', content: '🔄 Analyse et classification du document...', ts: Date.now(), isSystem: true }]);

    try {
      // Convert to base64
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result;
          resolve(result.split(',')[1]); // strip data:mime;base64, prefix
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const resp = await fetch('/api/assistant/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileData: base64,
          message: input || '',
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Erreur upload');

      // Remove the "analysis" system message
      setMessages(prev => prev.filter(m => !m.isSystem));

      const cl = data.classification || {};
      const clientInfo = cl.matchedClient ? `\n👤 Client: ${cl.matchedClient.name}` : '\n👤 Client: non identifié (A_Classer)';
      const typeInfo = `\n📁 Type: ${cl.docType}`;
      const pathInfo = `\n📂 Chemin Dropbox: ${data.dropboxPath}`;

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Document sauvegardé !\n\n📄 ${data.fileName}${typeInfo}${clientInfo}${pathInfo}`,
        ts: Date.now(),
      }]);

      speak(`Document ${data.fileName} classé et sauvegardé dans Dropbox`);
    } catch (err) {
      setMessages(prev => prev.filter(m => !m.isSystem));
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ ' + err.message, ts: Date.now(), isError: true }]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [uploading, input, speak]);

  const toggleVoice = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  const toggleTts = useCallback(() => {
    if (ttsEnabled) { stopSpeaking(); setTtsEnabled(false); }
    else setTtsEnabled(true);
  }, [ttsEnabled, stopSpeaking]);

  const statusColor = speaking ? '#D4AF37' : isListening ? '#06B6D4' : loading ? '#f59e0b' : '#22c55e';
  const statusText = speaking ? 'Parle...' : isListening ? 'Écoute...' : loading ? 'Réfléchit...' : 'En ligne';

  return (
    <>
      {/* Bulle flottante */}
      {!isOpen && (
        <div style={{
          position: 'fixed', bottom: '20px', right: '20px', zIndex: 99999,
          fontFamily: 'Inter, -apple-system, sans-serif',
        }}>
          <div
            onClick={() => setIsOpen(true)}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            title="NOVA — Assistant IA"
            style={{
              width: '60px', height: '60px', borderRadius: '50%',
              cursor: 'pointer', overflow: 'hidden', position: 'relative',
              boxShadow: '0 4px 20px rgba(212,175,55,0.3), 0 0 0 2px rgba(212,175,55,0.5)',
              transition: 'transform 0.2s ease',
            }}
          >
            <img src={novaAvatar} alt="NOVA" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            <span style={{
              position: 'absolute', top: '-2px', right: '-2px',
              width: '12px', height: '12px', borderRadius: '50%',
              background: '#06B6D4', border: '2px solid #0B0B0F',
            }} />
          </div>
        </div>
      )}

      {/* Panel de chat */}
      {isOpen && (
        <div style={{
          position: 'fixed', bottom: '20px', right: '20px',
          width: '380px', height: '540px', maxHeight: 'calc(100vh - 40px)',
          background: '#0B0B0F', borderRadius: '16px',
          border: '1px solid rgba(212,175,55,0.4)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', zIndex: 99999, overflow: 'hidden',
          fontFamily: 'Inter, -apple-system, sans-serif',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)',
            borderBottom: '1px solid rgba(212,175,55,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img src={novaAvatar} alt="NOVA" style={{
                width: '36px', height: '36px', borderRadius: '50%',
                objectFit: 'cover', border: '1px solid rgba(212,175,55,0.4)',
              }} />
              <div>
                <p style={{ color: '#D4AF37', fontSize: '14px', fontWeight: 600, margin: 0 }}>NOVA</p>
                <p style={{ color: '#64748b', fontSize: '11px', margin: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block', background: statusColor }} />
                  {statusText}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={toggleTts}
                title={ttsEnabled ? 'Lecture vocale ON' : 'Lecture vocale OFF'}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: ttsEnabled ? '#D4AF37' : '#64748b', fontSize: '16px', padding: '4px 8px', borderRadius: '6px',
                }}
              >
                {ttsEnabled ? '🔊' : '🔇'}
              </button>
              <button onClick={resetConversation} title="Nouvelle conversation" style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#64748b', fontSize: '16px', padding: '4px 8px', borderRadius: '6px',
              }}>↻</button>
              <button onClick={() => { stopSpeaking(); setIsOpen(false); }} title="Fermer" style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#64748b', fontSize: '16px', padding: '4px 8px', borderRadius: '6px',
              }}>✕</button>
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '16px',
            display: 'flex', flexDirection: 'column', gap: '12px',
          }}>
            {messages.length === 0 && !loading && (
              <div style={{ textAlign: 'center', color: '#475569', fontSize: '13px', padding: '30px 20px' }}>
                <img src={novaAvatar} alt="NOVA" style={{
                  width: '64px', height: '64px', borderRadius: '50%',
                  margin: '0 auto 12px', display: 'block', opacity: 0.8,
                }} />
                <p style={{ margin: 0 }}>Salut Julien !</p>
                <p style={{ marginTop: '8px' }}>Pose ta question, parle-moi, ou clique sur le micro.</p>
                <p style={{ marginTop: '12px', fontSize: '11px', color: '#334155' }}>
                  {sttSupported ? '🎤 Micro disponible' : 'Micro non supporté'} · {ttsSupported ? '🔊 Voix disponible' : 'Voix non supportée'}
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={msg.role === 'user' ? {
                alignSelf: 'flex-end',
                background: 'rgba(212,175,55,0.12)',
                border: '1px solid rgba(212,175,55,0.25)',
                borderRadius: '12px 12px 4px 12px',
                padding: '10px 14px', maxWidth: '85%',
                color: '#e2e8f0', fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
              } : {
                alignSelf: 'flex-start',
                background: 'rgba(15,23,42,0.6)',
                border: `1px solid ${msg.isError ? 'rgba(239,68,68,0.4)' : 'rgba(100,116,139,0.2)'}`,
                borderRadius: '12px 12px 12px 4px',
                padding: '10px 14px', maxWidth: '85%',
                color: msg.isError ? '#fca5a5' : '#cbd5e1',
                fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>
            ))}

            {loading && (
              <div style={{ alignSelf: 'flex-start', color: '#64748b', fontSize: '12px', fontStyle: 'italic', padding: '8px 14px' }}>
                <span style={{ animation: 'pulse 1.5s infinite' }}>●</span> NOVA réfléchit...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Zone de saisie */}
          <div style={{
            padding: '10px 12px', borderTop: '1px solid rgba(212,175,55,0.2)',
            display: 'flex', gap: '6px', alignItems: 'flex-end',
          }}>
            {sttSupported && (
              <button
                onClick={toggleVoice}
                title={isListening ? 'Arrêt écoute' : 'Parler à NOVA'}
                disabled={loading}
                style={{
                  background: isListening ? 'rgba(6,182,212,0.15)' : '#1e293b',
                  border: `1px solid ${isListening ? '#06B6D4' : 'rgba(100,116,139,0.3)'}`,
                  borderRadius: '10px', padding: '10px', cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: '40px', height: '40px', fontSize: '16px',
                }}
              >
                {isListening ? '⏹' : '🎤'}
              </button>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isListening ? 'Écoute en cours...' : 'Écris ton message...'}
              rows={1}
              disabled={loading || isListening}
              style={{
                flex: 1, background: '#0F172A',
                border: '1px solid rgba(100,116,139,0.3)',
                borderRadius: '10px', padding: '10px 14px',
                color: '#e2e8f0', fontSize: '13px', outline: 'none',
                resize: 'none', fontFamily: 'inherit',
                maxHeight: '80px', minHeight: '40px',
              }}
            />
            <button
              onClick={() => doSend()}
              disabled={loading || !input.trim()}
              style={{
                background: 'linear-gradient(135deg, #D4AF37 0%, #b8941f 100%)',
                border: 'none', borderRadius: '10px', padding: '0 14px',
                cursor: (loading || !input.trim()) ? 'not-allowed' : 'pointer',
                color: '#0B0B0F', fontSize: '16px', fontWeight: 600,
                minWidth: '40px', height: '40px', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                opacity: (loading || !input.trim()) ? 0.5 : 1,
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </>
  );
};

export default FloatingAgent;
