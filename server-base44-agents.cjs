/**
 * server-base44-agents.cjs — Proxy sécurisé pour l'API Base44 Agents
 *
 * Architecture cible :
 *   Cockpit frontend → API serveur Cockpit → BASE44_API_KEY → Base44 Agents API
 *
 * Routes exposées :
 *   GET  /api/base44-agents                          → liste le registre des agents
 *   GET  /api/base44-agents/registry/routing-map     → map de routage domaine → agent
 *   GET  /api/base44-agents/:agentId/status           → vérifie le statut d'un agent
 *   POST /api/base44-agents/:agentId/conversations    → crée/récupère une conversation
 *   GET  /api/base44-agents/:agentId/conversations     → liste les conversations
 *   POST /api/base44-agents/:agentId/conversations/:convId/messages → envoie un message
 *
 * Sécurité :
 *   - La clé BASE44_API_KEY est lue uniquement côté serveur (process.env)
 *   - Aucune clé n'est jamais renvoyée au frontend
 *   - Toutes les routes nécessitent une session authentifiée (à monter avec requireSession)
 */

const express = require('express');
const router = express.Router();
const { AGENT_REGISTRY } = require('./server-agent-registry.cjs');

// === Configuration ===
const BASE44_API_URL = 'https://app.base44.com/api/agents';
const BASE44_API_KEY = process.env.BASE44_API_KEY || process.env.BASE44_SERVER_API_KEY || '';

// === Registre central des agents Base44 ===
/* Registre partagé avec NOVA : voir server-agent-registry.cjs. */
/*
  {
    key: 'jsinnov-agent',
    name: 'JsInnov-Agent',
    provider: 'base44',
    provider_agent_id: '6a1845e17cc526d1e44965bc',
    role: 'Agent principal JS-Innov.IA',
    domains: ['cockpit.jsinnovia.com', 'jsinnovia.com'],
    capabilities: ['chat', 'diagnostic', 'orchestration', 'support'],
    status: 'active'
  },
  {
    key: 'synergie-dour',
    name: 'Synergie Dour Assistant',
    provider: 'base44',
    provider_agent_id: '6a0208edd1e235b62b4bda38',
    role: 'Assistant Synergie Dour',
    domains: ['synergiedour.be'],
    capabilities: ['chat', 'information', 'adhesion', 'event'],
    status: 'active'
  },
  {
    key: 'site-olivier',
    name: 'Site Olivier landing Page',
    provider: 'base44',
    provider_agent_id: '6a0371a87c9257126b051d5a',
    role: 'Site Olivier Trévis / Tour de Dour',
    domains: ['oliviertrevis.be', 'letourdedour.com'],
    capabilities: ['chat', 'information', 'landing'],
    status: 'active'
  },
  {
    key: 'dourconnect',
    name: 'Dourconnect2',
    provider: 'base44',
    provider_agent_id: '6a22f0c096ce009a943f4a05',
    role: 'Agent DourConnect',
    domains: ['dourconnect.be'],
    capabilities: ['chat', 'civic', 'information'],
    status: 'active'
  },
  {
    key: 'villeconnect',
    name: 'VilleConnect',
    provider: 'base44',
    provider_agent_id: '6a11d1493754e75ce76ee0de',
    role: 'Agent VilleConnect OS',
    domains: ['villeconnect.be'],
    capabilities: ['chat', 'civic', 'smart-city'],
    status: 'active'
  },
  {
    key: 'nova',
    name: 'NOVA JS-Innov.IA',
    provider: 'base44',
    provider_agent_id: '69ff4dc771a2cdab275f8a00',
    role: 'NOVA — Cockpit Agent',
    domains: ['cockpit.jsinnovia.com'],
    capabilities: ['chat', 'orchestration', 'crm', 'portfolio', 'automation'],
    status: 'active'
  },
  {
    key: 'fashionistart',
    name: 'Agent Fashionistart',
    provider: 'base44',
    provider_agent_id: '6a035427dca907aa03b71398',
    role: 'Agent Fashionist\'art Dour',
    domains: ['fashionistartdour.be'],
    capabilities: ['chat', 'event', 'fashion', 'art'],
    status: 'active'
  },
  {
    key: 'miss-mister-dour',
    name: 'Agent Miss & Mister Dour',
    provider: 'base44',
    provider_agent_id: '69e732e1d54abfd1783f5d06',
    role: 'Agent Miss & Mister Dour',
    domains: ['missetmisterdour.be'],
    capabilities: ['chat', 'event', 'concours', 'voting'],
    status: 'active'
  },
  {
    key: 'generatvideopro',
    name: 'Agent GeneratVideoPro',
    provider: 'base44',
    provider_agent_id: '69e467a9d6329bb2ead81fa3',
    role: 'Génération vidéo pro / Video Studio',
    domains: ['video-studio.jsinnovia.com'],
    capabilities: ['chat', 'video-generation', 'minimax', 'comfyui'],
    status: 'active'
  },
  {
    key: 'creative-director',
    name: 'Js-Innov.IA Creative Director',
    provider: 'base44',
    provider_agent_id: '69ed0a42be17008cf11027eb',
    role: 'Directeur créatif JS-Innov.IA',
    domains: ['jsinnovia.com'],
    capabilities: ['chat', 'branding', 'design', 'creative-direction'],
    status: 'active'
  },
  {
    key: 'a-yanis',
    name: 'A Yanis',
    provider: 'base44',
    provider_agent_id: '69fcda52258a254f4220b0bd',
    role: 'Agent A Yanis',
    domains: [],
    capabilities: [],
    status: 'deleted',
    status_detail: 'Agent non trouvé dans le workspace Base44 (supprimé ou déplacé)'
  }
]; */

