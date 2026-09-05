const express = require('express');
const crypto = require('crypto');
const { importRailwayCharges } = require('./server-cost-centers.cjs');
const { importGitHubCharges, importTwilioCharges, importVerifiedAdapterCharges } = require('./server-provider-cost-imports.cjs');
const { evidenceStatus, validateEvidence, mappingConflict, sourceToEurMinor } = require('./server-cost-accounting-core.cjs');

const CRM_URL = process.env.SUPABASE_CRM_URL || 'https://gfjpryakxzdzwnazlsfz.supabase.co';
const CRM_KEY = process.env.SUPABASE_CRM_KEY || '';
const CRM_PROXY_URL = process.env.SUPABASE_CRM_PROXY_URL || '';
const CRM_PROXY_TOKEN = process.env.SUPABASE_CRM_PROXY_TOKEN || '';
const AI_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const AI_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.VITE_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '';
const DEFAULT_MARKUP_PERCENT = Math.max(0, Number(process.env.CLIENT_COST_DEFAULT_MARKUP_PERCENT || 0));
const BILLING_VAT_PERCENT = 21;

const SOURCE_LABELS = {
  llm_api: 'Consommation IA / LLM API',
  railway: 'Infrastructure Railway',
  local_ai: 'Production IA locale',
  github: 'Services GitHub',
  storage: 'Stockage cloud',
  dropbox: 'Dropbox / stockage',
  supabase: 'Supabase / base de données',
  communications: 'Communications API',
  twilio: 'Twilio / communications',
  media_ai: 'IA média / génération',
  api: 'API tierces',
  other: 'Frais techniques refacturables',
};

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function minor(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function percent(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function monthWindow(value) {
  const now = new Date();
  const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')) ? String(value) : fallback;
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    month,
    year,
    monthNumber,
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end: new Date(Date.UTC(year, monthNumber, 1)),
  };
}

function previousMonth(reference = new Date()) {
  const date = reference instanceof Date ? reference : new Date(reference);
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  first.setUTCMonth(first.getUTCMonth() - 1);
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}`;
}

function authHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function rest(base, key, path, options = {}) {
  if (base === CRM_URL && CRM_PROXY_URL && CRM_PROXY_TOKEN) {
    const response = await fetch(CRM_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cockpit-proxy-token': CRM_PROXY_TOKEN },
      body: JSON.stringify({ path, method: options.method || 'GET', headers: options.headers || {}, body: options.body || null }),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(data?.message || data?.error || `Relais CRM ${response.status}`);
    return data;
  }
  const candidates = base === CRM_URL
    ? [...new Set([key, process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_SECRET_KEY].map((v) => clean(v, 10000)).filter(Boolean))]
    : [clean(key, 10000)].filter(Boolean);
  if (!candidates.length) throw new Error('Configuration Supabase serveur manquante');
  let lastError = 'Clé Supabase refusée';
  for (const candidate of candidates) {
    const response = await fetch(`${base}/rest/v1/${path}`, {
      ...options,
      headers: { ...authHeaders(candidate), ...(options.headers || {}) },
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (response.ok) return data;
    lastError = data?.message || data?.error || `Supabase ${response.status}`;
    if (![401, 403].includes(response.status)) break;
  }
  throw new Error(lastError);
}

async function crmSelect(path) {
  return rest(CRM_URL, CRM_KEY, path, { method: 'GET' });
}

async function crmPatch(table, filters, payload) {
  return rest(CRM_URL, CRM_KEY, `${table}?${filters}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
}

async function crmInsert(table, payload, conflict = null) {
  const suffix = conflict ? `?on_conflict=${encodeURIComponent(conflict)}` : '';
  return rest(CRM_URL, CRM_KEY, `${table}${suffix}`, {
    method: 'POST',
    headers: { Prefer: `${conflict ? 'resolution=ignore-duplicates,' : ''}return=representation` },
    body: JSON.stringify(payload),
  });
}

function agentHeaders() {
  if (!AGENT_KEY) throw new Error('AGENT_API_KEY manquante');
  return { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY, 'x-organisation-id': 'jsinnovia' };
}

