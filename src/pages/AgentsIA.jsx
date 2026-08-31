/**
 * AgentsIA.jsx — Page de gestion des spécialistes internes NOVA
 *
 * Architecture sécurisée :
 *   Frontend → /api/base44-agents (URL de compatibilité) → NOVA interne
 *
 * Aucune clé API n'est présente dans ce fichier.
 * Toutes les requêtes passent par le backend sécurisé du Cockpit.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// === Styles (système de conception JS-Innov.IA) ===
const COLORS = {
  bg: '#0B0B0F',
  card: '#14141e',
  border: '#1e1e2e',
  gold: '#D4AF37',
  cyan: '#06B6D4',
  violet: '#7C3AED',
  textPrimary: '#f0f0f5',
  textSecondary: '#9999aa',
  green: '#22c55e',
  red: '#ef4444',
  orange: '#f59e0b',
};

export default function AgentsIA() {
  const queryClient = useQueryClient();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [statusChecks, setStatusChecks] = useState({});
  const messagesEndRef = useRef(null);

  // === Chargement du registre des agents depuis le backend ===
  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/base44-agents');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setAgents(data.agents || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // === Vérification du statut d'un agent ===
  const checkAgentStatus = useCallback(async (agentId) => {
    setStatusChecks(prev => ({ ...prev, [agentId]: 'checking' }));
    try {
      const resp = await fetch(`/api/base44-agents/${agentId}/status`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setStatusChecks(prev => ({ ...prev, [agentId]: data.status }));
    } catch (err) {
      setStatusChecks(prev => ({ ...prev, [agentId]: 'error' }));
    }
  }, []);

  // === Création d'une conversation avec un agent ===
  const startConversation = useCallback(async (agent) => {
    setSelectedAgent(agent);
    setConversation(null);
    setMessages([]);
    setError(null);

    try {
      const resp = await fetch(`/api/base44-agents/${agent.provider_agent_id}/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!resp.ok) {
        const errData = await resp.json();
        throw new Error(errData.detail || errData.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setConversation(data);
      setMessages([]);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // === Envoi d'un message à l'agent ===
  const sendMessage = useCallback(async () => {
    if (!input.trim() || !selectedAgent || !conversation || sending) return;

    const userMsg = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const resp = await fetch(
        `/api/base44-agents/${selectedAgent.provider_agent_id}/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: userMsg.content, request_id: crypto.randomUUID() })
        }
      );

      if (!resp.ok) {
        const errData = await resp.json();
        throw new Error(errData.detail || errData.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.content, id: data.id }]);
      if (data.action_type === 'delete_dropbox_file') {
        queryClient.invalidateQueries({ queryKey: ['portfolio-dropbox-assets'] });
        window.dispatchEvent(new Event('cockpit-documents-changed'));
        queryClient.invalidateQueries({ queryKey: ['Tache'] });
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', content: `Erreur: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  }, [input, selectedAgent, conversation, sending, queryClient]);

  // Auto-scroll vers le bas
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // === Render ===
  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: COLORS.textSecondary }}>
        Chargement du registre des agents…
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* En-tête */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
          Spécialistes IA — NOVA
        </h1>
        <p style={{ color: COLORS.textSecondary, marginTop: '8px', fontSize: '14px' }}>
          {agents.filter(a => a.status === 'active').length} agents actifs sur {agents.length} •
          Communication sécurisée via backend (aucune clé exposée)
        </p>
      </div>

      {/* Erreur globale */}
      {error && (
        <div style={{
          background: `${COLORS.red}15`,
          border: `1px solid ${COLORS.red}40`,
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '24px',
          color: COLORS.red,
          fontSize: '14px'
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Grille des agents */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '16px',
        marginBottom: '32px'
      }}>
        {agents.map(agent => {
          const status = statusChecks[agent.provider_agent_id];
          const isActive = agent.status === 'active';
          const isSelected = selectedAgent?.provider_agent_id === agent.provider_agent_id;

          return (
            <div
              key={agent.provider_agent_id}
              onClick={() => isActive && startConversation(agent)}
              style={{
                background: isSelected ? `${COLORS.gold}10` : COLORS.card,
                border: `1px solid ${isSelected ? COLORS.gold : COLORS.border}`,
                borderRadius: '12px',
                padding: '20px',
                cursor: isActive ? 'pointer' : 'default',
                opacity: isActive ? 1 : 0.5,
                transition: 'all 0.2s ease',
              }}
            >
              {/* Statut */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: !isActive ? COLORS.red :
                    status === 'operational' ? COLORS.green :
                    status === 'checking' ? COLORS.orange :
                    status === 'error' || status === 'not_found' ? COLORS.red :
                    COLORS.cyan
                }} />
                {isActive && (
                  <button
                    onClick={(e) => { e.stopPropagation(); checkAgentStatus(agent.provider_agent_id); }}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '6px',
                      padding: '4px 10px',
                      color: COLORS.textSecondary,
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    {status === 'checking' ? 'Vérification…' : 'Tester'}
                  </button>
                )}
              </div>

              {/* Nom et rôle */}
              <h3 style={{ color: COLORS.textPrimary, fontSize: '16px', fontWeight: 600, margin: '0 0 4px 0' }}>
                {agent.name}
              </h3>
              <p style={{ color: COLORS.textSecondary, fontSize: '12px', margin: '0 0 12px 0' }}>
                {agent.role}
              </p>

              {/* Domaines */}
              {agent.domains.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                  {agent.domains.map(d => (
                    <span key={d} style={{
                      background: `${COLORS.cyan}15`,
                      color: COLORS.cyan,
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px'
                    }}>
                      {d}
                    </span>
                  ))}
                </div>
              )}

              {/* Capabilities */}
              {agent.capabilities.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {agent.capabilities.slice(0, 4).map(c => (
                    <span key={c} style={{
                      color: COLORS.textSecondary,
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '3px',
                      background: `${COLORS.violet}10`
                    }}>
                      {c}
                    </span>
                  ))}
                </div>
              )}

              {/* Statut détaillé pour agent supprimé */}
              {!isActive && agent.status_detail && (
                <p style={{ color: COLORS.red, fontSize: '11px', marginTop: '8px' }}>
                  {agent.status_detail}
                </p>
              )}

              {/* ID provider */}
              <p style={{ color: `${COLORS.textSecondary}80`, fontSize: '10px', marginTop: '12px', fontFamily: 'monospace' }}>
                {agent.provider_agent_id}
              </p>
            </div>
          );
        })}
      </div>

      {/* Zone de conversation */}
      {selectedAgent && conversation && (
        <div style={{
          background: COLORS.card,
          border: `1px solid ${COLORS.border}`,
          borderRadius: '12px',
          padding: '20px',
          marginTop: '24px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ color: COLORS.textPrimary, fontSize: '16px', margin: 0 }}>
              💬 {selectedAgent.name}
            </h3>
            <button
              onClick={() => { setSelectedAgent(null); setConversation(null); setMessages([]); }}
              style={{
                background: 'transparent', border: 'none', color: COLORS.textSecondary,
                cursor: 'pointer', fontSize: '14px'
              }}
            >
              ✕ Fermer
            </button>
          </div>

          {/* Messages */}
          <div style={{
            maxHeight: '400px',
            overflowY: 'auto',
            marginBottom: '16px',
            padding: '12px',
            background: `${COLORS.bg}`,
            borderRadius: '8px'
          }}>
            {messages.length === 0 && (
              <p style={{ color: COLORS.textSecondary, textAlign: 'center', fontSize: '13px' }}>
                Conversation initiée. Envoyez votre premier message à {selectedAgent.name}.
              </p>
            )}
            {messages.map((msg, i) => (
              <div key={i} style={{
                marginBottom: '12px',
                textAlign: msg.role === 'user' ? 'right' : 'left'
              }}>
                <div style={{
                  display: 'inline-block',
                  maxWidth: '80%',
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  background: msg.role === 'user' ? `${COLORS.gold}20` :
                    msg.role === 'system' ? `${COLORS.red}20` : `${COLORS.cyan}15`,
                  color: msg.role === 'system' ? COLORS.red : COLORS.textPrimary,
                  fontSize: '14px',
                  textAlign: 'left'
                }}>
                  {msg.content}
                </div>
              </div>
            ))}
            {sending && (
              <div style={{ color: COLORS.textSecondary, fontSize: '13px', fontStyle: 'italic' }}>
                {selectedAgent.name} réfléchit…
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder={`Message à ${selectedAgent.name}…`}
              disabled={sending}
              style={{
                flex: 1,
                background: COLORS.bg,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '8px',
                padding: '12px 16px',
                color: COLORS.textPrimary,
                fontSize: '14px',
                outline: 'none'
              }}
            />
            <button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              style={{
                background: COLORS.gold,
                color: COLORS.bg,
                border: 'none',
                borderRadius: '8px',
                padding: '0 24px',
                fontWeight: 600,
                cursor: sending ? 'wait' : 'pointer',
                opacity: sending || !input.trim() ? 0.5 : 1
              }}
            >
              Envoyer
            </button>
          </div>
        </div>
      )}

      {/* Note de sécurité */}
      <div style={{
        marginTop: '24px',
        padding: '12px 16px',
        background: `${COLORS.green}10`,
        border: `1px solid ${COLORS.green}30`,
        borderRadius: '8px',
        fontSize: '12px',
        color: COLORS.green
      }}>
        🔒 Sécurité : Cette page n'utilise aucune clé API côté navigateur. Toutes les requêtes passent par
        le moteur interne sécurisé de NOVA. L’ancienne URL technique est conservée uniquement pour compatibilité.
        La clé <code style={{ color: COLORS.cyan }}>BASE44_API_KEY</code> est stockée uniquement côté serveur.
      </div>
    </div>
  );
}
