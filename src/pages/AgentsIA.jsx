/**
 * Elynea — agent IA unique JS-Innov.IA.
 * L'ancienne route `/api/base44-agents` est conservée comme alias backend,
 * mais l'interface ne présente plus plusieurs agents : uniquement Elynea et
 * ses compétences internes.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const COLORS = {
  bg: '#0B0B0F', card: '#14141e', border: '#1e1e2e', gold: '#D4AF37',
  cyan: '#06B6D4', violet: '#7C3AED', textPrimary: '#f0f0f5',
  textSecondary: '#9999aa', green: '#22c55e', red: '#ef4444', orange: '#f59e0b',
};

const buttonStyle = {
  background: 'transparent', border: `1px solid ${COLORS.border}`, borderRadius: '8px',
  padding: '7px 12px', color: COLORS.textSecondary, fontSize: '12px', cursor: 'pointer',
};

export default function AgentsIA() {
  const queryClient = useQueryClient();
  const [assistant, setAssistant] = useState(null);
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState('');
  const [skillChecks, setSkillChecks] = useState({});
  const messagesEndRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const resp = await fetch('/api/base44-agents');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setAssistant(data.assistant || data.agents?.[0] || { key: 'elynea', name: 'Elynea', status: 'active' });
      // Compatibilité avec une ancienne réponse durant un déploiement progressif.
      setSkills(data.skills || (data.agents || []).filter(item => item.key !== 'elynea').map(item => ({
        key: item.provider_agent_id || item.key,
        skill_id: item.provider_agent_id || item.key,
        name: String(item.name || '').replace(/^Elynea\s*·\s*/i, ''),
        role: item.role,
        domains: item.domains || [],
        capabilities: item.capabilities || [],
        status: item.status,
      })));
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const checkAssistant = useCallback(async () => {
    setAssistantStatus('checking');
    try {
      const resp = await fetch('/api/base44-agents/elynea/status');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setAssistantStatus(data.status || 'operational');
    } catch { setAssistantStatus('error'); }
  }, []);

  const checkSkill = useCallback(async (skillKey) => {
    setSkillChecks(prev => ({ ...prev, [skillKey]: 'checking' }));
    try {
      const resp = await fetch(`/api/base44-agents/${encodeURIComponent(skillKey)}/status`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setSkillChecks(prev => ({ ...prev, [skillKey]: data.status || 'operational' }));
    } catch { setSkillChecks(prev => ({ ...prev, [skillKey]: 'error' })); }
  }, []);

  const startConversation = useCallback(async (skill) => {
    setSelectedSkill(skill); setConversation(null); setMessages([]); setError(null);
    try {
      const key = skill.skill_id || skill.key;
      const resp = await fetch(`/api/base44-agents/${encodeURIComponent(key)}/conversations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || data.error || `HTTP ${resp.status}`);
      setConversation(data);
    } catch (err) { setError(err.message); }
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !selectedSkill || !conversation || sending) return;
    const text = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput(''); setSending(true);
    try {
      const key = selectedSkill.skill_id || selectedSkill.key;
      const resp = await fetch(`/api/base44-agents/${encodeURIComponent(key)}/conversations/${encodeURIComponent(conversation.id)}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, request_id: crypto.randomUUID() }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || data.error || `HTTP ${resp.status}`);
      setMessages(prev => [...prev, { role: 'assistant', content: data.content || data.response || '', id: data.id }]);
      if (data.action_type === 'delete_dropbox_file') {
        queryClient.invalidateQueries({ queryKey: ['portfolio-dropbox-assets'] });
        window.dispatchEvent(new Event('cockpit-documents-changed'));
        queryClient.invalidateQueries({ queryKey: ['Tache'] });
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', content: `Erreur: ${err.message}` }]);
    } finally { setSending(false); }
  }, [input, selectedSkill, conversation, sending, queryClient]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: COLORS.textSecondary }}>Chargement d’Elynea…</div>;

  const assistantOnline = assistantStatus === 'operational';

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>Elynea</h1>
        <p style={{ color: COLORS.textSecondary, marginTop: 8, fontSize: 14 }}>
          Un seul agent IA • {skills.filter(skill => skill.status === 'active').length} compétences internes • Un seul moteur de conversation
        </p>
      </div>

      {error && <div style={{ background: `${COLORS.red}15`, border: `1px solid ${COLORS.red}40`, borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: COLORS.red, fontSize: 14 }}>⚠ {error}</div>}

      <section style={{ background: `linear-gradient(135deg, ${COLORS.card}, #10182b)`, border: `1px solid ${assistantOnline ? COLORS.green : COLORS.gold}55`, borderRadius: 16, padding: 20, marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: assistantStatus === 'error' ? COLORS.red : assistantOnline ? COLORS.green : COLORS.gold }} />
              <h2 style={{ color: COLORS.textPrimary, fontSize: 20, margin: 0 }}>{assistant?.name || 'Elynea'}</h2>
            </div>
            <p style={{ color: COLORS.textSecondary, margin: '7px 0 0', fontSize: 13 }}>{assistant?.role || 'Agent IA unique JS-Innov.IA'}</p>
            <p style={{ color: COLORS.cyan, margin: '7px 0 0', fontSize: 12 }}>Architecture : 1 agent → routage automatique vers les compétences ci-dessous</p>
          </div>
          <button type="button" onClick={checkAssistant} style={buttonStyle}>{assistantStatus === 'checking' ? 'Vérification…' : 'Tester Elynea'}</button>
        </div>
      </section>

      <div style={{ marginBottom: 12 }}>
        <h2 style={{ color: COLORS.textPrimary, fontSize: 18, margin: 0 }}>Compétences d’Elynea</h2>
        <p style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 5 }}>Ce ne sont pas des agents séparés. Une carte sélectionne uniquement le contexte métier utilisé par Elynea.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, marginBottom: 28 }}>
        {skills.map(skill => {
          const key = skill.skill_id || skill.key;
          const status = skillChecks[key];
          const selected = selectedSkill && (selectedSkill.skill_id || selectedSkill.key) === key;
          return (
            <div key={key} onClick={() => startConversation(skill)} style={{ background: selected ? `${COLORS.gold}10` : COLORS.card, border: `1px solid ${selected ? COLORS.gold : COLORS.border}`, borderRadius: 12, padding: 18, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: status === 'error' ? COLORS.red : status === 'operational' ? COLORS.green : status === 'checking' ? COLORS.orange : COLORS.cyan }} />
                <button type="button" onClick={(event) => { event.stopPropagation(); checkSkill(key); }} style={{ ...buttonStyle, padding: '4px 9px', fontSize: 11 }}>{status === 'checking' ? 'Vérification…' : 'Tester la compétence'}</button>
              </div>
              <h3 style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: 600, margin: '0 0 5px' }}>{skill.name}</h3>
              <p style={{ color: COLORS.textSecondary, fontSize: 12, margin: '0 0 10px' }}>{skill.role}</p>
              {!!skill.domains?.length && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>{skill.domains.map(domain => <span key={domain} style={{ background: `${COLORS.cyan}15`, color: COLORS.cyan, fontSize: 10, padding: '2px 7px', borderRadius: 4 }}>{domain}</span>)}</div>}
              {!!skill.capabilities?.length && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{skill.capabilities.slice(0, 5).map(capability => <span key={capability} style={{ color: COLORS.textSecondary, fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${COLORS.violet}12` }}>{capability}</span>)}</div>}
              <p style={{ color: `${COLORS.textSecondary}75`, fontSize: 10, marginTop: 12, fontFamily: 'monospace' }}>compétence · {key}</p>
            </div>
          );
        })}
      </div>

      {selectedSkill && conversation && <section style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h3 style={{ color: COLORS.textPrimary, fontSize: 16, margin: 0 }}>💬 Elynea</h3>
            <p style={{ color: COLORS.cyan, fontSize: 11, margin: '4px 0 0' }}>Compétence active : {selectedSkill.name}</p>
          </div>
          <button type="button" onClick={() => { setSelectedSkill(null); setConversation(null); setMessages([]); }} style={buttonStyle}>✕ Fermer</button>
        </div>

        <div style={{ maxHeight: 420, overflowY: 'auto', marginBottom: 14, padding: 12, background: COLORS.bg, borderRadius: 9 }}>
          {!messages.length && <p style={{ color: COLORS.textSecondary, textAlign: 'center', fontSize: 13 }}>Elynea est prête avec la compétence « {selectedSkill.name} ».</p>}
          {messages.map((msg, index) => <div key={msg.id || index} style={{ marginBottom: 10, textAlign: msg.role === 'user' ? 'right' : 'left' }}><div style={{ display: 'inline-block', maxWidth: '82%', padding: '10px 13px', borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px', background: msg.role === 'user' ? `${COLORS.gold}20` : msg.role === 'system' ? `${COLORS.red}20` : `${COLORS.cyan}15`, color: msg.role === 'system' ? COLORS.red : COLORS.textPrimary, fontSize: 14, textAlign: 'left', whiteSpace: 'pre-wrap' }}>{msg.content}</div></div>)}
          {sending && <div style={{ color: COLORS.textSecondary, fontSize: 13, fontStyle: 'italic' }}>Elynea réfléchit…</div>}
          <div ref={messagesEndRef} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder={`Demander à Elynea · ${selectedSkill.name}…`} disabled={sending} style={{ flex: 1, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '12px 14px', color: COLORS.textPrimary, fontSize: 14, outline: 'none' }} />
          <button type="button" onClick={sendMessage} disabled={sending || !input.trim()} style={{ background: COLORS.gold, color: COLORS.bg, border: 'none', borderRadius: 8, padding: '0 22px', fontWeight: 700, cursor: sending ? 'wait' : 'pointer', opacity: sending || !input.trim() ? 0.5 : 1 }}>Envoyer</button>
        </div>
      </section>}

      <div style={{ marginTop: 24, padding: '12px 16px', background: `${COLORS.green}10`, border: `1px solid ${COLORS.green}30`, borderRadius: 8, fontSize: 12, color: COLORS.green }}>
        🔒 Une seule identité IA : Elynea. Les anciennes clés NOVA/Base44 restent uniquement des alias techniques de compatibilité côté serveur.
      </div>
    </div>
  );
}
