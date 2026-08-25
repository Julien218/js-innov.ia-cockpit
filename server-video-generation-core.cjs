const SORA_SHUTDOWN_DATE = '2026-09-24';
const XAI_MODEL = 'grok-imagine-video-1.5';
const OPENAI_MODEL = 'sora-2';

function clean(value, max = 20_000) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
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
    sourceDocumentId: clean(input.source_document_id, 180) || null,
  };
}

function buildProviderRequest(provider, prompt, { imageDataUri = null } = {}) {
  if (provider === 'xai') return {
    url: 'https://api.x.ai/v1/videos/generations',
    model: XAI_MODEL,
    body: {
      model: XAI_MODEL,
      prompt,
      duration: 8,
      aspect_ratio: '16:9',
      resolution: '1080p',
      ...(imageDataUri ? { image: { url: imageDataUri } } : {}),
    },
  };
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
  buildProviderRequest,
  xaiUsdFromUsage,
  estimateSoraUsd,
  publicConfig,
};
