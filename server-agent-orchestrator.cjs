const { ELYNEA_AGENT, SKILL_REGISTRY } = require('./server-agent-registry.cjs');

const JS_AGENT_URL = String(process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app').replace(/\/$/, '');
const JS_AGENT_KEY = String(process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '').trim();
const MAX_SKILLS = Math.max(1, Math.min(4, Number(process.env.COMPANION_MAX_SPECIALISTS || 2)));

/*
 * Compatibilité : ce nom d'export est conservé pour les anciens consommateurs,
 * mais il contient désormais des compétences et non des agents IA distincts.
 */
const SITE_AGENT_KEYS = new Set(['jsinnov-agent', 'assurances-dour', 'synergie-dour', 'site-olivier', 'dourconnect', 'villeconnect', 'fashionistart', 'miss-mister-dour', 'generatvideopro']);
const SITE_AGENT_REGISTRY = Object.freeze(SKILL_REGISTRY.filter((skill) => skill.status === 'active' && SITE_AGENT_KEYS.has(skill.key)));

function norm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function scoreSkill(skill, message) {
  const text = norm(message);
  if (!text) return 0;
  let score = 0;
  for (const domain of skill.domains || []) {
    if (text.includes(norm(domain))) score += 100;
  }
  for (const alias of skill.aliases || []) {
    if (text.includes(norm(alias))) score += 30;
  }
  for (const capability of skill.capabilities || []) {
    if (text.includes(norm(capability))) score += 7;
  }
  return score;
}

/**
 * Retourne le plan historique `{ agent, score }` pour compatibilité, mais
 * `agent` est en réalité une compétence d'Elynea.
 */
function resolveAgentPlan(message, limit = MAX_SKILLS) {
  const text = norm(message);
  const mentionedDomains = [...new Set(
    SITE_AGENT_REGISTRY
      .flatMap((skill) => skill.domains || [])
      .filter((domain) => text.includes(norm(domain))),
  )];
  const specificDomains = mentionedDomains.filter(
    (domain) => !mentionedDomains.some((other) => other !== domain && norm(other).endsWith(`.${norm(domain)}`)),
  );

  const domainMatches = SITE_AGENT_REGISTRY
    .map((skill) => ({ agent: skill, score: scoreSkill(skill, message) }))
    .filter((item) => item.score > 0 && (!specificDomains.length || (item.agent.domains || []).some((domain) => specificDomains.includes(domain))));

  const genericMatches = SKILL_REGISTRY
    .filter((skill) => skill.status === 'active')
    .map((skill) => ({ agent: skill, score: scoreSkill(skill, message) }))
    .filter((item) => item.score > 0);

  const source = domainMatches.length ? domainMatches : genericMatches;
  const deduped = [];
  const seen = new Set();
  for (const item of source.sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name))) {
    if (seen.has(item.agent.key)) continue;
    seen.add(item.agent.key);
    deduped.push(item);
    if (deduped.length >= Math.max(1, Math.min(4, Number(limit) || MAX_SKILLS))) break;
  }
  return deduped;
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

/**
 * Ancien nom conservé pour compatibilité. Cette fonction crée une compétence
 * temporaire, jamais un second agent.
 */
function buildVirtualAgent(message, preferred = null) {
  const role = preferred?.role || inferVirtualRole(message);
  return {
    key: preferred?.key || `virtual:${role}`,
    name: preferred?.name || `Compétence automatique · ${role}`,
    label: preferred?.label || `Compétence automatique ${role}`,
    kind: 'skill',
    role,
    domains: preferred?.domains || [],
    aliases: preferred?.aliases || [],
    capabilities: preferred?.capabilities || [],
    system_prompt: preferred?.system_prompt || '',
    assistant_key: ELYNEA_AGENT.key,
    virtual: !preferred,
    status: 'active',
  };
}