// === Middleware de vérification de clé serveur ===
function checkServerKey(req, res, next) {
  if (!BASE44_API_KEY) {
    return res.status(500).json({
      error: 'Configuration serveur incomplète',
      detail: 'BASE44_API_KEY manquant côté serveur. Ajoutez BASE44_API_KEY dans Railway (pas VITE_BASE44_API_KEY).'
    });
  }
  next();
}

// === Routes ===

/**
 * GET /api/base44-agents
 * Retourne le registre complet des agents (sans exposer la clé API)
 */
router.get('/', checkServerKey, (req, res) => {
  res.json({
    agents: AGENT_REGISTRY.map(a => ({
      key: a.key,
      name: a.name,
      provider: a.provider,
      provider_agent_id: a.provider_agent_id,
      role: a.label || a.role,
      domains: a.domains,
      capabilities: a.capabilities,
      status: a.status,
      status_detail: a.status_detail || null,
      last_check: new Date().toISOString()
    })),
    total: AGENT_REGISTRY.length,
    active: AGENT_REGISTRY.filter(a => a.status === 'active').length
  });
});

/**
 * GET /api/base44-agents/registry/routing-map
 * Retourne la map de routage domaine → agent pour le Companion orchestrator
 */
router.get('/registry/routing-map', checkServerKey, (req, res) => {
  const routing = {};
  for (const agent of AGENT_REGISTRY) {
    if (agent.status !== 'active') continue;
    for (const domain of agent.domains) {
      routing[domain] = {
        agent_key: agent.key,
        agent_name: agent.name,
        provider_agent_id: agent.provider_agent_id,
        capabilities: agent.capabilities
      };
    }
  }
  res.json({ routing, generated_at: new Date().toISOString() });
});

/**
 * GET /api/base44-agents/:agentId/status
 * Vérifie le statut réel d'un agent en tentant de créer une conversation test
 */
