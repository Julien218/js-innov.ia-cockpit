const crypto = require('node:crypto');

const { AGENT_REGISTRY } = require('./server-agent-registry.cjs');
const { lookupBce } = require('./server-bce.cjs');
const {
  analyzeDomain,
  agentForDomain,
  executeBase44Agent,
  verifiedImprovement,
} = require('./server-domain-ops.cjs');
const { hasOperationalEvidence } = require('./server-agent-orchestrator.cjs');

const BASE44_API_URL = String(process.env.BASE44_AGENT_URL || 'https://app.base44.com/api/agents').replace(/\/$/, '');
const BASE44_API_KEY = String(process.env.BASE44_API_KEY || process.env.BASE44_SERVER_API_KEY || '').trim();

// Base44 reste strictement réservé aux agents responsables d'un site précis.
// NOVA, Creative Director et GeneratVideoPro ne sont pas utilisés comme workers génériques.
const SITE_AGENT_KEYS = new Set([
  'jsinnov-agent',
  'assurances-dour',
  'synergie-dour',
  'site-olivier',
  'dourconnect',
  'villeconnect',
  'fashionistart',
  'miss-mister-dour',
  'generatvideopro',
]);

const INTERNAL_EXECUTORS = Object.freeze({
  local_windows: {
    id: 'nova-windows-local',
    name: 'NOVA Windows Local',
    provider: 'local-agent',
    role: 'windows_local_execution',
    execution_mode: 'autonomous',
  },
  business_data: {
    id: 'nova-business-data',
    name: 'NOVA Données Métier',
    provider: 'cockpit-server',
    role: 'business_data_execution',
    execution_mode: 'autonomous',
  },
});

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function normalized(value) {
  return clean(value, 8000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function taskText(task = {}) {
  return `${task.titre || task.title || ''}\n${task.description || ''}\n${task.notes || ''}`;
}

function isReadOnlySiteTask(task = {}, declaredReadOnly = false) {
  if (declaredReadOnly) return true;
  const text = normalized(taskText(task));
  const diagnostic = /(diagnost|analys|audit|control|verifi|mesur|etat)/.test(text);
  const mutation = /(reparation|corrig|modifi|appliqu|deploi|publi|mise a jour|mettre a jour)/.test(text);
  return diagnostic && !mutation;
}

function isBase44QuotaError(error) {
  return /(limit of messages|message limit|monthly limit|quota|usage limit|rate limit|upgrade to a paid plan)/i.test(String(error?.message || error || ''));
}

function siteAgents() {
  return AGENT_REGISTRY.filter((agent) => agent.status === 'active' && SITE_AGENT_KEYS.has(agent.key));
}

function siteExecutorForTask(task = {}) {
  const text = normalized(taskText(task));
  const candidates = siteAgents()
    .flatMap((agent) => (agent.domains || []).map((domain) => ({ agent, domain })))
    .sort((a, b) => b.domain.length - a.domain.length);
  const found = candidates.find(({ domain }) => text.includes(String(domain).toLowerCase()));
  if (!found) return null;
  return {
    kind: 'site',
    id: `base44-site:${found.agent.key}`,
    name: found.agent.name,
    provider: 'base44',
    provider_agent_id: found.agent.provider_agent_id,
    role: found.agent.role,
    execution_mode: 'autonomous',
    domain: found.domain,
  };
}

function resolveNovaExecutor(task = {}) {
  const site = siteExecutorForTask(task);
  if (site) return site;

  const text = normalized(taskText(task));
  if (/(comfyui|minimax|workflow|ffmpeg|ffprobe|video ia|module video|avatar.*local|documentation.*workflow)/.test(text)) {
    return { kind: 'local', ...INTERNAL_EXECUTORS.local_windows };
  }
  if (/(client|facture|tva|societe|asbl|rattachement|bce|banque carrefour)/.test(text)) {
    return { kind: 'business', ...INTERNAL_EXECUTORS.business_data };
  }
  return {
    kind: 'unsupported',
    id: 'nova-architect',
    name: 'NOVA Architecte',
    provider: 'cockpit-server',
    role: 'orchestration',
    execution_mode: 'prepare_only',
    reason: 'aucun_executeur_reel_enregistre_pour_ce_type_de_tache',
  };
}

async function jsonFetch(url, options = {}, timeoutMs = 120000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  return data;
}

async function dispatchGenericSiteTask(executor, task, readOnly) {
  if (!BASE44_API_KEY) throw new Error('BASE44_API_KEY serveur non configurée.');
  const official = siteAgents().find((agent) => agent.key === executor.id.split(':').pop());
  if (!official || official.provider_agent_id !== executor.provider_agent_id || !official.domains.includes(executor.domain)) {
    throw new Error('Agent Base44 refusé: il n’est pas le responsable enregistré de ce site.');
  }
  const headers = { api_key: BASE44_API_KEY, 'Content-Type': 'application/json' };
  const conversation = await jsonFetch(`${BASE44_API_URL}/${encodeURIComponent(official.provider_agent_id)}/conversations`, {
    method: 'POST', headers, body: JSON.stringify({}),
  }, 15000);
  if (!conversation?.id) throw new Error(`Conversation Base44 absente pour ${official.name}.`);
  const prompt = [
    `Tu es l’agent Base44 exclusivement responsable du site ${executor.domain}.`,
    `Ne consulte et ne modifie aucun autre domaine, site, client ou projet.`,
    readOnly
      ? 'Mission en lecture seule: exécute uniquement les contrôles réellement disponibles et fournis les preuves techniques.'
      : 'Cette action a reçu l’autorisation explicite de l’administrateur. Applique uniquement les modifications sûres que tes outils permettent réellement sur ce site.',
    'Ne simule jamais une réussite. Une recommandation ou une URL documentaire ne constitue pas une exécution.',
    `Tâche: ${clean(task.titre || task.title, 240)}`,
    task.description ? `Description: ${clean(task.description, 5000)}` : '',
    'Retour obligatoire: action ou outil réellement utilisé, heure, résultat brut, blocages et identifiant de journal non-URL.',
  ].filter(Boolean).join('\n');
  const answer = await jsonFetch(`${BASE44_API_URL}/${encodeURIComponent(official.provider_agent_id)}/conversations/${encodeURIComponent(conversation.id)}/messages`, {
    method: 'POST', headers, body: JSON.stringify({ role: 'user', content: prompt }),
  });
  const content = clean(answer?.content || answer?.message || answer?.response, 12000);
  if (!content) throw new Error(`L’agent ${official.name} n’a renvoyé aucun résultat.`);
  return { conversation_id: conversation.id, content, evidence: hasOperationalEvidence(content) };
}

async function executeSiteTask(executor, task, { readOnly = false, dispatch = dispatchGenericSiteTask, analyze = analyzeDomain } = {}) {
  const text = normalized(taskText(task));
  const effectiveReadOnly = isReadOnlySiteTask(task, readOnly);
  if (!effectiveReadOnly && /(reparation|corrig|seo automatique|tls|https|dns)/.test(text)) {
    const before = await analyze(executor.domain);
    const officialAgent = agentForDomain(executor.domain);
    if (!officialAgent || officialAgent.provider_agent_id !== executor.provider_agent_id) {
      throw new Error('Le domaine n’est pas relié à son agent Base44 officiel.');
    }
    const dispatched = await executeBase44Agent(officialAgent, executor.domain, /seo/.test(text) ? 'seo' : 'repair', before);
    const after = await analyze(executor.domain);
    const verified = verifiedImprovement(/seo/.test(text) ? 'seo' : 'repair', before, after);
    return {
      completed: verified,
      awaiting_review: !verified,
      provider: 'base44',
      conversation_id: dispatched.conversationId,
      report: clean(dispatched.content, 12000),
      result: { domain: executor.domain, verified, before, after },
      reason: verified ? null : 'intervention_agent_recue_mais_amelioration_non_mesuree',
    };
  }

  let dispatched;
  try {
    dispatched = await dispatch(executor, task, effectiveReadOnly);
  } catch (error) {
    if (!effectiveReadOnly || !isBase44QuotaError(error)) throw error;
    const probe = await analyze(executor.domain);
    return {
      completed: true,
      awaiting_review: false,
      provider: 'cockpit-server',
      conversation_id: null,
      report: JSON.stringify(probe),
      result: {
        ...probe,
        base44_fallback: {
          attempted: true,
          provider_agent_id: executor.provider_agent_id,
          status: 'quota_exhausted',
          error: clean(error.message, 800),
        },
      },
      reason: null,
    };
  }
  return {
    completed: effectiveReadOnly && dispatched.evidence,
    awaiting_review: !effectiveReadOnly || !dispatched.evidence,
    provider: 'base44',
    conversation_id: dispatched.conversation_id,
    report: dispatched.content,
    result: { domain: executor.domain, evidence_verified: dispatched.evidence },
    reason: dispatched.evidence ? null : 'rapport_agent_recu_sans_preuve_operationnelle_complete',
  };
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function missingLegalFields(client = {}) {
  return ['denomination_legale', 'numero_entreprise', 'numero_tva', 'adresse', 'code_postal', 'ville']
    .filter((field) => !clean(client[field], 500));
}

function clientName(client = {}) {
  return clean(client.denomination_legale || client.entreprise || client.nom || client.name, 240);
}

function bcePatch(client, record) {
  const allowed = ['denomination_legale', 'numero_entreprise', 'numero_tva', 'adresse', 'code_postal', 'ville', 'pays'];
  return Object.fromEntries(allowed
    .filter((field) => !clean(client[field], 500) && clean(record[field], 500))
    .map((field) => [field, record[field]]));
}

async function executeBusinessTask(task, agentRequest) {
  const text = normalized(taskText(task));
  const clients = rowsFrom(await agentRequest('/data/Client?limit=500'));

  if (/(analys|audit|verifi|control).*(facture|rattachement)|(facture|rattachement).*(analys|audit|verifi|control)/.test(text)) {
    const [invoices, projects] = await Promise.all([
      agentRequest('/data/Facture?limit=500').then(rowsFrom),
      agentRequest('/data/Projet?limit=500').then(rowsFrom),
    ]);
    const result = {
      audit_id: `business-${crypto.randomUUID()}`,
      checked_at: new Date().toISOString(),
      clients_count: clients.length,
      invoices_count: invoices.length,
      projects_count: projects.length,
      clients_missing_legal_data: clients.filter((client) => missingLegalFields(client).length).map((client) => client.id).filter(Boolean),
      invoices_without_client: invoices.filter((invoice) => !invoice.client_id && !invoice.client_nom).map((invoice) => invoice.id).filter(Boolean),
      projects_without_client: projects.filter((project) => !project.client_id && !project.client_nom).map((project) => project.id).filter(Boolean),
    };
    return { completed: true, provider: 'cockpit-server', result, report: JSON.stringify(result) };
  }

  const isSynergie = /synergie dour/.test(text);
  const targets = isSynergie
    ? clients.filter((client) => /synergie.*dour|dour.*synergie/.test(normalized(clientName(client))))
    : clients.filter((client) => missingLegalFields(client).length);
  if (isSynergie && targets.length !== 1) {
    throw new Error(`Mise à jour Synergie Dour impossible: ${targets.length} fiche(s) correspondante(s), une seule est requise.`);
  }
  if (!targets.length) {
    return { completed: true, provider: 'cockpit-server', result: { checked_at: new Date().toISOString(), updated: [], message: 'Aucune fiche incomplète détectée.' }, report: 'Aucune fiche client incomplète détectée.' };
  }

  const updated = [];
  const blocked = [];
  for (const client of targets.slice(0, 50)) {
    const enterpriseNumber = clean(client.numero_entreprise || client.numero_tva, 40);
    const name = clientName(client);
    const postalCode = clean(client.code_postal, 20);
    if (!enterpriseNumber && (!name || !postalCode)) {
      blocked.push({ client_id: client.id, reason: 'numero_entreprise_ou_nom_et_code_postal_manquants' });
      continue;
    }
    try {
      const record = await lookupBce({ enterprise_number: enterpriseNumber, name, postal_code: postalCode });
      const patch = bcePatch(client, record);
      if (Object.keys(patch).length) {
        await agentRequest(`/data/Client/${encodeURIComponent(client.id)}`, { method: 'PATCH', body: patch });
      }
      updated.push({ client_id: client.id, fields: Object.keys(patch), source: 'BCE officielle' });
    } catch (error) {
      blocked.push({ client_id: client.id, reason: clean(error.message, 400) });
    }
  }

  const result = { audit_id: `business-${crypto.randomUUID()}`, checked_at: new Date().toISOString(), source: 'BCE officielle', updated, blocked };
  return {
    completed: blocked.length === 0,
    awaiting_review: blocked.length > 0,
    provider: 'cockpit-server',
    result,
    report: JSON.stringify(result),
    reason: blocked.length ? 'certaines_fiches_ne_peuvent_pas_etre_verifiees_automatiquement' : null,
  };
}

module.exports = {
  INTERNAL_EXECUTORS,
  SITE_AGENT_KEYS,
  bcePatch,
  clientName,
  executeBusinessTask,
  executeSiteTask,
  isBase44QuotaError,
  isReadOnlySiteTask,
  missingLegalFields,
  resolveNovaExecutor,
  siteExecutorForTask,
};