function shouldAutoDelegate(message) {
  return /(analyse|audit|diagnosti|verifi|vérifi|travaille|continue|avance|corrige|optimis|prepare|prépare|planifie|finalise|teste|test|projet|site|video|vidéo|campagne|publication|architecture|code|bug|dns|tls|https|seo|domaine|domain|hébergement|hebergement)/i.test(String(message || ''));
}

function buildAgentRoutingContext(message) {
  const plan = resolveAgentPlan(message);
  const lines = [
    '[ROUTAGE COMPÉTENCES ELYNEA — lecture seule]',
    `Agent IA unique: ${ELYNEA_AGENT.name}.`,
    `Provider jsinnovia-agent configuré: ${JS_AGENT_KEY ? 'oui' : 'non'}.`,
    'Politique: aucune délégation vers une autre personnalité IA. Elynea active seulement les compétences nécessaires.',
    'Base44 est retiré du chemin actif. Les anciennes clés servent uniquement d’alias de compatibilité.',
  ];
  if (!plan.length) {
    const skill = buildVirtualAgent(message);
    lines.push(`Compétence automatique prévue: ${skill.label} | rôle=${skill.role}.`);
  } else {
    for (const { agent: skill, score } of plan) {
      lines.push(`- compétence=${skill.name} | rôle=${skill.role} | clé_historique=${skill.key} | score=${score}`);
    }
  }
  lines.push('[/ROUTAGE COMPÉTENCES ELYNEA]');
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

function skillPrompt(skills, message) {
  const selected = (skills || []).filter(Boolean);
  const descriptions = selected.map((skill) => [
    `Compétence: ${skill.name}`,
    `Rôle: ${skill.role}`,
    `Domaines: ${(skill.domains || []).join(', ') || 'interne JS-Innov.IA'}`,
    skill.system_prompt ? `Directives spécifiques:\n${skill.system_prompt}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  return [
    'Tu es Elynea, l’unique agent IA de JS-Innov.IA.',
    'Tu ne changes jamais d’identité et tu ne prétends jamais déléguer à un autre agent.',
    'Tu peux activer des compétences internes spécialisées selon le besoin.',
    descriptions,
    'Mission: interroger réellement les données et capacités accessibles en lecture seule puis produire un rapport exploitable.',
    'Ne publie rien, n’envoie rien, ne supprime rien, ne modifie aucune donnée et ne déclenche aucun déploiement dans ce run.',
    'N’affirme jamais qu’une vérification est impossible avant d’avoir contrôlé les capacités réellement disponibles.',
    'Pour tout diagnostic présenté comme exécuté, fournis: outil ou commande utilisé, heure, cible, sortie brute et identifiant de journal/tool_run.',
    'Si une preuve manque, écris explicitement « diagnostic non exécuté ou non prouvé » et ne conclus pas sur l’état de la cible.',
    '',
    `Demande: ${String(message || '').slice(0, 3500)}`,
  ].filter(Boolean).join('\n');
}

function hasOperationalEvidence(content) {
  const text = String(content || '');
  const hasTool = /(outil|commande)\s+(réellement\s+)?(utilisé|utilisee|utilisée|exécuté|executee|exécutée)\s*:/i.test(text);
  const hasRawOutput = /(sortie|résultat|resultat)\s+brut(e)?\s*:/i.test(text);
  const hasRunId = /(identifiant\s+(du\s+)?(journal|tool[_ -]?run)|journal|tool[_ -]?run)\s*:\s*(?!https?:\/\/)[a-z0-9][a-z0-9._:-]{5,}/i.test(text);
  const hasTime = /(heure|date)\s+(d['’]exécution|execution|du contrôle|du controle)?\s*:/i.test(text);
  return hasTool && hasRawOutput && hasRunId && hasTime;
}

async function delegateElyneaReadOnly(skills, message) {
  const selectedSkills = (skills || []).filter(Boolean).slice(0, MAX_SKILLS);
  if (!JS_AGENT_KEY) {
    return { ok: false, skipped: true, reason: 'jsinnovia_agent_key_missing', agent: ELYNEA_AGENT, skills: selectedSkills };
  }
  const sessionId = `elynea:skills:${Date.now()}`;
  const data = await fetchJson(`${JS_AGENT_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': JS_AGENT_KEY,
    },
    body: JSON.stringify({
      message: skillPrompt(selectedSkills, message),
      session_id: sessionId,
      assistant_mode: 'owner',
      available_actions: [],
      user_context: {
        role: 'superadmin',
        organisation: 'jsinnovia',
        full_name: 'Elynea',
      },
      server_context: [
        'Architecture single-agent: Elynea est la seule identité IA.',
        `Compétences actives: ${selectedSkills.map((skill) => skill.key).join(', ') || 'générale'}.`,
        'Aucun effet métier réel n’est autorisé dans ce run de consultation.',
      ].join('\n'),
    }),
  }, 60000);
  const content = String(data?.response || data?.message || '').trim();
  return {
    ok: Boolean(content),
    skipped: false,
    provider: 'jsinnovia-agent',
    agent: ELYNEA_AGENT,
    skills: selectedSkills,
    session_id: sessionId,
    content: content.slice(0, 8000),
  };
}

// Compatibilité API historique : ces deux fonctions ne créent plus de nouvel agent.
async function delegateVirtualReadOnly(agent, message) {
  return delegateElyneaReadOnly([buildVirtualAgent(message, agent)], message);
}

async function delegateSpecialistReadOnly(agent, message) {
  return delegateElyneaReadOnly([buildVirtualAgent(message, agent)], message);
}

async function runReadOnlyDelegations(message) {
  if (!shouldAutoDelegate(message)) return [];
  const plan = resolveAgentPlan(message);
  const skills = plan.length ? plan.map((item) => item.agent) : [buildVirtualAgent(message)];
  try {
    // Une seule exécution IA : Elynea reçoit toutes les compétences pertinentes.
    return [await delegateElyneaReadOnly(skills, message)];
  } catch (error) {
    return [{ ok: false, skipped: false, agent: ELYNEA_AGENT, skills, error: String(error.message || error).slice(0, 500) }];
  }
}

function buildDelegationContext(results = []) {
  if (!Array.isArray(results) || !results.length) return '';
  const lines = ['[RÉSULTAT ELYNEA — consultation interne en lecture seule]'];
  for (const item of results) {
    const skills = (item.skills || []).map((skill) => skill.name).join(', ') || 'générale';
    if (item.ok) {
      const runId = item.conversation_id || item.session_id || 'non fourni';
      const evidence = hasOperationalEvidence(item.content) ? 'présente' : 'non fournie';
      lines.push(`- Elynea | compétences=${skills} | consultation=${runId} | preuve_diagnostic=${evidence} :`);
      lines.push(String(item.content || '').slice(0, 8000));
    } else if (item.skipped) {
      lines.push(`- Elynea | compétences=${skills}: non exécuté (${item.reason || 'indisponible'}).`);
    } else {
      lines.push(`- Elynea | compétences=${skills}: erreur (${item.error || 'erreur inconnue'}).`);
    }
  }
  lines.push('L’identifiant de consultation prouve uniquement que la consultation Elynea a eu lieu; il ne prouve pas qu’un diagnostic décrit a été exécuté.');
  lines.push('Quand preuve_diagnostic=non fournie, annoncer « rapport non vérifié » et ne marquer aucune tâche terminée.');
  lines.push('[/RÉSULTAT ELYNEA]');
  return lines.join('\n');
}

module.exports = {
  ELYNEA_AGENT,
  SKILL_REGISTRY,
  SITE_AGENT_REGISTRY,
  resolveAgentPlan,
  inferVirtualRole,
  buildVirtualAgent,
  shouldAutoDelegate,
  buildAgentRoutingContext,
  delegateElyneaReadOnly,
  delegateVirtualReadOnly,
  delegateSpecialistReadOnly,
  runReadOnlyDelegations,
  hasOperationalEvidence,
  buildDelegationContext,
};
