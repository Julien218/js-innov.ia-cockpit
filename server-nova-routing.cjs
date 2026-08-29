const { LED_AD_DIRECTOR_PROMPT, isLedAdvertisingRequest } = require('./server-led-ad-director.cjs');

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

function inferMissionDomains(message) {
  const text = normalize(message);
  const domains = [];
  const rules = [
    ['web', /(site|page web|landing|frontend|html|css|react|next|vite|ux|ui|responsive)/],
    ['seo', /(seo|referencement|référencement|meta|canonical|sitemap|robots|schema\.org|core web vitals)/],
    ['dns', /(dns|domaine|domain|cname|txt|mx|aaaa|tls|ssl|https)/],
    ['github', /(github|repo|repository|branche|branch|commit|pull request|\bpr\b)/],
    ['railway', /(railway|deploi|déploi|deploy|logs production|staging)/],
    ['mobile', /(mobile|android|ios|iphone|react native|expo|apk|aab)/],
    ['desktop', /(electron|application desktop|windows app|desktop app)/],
    ['video', /(video|vidéo|minimax|h3|comfyui|ffmpeg|montage|ecran geant|écran géant)/],
    ['creative', /(branding|design|creative|créatif|créative|storyboard|identite visuelle|identité visuelle|mascotte|mascottes|avatar|personnage|personnages|character|illustration)/],
    ['crm', /(crm|client|prospect|lead|bce|tva|societe|société|asbl)/],
    ['billing', /(facture|facturation|devis|stripe|paiement|marge|cout|coût|finops)/],
    ['email', /(email|mail|newsletter|relance|communication client)/],
    ['automation', /(automation|automatisation|workflow|n8n|make|tache automatique|tâche automatique)/],
    ['local', /(windows|outil local|agent local|ia locale|ollama|comfyui|ffmpeg|fichier local|dossier local)/],
  ];
  for (const [domain, pattern] of rules) if (pattern.test(text)) domains.push(domain);
  return [...new Set(domains)];
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
  const missionDomains = inferMissionDomains(message);
  const liveOperatorDomains = new Set(['web', 'seo', 'mobile', 'desktop']);
  const ledAdvertising = isLedAdvertisingRequest(message);

  const complex = text.length > 900 || complexSignals.some((pattern) => pattern.test(text)) || missionDomains.length >= 3;
  const balanced = !complex && (text.length > 240 || balancedSignals.some((pattern) => pattern.test(text)));

  return {
    complexity: complex ? 'complex' : balanced ? 'balanced' : 'simple',
    confidentiality: confidentialSignals.test(text) ? 'high' : 'standard',
    preferred_execution: localSignals.test(text) ? 'local_tools_then_cloud' : 'cloud_orchestrator',
    estimated_cost_usd: complex ? 0.75 : balanced ? 0.25 : 0.02,
    mission_domains: missionDomains,
    execution_policy: 'execute_or_delegate_until_done',
    supervision_required: true,
    evidence_required: true,
    requires_live_operator: missionDomains.some((domain) => liveOperatorDomains.has(domain)),
    confirmation_policy: 'single_grouped_confirmation_for_sensitive_actions_only',
    specialist_agent: ledAdvertising ? 'led-ad-director' : null,
    specialist_directives: ledAdvertising ? LED_AD_DIRECTOR_PROMPT : null,
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
  const specialistContext = decision.specialist_agent === 'led-ad-director'
    ? [
      '[DÉLÉGATION SPÉCIALISTE — led-ad-director]',
      'Cette mission relève du sous-agent NOVA Directeur Artistique LED. Applique ses directives à la lettre sous supervision NOVA.',
      'Avant toute génération: analyse les données et médias disponibles, ne demande que les informations essentielles réellement manquantes, puis présente un scénario 0–2 s / 2–5 s / 5–8 s avec les textes et coordonnées exacts.',
      'Une seule validation groupée doit couvrir le scénario, les textes et les coordonnées. Après cette validation seulement, propose create_video_generation. La confirmation Cockpit de cette action vaut validation créative groupée; ne demande pas une série de confirmations supplémentaires.',
      'Une tâche automatique ou un batch ne peut jamais servir à contourner cette validation.',
      decision.specialist_directives,
      '[/DÉLÉGATION SPÉCIALISTE — led-ad-director]',
    ].join('\n')
    : null;
  const seoContext = decision.mission_domains?.includes('seo')
    ? [
      '[SEO — EXÉCUTION AUTONOME]',
      'Pour un audit SEO d’un domaine déjà fourni, commence immédiatement par le diagnostic technique réellement disponible: HTML, title, meta description, canonical, H1, robots, sitemap, données structurées, HTTPS et performances.',
      'Les URLs concurrentes sont facultatives. Ne les demande que si l’utilisateur sollicite explicitement une comparaison concurrentielle, un benchmark ou une analyse de concurrents.',
      'Ne bloque jamais un audit SEO standard pour obtenir des concurrents. Réutilise le domaine clairement fourni dans la conversation ou le domaine géré résolu par le Cockpit.',
      '[/SEO — EXÉCUTION AUTONOME]',
    ].join('\n')
    : null;
  const creativeClientContext = decision.mission_domains?.includes('creative') && decision.mission_domains?.includes('crm')
    ? [
      '[CONTEXTE CRÉATIF + CLIENT]',
      'Quand un nom de société ou d’ASBL est suivi d’un objet créatif tel que Mascottes, avatar, personnage, illustration ou identité visuelle, traite la société comme contexte client/marque et l’objet créatif comme mission principale.',
      'Ne remplace pas cette mission créative par un simple résumé de la fiche légale de l’entreprise, sauf si l’utilisateur demande explicitement des données légales ou administratives.',
      '[/CONTEXTE CRÉATIF + CLIENT]',
    ].join('\n')
    : null;
  return [
    '[DÉCISION DE ROUTAGE NOVA — calculée par le Cockpit]',
    `Complexité: ${decision.complexity}. Confidentialité: ${decision.confidentiality}. Exécution préférée: ${decision.preferred_execution}.`,
    `Domaines mission: ${(decision.mission_domains || []).join(', ') || 'général'}. Politique: ${decision.execution_policy || 'execute_or_delegate_until_done'}.`,
    `Supervision NOVA: ${decision.supervision_required ? 'obligatoire' : 'standard'}. Preuves: ${decision.evidence_required ? 'obligatoires' : 'standard'}. Live Operator: ${decision.requires_live_operator ? 'requis' : 'non requis'}.`,
    `Confirmations: ${decision.confirmation_policy || 'single_grouped_confirmation_for_sensitive_actions_only'}.`,
    decision.specialist_agent && `Spécialiste imposé: ${decision.specialist_agent}.`,
    `Coût plafond estimatif avant exécution: ${decision.estimated_cost_usd.toFixed(2)} USD. Contrôle budget: ${budgetState}.`,
    `Attribution obligatoire: client=${attribution.client_key || 'non résolu'}; projet=${attribution.project_key || 'non résolu'}; source=${attribution.attribution_source}.`,
    budget.recommended_model && `Modèle recommandé par la politique active: ${budget.recommended_model}.`,
    'Consigne centrale: NOVA reste responsable du résultat final. Elle exécute elle-même ce qui relève de ses outils réels et délègue le reste au spécialiste le plus adapté.',
    'Une délégation n’est jamais une fin de mission: NOVA récupère le résultat, vérifie les preuves, corrige ou redélègue si nécessaire, puis clôture seulement quand le résultat est réellement vérifié.',
    'Ne demande pas une succession de confirmations. Regroupe en une seule validation les actions sensibles ou irréversibles; analyses, code, tests, prévisualisations et corrections réversibles restent autonomes dans la mission autorisée.',
    'Pour les travaux web/mobile/desktop, ouvre ou demande le Live Operator afin que le rendu réellement exécuté puisse être contrôlé visuellement avant clôture.',
    'Consigne: applique cette décision avec les outils réellement disponibles. Ne transforme pas ce flux en questionnaire générique.',
    'Utilise les valeurs internes par défaut fournies pour un travail JS-Innov.IA. Ne demande au propriétaire que la donnée précise qui empêcherait réellement une action ciblée.',
    'Distingue toujours estimation avant appel et coût réel mesuré après appel.',
    seoContext,
    creativeClientContext,
    specialistContext,
    '[/DÉCISION DE ROUTAGE NOVA]',
  ].filter(Boolean).join('\n');
}

module.exports = {
  INTERNAL_CLIENT_KEY,
  INTERNAL_PROJECT_KEY,
  inferMissionDomains,
  evaluateNovaRequest,
  resolveCostAttribution,
  buildRoutingContext,
};