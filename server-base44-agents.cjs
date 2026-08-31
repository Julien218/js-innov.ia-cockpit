/**
 * Route de compatibilité historique `/api/base44-agents`.
 *
 * Le frontend conserve temporairement cet URL, mais toutes les opérations sont
 * désormais servies par les spécialistes internes NOVA. Aucune clé ni requête
 * Base44 n'est utilisée.
 */
const crypto = require('node:crypto');
const express = require('express');
const { AGENT_REGISTRY } = require('./server-agent-registry.cjs');
const { processSpecialistMessage } = require('./server-specialist-tasks.cjs');
const { cleanTenant } = require('./server-tenant.cjs');

const router = express.Router();
const JS_AGENT_URL = String(process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app').replace(/\/$/, '');
const JS_AGENT_KEY = String(process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '').trim();
const conversations = new Map();

function activeAgents() {
  return AGENT_REGISTRY.filter((agent) => agent.status === 'active' && agent.provider === 'jsinnovia-agent');
}

function publicAgent(agent) {
  return {
    key: agent.key,
    name: agent.name,
    provider: 'jsinnovia-agent',
    provider_agent_id: agent.key,
    role: agent.label || agent.role,
    domains: agent.domains,
    capabilities: agent.capabilities,
    status: 'active',
    status_detail: 'Spécialiste interne NOVA — Base44 retiré du chemin actif',
    last_check: new Date().toISOString(),
  };
}

function findAgent(value) {
  return activeAgents().find((agent) => agent.key === value) || null;
}

function requireInternalAgent(req, res, next) {
  if (!req.user?.id || !['collaborateur', 'admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Accès spécialiste refusé.' });
  if (!JS_AGENT_KEY) return res.status(503).json({ error: 'JSINNOVIA_AGENT_KEY non configurée pour les spécialistes internes NOVA.' });
  next();
}

router.get('/', (_req, res) => {
  const agents = activeAgents().map(publicAgent);
  res.json({ agents, total: agents.length, active: agents.length, provider: 'jsinnovia-agent', base44_active: false });
});

router.get('/registry/routing-map', (_req, res) => {
  const routing = {};
  for (const agent of activeAgents()) {
    for (const domain of agent.domains || []) {
      routing[domain] = { agent_key: agent.key, agent_name: agent.name, provider_agent_id: agent.key, provider: 'jsinnovia-agent', capabilities: agent.capabilities };
    }
  }
  res.json({ routing, provider: 'jsinnovia-agent', generated_at: new Date().toISOString() });
});

router.get('/:agentId/status', (req, res) => {
  const agent = findAgent(req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'Spécialiste NOVA non trouvé' });
  res.json({ agent_id: agent.key, name: agent.name, provider: 'jsinnovia-agent', status: JS_AGENT_KEY ? 'operational' : 'configuration_required', checked_at: new Date().toISOString() });
});

router.post('/:agentId/conversations', requireInternalAgent, (req, res) => {
  const agent = findAgent(req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'Spécialiste NOVA non trouvé' });
  const id = `nova-${crypto.randomUUID()}`;
  const item = { id, agent_key: agent.key, owner_id: req.user.id, tenant: cleanTenant(req.user.organisation) || 'jsinnovia', created_at: new Date().toISOString(), messages: [] };
  conversations.set(id, item);
  res.status(201).json(item);
});

router.get('/:agentId/conversations', requireInternalAgent, (req, res) => {
  const agent = findAgent(req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'Spécialiste NOVA non trouvé' });
  res.json([...conversations.values()].filter((item) => item.agent_key === agent.key && item.owner_id === req.user.id && item.tenant === (cleanTenant(req.user.organisation) || 'jsinnovia')).map(({ messages, requests, busy, ...item }) => ({ ...item, message_count: messages.length })));
});

router.post('/:agentId/conversations/:convId/messages', requireInternalAgent, async (req, res) => {
  const agent = findAgent(req.params.agentId);
  const conversation = conversations.get(req.params.convId);
  const tenant = cleanTenant(req.user.organisation) || 'jsinnovia';
  if (!agent || !conversation || conversation.agent_key !== agent.key || conversation.owner_id !== req.user.id || conversation.tenant !== tenant) return res.status(404).json({ error: 'Conversation NOVA non trouvée' });
  const message = String(req.body?.content || req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message requis' });
  if (message.length > 4000) return res.status(413).json({ error: 'Message limité à 4000 caractères pour conserver toutes les contraintes dans chaque tâche.' });
  const requestId = String(req.body?.request_id || crypto.randomUUID()).slice(0, 100);
  conversation.requests ||= new Map();
  const cached = conversation.requests.get(requestId);
  if (cached) return cached.message === message ? res.json(cached.response) : res.status(409).json({ error: 'Identifiant déjà utilisé pour un autre message.' });
  if (conversation.busy) return res.status(409).json({ error: 'Un message est déjà en cours dans cette conversation.' });
  conversation.busy = true;
  try {
    const agentFetch = (path, options = {}) => fetch(`${JS_AGENT_URL}${path}`, {
      ...options, headers: { 'Content-Type': 'application/json', 'x-agent-key': JS_AGENT_KEY, ...options.headers, 'x-organisation-id': tenant },
      signal: AbortSignal.timeout(60000),
    });
    const outcome = await processSpecialistMessage({ agent, message, user: req.user, tenant, conversationId: conversation.id, requestId, agentFetch, chat: async (availableActions) => {
    const response = await fetch(`${JS_AGENT_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-key': JS_AGENT_KEY },
      body: JSON.stringify({
        message,
        session_id: conversation.id,
        assistant_mode: req.user.role === 'superadmin' ? 'owner' : 'staff',
        available_actions: availableActions,
        user_context: { id: req.user.id, role: req.user.role, organisation: tenant, full_name: req.user.full_name },
        action_protocol: { proposed_action: { type: 'create_task_batch', payload: { tasks: [{ titre: 'Titre précis', description: 'Critères vérifiables', priorite: 'haute' }] } } },
        server_context: [
          `Tu es ${agent.name}, spécialiste interne délégué par NOVA.`,
          `Rôle: ${agent.role}.`,
          `Périmètre de domaine strict: ${(agent.domains || []).join(', ') || 'interne JS-Innov.IA'}.`,
          agent.system_prompt ? `[DIRECTIVES SPÉCIALISTE]\n${agent.system_prompt}\n[/DIRECTIVES SPÉCIALISTE]` : '',
          'Base44 est retiré. Vérifie les capacités internes réellement disponibles et ne simule jamais une exécution.',
          'Pour une demande de travail, retourne propose_action type=create_task_batch avec tasks. Conserve toutes les exigences et les distinctions membres/non-membres, pourcentages, bénéficiaires et réseaux. Ne promets jamais une action future : seuls les identifiants retournés par le Cockpit constituent une preuve.',
          'La création des tâches ne vaut pas autorisation de publier, encaisser, virer des fonds ou modifier la production.',
        ].filter(Boolean).join('\n'),
      }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Agent interne HTTP ${response.status}`);
    return data;
    } });
    const content = outcome.content;
    conversation.messages.push({ role: 'user', content: message, created_at: new Date().toISOString() }, { role: 'assistant', content, created_at: new Date().toISOString() });
    const result = { ...outcome, response: content, provider: 'jsinnovia-agent', conversation_id: conversation.id };
    conversation.requests.set(requestId, { message, response: result });
    if (conversation.requests.size > 100) conversation.requests.delete(conversation.requests.keys().next().value);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error.message });
  } finally {
    conversation.busy = false;
  }
});

module.exports = { router, AGENT_REGISTRY };
