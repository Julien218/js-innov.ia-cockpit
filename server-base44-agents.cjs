/**
 * Route historique `/api/base44-agents` conservée pour compatibilité.
 *
 * Architecture active : un seul agent IA, Elynea. Les anciens identifiants
 * d'agents sont désormais des clés de compétences internes. Base44 n'est plus
 * appelé dans le chemin actif.
 */
const crypto = require('node:crypto');
const express = require('express');
const { ELYNEA_AGENT, SKILL_REGISTRY, AGENT_REGISTRY, findSkill } = require('./server-agent-registry.cjs');
const { processSpecialistMessage } = require('./server-specialist-tasks.cjs');
const { cleanTenant } = require('./server-tenant.cjs');

const router = express.Router();
const JS_AGENT_URL = String(process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app').replace(/\/$/, '');
const JS_AGENT_KEY = String(process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '').trim();
const conversations = new Map();

function activeSkills() {
  return SKILL_REGISTRY.filter((skill) => skill.status === 'active');
}

function publicAssistant() {
  return {
    key: ELYNEA_AGENT.key,
    name: ELYNEA_AGENT.name,
    provider: ELYNEA_AGENT.provider,
    provider_agent_id: ELYNEA_AGENT.key,
    role: ELYNEA_AGENT.label,
    capabilities: ELYNEA_AGENT.capabilities,
    status: ELYNEA_AGENT.status,
    architecture: ELYNEA_AGENT.architecture,
    status_detail: 'Agent IA unique JS-Innov.IA',
    last_check: new Date().toISOString(),
  };
}

function publicSkill(skill) {
  return {
    key: skill.key,
    skill_id: skill.key,
    name: skill.name,
    kind: 'skill',
    assistant_key: ELYNEA_AGENT.key,
    role: skill.label || skill.role,
    technical_role: skill.role,
    domains: skill.domains || [],
    capabilities: skill.capabilities || [],
    status: skill.status,
    status_detail: 'Compétence interne d’Elynea',
  };
}

function resolveSkill(value) {
  if (String(value || '').toLowerCase() === ELYNEA_AGENT.key) return null;
  return findSkill(value) || activeSkills().find((skill) => skill.key === value) || null;
}

function requireElynea(req, res, next) {
  if (!req.user?.id || !['collaborateur', 'admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Accès Elynea refusé.' });
  if (!JS_AGENT_KEY) return res.status(503).json({ error: 'JSINNOVIA_AGENT_KEY non configurée pour Elynea.' });
  next();
}

router.get('/', (_req, res) => {
  const assistant = publicAssistant();
  const skills = activeSkills().map(publicSkill);
  res.json({
    assistant,
    skills,
    // Compatibilité avec les anciennes interfaces : il n’y a désormais qu’un agent.
    agents: [assistant],
    total: 1,
    active: 1,
    skill_total: skills.length,
    provider: 'jsinnovia-agent',
    architecture: 'single-agent-multi-skill',
    base44_active: false,
  });
});

router.get('/registry/routing-map', (_req, res) => {
  const routing = {};
  for (const skill of activeSkills()) {
    for (const domain of skill.domains || []) {
      routing[domain] = {
        assistant_key: ELYNEA_AGENT.key,
        assistant_name: ELYNEA_AGENT.name,
        skill_key: skill.key,
        skill_name: skill.name,
        // Champs historiques conservés pour les clients anciens.
        agent_key: skill.key,
        agent_name: ELYNEA_AGENT.name,
        provider_agent_id: ELYNEA_AGENT.key,
        provider: 'jsinnovia-agent',
        capabilities: skill.capabilities,
      };
    }
  }
  res.json({ routing, provider: 'jsinnovia-agent', assistant: publicAssistant(), architecture: 'single-agent-multi-skill', generated_at: new Date().toISOString() });
});

router.get('/:agentId/status', (req, res) => {
  const requested = String(req.params.agentId || '');
  const skill = resolveSkill(requested);
  if (requested !== ELYNEA_AGENT.key && !skill) return res.status(404).json({ error: 'Compétence Elynea non trouvée' });
  res.json({
    assistant_key: ELYNEA_AGENT.key,
    name: ELYNEA_AGENT.name,
    skill_key: skill?.key || null,
    skill_name: skill?.name || null,
    provider: 'jsinnovia-agent',
    status: JS_AGENT_KEY ? 'operational' : 'configuration_required',
    checked_at: new Date().toISOString(),
  });
});

router.post('/:agentId/conversations', requireElynea, (req, res) => {
  const skill = resolveSkill(req.params.agentId);
  if (!skill) return res.status(404).json({ error: 'Compétence Elynea non trouvée' });
  const id = `elynea-${crypto.randomUUID()}`;
  const item = {
    id,
    assistant_key: ELYNEA_AGENT.key,
    skill_key: skill.key,
    // Ancien champ gardé afin de relire les objets historiques.
    agent_key: skill.key,
    owner_id: req.user.id,
    tenant: cleanTenant(req.user.organisation) || 'jsinnovia',
    created_at: new Date().toISOString(),
    messages: [],
  };
  conversations.set(id, item);
  res.status(201).json(item);
});

router.get('/:agentId/conversations', requireElynea, (req, res) => {
  const skill = resolveSkill(req.params.agentId);
  if (!skill) return res.status(404).json({ error: 'Compétence Elynea non trouvée' });
  const tenant = cleanTenant(req.user.organisation) || 'jsinnovia';
  res.json([...conversations.values()]
    .filter((item) => item.skill_key === skill.key && item.owner_id === req.user.id && item.tenant === tenant)
    .map(({ messages, requests, busy, ...item }) => ({ ...item, message_count: messages.length })));
});

router.post('/:agentId/conversations/:convId/messages', requireElynea, async (req, res) => {
  const skill = resolveSkill(req.params.agentId);
  const conversation = conversations.get(req.params.convId);
  const tenant = cleanTenant(req.user.organisation) || 'jsinnovia';
  if (!skill || !conversation || conversation.skill_key !== skill.key || conversation.owner_id !== req.user.id || conversation.tenant !== tenant) {
    return res.status(404).json({ error: 'Conversation Elynea non trouvée' });
  }

  const message = String(req.body?.content || req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message requis' });
  if (message.length > 4000) return res.status(413).json({ error: 'Message limité à 4000 caractères.' });

  const requestId = String(req.body?.request_id || crypto.randomUUID()).slice(0, 100);
  conversation.requests ||= new Map();
  const cached = conversation.requests.get(requestId);
  if (cached) return cached.message === message ? res.json(cached.response) : res.status(409).json({ error: 'Identifiant déjà utilisé pour un autre message.' });
  if (conversation.busy) return res.status(409).json({ error: 'Un message est déjà en cours dans cette conversation.' });
  conversation.busy = true;

  try {
    const agentFetch = (path, options = {}) => fetch(`${JS_AGENT_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-agent-key': JS_AGENT_KEY, ...options.headers, 'x-organisation-id': tenant },
      signal: AbortSignal.timeout(60000),
    });

    // processSpecialistMessage est conservé comme moteur de compétence. Le paramètre
    // historique `agent` reçoit une compétence, jamais une seconde identité IA.
    const outcome = await processSpecialistMessage({
      agent: skill,
      message,
      user: req.user,
      tenant,
      conversationId: conversation.id,
      requestId,
      agentFetch,
      chat: async (availableActions) => {
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
              'Tu es Elynea, l’unique agent IA de JS-Innov.IA. Ne change jamais d’identité.',
              `Compétence active: ${skill.name}.`,
              `Rôle technique de la compétence: ${skill.role}.`,
              `Périmètre strict: ${(skill.domains || []).join(', ') || 'interne JS-Innov.IA'}.`,
              skill.system_prompt ? `[DIRECTIVES COMPÉTENCE]\n${skill.system_prompt}\n[/DIRECTIVES COMPÉTENCE]` : '',
              'Base44 est retiré. Vérifie les capacités internes réellement disponibles et ne simule jamais une exécution.',
              'Pour une demande de travail, retourne propose_action type=create_task_batch avec tasks. Seuls les identifiants retournés par le Cockpit constituent une preuve.',
              'La création de tâches ne vaut pas autorisation de publier, encaisser, virer des fonds ou modifier la production.',
            ].filter(Boolean).join('\n'),
          }),
          signal: AbortSignal.timeout(60000),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Elynea HTTP ${response.status}`);
        return data;
      },
    });

    const content = outcome.content;
    conversation.messages.push(
      { role: 'user', content: message, created_at: new Date().toISOString() },
      { role: 'assistant', content, created_at: new Date().toISOString() },
    );
    const result = {
      ...outcome,
      response: content,
      provider: 'jsinnovia-agent',
      assistant_key: ELYNEA_AGENT.key,
      assistant_name: ELYNEA_AGENT.name,
      skill_key: skill.key,
      skill_name: skill.name,
      conversation_id: conversation.id,
    };
    conversation.requests.set(requestId, { message, response: result });
    if (conversation.requests.size > 100) conversation.requests.delete(conversation.requests.keys().next().value);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error.message });
  } finally {
    conversation.busy = false;
  }
});

module.exports = { router, AGENT_REGISTRY, ELYNEA_AGENT, SKILL_REGISTRY };