router.get('/:agentId/status', checkServerKey, async (req, res) => {
  const { agentId } = req.params;
  const agent = AGENT_REGISTRY.find(a => a.provider_agent_id === agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agent non trouvé dans le registre' });
  }

  try {
    const resp = await fetch(`${BASE44_API_URL}/${agentId}/conversations`, {
      method: 'POST',
      headers: { 'api_key': BASE44_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (resp.ok) {
      const data = await resp.json();
      res.json({
        agent_id: agentId,
        name: agent.name,
        status: 'operational',
        conversation_test_id: data.id || null,
        checked_at: new Date().toISOString()
      });
    } else if (resp.status === 404) {
      res.json({
        agent_id: agentId,
        name: agent.name,
        status: 'not_found',
        detail: 'Agent non trouvé sur Base44',
        checked_at: new Date().toISOString()
      });
    } else {
      res.json({
        agent_id: agentId,
        name: agent.name,
        status: 'error',
        http_code: resp.status,
        checked_at: new Date().toISOString()
      });
    }
  } catch (err) {
    res.status(502).json({
      agent_id: agentId,
      name: agent.name,
      status: 'unreachable',
      error: err.message,
      checked_at: new Date().toISOString()
    });
  }
});

/**
 * POST /api/base44-agents/:agentId/conversations
 * Crée ou récupère une conversation avec l'agent spécifié
 */
router.post('/:agentId/conversations', checkServerKey, async (req, res) => {
  const { agentId } = req.params;
  const agent = AGENT_REGISTRY.find(a => a.provider_agent_id === agentId);
  if (!agent) return res.status(404).json({ error: 'Agent non autorisé dans le registre' });
  if (agent.status !== 'active') return res.status(403).json({ error: `Agent ${agent.name} n'est pas actif`, detail: agent.status_detail });

  try {
    const resp = await fetch(`${BASE44_API_URL}/${agentId}/conversations`, {
      method: 'POST',
      headers: { 'api_key': BASE44_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (resp.ok) {
      res.json(await resp.json());
    } else {
      const errorText = await resp.text();
      res.status(resp.status).json({ error: 'Erreur Base44', status: resp.status, detail: errorText.substring(0, 500) });
    }
  } catch (err) {
    res.status(502).json({ error: 'Base44 injoignable', detail: err.message });
  }
});

/**
 * GET /api/base44-agents/:agentId/conversations
 * Liste les conversations d'un agent
 */
router.get('/:agentId/conversations', checkServerKey, async (req, res) => {
  const { agentId } = req.params;
  const agent = AGENT_REGISTRY.find(a => a.provider_agent_id === agentId);
  if (!agent) return res.status(404).json({ error: 'Agent non autorisé dans le registre' });

  try {
    const resp = await fetch(`${BASE44_API_URL}/${agentId}/conversations`, {
      method: 'GET',
      headers: { 'api_key': BASE44_API_KEY }
    });

    if (resp.ok) {
      res.json(await resp.json());
    } else {
      const errorText = await resp.text();
      res.status(resp.status).json({ error: 'Erreur Base44', status: resp.status, detail: errorText.substring(0, 500) });
    }
  } catch (err) {
    res.status(502).json({ error: 'Base44 injoignable', detail: err.message });
  }
});

/**
 * POST /api/base44-agents/:agentId/conversations/:convId/messages
 * Envoie un message à un agent via une conversation existante
 * Body: { content: "message text" }
 */
router.post('/:agentId/conversations/:convId/messages', checkServerKey, async (req, res) => {
  const { agentId, convId } = req.params;
  const { content } = req.body;

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Le champ "content" est requis' });
  }

  const agent = AGENT_REGISTRY.find(a => a.provider_agent_id === agentId);
  if (!agent) return res.status(404).json({ error: 'Agent non autorisé dans le registre' });
  if (agent.status !== 'active') return res.status(403).json({ error: `Agent ${agent.name} n'est pas actif` });

  try {
    const resp = await fetch(`${BASE44_API_URL}/${agentId}/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'api_key': BASE44_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });

    if (resp.ok) {
      res.json(await resp.json());
    } else {
      const errorText = await resp.text();
      res.status(resp.status).json({ error: 'Erreur Base44', status: resp.status, detail: errorText.substring(0, 500) });
    }
  } catch (err) {
    res.status(502).json({ error: 'Base44 injoignable', detail: err.message });
  }
});

module.exports = { router, AGENT_REGISTRY };
