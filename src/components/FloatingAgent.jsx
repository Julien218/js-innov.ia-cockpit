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

import React, { useState, useRef, useEffect, useCallback } from 'react';
import novaAvatar from '@/assets/nova-avatar-128.png';

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
  const [conversationId, setConversationId] = useState(() => {
    return localStorage.getItem('agent_conversation_id') || '';
  });
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    return localStorage.getItem('agent_tts_enabled') === 'true';
  });
  const [speaking, setSpeaking] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const sttSupported = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  // Auto-scroll
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Focus on open
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  // Persist messages
  useEffect(() => {
    try { localStorage.setItem('agent_chat_messages', JSON.stringify(messages.slice(-50))); } catch {}
  }, [messages]);

  // Persist conversationId
  useEffect(() => {
    if (conversationId) localStorage.setItem('agent_conversation_id', conversationId);
  }, [conversationId]);

  // Persist TTS preference
  useEffect(() => {
    localStorage.setItem('agent_tts_enabled', String(ttsEnabled));
  }, [ttsEnabled]);

  // === Text-to-Speech ===
  const speak = useCallback((text) => {
    if (!ttsSupported || !ttsEnabled || !text) return;
    // Clean text for speech (remove markdown, emojis, brackets)
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
    
    // Try to find a French voice
    const voices = window.speechSynthesis.getVoices();
    const frVoice = voices.find(v => v.lang.startsWith('fr'));
    if (frVoice) utter.voice = frVoice;
    
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    
    window.speechSynthesis.speak(utter);
  }, [ttsSupported, ttsEnabled]);

  // Stop speaking
  const stopSpeaking = useCallback(() => {
    if (ttsSupported) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  }, [ttsSupported]);

  // === Speech Recognition ===
  const startListening = useCallback(() => {
    if (!sttSupported) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    let finalTranscript = '';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      setInput(finalTranscript + interim);
    };

    recognition.onend = () => {
      setIsListening(false);
      // Auto-send if we got text
      if (finalTranscript.trim()) {
        setInput(finalTranscript.trim());
        // Use a timeout to let the state update
        setTimeout(() => {
          const event = new Event('nova-autosend');
          document.dispatchEvent(event);
        }, 100);
      }
    };

    recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      setIsListening(false);
    };

    recognition.start();
    setIsListening(true);
  }, [sttSupported]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, []);

  // Auto-send listener for voice input
  useEffect(() => {
    const autoSend = () => {
      // Trigger send by reading from state
      const currentInput = inputRef.current?.value || '';
      if (currentInput.trim()) {
        sendMessageWithText(currentInput.trim());
      }
    };
    document.addEventListener('nova-autosend', autoSend);
    return () => document.removeEventListener('nova-autosend', autoSend);
  }, []);

  // Preload voices for TTS
  useEffect(() => {
    if (ttsSupported) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
    return () => {
      if (ttsSupported) window.speechSynthesis.cancel();
    };
  }, [ttsSupported]);

  // === Chat ===
  const ensureConversation = useCallback(async () => {
    if (!conversationId) setConversationId('floating');
    return 'floating';
  }, [conversationId]);

  const sendMessageWithText = useCallback(async (text) => {
    if (!text.trim() || loading) return;

    const userMessage = text.trim();
    setInput('');
    stopSpeaking();
    setMessages(prev => [...prev, { role: 'user', content: userMessage, ts: Date.now() }]);
    setLoading(true);

    try {
      await ensureConversation();
      const resp = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: userMessage, conversation_id: 'floating' }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Erreur serveur');
      }

      const data = await resp.json();
      let assistantContent = data.message || data.response || data.reply || 'Reponse vide';

      if (data.confirmation) {
        assistantContent += '\n\n--- Action proposee: ' + (data.confirmation.type || 'Action') + '. Confirme pour executer.';
      }

      setMessages(prev => [...prev, { role: 'assistant', content: assistantContent, ts: Date.now() }]);
      
      // Auto-read response aloud if TTS is on
      speak(assistantContent);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Erreur: ' + err.message, ts: Date.now(), isError: true }]);
    } finally {
      setLoading(false);
    }
  }, [loading, ensureConversation, speak, stopSpeaking]);

  const sendMessage = useCallback(() => {
    sendMessageWithText(input);
  }, [input, sendMessageWithText]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const resetConversation = useCallback(async () => {
    stopSpeaking();
    setMessages([]);
    setConversationId('');
    localStorage.removeItem('agent_conversation_id');
    localStorage.removeItem('agent_chat_messages');
    try {
      await fetch('/api/assistant/history?conversation_id=floating', { method: 'DELETE', credentials: 'include' });
    } catch {}
  }, [stopSpeaking]);

  const toggleVoice = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const toggleTts = useCallback(() => {
    if (ttsEnabled) {
      stopSpeaking();
      setTtsEnabled(false);
    } else {
      setTtsEnabled(true);
    }
  }, [ttsEnabled, stopSpeaking]);

  // Styles
  const S = {
    container: { position: 'fixed', bottom: '20px', right: '20px', zIndex: 99999, fontFamily: 'Inter, -apple-system, sans-serif' },
    bubble: {
      width: '60px', height: '60px', borderRadius: '50%',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 4px 20px rgba(212,175,55,0.3), 0 0 0 2px rgba(212,175,55,0.5)',
      transition: 'transform 0.2s ease, box-shadow 0.3s ease',
      overflow: 'hidden', position: 'relative',
    },
    bubbleImg: { width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' },
    panel: {
      position: 'fixed', bottom: '20px', right: '20px', width: '380px', height: '540px',
      maxHeight: 'calc(100vh - 40px)', background: '#0B0B0F', borderRadius: '16px',
      border: '1px solid rgba(212,175,55,0.4)', boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
      display: 'flex', flexDirection: 'column', zIndex: 99999, overflow: 'hidden',
    },
    header: {
      padding: '12px 16px', background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)',
      borderBottom: '1px solid rgba(212,175,55,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    },
    headerLeft: { display: 'flex', alignItems: 'center', gap: '10px' },
    avatar: { width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(212,175,55,0.4)' },
    title: { color: '#D4AF37', fontSize: '14px', fontWeight: 600, margin: 0 },
    subtitle: { color: '#64748b', fontSize: '11px', margin: 0, display: 'flex', alignItems: 'center', gap: '4px' },
    headerBtn: { background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '16px', padding: '4px 8px', borderRadius: '6px' },
    messages: { flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' },
    msgUser: { alignSelf: 'flex-end', background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.25)', borderRadius: '12px 12px 4px 12px', padding: '10px 14px', maxWidth: '85%', color: '#e2e8f0', fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
    msgAssistant: { alignSelf: 'flex-start', background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(100,116,139,0.2)', borderRadius: '12px 12px 12px 4px', padding: '10px 14px', maxWidth: '85%', color: '#cbd5e1', fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
    msgError: { borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' },
    inputArea: { padding: '10px 12px', borderTop: '1px solid rgba(212,175,55,0.2)', display: 'flex', gap: '6px', alignItems: 'flex-end' },
    input: { flex: 1, background: '#0F172A', border: '1px solid rgba(100,116,139,0.3)', borderRadius: '10px', padding: '10px 14px', color: '#e2e8f0', fontSize: '13px', outline: 'none', resize: 'none', fontFamily: 'inherit', maxHeight: '80px', minHeight: '40px' },
    iconBtn: { background: '#1e293b', border: '1px solid rgba(100,116,139,0.3)', borderRadius: '10px', padding: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', minWidth: '40px', height: '40px' },
    sendBtn: { background: 'linear-gradient(135deg, #D4AF37 0%, #b8941f 100%)', border: 'none', borderRadius: '10px', padding: '0 14px', cursor: 'pointer', color: '#0B0B0F', fontSize: '16px', fontWeight: 600, minWidth: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    empty: { textAlign: 'center', color: '#475569', fontSize: '13px', padding: '30px 20px' },
    statusDot: { width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block' },
    badge: { position: 'absolute', top: '-2px', right: '-2px', width: '12px', height: '12px', borderRadius: '50%', background: '#06B6D4', border: '2px solid #0B0B0F' },
    tooltip: { position: 'absolute', bottom: '70px', right: '0', background: '#1e293b', color: '#e2e8f0', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', whiteSpace: 'nowrap', pointerEvents: 'none', opacity: 0, transition: 'opacity 0.2s' },
  };

  return React.createElement(React.Fragment, null,
    // Floating bubble
    !isOpen && React.createElement('div', { style: S.container },
      React.createElement('div', {
        style: S.bubble,
        onClick: () => setIsOpen(true),
        onMouseEnter: (e) => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 4px 30px rgba(212,175,55,0.5)'; },
        onMouseLeave: (e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(212,175,55,0.3), 0 0 0 2px rgba(212,175,55,0.5)'; },
        title: 'NOVA — Assistant IA',
      },
        React.createElement('img', { src: novaAvatar, style: S.bubbleImg, alt: 'NOVA' }),
        React.createElement('span', { style: S.badge }),
      ),
    ),

    // Chat panel
    isOpen && React.createElement('div', { style: S.panel },
      // Header
      React.createElement('div', { style: S.header },
        React.createElement('div', { style: S.headerLeft },
          React.createElement('img', { src: novaAvatar, style: S.avatar, alt: 'NOVA' }),
          React.createElement('div', null,
            React.createElement('p', { style: S.title }, 'NOVA'),
            React.createElement('p', { style: S.subtitle },
              React.createElement('span', { style: { ...S.statusDot, background: speaking ? '#D4AF37' : isListening ? '#06B6D4' : loading ? '#f59e0b' : '#22c55e' } }),
              speaking ? 'Parle...' : isListening ? 'Ecoute...' : loading ? 'Reflechit...' : 'En ligne',
            ),
          ),
        ),
        React.createElement('div', { style: { display: 'flex', gap: '4px' } },
          // TTS toggle
          React.createElement('button', {
            style: { ...S.headerBtn, color: ttsEnabled ? '#D4AF37' : '#64748b' },
            onClick: toggleTts, title: ttsEnabled ? 'Lecture vocale ON' : 'Lecture vocale OFF',
          }, ttsEnabled ? '\u{1F50A}' : '\u{1F507}'),
          // Reset
          React.createElement('button', { style: S.headerBtn, onClick: resetConversation, title: 'Nouvelle conversation' }, '\u21BB'),
          // Close
          React.createElement('button', { style: S.headerBtn, onClick: () => { stopSpeaking(); setIsOpen(false); }, title: 'Fermer' }, '\u2715'),
        ),
      ),

      // Messages
      React.createElement('div', { style: S.messages },
        messages.length === 0 && !loading && React.createElement('div', { style: S.empty },
          React.createElement('img', { src: novaAvatar, style: { width: '64px', height: '64px', borderRadius: '50%', margin: '0 auto 12px', display: 'block', opacity: 0.8 } }),
          React.createElement('p', null, 'Salut Julien !'),
          React.createElement('p', { style: { marginTop: '8px' } }, 'Pose ta question, parle-moi, ou clique sur le micro.'),
          React.createElement('p', { style: { marginTop: '12px', fontSize: '11px', color: '#334155' } },
            sttSupported ? 'Micro disponible' : 'Micro non supporte sur ce navigateur',
            ' - ',
            ttsSupported ? 'Lecture vocale disponible' : 'Lecture vocale non supportee',
          ),
        ),
        messages.map((msg, i) => React.createElement('div', {
          key: i,
          style: msg.role === 'user' ? S.msgUser : { ...S.msgAssistant, ...(msg.isError ? S.msgError : {}) },
        }, msg.content)),
        loading && React.createElement('div', { style: { alignSelf: 'flex-start', color: '#64748b', fontSize: '12px', fontStyle: 'italic', padding: '8px 14px' } },
          React.createElement('span', { style: { animation: 'pulse 1.5s infinite' } }, 'NOVA reflechit...'),
        ),
        React.createElement('div', { ref: messagesEndRef }),
      ),

      // Input area
      React.createElement('div', { style: S.inputArea },
        // Mic button
        sttSupported && React.createElement('button', {
          style: { ...S.iconBtn, borderColor: isListening ? '#06B6D4' : 'rgba(100,116,139,0.3)', background: isListening ? 'rgba(6,182,212,0.15)' : '#1e293b' },
          onClick: toggleVoice, title: isListening ? 'Arret ecoute' : 'Parler a NOVA', disabled: loading,
        }, isListening ? '\u{23F9}' : '\u{1F3A4}'),
        // Text input
        React.createElement('textarea', {
          ref: inputRef, style: S.input, value: input,
          onChange: (e) => setInput(e.target.value), onKeyDown: handleKeyDown,
          placeholder: isListening ? 'Ecoute en cours...' : 'Ecris ton message...',
          rows: 1, disabled: loading || isListening,
        }),
        // Send button
        React.createElement('button', {
          style: { ...S.sendBtn, opacity: loading || !input.trim() ? 0.5 : 1, cursor: loading || !input.trim() ? 'not-allowed' : 'pointer' },
          onClick: sendMessage, disabled: loading || !input.trim(),
        }, '\u27A4'),
      ),
    ),

    // Pulse animation
    React.createElement('style', null, '@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}'),
  );
};

export default FloatingAgent;
