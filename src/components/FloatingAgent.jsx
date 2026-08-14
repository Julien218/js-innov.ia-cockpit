/**
 * FloatingAgent.jsx — Widget flottant Superagent pour le cockpit
 * 
 * Bulle de chat persistante en bas à droite, accessible sur toutes les pages.
 * Communique avec le proxy backend /api/agent-chat (clé API gardée côté serveur).
 * 
 * Design: dark theme cockpit — noir profond + or premium + cyan
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

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
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll vers le bas
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Focus l'input quand on ouvre
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Sauvegarder les messages en localStorage
  useEffect(() => {
    try {
      localStorage.setItem('agent_chat_messages', JSON.stringify(messages.slice(-50)));
    } catch {}
  }, [messages]);

  // Sauvegarder le conversationId
  useEffect(() => {
    if (conversationId) {
      localStorage.setItem('agent_conversation_id', conversationId);
    }
  }, [conversationId]);

  // Initialiser ou récupérer la conversation au premier message
  const ensureConversation = useCallback(async () => {
    if (conversationId) return conversationId;

    try {
      const resp = await fetch('/api/agent-chat/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });

      if (!resp.ok) throw new Error('Création conversation échouée');
      const data = await resp.json();
      setConversationId(data.conversationId);
      return data.conversationId;
    } catch (err) {
      throw new Error('Impossible de contacter l\'agent: ' + err.message);
    }
  }, [conversationId]);

  // Envoyer un message
  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    
    setMessages(prev => [...prev, { role: 'user', content: userMessage, ts: Date.now() }]);
    setLoading(true);

    try {
      const convId = await ensureConversation();

      const resp = await fetch('/api/agent-chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ conversationId: convId, message: userMessage }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Erreur serveur');
      }

      const data = await resp.json();

      // Extraire le contenu de la réponse
      let assistantContent = '';
      if (typeof data === 'string') {
        assistantContent = data;
      } else if (data.content) {
        assistantContent = data.content;
      } else if (data.message) {
        assistantContent = typeof data.message === 'string' ? data.message : JSON.stringify(data.message);
      } else if (data.text) {
        assistantContent = data.text;
      } else if (data.detail) {
        // L'API peut retourner un détail si le message est en cours de traitement
        assistantContent = data.detail;
      } else {
        assistantContent = JSON.stringify(data);
      }

      setMessages(prev => [...prev, { role: 'assistant', content: assistantContent, ts: Date.now() }]);
    } catch (err) {
      
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ ' + err.message, ts: Date.now(), isError: true }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, ensureConversation]);

  // Reset conversation
  const resetConversation = useCallback(() => {
    setMessages([]);
    setConversationId('');
    localStorage.removeItem('agent_conversation_id');
    localStorage.removeItem('agent_chat_messages');
    
  }, []);

  // Handle Enter (sans Shift)
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  // Styles inline (pas de dépendance Tailwind requise)
  const styles = {
    container: {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 99999,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
    },
    bubble: {
      width: '56px',
      height: '56px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)',
      border: '2px solid #D4AF37',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      transition: 'transform 0.2s ease',
    },
    bubbleHover: {
      transform: 'scale(1.08)',
    },
    panel: {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      width: '380px',
      height: '520px',
      maxHeight: 'calc(100vh - 40px)',
      background: '#0B0B0F',
      borderRadius: '16px',
      border: '1px solid #D4AF37',
      boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 99999,
      overflow: 'hidden',
    },
    header: {
      padding: '14px 18px',
      background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)',
      borderBottom: '1px solid rgba(212,175,55,0.3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    },
    logo: {
      width: '32px',
      height: '32px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, #D4AF37 0%, #b8941f 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '14px',
      fontWeight: 700,
      color: '#0B0B0F',
    },
    title: {
      color: '#D4AF37',
      fontSize: '14px',
      fontWeight: 600,
      margin: 0,
    },
    subtitle: {
      color: '#64748b',
      fontSize: '11px',
      margin: 0,
    },
    headerBtn: {
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      color: '#64748b',
      fontSize: '18px',
      padding: '4px 8px',
      borderRadius: '6px',
      transition: 'color 0.2s',
    },
    messages: {
      flex: 1,
      overflowY: 'auto',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      scrollbarWidth: 'thin',
    },
    msgUser: {
      alignSelf: 'flex-end',
      background: 'rgba(212,175,55,0.15)',
      border: '1px solid rgba(212,175,55,0.3)',
      borderRadius: '12px 12px 4px 12px',
      padding: '10px 14px',
      maxWidth: '85%',
      color: '#e2e8f0',
      fontSize: '13px',
      lineHeight: '1.5',
      whiteSpace: 'pre-wrap',
    },
    msgAssistant: {
      alignSelf: 'flex-start',
      background: 'rgba(15,23,42,0.8)',
      border: '1px solid rgba(100,116,139,0.2)',
      borderRadius: '12px 12px 12px 4px',
      padding: '10px 14px',
      maxWidth: '85%',
      color: '#cbd5e1',
      fontSize: '13px',
      lineHeight: '1.5',
      whiteSpace: 'pre-wrap',
    },
    msgError: {
      borderColor: 'rgba(239,68,68,0.4)',
      color: '#fca5a5',
    },
    inputArea: {
      padding: '12px',
      borderTop: '1px solid rgba(212,175,55,0.2)',
      display: 'flex',
      gap: '8px',
    },
    input: {
      flex: 1,
      background: '#0F172A',
      border: '1px solid rgba(100,116,139,0.3)',
      borderRadius: '10px',
      padding: '10px 14px',
      color: '#e2e8f0',
      fontSize: '13px',
      outline: 'none',
      resize: 'none',
      fontFamily: 'inherit',
      maxHeight: '80px',
    },
    sendBtn: {
      background: loading ? '#1e293b' : 'linear-gradient(135deg, #D4AF37 0%, #b8941f 100%)',
      border: 'none',
      borderRadius: '10px',
      padding: '0 16px',
      cursor: loading ? 'not-allowed' : 'pointer',
      color: '#0B0B0F',
      fontSize: '16px',
      fontWeight: 600,
      transition: 'opacity 0.2s',
      opacity: loading ? 0.5 : 1,
    },
    loading: {
      alignSelf: 'flex-start',
      color: '#64748b',
      fontSize: '12px',
      fontStyle: 'italic',
      padding: '8px 14px',
    },
    empty: {
      textAlign: 'center',
      color: '#475569',
      fontSize: '13px',
      padding: '40px 20px',
    },
    badge: {
      position: 'absolute',
      top: '-2px',
      right: '-2px',
      width: '12px',
      height: '12px',
      borderRadius: '50%',
      background: '#06B6D4',
      border: '2px solid #0B0B0F',
    },
  };

  return (
    <>
      {/* Bulle flottante */}
      {!isOpen && (
        <div style={styles.container}>
          <div
            style={styles.bubble}
            onClick={() => setIsOpen(true)}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            title="Assistant IA JS-Innov.IA"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
              <path d="M8 12a4 4 0 0 1 8 0"/>
              <circle cx="9" cy="9" r="1" fill="#D4AF37"/>
              <circle cx="15" cy="9" r="1" fill="#D4AF37"/>
            </svg>
            <span style={styles.badge} />
          </div>
        </div>
      )}

      {/* Panel de chat */}
      {isOpen && (
        <div style={styles.panel}>
          {/* Header */}
          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <div style={styles.logo}>IA</div>
              <div>
                <p style={styles.title}>NOVA — Assistant IA</p>
                <p style={styles.subtitle}>
                  {loading ? 'Traitement...' : 'En ligne — JS-Innov.IA'}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                style={styles.headerBtn}
                onClick={resetConversation}
                title="Nouvelle conversation"
              >
                ↻
              </button>
              <button
                style={styles.headerBtn}
                onClick={() => setIsOpen(false)}
                title="Fermer"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Messages */}
          <div style={styles.messages}>
            {messages.length === 0 && !loading && (
              <div style={styles.empty}>
                <p>👋 Salut Julien !</p>
                <p style={{ marginTop: '8px' }}>
                  Pose-moi une question ou demande-moi une action :
                </p>
                <p style={{ marginTop: '12px', fontSize: '11px', color: '#334155' }}>
                  Vérifier les factures Dropbox · Status des projets · Emails · Analytics
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                style={msg.role === 'user' ? styles.msgUser : {
                  ...styles.msgAssistant,
                  ...(msg.isError ? styles.msgError : {}),
                }}
              >
                {msg.content}
              </div>
            ))}

            {loading && (
              <div style={styles.loading}>
                <span style={{ animation: 'pulse 1.5s infinite' }}>●●●</span> NOVA réfléchit...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Zone de saisie */}
          <div style={styles.inputArea}>
            <textarea
              ref={inputRef}
              style={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Écris ton message..."
              rows={1}
              disabled={loading}
            />
            <button
              style={styles.sendBtn}
              onClick={sendMessage}
              disabled={loading || !input.trim()}
            >
              ➤
            </button>
          </div>
        </div>
      )}

      {/* Animation pulse */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </>
  );
};

export default FloatingAgent;
