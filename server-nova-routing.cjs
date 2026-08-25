const INTERNAL_CLIENT_KEY = 'internal:jsinnovia';
const INTERNAL_PROJECT_KEY = 'internal:cockpit-nova';

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function safeKey(value) {
  const key = String(value || '').trim();
  return /^[a-zA-Z0-9:_-]{1,120}$/.test(key) ? key : null;
}

function evaluateNovaRequest(message) {
  const text = normalize(message);
  const complexSignals = [
    /architecture|refactor|debug|corrig|implemente|deploie|securis|migration/,
    /plusieurs? (?:agent|api|fournisseur|modele)/,
    /cout.*(?:client|projet|factur)|factur.*(?:llm|ia|api)/,
    /dns|tls|railway|github|base44|supabase/,
  ];
  const balancedSignals = [
    /analyse|compare|audit|diagnostic|projet|client|facture|workflow/,
    /resume|regroupe|classe|prioris/,
  ];
  const confidentialSignals = /client|facture|devis|tva|bce|donnee|contrat|email|telephone|adresse|cle api|secret|token/;
  const localSignals = /(?:mode|agent|ia|outil) local|hors connexion|sans internet|comfyui|ffmpeg|ffprobe|workflow local|dossier local|fichier local|windows/;

  const complex = text.length > 900 || complexSignals.some((pattern) => pattern.test(text));
  const balanced = !complex && (text.length > 240 || balancedSignals.some((pattern) => pattern.test(text)));

  return {
    complexity: complex ? 'complex' : balanced ? 'balanced' : 'simple',
    confidentiality: confidentialSignals.test(text) ? 'high' : 'standard',
    preferred_execution: localSignals.test(text) ? 'local_tools_then_cloud' : 'cloud_orchestrator',
    estimated_cost_usd: complex ? 0.75 : balanced ? 0.25 : 0.02,
  };
}

function resolveCostAttribution({ body = {}, audience = {}, user = {} } = {}) {
  const requestedClient = safeKey(body.client_id || body.client_key);
  const requestedProject = safeKey(body.project_id || body.project_key);
  const clientAudience = safeKey(audience.client_id);
  const ownerOrStaff = audience.mode === 'owner' || audience.mode === 'staff';

  const clientKey = clientAudience || requestedClient || (ownerOrStaff ? INTERNAL_CLIENT_KEY : null);
  const projectKey = requestedProject || (ownerOrStaff && !requestedClient ? INTERNAL_PROJECT_KEY : null);

  return {
    client_key: clientKey,
    client_name: clientAudience
      ? (audience.client_name || user.organisation || 'Client Cockpit')
      : requestedClient
        ? String(body.client_name || requestedClient).slice(0, 180)
        : ownerOrStaff ? 'JS-Innov.IA — interne' : null,
    project_key: projectKey,
    project_name: requestedProject
      ? String(body.project_name || requestedProject).slice(0, 180)
      : projectKey === INTERNAL_PROJECT_KEY ? 'Cockpit NOVA — interne' : null,
    attribution_source: clientAudience
      ? 'authenticated_client'
      : requestedClient || requestedProject ? 'explicit_request' : ownerOrStaff ? 'internal_default' : 'unresolved',
  };
}

function buildRoutingContext(decision, attribution, budget = {}) {
  const budgetState = budget.allowed === false
    ? `bloqué (${budget.reason || 'limite budgétaire'})`
    : budget.allowed === true ? 'autorisé' : 'contrôle indisponible, journalisation obligatoire';
  return [
    '[DÉCISION DE ROUTAGE NOVA — calculée par le Cockpit]',
    `Complexité: ${decision.complexity}. Confidentialité: ${decision.confidentiality}. Exécution préférée: ${decision.preferred_execution}.`,
    `Coût plafond estimatif avant exécution: ${decision.estimated_cost_usd.toFixed(2)} USD. Contrôle budget: ${budgetState}.`,
    `Attribution obligatoire: client=${attribution.client_key || 'non résolu'}; projet=${attribution.project_key || 'non résolu'}; source=${attribution.attribution_source}.`,
    budget.recommended_model && `Modèle recommandé par la politique active: ${budget.recommended_model}.`,
    'Consigne: applique cette décision avec les outils réellement disponibles. Ne transforme pas ce flux en questionnaire générique.',
    'Utilise les valeurs internes par défaut fournies pour un travail JS-Innov.IA. Ne demande au propriétaire que la donnée précise qui empêcherait réellement une action ciblée.',
    'Distingue toujours estimation avant appel et coût réel mesuré après appel.',
    '[/DÉCISION DE ROUTAGE NOVA]',
  ].filter(Boolean).join('\n');
}

module.exports = {
  INTERNAL_CLIENT_KEY,
  INTERNAL_PROJECT_KEY,
  evaluateNovaRequest,
  resolveCostAttribution,
  buildRoutingContext,
};
