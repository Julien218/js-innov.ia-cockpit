const SORA_SHUTDOWN_DATE = '2026-09-24';
const XAI_MODEL = 'grok-imagine-video-1.5';
const OPENAI_MODEL = 'sora-2';

function clean(value, max = 20_000) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanIdList(value, maxItems = 7) {
  const raw = Array.isArray(value) ? value : [];
  return [...new Set(raw.map((item) => clean(item, 180)).filter(Boolean))].slice(0, maxItems);
}


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCanonicalUuid(value) {
  return UUID_RE.test(clean(value, 180));
}

function clientReferenceKey(value) {
  return clean(value, 180)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function sameClientReference(left, right) {
  const a = clientReferenceKey(left);
  const b = clientReferenceKey(right);
  return Boolean(a && b) && (a === b || a.startsWith(`${b}_`) || b.startsWith(`${a}_`));
}

function isInternalClientReference(value) {
  return new Set([
    'client_jsinnovia',
    'client_js_innovia',
    'client_js_innov_ia',
    'jsinnovia',
    'js_innovia',
    'js_innov_ia',
    'interne_jsinnovia',
    'interne_js_innovia',
    'jsinnovia_interne',
    'js_innovia_interne',
  ]).has(clientReferenceKey(value));
}

function canonicalClientName(client = {}) {
  return clean(client.denomination_legale || client.entreprise || [client.prenom, client.nom].filter(Boolean).join(' ') || client.nom || client.name, 240);
}

function isInternalClientRecord(client = {}) {
  const references = [
    client.type_client,
    client.slug,
    client.key,
    client.code,
    client.client_key,
    client.external_id,
    client.denomination_legale,
    client.entreprise,
    client.nom,
    client.name,
  ];
  if (references.some((value) => isInternalClientReference(value))) return true;
  const text = references.map(clientReferenceKey).filter(Boolean).join(' ');
  return /(?:^|_)(?:interne|internal)(?:_|$)/.test(text)
    && /js_?innov(?:_?ia)?/.test(text);
}

function clientReferenceAliases(client = {}) {
  return [
    client.id,
    client.client_id,
    client.slug,
    client.key,
    client.code,
    client.client_key,
    client.external_id,
    client.type_client,
    canonicalClientName(client),
    client.nom,
    client.entreprise,
    client.denomination_legale,
    client.name,
  ].filter(Boolean);
}

function findCanonicalClient(clients = [], { clientId = '', clientName = '' } = {}) {
  const available = (Array.isArray(clients) ? clients : [])
    .filter((client) => client && isCanonicalUuid(client.id));
  const requestedId = clean(clientId, 180);
  const requestedName = clean(clientName, 240);
  const aliasMatches = (reference) => available.filter((client) =>
    clientReferenceAliases(client).some((alias) => sameClientReference(alias, reference))
  );

  if (requestedId) {
    const exact = available.find((client) => String(client.id) === requestedId);
    if (exact) return exact;
    const matches = aliasMatches(requestedId);
    if (matches.length === 1) return matches[0];
    if (isInternalClientReference(requestedId)) {
      const internal = available.filter(isInternalClientRecord);
      if (internal.length === 1) return internal[0];
    }
    return null;
  }

  if (!requestedName) return null;
  const matches = aliasMatches(requestedName);
  if (matches.length === 1) return matches[0];
  if (isInternalClientReference(requestedName)) {
    const internal = available.filter(isInternalClientRecord);
    if (internal.length === 1) return internal[0];
  }
  return null;
}

function providerAvailability(env = process.env, now = new Date()) {
  const soraExpired = now.toISOString().slice(0, 10) >= SORA_SHUTDOWN_DATE;
  return {
    xai: { available: Boolean(clean(env.XAI_API_KEY, 10_000)), model: XAI_MODEL, cost_source: 'actual_provider_usage' },
    openai: {
      available: Boolean(clean(env.OPENAI_API_KEY, 10_000)) && !soraExpired,
      configured: Boolean(clean(env.OPENAI_API_KEY, 10_000)),
      model: OPENAI_MODEL,
      deprecated: true,
      shutdown_date: SORA_SHUTDOWN_DATE,
      cost_source: 'estimated_official_rate',
    },
  };
}

function chooseProvider(requested = 'auto', env = process.env, now = new Date()) {
  const availability = providerAvailability(env, now);
  const wanted = String(requested || 'auto').toLowerCase();
  if (wanted === 'grok' || wanted === 'xai') {
    if (!availability.xai.available) throw new Error('Grok indisponible : XAI_API_KEY n’est pas configurée dans le coffre Railway.');
    return 'xai';
  }
  if (wanted === 'sora' || wanted === 'openai') {
    if (!availability.openai.available) {
      throw new Error(availability.openai.configured
        ? `Sora indisponible : son API a été arrêtée le ${SORA_SHUTDOWN_DATE}.`
        : 'Sora indisponible : OPENAI_API_KEY n’est pas configurée dans le coffre Railway.');
    }
    return 'openai';
  }
  if (availability.xai.available) return 'xai';
  if (availability.openai.available) return 'openai';
  throw new Error('Aucun générateur vidéo API n’est disponible. Configure XAI_API_KEY ou OPENAI_API_KEY dans Railway.');
}

function validateJobInput(input = {}) {
  const clientId = clean(input.client_id, 180);
  const clientName = clean(input.client_name, 180);
  const campaign = clean(input.campaign_name, 180);
  const prompt = clean(input.prompt);
  if (!clientId) throw new Error('Sélectionne un client Cockpit pour attribuer la dépense.');
  if (!clientName) throw new Error('Le nom du client est manquant.');
  if (!campaign) throw new Error('Le nom de campagne est obligatoire.');
  if (prompt.length < 20) throw new Error('Le prompt vidéo doit contenir au moins 20 caractères.');

  const sourceDocumentId = clean(input.source_document_id, 180) || null;
  const endSourceDocumentId = clean(input.end_source_document_id, 180) || null;
  const referenceDocumentIds = cleanIdList(input.reference_document_ids);
  const orderedReferenceDocumentIds = [...new Set([
    ...referenceDocumentIds,
    ...(sourceDocumentId ? [sourceDocumentId] : []),
    ...(endSourceDocumentId ? [endSourceDocumentId] : []),
  ])].slice(0, 7);

  return {
    clientId,
    clientName,
    projectId: clean(input.project_id, 180) || null,
    costCenterId: clean(input.cost_center_id, 180) || null,
    campaign,
    prompt,
    sector: clean(input.sector, 120) || 'innovation numérique',
    usageRights: clean(input.usage_rights, 1000) || 'Utilisation limitée à la campagne et aux supports validés par le client.',
    rightsConfirmed: input.rights_confirmed === true,
    version: clean(input.version, 20) || 'v01',
    sourceDocumentId,
    endSourceDocumentId,
    referenceDocumentIds: orderedReferenceDocumentIds,
  };
}

function resolveCostScope(input = {}, centers = []) {
  const clientId = clean(input.client_id, 180);
  if (!clientId) return input;
  const available = (Array.isArray(centers) ? centers : []).filter((center) =>
    String(center?.client_id || '') === clientId
      && String(center?.metadata?.project_id || '').trim()
  );
  const requestedCenterId = clean(input.cost_center_id, 180);
  let center = null;
  if (requestedCenterId) {
    center = available.find((candidate) => String(candidate.id) === requestedCenterId) || null;
    if (!center) throw new Error('Le centre de coût sélectionné n’appartient pas à ce client ou ne possède aucun projet validé.');
  } else if (available.length === 1) {
    [center] = available;
  } else {
    throw new Error(available.length
      ? 'Plusieurs projets sont disponibles pour ce client : sélectionne le centre de coût concerné.'
      : 'Aucun projet comptable validé n’est disponible pour ce client.');
  }
  const canonicalProjectId = clean(center.metadata.project_id, 180);
  const requestedProjectId = clean(input.project_id, 180);
  if (requestedProjectId && requestedProjectId !== canonicalProjectId) {
    throw new Error('Le projet demandé ne correspond pas au centre de coût sélectionné.');
  }
  return { ...input, cost_center_id: String(center.id), project_id: canonicalProjectId };
}

function buildProviderRequest(provider, prompt, { imageDataUri = null, referenceImageDataUris = [] } = {}) {
  if (provider === 'xai') {
    const refs = Array.isArray(referenceImageDataUris) ? referenceImageDataUris.filter(Boolean).slice(0, 7) : [];
    const referenceMode = refs.length > 1;
    return {
      url: 'https://api.x.ai/v1/videos/generations',
      model: XAI_MODEL,
      body: {
        model: XAI_MODEL,
        prompt,
        duration: 8,
        aspect_ratio: '16:9',
        resolution: referenceMode ? '720p' : '1080p',
        ...(referenceMode ? { reference_images: refs.map((url) => ({ url })) } : {}),
        ...(!referenceMode && imageDataUri ? { image: { url: imageDataUri } } : {}),
      },
    };
  }
  return {
    url: 'https://api.openai.com/v1/videos',
    model: OPENAI_MODEL,
    body: { model: OPENAI_MODEL, prompt, seconds: '8', size: '1280x720' },
  };
}

function xaiUsdFromUsage(payload = {}) {
  const ticks = Number(payload?.usage?.cost_in_usd_ticks);
  return Number.isFinite(ticks) && ticks >= 0 ? ticks / 10_000_000_000 : null;
}

function estimateSoraUsd({ seconds = 8, model = OPENAI_MODEL, size = '1280x720' } = {}) {
  if (model !== OPENAI_MODEL || size !== '1280x720') throw new Error('Tarif Sora non vérifié pour ce modèle ou cette résolution.');
  return Number((Number(seconds) * 0.10).toFixed(6));
}

function publicConfig(env = process.env, now = new Date()) {
  return {
    providers: providerAvailability(env, now),
    defaults: { duration_seconds: 8, aspect_ratio: '16:9', final_resolution: '1920x1080', fps: 25 },
    capabilities: {
      xai_image_to_video: true,
      xai_reference_to_video: true,
      xai_reference_to_video_max_resolution: '720p',
      exact_end_frame_guarantee: false,
    },
    secret_values_exposed: false,
  };
}

module.exports = {
  SORA_SHUTDOWN_DATE,
  XAI_MODEL,
  OPENAI_MODEL,
  providerAvailability,
  chooseProvider,
  validateJobInput,
  resolveCostScope,
  buildProviderRequest,
  xaiUsdFromUsage,
  estimateSoraUsd,
  publicConfig,
  isCanonicalUuid,
  clientReferenceKey,
  isInternalClientReference,
  canonicalClientName,
  isInternalClientRecord,
  clientReferenceAliases,
  findCanonicalClient,
};
