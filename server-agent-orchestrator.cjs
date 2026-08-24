const { AGENT_REGISTRY } = require('./server-agent-registry.cjs');

const BASE44_API_KEY = String(process.env.BASE44_API_KEY || process.env.BASE44_SERVER_API_KEY || '').trim();
const BASE44_AGENT_URL = String(process.env.BASE44_AGENT_URL || 'https://app.base44.com/api/agents').replace(/\/$/, '');
const JS_AGENT_URL = String(process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app').replace(/\/$/, '');
const JS_AGENT_KEY = String(process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '').trim();
const MAX_DELEGATES = Math.max(1, Math.min(3, Number(process.env.COMPANION_MAX_SPECIALISTS || 2)));

/* Le proxy UI et l'orchestrateur consomment exactement le même registre. */
const SITE_AGENT_REGISTRY = Object.freeze(AGENT_REGISTRY.filter((agent) => agent.status === 'active'));
/*
  {
    key: 'jsinnovia-core',
    name: 'JsInnov-Agent',
    provider: 'base44',
    provider_agent_id: '6a1845e17cc526d1e44965bc',
    role: 'architecture_devops',
    domains: ['jsinnovia.com', 'jsinnovia.store'],
    aliases: ['js-innov.ia', 'jsinnovia', 'cockpit', 'nova'],
    capabilities: ['architecture', 'code', 'devops', 'github', 'railway', 'cockpit', 'debug', 'securite', 'sécurité'],
  },
  {
    key: 'synergie-dour',
    name: 'Synergie Dour Assistant',
    provider: 'base44',
    provider_agent_id: '6a0208edd1e235b62b4bda38',
    role: 'site_synergie_dour',
    domains: ['synergiedour.be'],
    aliases: ['synergie dour', 'synergiedour', 'synergie asbl'],
    capabilities: ['membres', 'commercants', 'commerçants', 'evenements', 'événements', 'annuaire', 'communication', 'contenu'],
  },
  {
    key: 'olivier-trevis',
    name: 'Site Olivier landing Page',
    provider: 'base44',
    provider_agent_id: '6a0371a87c9257126b051d5a',
    role: 'site_olivier_trevis',
    domains: ['oliviertrevis.be', 'letourdedour.com'],
    aliases: ['olivier trevis', 'tour de dour', 'le tour de dour'],
    capabilities: ['site', 'landing', 'contenu', 'communication', 'evenement', 'événement'],
  },
  {
    key: 'fashionistart',
    name: 'Agent Fashionistart',
    provider: 'base44',
    provider_agent_id: '6a035427dca907aa03b71398',
    role: 'site_fashionistart',
    domains: ['fashionistartdour.be'],
    aliases: ["fashionist'art", 'fashionistart', 'fashionist art'],
    capabilities: ['mode', 'art', 'evenement', 'événement', 'publication', 'communication', 'site'],
  },
  {
    key: 'miss-mister-dour',
    name: 'Agent Miss & Mister Dour',
    provider: 'base44',
    provider_agent_id: '69e732e1d54abfd1783f5d06',
    role: 'site_pageant_dour',
    domains: ['missetmisterdour.be'],
    aliases: ['miss & mister dour', 'miss mister dour', 'missetmisterdour', 'dour pageant'],
    capabilities: ['candidature', 'vote', 'concours', 'evenement', 'événement', 'publication', 'site'],
  },
  {
    key: 'villeconnect',
    name: 'Dourconnect2',
    provider: 'base44',
    provider_agent_id: '6a22f0c096ce009a943f4a05',
    role: 'villeconnect_ops',
    domains: [],
    aliases: ['villeconnect', 'ville connect', 'dourconnect', 'dour connect'],
    capabilities: ['territoire', 'citoyens', 'commerces', 'ville', 'services', 'plateforme'],
  },
  {
    key: 'video-pro',
    name: 'Agent GeneratVideoPro',
    provider: 'base44',
    provider_agent_id: '69e467a9d6329bb2ead81fa3',
    role: 'video_production',
    domains: [],
    aliases: ['video studio', 'generateur video', 'générateur vidéo', 'minimax h3', 'h3', 'comfyui'],
    capabilities: ['video', 'vidéo', 'montage', 'prompt video', 'prompt vidéo', 'comfyui', 'minimax', 'h3', 'ffmpeg'],
  },
  {
    key: 'video-dour',
    name: 'Agentvideomasvotedour',
    provider: 'base44',
    provider_agent_id: '6a199bf9a8a9f3bf17256d73',
    role: 'video_dour_campaigns',
    domains: ['letourdedour.com', 'missetmisterdour.be'],
    aliases: ['mas vote dour', 'vote dour', 'video vote dour', 'vidéo vote dour'],
    capabilities: ['vote', 'mascotte', 'video', 'vidéo', 'campagne'],
  },
  {
    key: 'creative-director',
    name: 'Js-Innov.IA Creative Director',
    provider: 'base44',
    provider_agent_id: '69ed0a42be17008cf11027eb',
    role: 'creative_direction',
    domains: [],
    aliases: ['creative director', 'direction creative', 'direction créative'],
    capabilities: ['branding', 'identite', 'identité', 'visuel', 'campagne', 'storyboard', 'direction artistique', 'créatif', 'creatif'],
  },
]); */

function norm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function scoreAgent(agent, message) {
  const text = norm(message);
  if (!text) return 0;
  let score = 0;
  for (const domain of agent.domains || []) {
    if (text.includes(norm(domain))) score += 100;
  }
  for (const alias of agent.aliases || []) {
    if (text.includes(norm(alias))) score += 30;
  }
  for (const capability of agent.capabilities || []) {
    if (text.includes(norm(capability))) score += 7;
  }
  return score;
}

function resolveAgentPlan(message, limit = MAX_DELEGATES) {
  const scored = SITE_AGENT_REGISTRY
    .map((agent) => ({ agent, score: scoreAgent(agent, message) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));

  const picked = [];
  const seenRoles = new Set();
  for (const item of scored) {
    const roleFamily = item.agent.role.startsWith('site_') ? 'site' : item.agent.role;
    if (seenRoles.has(roleFamily)) continue;
    picked.push(item);
    seenRoles.add(roleFamily);
    if (picked.length >= Math.max(1, Math.min(3, Number(limit) || MAX_DELEGATES))) break;
  }
  return picked;
}

function inferVirtualRole(message) {
  const text = norm(message);
  if (/(video|montage|minimax|h3|comfyui|ffmpeg)/.test(text)) return 'video_engineer';
  if (/(site|seo|landing|frontend|mobile|responsive|ux|ui)/.test(text)) return 'web_product_engineer';
  if (/(marketing|campagne|social|facebook|instagram|publication|communication)/.test(text)) return 'marketing_ops';
  if (/(factur|cout|coût|finops|stripe|paiement|marge|devis)/.test(text)) return 'finops_billing';
  if (/(github|railway|deploy|code|bug|api|architecture|securite|sécurité)/.test(text)) return 'software_architect';
  if (/(assurance|sinistre|contrat|client assurance)/.test(text)) return 'insurance_ops';
  return 'project_delivery_manager';
}

function buildVirtualAgent(message, preferred = null) {
  const role = preferred?.role || inferVirtualRole(message);
  const label = preferred?.name ? `${preferred.name} — fallback Cockpit` : `Agent métier ${role}`;
  return {
    key: `virtual:${role}`,
    name: label,
    provider: 'jsinnovia-agent',
    provider_agent_id: null,
    role,
    virtual: true,
  };
}

function shouldAutoDelegate(message) {
  return /(analyse|audit|diagnosti|verifi|vérifi|travaille|continue|avance|corrige|optimis|prepare|prépare|planifie|finalise|teste|test|projet|site|video|vidéo|campagne|publication|architecture|code|bug|dns|tls|https|seo|domaine|domain|hébergement|hebergement)/i.test(String(message || ''));
}

function buildAgentRoutingContext(message) {
  const plan = resolveAgentPlan(message);
  const lines = [
    '[ROUTAGE AGENTS MÉTIER JS-INNOV.IA — lecture seule]',
    `Provider Base44 serveur configuré: ${BASE44_API_KEY ? 'oui' : 'non'}.`,
    `Provider jsinnovia-agent configuré: ${JS_AGENT_KEY ? 'oui' : 'non'}.`,
    'Politique: réutiliser un agent existant lié au site/projet avant de créer un nouvel agent métier.',
    'Un agent Base44 dédié au site garde la priorité. Si Base44 est indisponible, utiliser un agent métier virtuel avec le même rôle.',
  ];
  if (!plan.length) {
    const virtual = buildVirtualAgent(message);
    lines.push(`Aucun agent existant ne correspond clairement. Agent métier virtuel prévu: ${virtual.name} | rôle=${virtual.role}.`);
  } else {
    for (const { agent, score } of plan) {
      lines.push(`- ${agent.name} | rôle=${agent.role} | provider=${agent.provider} | id=${agent.provider_agent_id} | score=${score}`);
    }
  }
  lines.push('[/ROUTAGE AGENTS MÉTIER JS-INNOV.IA]');
  return { context: lines.join('\n'), plan };
}

async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function specialistPrompt(agent, message) {
  return [
    `Tu es ${agent.name}, agent métier délégué par le Companion JS-Innov.IA.`,
    `Rôle fonctionnel: ${agent.role}.`,
    'Mission: interroger réellement les données et capacités auxquelles ton backend a accès, en lecture seule, puis produire un rapport exploitable par l’architecte principal.',
    'Ne publie rien, n’envoie rien, ne supprime rien, ne modifie aucune donnée et ne déclenche aucun déploiement.',
    'N’affirme jamais qu’une vérification est impossible avant d’avoir contrôlé tes capacités réelles. Réponds avec: état observé, preuves ou identifiants disponibles, anomalies, travail restant, dépendances et prochaines tâches recommandées.',
    '',
    `Demande: ${String(message || '').slice(0, 3500)}`,
  ].join('\n');
}

async function delegateBase44ReadOnly(agent, message) {
  if (!BASE44_API_KEY) {
    return { ok: false, skipped: true, reason: 'base44_server_key_missing', agent };
  }
  if (!agent?.provider_agent_id) {
    return { ok: false, skipped: true, reason: 'agent_id_missing', agent };
  }

  const headers = { api_key: BASE44_API_KEY, 'Content-Type': 'application/json' };
  const conversation = await fetchJson(`${BASE44_AGENT_URL}/${encodeURIComponent(agent.provider_agent_id)}/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  if (!conversation?.id) throw new Error(`Base44 n'a pas retourné de conversation pour ${agent.name}.`);

  const answer = await fetchJson(`${BASE44_AGENT_URL}/${encodeURIComponent(agent.provider_agent_id)}/conversations/${encodeURIComponent(conversation.id)}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ role: 'user', content: specialistPrompt(agent, message) }),
  }, 60000);

  const content = String(answer?.content || answer?.message || answer?.response || '').trim();
  return {
    ok: Boolean(content),
    skipped: false,
    provider: 'base44',
    agent,
    conversation_id: conversation.id,
    content: content.slice(0, 8000),
  };
}

async function delegateVirtualReadOnly(agent, message) {
  if (!JS_AGENT_KEY) {
    return { ok: false, skipped: true, reason: 'jsinnovia_agent_key_missing', agent };
  }
  const sessionId = `delegated:${String(agent.role || 'specialist').replace(/[^a-zA-Z0-9_-]/g, '_')}:${Date.now()}`;
  const data = await fetchJson(`${JS_AGENT_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': JS_AGENT_KEY,
    },
    body: JSON.stringify({
      message: specialistPrompt(agent, message),
      session_id: sessionId,
      assistant_mode: 'owner',
      available_actions: [],
      user_context: {
        role: 'superadmin',
        organisation: 'jsinnovia',
        full_name: 'JS-Innov.IA Companion',
      },
      server_context: 'Délégation interne en lecture seule. Aucun effet métier réel n’est autorisé dans ce run.',
    }),
  }, 60000);
  const content = String(data?.response || data?.message || '').trim();
  return {
    ok: Boolean(content),
    skipped: false,
    provider: 'jsinnovia-agent',
    agent,
    session_id: sessionId,
    content: content.slice(0, 8000),
  };
}

async function delegateSpecialistReadOnly(agent, message) {
  if (agent?.provider === 'base44' && BASE44_API_KEY) {
    return delegateBase44ReadOnly(agent, message);
  }
  return delegateVirtualReadOnly(buildVirtualAgent(message, agent), message);
}

async function runReadOnlyDelegations(message) {
  if (!shouldAutoDelegate(message)) return [];
  const plan = resolveAgentPlan(message);
  const selectedAgents = plan.length ? plan.map((item) => item.agent) : [buildVirtualAgent(message)];
  const results = [];
  for (const agent of selectedAgents.slice(0, MAX_DELEGATES)) {
    try {
      results.push(await delegateSpecialistReadOnly(agent, message));
    } catch (error) {
      results.push({ ok: false, skipped: false, agent, error: String(error.message || error).slice(0, 500) });
    }
  }
  return results;
}

function buildDelegationContext(results = []) {
  if (!Array.isArray(results) || !results.length) return '';
  const lines = ['[RÉSULTATS AGENTS MÉTIER DÉLÉGUÉS — lecture seule]'];
  for (const item of results) {
    const name = item?.agent?.name || 'Agent métier';
    if (item.ok) {
      const runId = item.conversation_id || item.session_id || 'non fourni';
      lines.push(`- ${name} (${item.agent.role}) via ${item.provider || item.agent.provider} | exécution=${runId} :`);
      lines.push(String(item.content || '').slice(0, 8000));
    } else if (item.skipped) {
      lines.push(`- ${name}: non exécuté (${item.reason || 'indisponible'}).`);
    } else {
      lines.push(`- ${name}: erreur de délégation (${item.error || 'erreur inconnue'}).`);
    }
  }
  lines.push('Le Companion doit synthétiser ces rapports, arbitrer les contradictions et ne jamais les présenter comme des actions déjà exécutées.');
  lines.push('[/RÉSULTATS AGENTS MÉTIER DÉLÉGUÉS]');
  return lines.join('\n');
}

module.exports = {
  SITE_AGENT_REGISTRY,
  resolveAgentPlan,
  inferVirtualRole,
  buildVirtualAgent,
  shouldAutoDelegate,
  buildAgentRoutingContext,
  delegateBase44ReadOnly,
  delegateVirtualReadOnly,
  delegateSpecialistReadOnly,
  runReadOnlyDelegations,
  buildDelegationContext,
};
