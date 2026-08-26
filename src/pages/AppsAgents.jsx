/**
 * AppsAgents.jsx — Page Apps & Agents (registre dynamique)
 *
 * Affiche le registre actuel des spécialistes internes NOVA avec :
 * - agent actif / provider / ID provider / site associé
 * - dernière vérification / dernière exécution / état / erreur éventuelle
 *
 * Source : /api/base44-agents (backend sécurisé)
 */

import { useState, useEffect, useCallback } from 'react';

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

export default function AppsAgents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [statusChecks, setStatusChecks] = useState({});
  const [checkingAll, setCheckingAll] = useState(false);

  // === Chargement du registre ===
  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/base44-agents');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setAgents(data.agents || []);
      setLastRefresh(new Date().toLocaleString('fr-BE'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  // === Vérification du statut d'un agent ===
  const checkAgentStatus = useCallback(async (agentId) => {
    setStatusChecks(prev => ({ ...prev, [agentId]: 'checking' }));
    try {
      const resp = await fetch(`/api/base44-agents/${agentId}/status`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setStatusChecks(prev => ({
        ...prev,
        [agentId]: {
          status: data.status,
          checked_at: data.checked_at,
          detail: data.detail || null
        }
      }));
    } catch (err) {
      setStatusChecks(prev => ({
        ...prev,
        [agentId]: { status: 'error', checked_at: new Date().toISOString(), detail: err.message }
      }));
    }
  }, []);

  // === Vérification de tous les agents ===
  const checkAllAgents = useCallback(async () => {
    setCheckingAll(true);
    for (const agent of agents) {
      if (agent.status === 'active') {
        await checkAgentStatus(agent.provider_agent_id);
      }
    }
    setCheckingAll(false);
  }, [agents, checkAgentStatus]);

  // === Formatage de la date ===
  const formatDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('fr-BE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return iso; }
  };

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
            Apps & Agents
          </h1>
          <p style={{ color: COLORS.textSecondary, marginTop: '8px', fontSize: '14px' }}>
            Registre dynamique • {agents.filter(a => a.status === 'active').length} actifs sur {agents.length}
            {lastRefresh && ` • Dernière actualisation : ${lastRefresh}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={loadAgents}
            style={{
              background: 'transparent', border: `1px solid ${COLORS.border}`, borderRadius: '8px',
              padding: '8px 16px', color: COLORS.textPrimary, fontSize: '13px', cursor: 'pointer'
            }}
          >
            ↻ Actualiser
          </button>
          <button
            onClick={checkAllAgents}
            disabled={checkingAll}
            style={{
              background: COLORS.gold, border: 'none', borderRadius: '8px',
              padding: '8px 16px', color: COLORS.bg, fontSize: '13px', fontWeight: 600,
              cursor: checkingAll ? 'wait' : 'pointer', opacity: checkingAll ? 0.5 : 1
            }}
          >
            {checkingAll ? 'Vérification…' : 'Tester tous'}
          </button>
        </div>
      </div>

      {/* Erreur */}
      {error && (
        <div style={{
          background: `${COLORS.red}15`, border: `1px solid ${COLORS.red}40`,
          borderRadius: '8px', padding: '12px 16px', marginBottom: '24px',
          color: COLORS.red, fontSize: '14px'
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Tableau des agents */}
      <div style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: '12px',
        overflow: 'hidden'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
              {['Agent', 'Provider', 'ID Provider', 'Site/Projet', 'Statut', 'Dernière vérif.', 'Détail'].map(h => (
                <th key={h} style={{
                  padding: '14px 16px', textAlign: 'left',
                  fontSize: '12px', fontWeight: 600, color: COLORS.textSecondary,
                  textTransform: 'uppercase', letterSpacing: '0.5px'
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((agent, i) => {
              const check = statusChecks[agent.provider_agent_id];
              const status = agent.status === 'active'
                ? (check?.status || 'pending')
                : agent.status;
              const isActive = agent.status === 'active';

              return (
                <tr key={agent.provider_agent_id} style={{
                  borderBottom: i < agents.length - 1 ? `1px solid ${COLORS.border}` : 'none'
                }}>
                  {/* Agent */}
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ color: COLORS.textPrimary, fontSize: '14px', fontWeight: 500 }}>
                      {agent.name}
                    </div>
                    <div style={{ color: COLORS.textSecondary, fontSize: '11px', marginTop: '2px' }}>
                      {agent.role}
                    </div>
                  </td>

                  {/* Provider */}
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{
                      background: `${COLORS.violet}15`, color: COLORS.violet,
                      fontSize: '11px', padding: '2px 8px', borderRadius: '4px'
                    }}>
                      {agent.provider}
                    </span>
                  </td>

                  {/* ID Provider */}
                  <td style={{ padding: '14px 16px' }}>
                    <code style={{
                      color: COLORS.cyan, fontSize: '11px',
                      fontFamily: 'monospace'
                    }}>
                      {agent.provider_agent_id.substring(0, 12)}…
                    </code>
                  </td>

                  {/* Site/Projet */}
                  <td style={{ padding: '14px 16px' }}>
                    {agent.domains.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {agent.domains.map(d => (
                          <span key={d} style={{
                            color: COLORS.cyan, fontSize: '12px'
                          }}>
                            {d}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: COLORS.textSecondary, fontSize: '12px' }}>—</span>
                    )}
                  </td>

                  {/* Statut */}
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: status === 'operational' ? COLORS.green :
                          status === 'checking' ? COLORS.orange :
                          status === 'deleted' || status === 'not_found' || status === 'error' ? COLORS.red :
                          COLORS.cyan
                      }} />
                      <span style={{
                        color: status === 'operational' ? COLORS.green :
                          status === 'deleted' ? COLORS.red :
                          status === 'error' || status === 'not_found' ? COLORS.red :
                          status === 'checking' ? COLORS.orange :
                          COLORS.textSecondary,
                        fontSize: '12px'
                      }}>
                        {status === 'operational' ? 'Opérationnel' :
                          status === 'checking' ? 'Vérification…' :
                          status === 'deleted' ? 'Supprimé' :
                          status === 'not_found' ? 'Introuvable' :
                          status === 'error' ? 'Erreur' :
                          status === 'active' ? 'Actif' :
                          status === 'pending' ? 'En attente' :
                          status}
                      </span>
                    </div>
                  </td>

                  {/* Dernière vérif */}
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{ color: COLORS.textSecondary, fontSize: '11px' }}>
                      {check?.checked_at ? formatDate(check.checked_at) : '—'}
                    </span>
                  </td>

                  {/* Détail / Action */}
                  <td style={{ padding: '14px 16px' }}>
                    {isActive && (
                      <button
                        onClick={() => checkAgentStatus(agent.provider_agent_id)}
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
                        {check?.status === 'checking' ? '…' : 'Vérifier'}
                      </button>
                    )}
                    {agent.status_detail && (
                      <span style={{ color: COLORS.red, fontSize: '11px' }}>
                        {agent.status_detail}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
        🔒 Registre dynamique des spécialistes internes NOVA. Base44 n’est plus requis pour exécuter les tâches.
        Aucune clé API exposée côté navigateur. La clé <code style={{ color: COLORS.cyan }}>BASE44_API_KEY</code>
        est stockée uniquement côté serveur Railway.
      </div>
    </div>
  );
}