async function agentFetch(path, options = {}) {
  const response = await fetch(`${AGENT_URL}${path}`, {
    ...options,
    headers: { ...agentHeaders(), ...(options.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || `Agent ${response.status}`);
  return data;
}

async function getClient(clientId) {
  const client = await agentFetch(`/data/Client/${encodeURIComponent(clientId)}`);
  if (!client?.id) throw new Error('Client canonique introuvable');
  return client;
}

function clientName(client) {
  return clean(client.denomination_legale || client.entreprise || [client.prenom, client.nom].filter(Boolean).join(' ') || client.nom || client.id, 180);
}

async function loadBillingRule(clientId, sourceType) {
  const rows = await crmSelect(
    `client_billing_rules?select=*&client_id=eq.${encodeURIComponent(clientId)}&cost_type=in.(${encodeURIComponent(sourceType)},all)&enabled=eq.true&order=cost_type.desc&limit=2`,
  ).catch(() => []);
  return (rows || []).find((row) => row.cost_type === sourceType) || (rows || []).find((row) => row.cost_type === 'all') || null;
}

function applyBillingRule(actualMinor, rule) {
  const actual = minor(actualMinor);
  if (rule?.billing_mode === 'included') {
    return { actual, billable: 0, markupPercent: 0, billableEnabled: false, mode: 'included' };
  }
  if (rule?.billing_mode === 'fixed') {
    const fixed = Math.max(minor(rule.fixed_fee_minor), minor(rule.minimum_minor));
    return { actual, billable: fixed, markupPercent: 0, billableEnabled: true, mode: 'fixed' };
  }
  const markupPercent = rule?.billing_mode === 'at_cost' ? 0 : percent(rule?.markup_percent, DEFAULT_MARKUP_PERCENT);
  const billable = Math.max(Math.round(actual * (1 + markupPercent / 100)), minor(rule?.minimum_minor));
  return { actual, billable, markupPercent, billableEnabled: true, mode: rule?.billing_mode || 'percent' };
}

function blocker(code, message, extra = {}) {
  return { code, message, ...extra };
}

function billingProfileBlockers(client) {
  const name = clean(client.denomination_legale || client.entreprise);
  const address = clean(client.adresse);
  const postal = clean(client.code_postal);
  const city = clean(client.ville);
  const country = clean(client.pays);
  const enterprise = clean(client.numero_entreprise);
  const vat = clean(client.numero_tva);
  const email = clean(client.email_facturation || client.email);
  const missing = [];
  if (!name) missing.push('dénomination légale');
  if (!address || !/[a-zA-ZÀ-ÿ]/.test(address.replace(postal, ' ')) || !/\d/.test(address.replace(postal, ' '))) missing.push('adresse complète du siège');
  if (!postal) missing.push('code postal');
  if (!city) missing.push('ville');
  if (!country) missing.push('pays');
  if (!enterprise) missing.push('numéro d’entreprise');
  if (!vat) missing.push('numéro de TVA');
  if (!email) missing.push('email de facturation');
  if (client.facturation_statut !== 'verifie') missing.push('validation des informations légales');
  return missing.length
    ? [blocker('CLIENT_INFORMATION_INCOMPLETE', `Informations légales à compléter : ${missing.join(', ')}.`, { missing })]
    : [];
}

async function createCanonicalCostEvent({ clientId, projectId = null, costCenterId = null, sourceType, provider, description, actualCostMinor, externalRef, incurredAt, evidence, verificationRef = null, calculationMethod = null, calculationInputs = null, metadata = {} }) {
  const existing = externalRef
    ? await crmSelect(`client_cost_events?select=*&source_type=eq.${encodeURIComponent(sourceType)}&external_ref=eq.${encodeURIComponent(externalRef)}&limit=1`).catch(() => [])
    : [];
  if (existing?.[0]) {
    const row = existing[0];
    if (String(row.client_id) !== String(clientId) || minor(row.actual_cost_minor) !== minor(actualCostMinor)) {
      throw new Error('Coût fournisseur déjà enregistré avec attribution ou montant différent : rapprochement requis');
    }
    return { row, created: false };
  }
  const normalizedEvidence = validateEvidence({
    status: evidence || 'unverified',
    verificationRef,
    calculationMethod,
    calculationInputs,
    billable: evidence === 'unverified' ? false : undefined,
  });
  const rule = await loadBillingRule(clientId, sourceType);
  const priced = applyBillingRule(actualCostMinor, rule);
  if (normalizedEvidence === 'unverified' || metadata.billable === false) {
    priced.billable = 0;
    priced.billableEnabled = false;
  }
  const payload = {
    client_id: clientId,
    project_id: projectId || null,
    cost_center_id: costCenterId || null,
    source_type: sourceType,
    provider: clean(provider, 100) || null,
    description: clean(description, 500) || `${sourceType} — coût client`,
    actual_cost_minor: priced.actual,
    markup_percent: priced.markupPercent,
    billable_minor: priced.billable,
    currency: 'EUR',
    billable: priced.billableEnabled,
    external_ref: clean(externalRef, 300) || null,
    incurred_at: incurredAt,
    metadata: {
      ...metadata,
      evidence_status: normalizedEvidence,
      verification_ref: clean(verificationRef, 500) || null,
      calculation_method: clean(calculationMethod, 300) || null,
      calculation_inputs: calculationInputs || null,
      billing_mode: priced.mode,
    },
  };
  const inserted = await crmInsert('client_cost_events', payload, externalRef ? 'source_type,external_ref' : null);
  return { row: inserted?.[0] || payload, created: Boolean(inserted?.[0]) };
}

async function syncPreciseAiUsage(clientId, window) {
  if (!AI_KEY) return { status: 'blocked', created: 0, error: 'Source IA précise non connectée : clé Supabase AI Cost manquante.' };
  const rows = await rest(
    AI_URL,
    AI_KEY,
    `ai_cost_usage?select=*&client_key=eq.${encodeURIComponent(clientId)}&created_at=gte.${encodeURIComponent(window.start.toISOString())}&created_at=lt.${encodeURIComponent(window.end.toISOString())}&order=created_at.asc&limit=10000`,
    { method: 'GET' },
  );
  if ((rows || []).length >= 10000) return { status: 'blocked', created: 0, error: 'Usage IA trop volumineux : pagination comptable requise.' };
  let created = 0;
  for (const row of rows || []) {
    if (row.pricing_warning === 'model_unpriced') {
      return { status: 'blocked', created, error: `Modèle IA non tarifé : ${clean(row.model, 120) || 'inconnu'}.` };
    }
    const converted = sourceToEurMinor(Number(row.cost_usd || 0), 'USD', process.env);
    const estimated = row.cost_estimated !== false;
    const result = await createCanonicalCostEvent({
      clientId,
      sourceType: 'llm_api',
      provider: row.provider || 'openai',
      description: `LLM API — ${clean(row.model, 120) || 'modèle'}`,
      actualCostMinor: converted.totalMinor,
      externalRef: `ai-usage:${row.request_id || row.id}`,
      incurredAt: row.created_at || window.start.toISOString(),
      evidence: estimated ? 'estimated' : 'actual',
      verificationRef: estimated ? null : `ai-cost-usage:${row.request_id || row.id}`,
      calculationMethod: estimated ? 'provider_token_pricing' : null,
      calculationInputs: estimated ? {
        model: row.model,
        input_tokens: row.input_tokens,
        cached_input_tokens: row.cached_input_tokens,
        output_tokens: row.output_tokens,
        cost_usd: row.cost_usd,
      } : null,
      metadata: {
        ai_cost_usage_id: row.id,
        request_id: row.request_id,
        model: row.model,
        source_currency: 'USD',
        fx_rate: converted.fxRate,
        fx_source: converted.fxSource,
        period: window.month,
      },
    });
    if (result.created) created += 1;
  }
  return { status: 'completed', created, scanned: (rows || []).length, error: null };
}

async function collectMapping(mapping, window) {
  if (['railway_project', 'railway_service'].includes(mapping.service_type)) return importRailwayCharges(mapping, window.year, window.monthNumber);
  if (['github_user', 'github_org', 'github_repo'].includes(mapping.service_type)) return importGitHubCharges(mapping, window.year, window.monthNumber);
  if (mapping.service_type === 'twilio_account') return importTwilioCharges(mapping, window.year, window.monthNumber);
  if (['supabase_project', 'dropbox_account', 'media_provider'].includes(mapping.service_type)) return importVerifiedAdapterCharges(mapping, window.year, window.monthNumber);
  if (mapping.service_type === 'openai_project') return { lines: [], totalEurMinor: 0, precise_ai_usage: true };
  return { lines: [], totalEurMinor: 0, error: 'Cette source exige une facture vérifiée ou une remontée d’usage signée.' };
}

async function syncCostCenter(center, window, allMappings) {
  const mappings = (allMappings || []).filter((mapping) => String(mapping.cost_center_id) === String(center.id));
  const projectId = clean(center.metadata?.project_id, 120);
  if (!projectId && mappings.some((mapping) => mapping.service_type !== 'openai_project')) {
    return { results: [], blockers: [blocker('CENTER_PROJECT_MISSING', `Centre ${clean(center.name || center.product_code || center.id, 180)} sans projet métier validé.`)] };
  }
  if (projectId) {
    const project = await agentFetch(`/data/Projet/${encodeURIComponent(projectId)}`).catch(() => null);
    if (!project || String(project.client_id) !== String(center.client_id)) {
      return { results: [], blockers: [blocker('CENTER_PROJECT_INVALID', `Le projet du centre ${clean(center.name || center.product_code || center.id, 180)} n’est pas rattaché au bon client.`)] };
    }
  }
  const results = [];
  const blockers = [];
  for (const mapping of mappings) {
    if (mappingConflict(mapping, allMappings)) {
      blockers.push(blocker('MAPPING_OVERLAP', `Rattachement fournisseur en doublon pour ${clean(mapping.external_label || mapping.external_id, 180)}.`));
      continue;
    }
    if (mapping.service_type === 'openai_project') {
      results.push({ mapping_id: mapping.id, service_type: mapping.service_type, status: 'precise_ai_usage', created: 0 });
      continue;
    }
    let result;
    try {
      result = await collectMapping(mapping, window);
    } catch (error) {
      blockers.push(blocker('PROVIDER_SYNC_FAILED', `${clean(mapping.external_label || mapping.external_id, 180)} : ${clean(error.message, 300)}`));
      continue;
    }
    let created = 0;
    for (let index = 0; index < (result.lines || []).length; index += 1) {
      const line = result.lines[index];
      if (minor(line.total_minor) <= 0) continue;
      const sourceType = ({ railway: 'railway', github: 'github', twilio: 'twilio', supabase: 'supabase', dropbox: 'dropbox', media_ai: 'media_ai' })[line.line_type] || 'other';
      const deterministic = crypto.createHash('sha256').update(`${mapping.id}|${window.month}|${index}|${line.description || ''}|${line.total_minor}`).digest('hex').slice(0, 24);
      const externalRef = line.external_ref || `${sourceType}:${mapping.id}:${window.month}:${deterministic}`;
      const event = await createCanonicalCostEvent({
        clientId: center.client_id,
        projectId: projectId || null,
        costCenterId: center.id,
        sourceType,
        provider: sourceType,
        description: line.description,
        actualCostMinor: line.total_minor,
        externalRef,
        incurredAt: window.start.toISOString(),
        evidence: line.metadata?.evidence_status || 'unverified',
        verificationRef: line.metadata?.verification_ref || null,
        calculationMethod: line.metadata?.calculation_method || null,
        calculationInputs: line.metadata?.calculation_inputs || null,
        metadata: {
          ...(line.metadata || {}),
          billable: center.metadata?.billable !== false,
          mapping_id: mapping.id,
          canonical_project_id: projectId || null,
          period: window.month,
        },
      });
      if (event.created) created += 1;
    }
    if (result.error) blockers.push(blocker('PROVIDER_EVIDENCE_MISSING', `${clean(mapping.external_label || mapping.external_id, 180)} : ${clean(result.error, 300)}`));
    results.push({ mapping_id: mapping.id, service_type: mapping.service_type, status: result.error ? 'blocked' : 'completed', created });
  }
  return { results, blockers };
}

async function syncClientCosts(clientId, window) {
  const centers = await crmSelect(`client_cost_centers?select=*&client_id=eq.${encodeURIComponent(clientId)}&is_active=eq.true&limit=1000`).catch(() => []);
  const allMappings = await crmSelect('client_external_mappings?select=*&is_active=eq.true&limit=5000').catch(() => []);
  const blockers = [];
  const results = [];
  if (allMappings.length >= 5000) blockers.push(blocker('MAPPING_REGISTRY_TOO_LARGE', 'Registre fournisseurs trop volumineux pour vérifier les chevauchements.'));

  const clientMappings = allMappings.filter((mapping) => centers.some((center) => String(center.id) === String(mapping.cost_center_id)));
  if (clientMappings.some((mapping) => mapping.service_type === 'openai_project')) {
    try {
      const ai = await syncPreciseAiUsage(clientId, window);
      results.push({ source: 'precise_ai_usage', ...ai });
      if (ai.error) blockers.push(blocker('AI_USAGE_SYNC_FAILED', ai.error));
    } catch (error) {
      blockers.push(blocker('AI_USAGE_SYNC_FAILED', clean(error.message, 300)));
    }
  }

  for (const center of centers) {
    if (center.metadata?.billable === false) continue;
    const synced = await syncCostCenter(center, window, allMappings);
    results.push({ cost_center_id: center.id, results: synced.results });
    blockers.push(...synced.blockers);
  }
  return { centers, mappings: clientMappings, results, blockers };
}

async function listCostEvents(clientId, window) {
  return crmSelect(
    `client_cost_events?select=*&client_id=eq.${encodeURIComponent(clientId)}&incurred_at=gte.${encodeURIComponent(window.start.toISOString())}&incurred_at=lt.${encodeURIComponent(window.end.toISOString())}&order=incurred_at.asc&limit=10000`,
  );
}

function buildInvoiceSnapshot({ client, centers = [], events = [], window, invoiceId = null, syncBlockers = [] }) {
  const centerById = new Map((centers || []).map((center) => [String(center.id), center]));
  const blockers = [...billingProfileBlockers(client), ...(syncBlockers || [])];
  const eligible = [];
  let hasPreciseLlm = false;
  let hasBroadLlm = false;

  for (const event of events || []) {
    const linkedToThis = invoiceId && String(event.facture_id || '') === String(invoiceId);
    if (event.facture_id && !linkedToThis) continue;
    const center = event.cost_center_id ? centerById.get(String(event.cost_center_id)) : null;
    const explicitlyIncluded = event.metadata?.billing_mode === 'included' || event.metadata?.billable === false || center?.metadata?.billable === false;
    const status = evidenceStatus(event);
    if (event.source_type === 'llm_api' && String(event.external_ref || '').startsWith('ai-usage:')) hasPreciseLlm = true;
    if (event.source_type === 'llm_api' && !String(event.external_ref || '').startsWith('ai-usage:') && minor(event.actual_cost_minor) > 0) hasBroadLlm = true;
    if (status === 'unverified' && minor(event.actual_cost_minor) > 0 && !explicitlyIncluded) {
      blockers.push(blocker('UNVERIFIED_COST', `${clean(event.description, 220) || 'Dépense'} : justificatif ou preuve API manquante.`, { event_id: event.id, source_type: event.source_type }));
      continue;
    }
    if (status !== 'unverified' && event.billable && minor(event.billable_minor) > 0) eligible.push(event);
  }
  if (hasPreciseLlm && hasBroadLlm) blockers.push(blocker('LLM_DOUBLE_SOURCE', 'Deux sources LLM différentes sont présentes pour la même période. Rapprochement requis avant facturation.'));

  const grouped = new Map();
  for (const event of eligible) {
    const key = event.source_type || 'other';
    const current = grouped.get(key) || { minor: 0, count: 0 };
    current.minor += minor(event.billable_minor);
    current.count += 1;
    grouped.set(key, current);
  }

  const lineMinor = [];
  for (const [sourceType, group] of grouped.entries()) {
    lineMinor.push({
      description: `${SOURCE_LABELS[sourceType] || SOURCE_LABELS.other} — ${group.count} événement(s)`,
      minor: group.minor,
      source_type: sourceType,
    });
  }

  const feeCenters = [];
  for (const center of centers || []) {
    if (center.metadata?.billable === false || !center.is_active) continue;
    const fee = minor(center.monthly_fee_minor);
    if (!fee) continue;
    feeCenters.push(String(center.id));
    lineMinor.unshift({
      description: `Forfait mensuel — ${clean(center.name || center.product_code || center.client_name || 'service', 180)}`,
      minor: fee,
      source_type: 'forfait',
    });
  }

  const totalMinor = lineMinor.reduce((sum, line) => sum + line.minor, 0);
  const vatMinor = Math.round(totalMinor * BILLING_VAT_PERCENT / 100);
  const ttcMinor = totalMinor + vatMinor;
  const lines = lineMinor.map((line) => ({
    description: line.description,
    quantite: 1,
    prix_unitaire: Number((line.minor / 100).toFixed(2)),
    total: Number((line.minor / 100).toFixed(2)),
  }));
  const normalizedBlockers = blockers
    .filter((item) => item && item.message)
    .sort((a, b) => `${a.code}|${a.message}`.localeCompare(`${b.code}|${b.message}`));
  const eventIds = eligible.map((event) => String(event.id)).filter(Boolean).sort();
  const fingerprintPayload = {
    client_id: String(client.id),
    period: window.month,
    vat_percent: BILLING_VAT_PERCENT,
    lines: lineMinor.map((line) => ({ description: line.description, minor: line.minor, source_type: line.source_type })),
    source_event_ids: eventIds,
    monthly_fee_centers: feeCenters.slice().sort(),
    blockers: normalizedBlockers.map((item) => ({ code: item.code, message: item.message })),
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex');
  return {
    client,
    centers,
    window,
    lines,
    eventIds,
    feeCenters,
    blockers: normalizedBlockers,
    fingerprint,
    amountHt: Number((totalMinor / 100).toFixed(2)),
    vatAmount: Number((vatMinor / 100).toFixed(2)),
    amountTtc: Number((ttcMinor / 100).toFixed(2)),
    totalMinor,
  };
}

async function findAutoInvoice(clientId, month) {
  const rows = await agentFetch('/data/Facture?sort=-created_at&limit=1000');
  return (Array.isArray(rows) ? rows : []).find((row) =>
    String(row.client_id) === String(clientId)
    && row.auto_generation === true
    && String(row.periode || '') === String(month)
    && String(row.statut || '') !== 'annulee'
  ) || null;
}

async function nextInvoiceNumber(year) {
  const rows = await agentFetch('/data/Facture?sort=-created_at&limit=1000');
  let max = 0;
  const pattern = new RegExp(`^FAC-${year}-(\\d{4,})$`, 'i');
  for (const row of Array.isArray(rows) ? rows : []) {
    const match = String(row.numero || '').match(pattern);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return `FAC-${year}-${String(max + 1).padStart(4, '0')}`;
}

async function replaceEventLinks(clientId, window, invoiceId, eventIds) {
  await crmPatch(
    'client_cost_events',
    `client_id=eq.${encodeURIComponent(clientId)}&incurred_at=gte.${encodeURIComponent(window.start.toISOString())}&incurred_at=lt.${encodeURIComponent(window.end.toISOString())}&facture_id=eq.${encodeURIComponent(invoiceId)}`,
    { facture_id: null },
  ).catch(() => []);
  if (eventIds.length) {
    await crmPatch(
      'client_cost_events',
      `id=in.(${eventIds.map((id) => encodeURIComponent(id)).join(',')})&facture_id=is.null`,
      { facture_id: String(invoiceId) },
    );
  }
}

function invoicePayload(snapshot, existing = null, actor = 'system-monthly-billing') {
  const now = new Date();
  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + 30);
  const changed = !existing || String(existing.billing_fingerprint || '') !== snapshot.fingerprint;
  const payload = {
    objet: `Facturation mensuelle JS-Innov.IA — ${snapshot.window.month}`,
    client_id: snapshot.client.id,
    client_nom: clientName(snapshot.client),
    client_email: clean(snapshot.client.email_facturation || snapshot.client.email, 240),
    lignes: snapshot.lines,
    montant_ht: snapshot.amountHt,
    tva: BILLING_VAT_PERCENT,
    montant_tva: snapshot.vatAmount,
    montant_ttc: snapshot.amountTtc,
    statut: 'brouillon',
    date_emission: now.toISOString().slice(0, 10),
    date_echeance: due.toISOString().slice(0, 10),
    periode: snapshot.window.month,
    notes: 'Brouillon mensuel généré automatiquement depuis le ledger auditable. Validation humaine obligatoire avant envoi.',
    auto_generation: true,
    billing_fingerprint: snapshot.fingerprint,
    billing_review_status: snapshot.blockers.length ? 'blocked' : 'pending',
    billing_generated_at: now.toISOString(),
    billing_validated_at: null,
    billing_validated_by: null,
    billing_source_event_ids: snapshot.eventIds,
    billing_monthly_fee_centers: snapshot.feeCenters,
    billing_blockers: snapshot.blockers,
    billing_send_error: null,
    billing_send_attempt_at: null,
    billing_send_attempt_key: null,
  };
  if (changed && existing?.pdf_document_id) {
    Object.assign(payload, {
      pdf_document_id: null,
      pdf_dropbox_path: null,
      pdf_dropbox_file_id: null,
      pdf_sha256: null,
      pdf_version: null,
      pdf_genere_at: null,
      pdf_genere_par: null,
      pdf_conformite_statut: null,
      historique_documents: [
        ...(Array.isArray(existing.historique_documents) ? existing.historique_documents : []),
        { type: 'actualisation_comptable', date: now.toISOString(), utilisateur: actor, replaced_document_id: existing.pdf_document_id },
      ].slice(-200),
    });
  }
  return payload;
}

async function snapshotForClient(clientId, month, { invoiceId = null, sync = true } = {}) {
  const window = monthWindow(month);
  const client = await getClient(clientId);
  let syncResult = { centers: [], blockers: [], results: [] };
  if (sync) syncResult = await syncClientCosts(client.id, window);
  const centers = syncResult.centers?.length
    ? syncResult.centers
    : await crmSelect(`client_cost_centers?select=*&client_id=eq.${encodeURIComponent(client.id)}&is_active=eq.true&limit=1000`).catch(() => []);
  const events = await listCostEvents(client.id, window);
  return buildInvoiceSnapshot({ client, centers, events, window, invoiceId, syncBlockers: syncResult.blockers || [] });
}

async function prepareOrRefreshMonthlyDraft(clientId, month, { sync = true, actor = 'system-monthly-billing' } = {}) {
  const window = monthWindow(month);
  const existing = await findAutoInvoice(clientId, window.month);
  if (existing && ['envoyee', 'payee', 'en_retard'].includes(String(existing.statut || ''))) {
    return { action: 'skipped_issued', invoice: existing, changed: false, blockers: [] };
  }
  const snapshot = await snapshotForClient(clientId, window.month, { invoiceId: existing?.id || null, sync });
  if (!existing && snapshot.totalMinor <= 0 && !snapshot.blockers.length) {
    return { action: 'skipped_empty', invoice: null, snapshot, changed: false, blockers: [] };
  }
  const payload = invoicePayload(snapshot, existing, actor);
  let invoice;
  let action;
  let changed = true;
  if (existing) {
    changed = String(existing.billing_fingerprint || '') !== snapshot.fingerprint
      || String(existing.billing_review_status || '') !== String(payload.billing_review_status || '');
    if (changed) {
      invoice = await agentFetch(`/data/Facture/${encodeURIComponent(existing.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      action = 'refreshed';
    } else {
      invoice = existing;
      action = 'unchanged';
    }
  } else {
    payload.numero = await nextInvoiceNumber(window.year);
    invoice = await agentFetch('/data/Facture', { method: 'POST', body: JSON.stringify(payload) });
    if (!invoice?.id) throw new Error('Facture créée sans identifiant');
    action = 'created';
  }
  await replaceEventLinks(clientId, window, invoice.id, snapshot.eventIds);
  return { action, invoice: { ...invoice, ...payload, id: invoice.id }, snapshot, changed, blockers: snapshot.blockers };
}

async function refreshAutoInvoiceDraft(invoice, { sync = true, actor = 'billing-review' } = {}) {
  if (!invoice?.id || !invoice.auto_generation) throw Object.assign(new Error('Cette facture n’est pas un brouillon mensuel automatique.'), { status: 409, code: 'NOT_AUTO_INVOICE' });
  if (String(invoice.statut || '') !== 'brouillon') throw Object.assign(new Error('Une facture déjà émise ne peut plus être recalculée.'), { status: 409, code: 'INVOICE_ALREADY_ISSUED' });
  const result = await prepareOrRefreshMonthlyDraft(invoice.client_id, invoice.periode, { sync, actor });
  return {
    ...result,
    stable: !result.changed && !result.blockers.length && String(result.invoice?.billing_fingerprint || '') === String(invoice.billing_fingerprint || ''),
  };
}

async function runMonthlyBilling({ month = null, now = new Date(), dryRun = false } = {}) {
  const targetMonth = month || previousMonth(now);
  const window = monthWindow(targetMonth);
  const centers = await crmSelect('client_cost_centers?select=*&is_active=eq.true&limit=5000').catch(() => []);
  const events = await crmSelect(
    `client_cost_events?select=client_id,billable,billable_minor,actual_cost_minor,metadata&incurred_at=gte.${encodeURIComponent(window.start.toISOString())}&incurred_at=lt.${encodeURIComponent(window.end.toISOString())}&limit=10000`,
  ).catch(() => []);
  const clientIds = new Set();
  for (const center of centers || []) {
    if (center.client_id && center.metadata?.billable !== false && (minor(center.monthly_fee_minor) > 0 || center.is_active)) clientIds.add(String(center.client_id));
  }
  for (const event of events || []) {
    if (event.client_id && (event.billable || minor(event.actual_cost_minor) > 0)) clientIds.add(String(event.client_id));
  }

  const summary = { month: targetMonth, clients: clientIds.size, created: 0, refreshed: 0, unchanged: 0, blocked: 0, skipped: 0, errors: 0, dry_run: Boolean(dryRun), details: [] };
  for (const clientId of clientIds) {
    try {
      if (dryRun) {
        const snapshot = await snapshotForClient(clientId, targetMonth, { sync: true });
        summary.blocked += snapshot.blockers.length ? 1 : 0;
        summary.details.push({ client_id: clientId, action: 'dry_run', amount_ttc: snapshot.amountTtc, blockers: snapshot.blockers.length });
        continue;
      }
      const result = await prepareOrRefreshMonthlyDraft(clientId, targetMonth, { sync: true, actor: 'system-monthly-billing' });
      if (result.action === 'created') summary.created += 1;
      else if (result.action === 'refreshed') summary.refreshed += 1;
      else if (result.action === 'unchanged') summary.unchanged += 1;
      else summary.skipped += 1;
      if (result.blockers?.length) summary.blocked += 1;
      summary.details.push({ client_id: clientId, action: result.action, invoice_id: result.invoice?.id || null, amount_ttc: result.snapshot?.amountTtc ?? result.invoice?.montant_ttc ?? 0, blockers: result.blockers?.length || 0 });
    } catch (error) {
      summary.errors += 1;
      summary.details.push({ client_id: clientId, action: 'error', error: clean(error.message, 300) });
    }
  }
  return summary;
}

function createBillingReviewRouter({ fetchDocument, updateDocument, sendPDF, getSmtpTransport, tenantForRequest }) {
  const router = express.Router();
  const approvalLocks = new Map();

  router.post('/monthly/prepare', async (req, res) => {
    try {
      const month = req.body?.month || previousMonth(new Date());
      const summary = await runMonthlyBilling({ month, dryRun: req.body?.dry_run === true });
      return res.json({ success: true, summary });
    } catch (error) {
      return res.status(503).json({ success: false, error: error.message, code: 'MONTHLY_BILLING_PREPARE_FAILED' });
    }
  });

  router.post('/factures/:id/refresh-auto-draft', async (req, res) => {
    try {
      const tenant = tenantForRequest(req);
      const invoice = await fetchDocument('facture', req.params.id, tenant);
      const result = await refreshAutoInvoiceDraft(invoice, { sync: true, actor: req.user?.email || req.user?.id || 'billing-review' });
      return res.json({ success: true, action: result.action, invoice: result.invoice, blockers: result.blockers, changed: result.changed });
    } catch (error) {
      return res.status(Number(error.status) || 503).json({ success: false, error: error.message, code: error.code || 'BILLING_REFRESH_FAILED' });
    }
  });

  router.post('/factures/:id/approve-and-send', async (req, res) => {
    const lockKey = String(req.params.id);
    if (approvalLocks.has(lockKey)) return res.status(409).json({ success: false, code: 'BILLING_SEND_IN_PROGRESS', error: 'Une validation/envoi est déjà en cours pour cette facture.' });
    const task = (async () => {
      const tenant = tenantForRequest(req);
      let invoice = await fetchDocument('facture', req.params.id, tenant);
      if (!invoice?.auto_generation) return res.status(409).json({ success: false, code: 'NOT_AUTO_INVOICE', error: 'Cette facture n’est pas issue du cycle mensuel automatique.' });
      if (String(invoice.statut || '') !== 'brouillon') return res.status(409).json({ success: false, code: 'INVOICE_ALREADY_ISSUED', error: 'Cette facture est déjà émise ou clôturée.' });
      if (invoice.billing_send_attempt_key && !invoice.billing_send_error) {
        return res.status(409).json({ success: false, code: 'BILLING_SEND_UNCERTAIN', error: 'Un envoi précédent est resté sans confirmation technique. Vérifiez le journal avant de relancer afin d’éviter un double envoi.' });
      }
      if (!getSmtpTransport()) return res.status(503).json({ success: false, code: 'SMTP_NOT_CONFIGURED', error: 'SMTP non configuré.' });

      const reviewedFingerprint = String(invoice.billing_fingerprint || '');
      const verification = await refreshAutoInvoiceDraft(invoice, { sync: true, actor: req.user?.email || req.user?.id || 'billing-review' });
      invoice = verification.invoice;
      if (verification.blockers?.length) {
        return res.status(409).json({ success: false, code: 'BILLING_REVIEW_BLOCKED', error: 'La facture contient encore des éléments à justifier ou à corriger.', blockers: verification.blockers });
      }
      if (verification.changed || String(invoice.billing_fingerprint || '') !== reviewedFingerprint) {
        return res.status(409).json({ success: false, code: 'BILLING_DRAFT_REFRESHED', error: 'Les coûts ont changé depuis votre dernière vérification. Le brouillon a été actualisé : vérifiez-le à nouveau avant l’envoi.', invoice });
      }

      const now = new Date().toISOString();
      const attemptKey = crypto.randomUUID();
      const validatedBy = req.user?.email || req.user?.id || 'billing-review';
      await updateDocument('facture', invoice.id, {
        billing_review_status: 'approved',
        billing_validated_at: now,
        billing_validated_by: validatedBy,
        billing_send_attempt_at: now,
        billing_send_attempt_key: attemptKey,
        billing_send_error: null,
      }, tenant);
      try {
        return await sendPDF(req, res, 'facture');
      } catch (error) {
        await updateDocument('facture', invoice.id, {
          billing_review_status: 'send_failed',
          billing_send_error: clean(error.message, 500),
          billing_send_attempt_key: null,
        }, tenant).catch(() => null);
        throw error;
      }
    })().finally(() => approvalLocks.delete(lockKey));
    approvalLocks.set(lockKey, task);
    try {
      return await task;
    } catch (error) {
      return res.status(Number(error.status) || 500).json({ success: false, error: error.message, code: error.code || 'BILLING_APPROVE_SEND_FAILED' });
    }
  });

  return router;
}

module.exports = {
  BILLING_VAT_PERCENT,
  monthWindow,
  previousMonth,
  buildInvoiceSnapshot,
  snapshotForClient,
  prepareOrRefreshMonthlyDraft,
  refreshAutoInvoiceDraft,
  runMonthlyBilling,
  createBillingReviewRouter,
};
