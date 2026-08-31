const express = require('express');
const crypto = require('crypto');
const { importOpenAICharges, importRailwayCharges } = require('./server-cost-centers.cjs');
const { importGitHubCharges, importTwilioCharges, importVerifiedAdapterCharges } = require('./server-provider-cost-imports.cjs');
const {
  validateEvidence,
  evidenceStatus,
  summarizeAccounting,
  buildSourceCoverage,
  accountingCompleteness,
  sourceToEurMinor,
  mappingConflict,
} = require('./server-cost-accounting-core.cjs');

const router = express.Router();

const CRM_URL = process.env.SUPABASE_CRM_URL || 'https://gfjpryakxzdzwnazlsfz.supabase.co';
const CRM_KEY = process.env.SUPABASE_CRM_KEY || '';
const AI_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const AI_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.VITE_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '';
const CRM_PROXY_URL = process.env.SUPABASE_CRM_PROXY_URL || '';
const CRM_PROXY_TOKEN = process.env.SUPABASE_CRM_PROXY_TOKEN || '';

const DEFAULT_MARKUP_PERCENT = Math.max(0, Number(process.env.CLIENT_COST_DEFAULT_MARKUP_PERCENT || 0));
const LOCAL_AI_POWER_WATTS = Math.max(0, Number(process.env.LOCAL_AI_POWER_WATTS || 180));
const LOCAL_AI_ENERGY_EUR_KWH = Math.max(0, Number(process.env.LOCAL_AI_ENERGY_EUR_KWH || 0.30));
const LOCAL_AI_MACHINE_EUR_HOUR = Math.max(0, Number(process.env.LOCAL_AI_MACHINE_EUR_HOUR || 0.20));

const SOURCE_TYPES = new Set([
  'llm_api', 'railway', 'local_ai', 'github', 'storage', 'communications',
  'api', 'media_ai', 'supabase', 'dropbox', 'twilio', 'other',
]);
const MAPPING_TYPES = new Set([
  'openai_project', 'railway_project', 'railway_service', 'github_user', 'github_org', 'github_repo',
  'twilio_account', 'supabase_project', 'dropbox_account', 'storage_account',
  'media_provider', 'communications_provider', 'api_provider', 'other_provider',
]);

function clean(value, max = 300) {
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

function authHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
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
    ? [...new Set([key, process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_SECRET_KEY].map((value) => String(value || '').trim()).filter(Boolean))]
    : [String(key || '').trim()].filter(Boolean);
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

async function crmRequest(path, options = {}) {
  return rest(CRM_URL, CRM_KEY, path, options);
}

async function crmInsert(table, payload, conflict = null) {
  const suffix = conflict ? `?on_conflict=${encodeURIComponent(conflict)}` : '';
  return rest(CRM_URL, CRM_KEY, `${table}${suffix}`, {
    method: 'POST',
    headers: { Prefer: `${conflict ? 'resolution=ignore-duplicates,' : ''}return=representation` },
    body: JSON.stringify(payload),
  });
}

async function crmPatch(table, filters, payload) {
  return rest(CRM_URL, CRM_KEY, `${table}?${filters}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
}

async function crmUpsert(table, payload, conflict) {
  return rest(CRM_URL, CRM_KEY, `${table}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload),
  });
}

function normalizedLocalRates(input = {}, source = 'environment') {
  return {
    power_watts: Math.max(0, Number(input.power_watts ?? input.LOCAL_AI_POWER_WATTS ?? LOCAL_AI_POWER_WATTS)),
    energy_eur_kwh: Math.max(0, Number(input.energy_eur_kwh ?? input.LOCAL_AI_ENERGY_EUR_KWH ?? LOCAL_AI_ENERGY_EUR_KWH)),
    machine_eur_hour: Math.max(0, Number(input.machine_eur_hour ?? input.LOCAL_AI_MACHINE_EUR_HOUR ?? LOCAL_AI_MACHINE_EUR_HOUR)),
    source,
  };
}

async function loadLocalRates() {
  const rows = await crmSelect('cost_accounting_settings?select=*&settings_key=eq.local_ai_rates&limit=1').catch(() => []);
  if (rows?.[0]?.settings) return normalizedLocalRates(rows[0].settings, 'cockpit');
  return normalizedLocalRates(process.env, 'environment');
}

async function agentFetch(path, options = {}) {
  if (!AGENT_KEY) throw new Error('AGENT_API_KEY manquante');
  const response = await fetch(`${AGENT_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': AGENT_KEY,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Agent ${response.status}`);
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
  if (!CRM_KEY) return null;
  const rows = await crmSelect(
    `client_billing_rules?select=*&client_id=eq.${encodeURIComponent(clientId)}&cost_type=in.(${encodeURIComponent(sourceType)},all)&enabled=eq.true&order=cost_type.desc&limit=2`
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
  const calculated = Math.round(actual * (1 + markupPercent / 100));
  const billable = Math.max(calculated, minor(rule?.minimum_minor));
  return { actual, billable, markupPercent, billableEnabled: true, mode: rule?.billing_mode || 'percent' };
}

function limitedNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function normalizeLocalTelemetry(input = {}, runtimeSeconds = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const sampleCount = Math.max(0, Math.min(100000, Math.round(Number(input.sample_count || 0))));
  const averagePowerWatts = limitedNumber(input.power?.average_estimated_system_watts, 1, 5000);
  if (!sampleCount || !averagePowerWatts) return null;
  const seconds = Math.max(0, Number(runtimeSeconds || input.runtime_seconds || 0));
  return {
    summary_id: clean(input.summary_id, 300) || null,
    session_id: clean(input.session_id, 120) || null,
    started_at: Number.isFinite(Date.parse(input.started_at)) ? new Date(input.started_at).toISOString() : null,
    completed_at: Number.isFinite(Date.parse(input.completed_at)) ? new Date(input.completed_at).toISOString() : null,
    runtime_seconds: seconds,
    sample_count: sampleCount,
    sampling_interval_seconds: limitedNumber(input.sampling_interval_seconds, 0.1, 3600),
    cpu: {
      model: clean(input.cpu?.model, 300) || null,
      logical_cores: limitedNumber(input.cpu?.logical_cores, 1, 1024),
      average_utilization_percent: limitedNumber(input.cpu?.average_utilization_percent, 0, 100),
    },
    memory: {
      total_bytes: limitedNumber(input.memory?.total_bytes, 1, Number.MAX_SAFE_INTEGER),
      average_utilization_percent: limitedNumber(input.memory?.average_utilization_percent, 0, 100),
    },
    gpu: {
      names: Array.isArray(input.gpu?.names) ? input.gpu.names.slice(0, 8).map((name) => clean(name, 300)).filter(Boolean) : [],
      average_utilization_percent: limitedNumber(input.gpu?.average_utilization_percent, 0, 100),
      average_power_draw_watts: limitedNumber(input.gpu?.average_power_draw_watts, 0, 5000),
      power_sensor: clean(input.gpu?.power_sensor, 80) || 'unavailable',
    },
    power: {
      average_estimated_system_watts: averagePowerWatts,
      configured_ceiling_watts: limitedNumber(input.power?.configured_ceiling_watts, 1, 5000),
      methods: Array.isArray(input.power?.methods) ? input.power.methods.slice(0, 8).map((method) => clean(method, 120)).filter(Boolean) : [],
      evidence_status: 'estimated',
    },
    energy_wh_estimated: Number((seconds * averagePowerWatts / 3600).toFixed(6)),
    evidence_status: 'estimated',
  };
}

function costEventLookupPath(sourceType, externalRef) {
  return `client_cost_events?select=*&source_type=eq.${encodeURIComponent(sourceType)}&external_ref=eq.${encodeURIComponent(externalRef)}&limit=1`;
}

async function createCostEvent({
  clientId,
  projectId = null,
  costCenterId = null,
  sourceType,
  provider = null,
  description,
  actualCostMinor,
  externalRef = null,
  incurredAt = null,
  metadata = {},
  evidenceStatus = null,
  verificationRef = null,
  calculationMethod = null,
  calculationInputs = null,
}) {
  await getClient(clientId);
  const type = SOURCE_TYPES.has(sourceType) ? sourceType : 'other';
  const rule = await loadBillingRule(clientId, type);
  const requestedEvidence = evidenceStatus || metadata.evidence_status || 'unverified';
  const normalizedEvidence = validateEvidence({
    status: requestedEvidence,
    verificationRef: verificationRef || metadata.verification_ref,
    calculationMethod: calculationMethod || metadata.calculation_method,
    calculationInputs: calculationInputs || metadata.calculation_inputs,
    billable: requestedEvidence === 'unverified' ? false : undefined,
  });
  const priced = applyBillingRule(actualCostMinor, rule);
  if (normalizedEvidence === 'unverified' || metadata.billable === false) {
    priced.billable = 0;
    priced.billableEnabled = false;
  }
  const row = {
    client_id: clientId,
    project_id: projectId || null,
    cost_center_id: costCenterId || null,
    source_type: type,
    provider: clean(provider, 100) || null,
    description: clean(description, 500) || `${type} — coût client`,
    actual_cost_minor: priced.actual,
    markup_percent: priced.markupPercent,
    billable_minor: priced.billable,
    currency: 'EUR',
    billable: priced.billableEnabled,
    external_ref: clean(externalRef, 300) || null,
    incurred_at: incurredAt && !Number.isNaN(Date.parse(incurredAt)) ? new Date(incurredAt).toISOString() : new Date().toISOString(),
    metadata: {
      ...metadata,
      evidence_status: normalizedEvidence,
      verification_ref: clean(verificationRef || metadata.verification_ref, 500) || null,
      calculation_method: clean(calculationMethod || metadata.calculation_method, 300) || null,
      calculation_inputs: calculationInputs || metadata.calculation_inputs || null,
      billing_mode: priced.mode,
    },
  };
  const inserted = await crmInsert('client_cost_events', row, externalRef ? 'source_type,external_ref' : null);
  if (inserted?.[0]) return inserted[0];
  if (row.external_ref) {
    const existing = await crmSelect(costEventLookupPath(type, row.external_ref));
    if (existing?.[0]) return existing[0];
    throw new Error('Coût idempotent ignoré mais événement existant introuvable.');
  }
  return row;
}

async function collectMapping(mapping, window) {
  if (mapping.service_type === 'openai_project') return importOpenAICharges(mapping, window.year, window.monthNumber);
  if (['railway_project', 'railway_service'].includes(mapping.service_type)) return importRailwayCharges(mapping, window.year, window.monthNumber);
  if (['github_user', 'github_org', 'github_repo'].includes(mapping.service_type)) return importGitHubCharges(mapping, window.year, window.monthNumber);
  if (mapping.service_type === 'twilio_account') return importTwilioCharges(mapping, window.year, window.monthNumber);
  if (['supabase_project', 'dropbox_account', 'media_provider'].includes(mapping.service_type)) {
    return importVerifiedAdapterCharges(mapping, window.year, window.monthNumber);
  }
  return { lines: [], totalEurMinor: 0, error: 'Cette source exige une facture vérifiée ou une remontée d’usage signée.' };
}

async function importCostCenter(center, window) {
  if (!center?.client_id) throw new Error('Cost center sans client_id canonique');
  await getClient(center.client_id);
  const mappings = await crmSelect(`client_external_mappings?select=*&cost_center_id=eq.${encodeURIComponent(center.id)}&is_active=eq.true&limit=500`);
  const allMappings = await crmSelect('client_external_mappings?select=*&is_active=eq.true&limit=5000');
  if (allMappings.length >= 5000) throw new Error('Registre trop volumineux pour vérifier les chevauchements');
  const projectId = clean(center.metadata?.project_id, 120);
  if (!projectId) throw new Error('Centre sans projet métier validé : import bloqué');
  const project = await agentFetch(`/data/Projet/${encodeURIComponent(projectId)}`);
  if (String(project?.client_id) !== String(center.client_id)) throw new Error('Le projet du centre appartient à un autre client');
  const results = [];

  for (const mapping of mappings || []) {
    if (mappingConflict(mapping, allMappings)) throw new Error('Rattachements fournisseurs qui se chevauchent : import bloqué');
    const result = await collectMapping(mapping, window);
    let created = 0;
    for (const line of result.lines || []) {
      if (minor(line.total_minor) <= 0) continue;
      const sourceType = ({
        railway: 'railway', github: 'github', twilio: 'twilio',
        supabase: 'supabase', dropbox: 'dropbox', media_ai: 'media_ai',
      })[line.line_type] || 'llm_api';
      const ref = line.external_ref || `${sourceType}:${mapping.external_id}:${window.month}:${crypto.randomUUID()}`;
      const exists = await crmSelect(`client_cost_events?select=id,client_id,project_id,actual_cost_minor&source_type=eq.${encodeURIComponent(sourceType)}&external_ref=eq.${encodeURIComponent(ref)}&limit=1`);
      if (exists?.length) {
        if (String(exists[0].client_id) !== String(center.client_id) || exists[0].project_id !== projectId
          || Number(exists[0].actual_cost_minor) !== minor(line.total_minor)) throw new Error('Coût fournisseur déjà enregistré avec montant ou attribution différent : rapprochement requis');
        continue;
      }
      await createCostEvent({
        clientId: center.client_id,
        projectId,
        costCenterId: center.id,
        sourceType,
        provider: sourceType === 'llm_api' ? 'openai' : sourceType,
        description: line.description,
        actualCostMinor: line.total_minor,
        externalRef: ref,
        incurredAt: window.start.toISOString(),
        evidenceStatus: line.metadata?.evidence_status || 'unverified',
        verificationRef: line.metadata?.verification_ref || null,
        calculationMethod: line.metadata?.calculation_method || null,
        calculationInputs: line.metadata?.calculation_inputs || null,
        metadata: { ...(line.metadata || {}), billable: center.metadata?.billable !== false, mapping_id: mapping.id, canonical_project_id: projectId, period: window.month },
      });
      created += 1;
    }
    results.push({
      mapping_id: mapping.id,
      service_type: mapping.service_type,
      external_label: mapping.external_label || mapping.external_id,
      created,
      status: result.error ? 'blocked' : 'completed',
      error: result.error || null,
    });
  }
  return results;
}

async function listCostEvents(clientId, window, onlyUnbilled = false) {
  const filters = [
    'select=*',
    `client_id=eq.${encodeURIComponent(clientId)}`,
    `incurred_at=gte.${encodeURIComponent(window.start.toISOString())}`,
    `incurred_at=lt.${encodeURIComponent(window.end.toISOString())}`,
    'order=incurred_at.asc',
    'limit=5000',
  ];
  if (onlyUnbilled) {
    filters.push('billable=eq.true');
    filters.push('facture_id=is.null');
  }
  return crmSelect(`client_cost_events?${filters.join('&')}`);
}

function summarize(events) {
  const accounting = summarizeAccounting(events);
  const internalCost = accounting.verified_cost_minor + accounting.estimated_cost_minor;
  return {
    actual_cost_minor: accounting.actual_cost_minor,
    manual_verified_minor: accounting.manual_verified_minor,
    verified_cost_minor: accounting.verified_cost_minor,
    estimated_cost_minor: accounting.estimated_cost_minor,
    billable_minor: accounting.billable_minor,
    margin_minor: Math.max(0, accounting.billable_minor - internalCost),
    unverified_events: accounting.unverified_events,
    by_source: accounting.by_source,
    accounting,
  };
}

async function nextCoreInvoiceNumber(year) {
  const rows = await agentFetch('/data/Facture?sort=created_at&order=desc&limit=1000');
  let max = 0;
  const pattern = new RegExp(`^FAC-${year}-(\\d{4,})$`, 'i');
  for (const row of Array.isArray(rows) ? rows : []) {
    const match = String(row.numero || '').match(pattern);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return `FAC-${year}-${String(max + 1).padStart(4, '0')}`;
}

function buildInvoiceLines(events) {
  const groups = new Map();
  for (const event of events) {
    if (evidenceStatus(event) === 'unverified' || !event.billable || minor(event.billable_minor) <= 0) continue;
    const key = event.source_type || 'other';
    const current = groups.get(key) || { description: key, total: 0, count: 0 };
    current.total += minor(event.billable_minor);
    current.count += 1;
    groups.set(key, current);
  }
  const labels = {
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
  return [...groups.entries()].map(([key, group]) => ({
    description: `${labels[key] || labels.other} — ${group.count} événement(s)`,
    quantite: 1,
    prix_unitaire: Number((group.total / 100).toFixed(2)),
    total: Number((group.total / 100).toFixed(2)),
  }));
}

// Vue comptable globale : ne mélange jamais coûts réels, estimations et sources non vérifiées.
router.get('/accounting/overview', async (req, res) => {
  try {
    const window = monthWindow(req.query.month);
    const events = await crmSelect(
      `client_cost_events?select=*&incurred_at=gte.${encodeURIComponent(window.start.toISOString())}&incurred_at=lt.${encodeURIComponent(window.end.toISOString())}&order=incurred_at.desc&limit=10000`,
    );
    const mappings = await crmSelect('client_external_mappings?select=*&is_active=eq.true&limit=5000').catch(() => []);
    const accounting = summarizeAccounting(events || []);
    const localRates = await loadLocalRates();
    const coverageEnv = {
      ...process.env,
      LOCAL_AI_POWER_WATTS: localRates.power_watts,
      LOCAL_AI_ENERGY_EUR_KWH: localRates.energy_eur_kwh,
      LOCAL_AI_MACHINE_EUR_HOUR: localRates.machine_eur_hour,
    };
    const sources = buildSourceCoverage(coverageEnv, mappings || [], events || []);
    return res.json({
      month: window.month,
      currency: 'EUR',
      accounting,
      sources,
      completeness: accountingCompleteness(sources),
      local_rates: localRates,
      rules: {
        actual: 'Montant fournisseur reçu par API avec une référence vérifiable.',
        manual_verified: 'Montant saisi manuellement avec référence de facture ou justificatif.',
        estimated: 'Calcul interne documenté, séparé des dépenses fournisseur réelles.',
        unverified: 'Exclu des totaux et de la facturation tant qu’une preuve manque.',
      },
    });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

router.get('/accounting/local-rates', async (_req, res) => {
  try {
    return res.json({ rates: await loadLocalRates() });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

router.put('/accounting/local-rates', async (req, res) => {
  try {
    const rates = normalizedLocalRates(req.body || {}, 'cockpit');
    if (!(rates.power_watts > 0) || !(rates.energy_eur_kwh > 0) || !(rates.machine_eur_hour > 0)) {
      return res.status(400).json({ error: 'Puissance, prix du kWh et coût machine/heure doivent être supérieurs à zéro.' });
    }
    const rows = await crmUpsert('cost_accounting_settings', {
      settings_key: 'local_ai_rates',
      settings: {
        power_watts: rates.power_watts,
        energy_eur_kwh: rates.energy_eur_kwh,
        machine_eur_hour: rates.machine_eur_hour,
      },
      updated_at: new Date().toISOString(),
    }, 'settings_key');
    return res.json({ success: true, rates, stored: rows?.[0] || null });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get('/accounting/cost-centers', async (_req, res) => {
  try {
    const centers = await crmSelect('client_cost_centers?select=*&is_active=eq.true&order=client_name.asc&limit=1000');
    const mappings = await crmSelect('client_external_mappings?select=*&is_active=eq.true&order=created_at.asc&limit=5000').catch(() => []);
    return res.json({
      centers: (centers || []).map((center) => ({
        ...center,
        mappings: (mappings || []).filter((mapping) => mapping.cost_center_id === center.id),
      })),
      mapping_types: [...MAPPING_TYPES],
    });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

router.get('/accounting/clients', async (_req, res) => {
  try {
    const clients = await agentFetch('/data/Client?limit=2000');
    const projects = await agentFetch('/data/Projet?limit=2000');
    const centers = await crmSelect('client_cost_centers?select=id,client_id,product_code&is_active=eq.true&limit=2000').catch(() => []);
    return res.json({
      clients: (Array.isArray(clients) ? clients : []).map((client) => ({
        id: client.id,
        name: clientName(client),
        projects: (Array.isArray(projects) ? projects : []).filter((project) => String(project.client_id) === String(client.id)).map((project) => ({ id: project.id, name: project.nom })),
        cost_centers: (centers || []).filter((center) => String(center.client_id) === String(client.id)),
      })).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

router.post('/accounting/cost-centers', async (req, res) => {
  try {
    const client = await getClient(clean(req.body?.client_id, 120));
    const projectId = clean(req.body?.project_id, 120);
    if (!projectId) return res.status(400).json({ error: 'Projet métier requis pour créer un centre de coût' });
    const project = await agentFetch(`/data/Projet/${encodeURIComponent(projectId)}`);
    if (String(project?.client_id) !== String(client.id)) return res.status(400).json({ error: 'Le projet doit appartenir au client sélectionné' });
    const rawCode = clean(req.body?.product_code, 100) || `CLIENT_${client.id}`;
    const productCode = rawCode.toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
    if (!productCode) return res.status(400).json({ error: 'Code projet invalide' });
    const existing = await crmSelect(`client_cost_centers?select=*&client_id=eq.${encodeURIComponent(client.id)}&product_code=eq.${encodeURIComponent(productCode)}&is_active=eq.true&limit=1`).catch(() => []);
    if (existing?.[0]) {
      if (existing[0].metadata?.project_id !== projectId) return res.status(409).json({ error: 'Ce code existe déjà avec un autre projet ou un rattachement à vérifier' });
      return res.json({ success: true, cost_center: existing[0], status: 'already_exists' });
    }
    const rows = await crmInsert('client_cost_centers', {
      client_id: String(client.id),
      product_code: productCode,
      client_name: clientName(client),
      client_email: clean(client.email, 200) || null,
      client_address: clean(client.adresse || client.adresse_complete, 500) || null,
      client_vat_number: clean(client.numero_tva || client.tva, 80) || null,
      monthly_fee_minor: 0,
      currency: 'EUR',
      is_active: true,
      metadata: { created_from: 'ai_cost_control', canonical_client_id: String(client.id), project_id: projectId, billable: false, billing_activation_requires_review: true },
    });
    return res.status(201).json({ success: true, cost_center: rows?.[0] });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/accounting/cost-centers/:id/mappings', async (req, res) => {
  try {
    const serviceType = clean(req.body?.service_type, 80).toLowerCase();
    const externalId = clean(req.body?.external_id, 300);
    if (!MAPPING_TYPES.has(serviceType)) return res.status(400).json({ error: 'Type de source non pris en charge' });
    if (!externalId) return res.status(400).json({ error: 'Identifiant fournisseur requis' });
    const centers = await crmSelect(`client_cost_centers?select=id,client_id&is_active=eq.true&id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
    if (!centers?.[0]?.client_id) return res.status(404).json({ error: 'Centre de coût client introuvable' });
    const existing = await crmSelect(`client_external_mappings?select=*&service_type=eq.${encodeURIComponent(serviceType)}&external_id=eq.${encodeURIComponent(externalId)}&is_active=eq.true&limit=1`).catch(() => []);
    if (existing?.[0] && existing[0].cost_center_id !== req.params.id) {
      return res.status(409).json({ error: 'Cet identifiant fournisseur appartient déjà à un autre client/projet' });
    }
    if (existing?.[0]) return res.json({ success: true, mapping: existing[0], status: 'already_exists' });
    const allMappings = await crmSelect('client_external_mappings?select=*&is_active=eq.true&limit=5000');
    if (allMappings.length >= 5000) return res.status(409).json({ error: 'Registre trop volumineux pour vérifier les chevauchements' });
    const candidate = { service_type: serviceType, external_id: externalId, metadata: req.body?.metadata || {} };
    if (serviceType === 'railway_service' && !clean(candidate.metadata.project_id)) return res.status(400).json({ error: 'project_id Railway requis pour un service' });
    if (mappingConflict(candidate, allMappings)) return res.status(409).json({ error: 'Ce rattachement chevauche un compte, projet ou service déjà configuré' });
    const rows = await crmInsert('client_external_mappings', {
      cost_center_id: req.params.id,
      service_type: serviceType,
      external_id: externalId,
      external_label: clean(req.body?.external_label, 300) || externalId,
      metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
      is_active: true,
    });
    return res.status(201).json({ success: true, mapping: rows?.[0] });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/accounting/sync', async (req, res) => {
  try {
    const window = monthWindow(req.body?.month || req.query?.month);
    const centers = await crmSelect('client_cost_centers?select=*&is_active=eq.true&client_id=not.is.null&limit=1000');
    const results = [];
    for (const center of centers || []) {
      try {
        results.push({ cost_center_id: center.id, client_id: center.client_id, results: await importCostCenter(center, window) });
      } catch (error) {
        results.push({ cost_center_id: center.id, client_id: center.client_id, error: error.message, results: [] });
      }
    }
    const flat = results.flatMap((row) => row.results || []);
    return res.json({
      success: true,
      month: window.month,
      centers: results.length,
      imported_events: flat.reduce((sum, item) => sum + Number(item.created || 0), 0),
      completed_sources: flat.filter((item) => item.status === 'completed').length,
      blocked_sources: flat.filter((item) => item.status === 'blocked').length,
      results,
    });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

// Résumé par client : coût fournisseur, montant à refacturer et marge.
router.get('/clients/:clientId/summary', async (req, res) => {
  try {
    const client = await getClient(req.params.clientId);
    const window = monthWindow(req.query.month);
    const events = await listCostEvents(client.id, window, false);
    return res.json({ client_id: client.id, client_name: clientName(client), month: window.month, ...summarize(events), events });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

// Ingestion générique pour GitHub, Dropbox, Supabase, Twilio, API média, etc.
router.post('/clients/:clientId/events', async (req, res) => {
  try {
    const sourceType = clean(req.body?.source_type, 60).toLowerCase();
    const evidenceStatus = clean(req.body?.evidence_status, 40).toLowerCase() || 'unverified';
    if (req.body?.actual_cost_minor === undefined && req.body?.actual_cost_eur === undefined) {
      return res.status(400).json({ error: 'actual_cost_minor ou actual_cost_eur requis; une absence de montant ne vaut pas zéro' });
    }
    const actualCostMinor = req.body?.actual_cost_minor !== undefined
      ? minor(req.body.actual_cost_minor)
      : minor(Number(req.body?.actual_cost_eur || 0) * 100);
    const event = await createCostEvent({
      clientId: req.params.clientId,
      projectId: clean(req.body?.project_id, 120) || null,
      costCenterId: clean(req.body?.cost_center_id, 120) || null,
      sourceType,
      provider: req.body?.provider,
      description: req.body?.description,
      actualCostMinor,
      externalRef: req.body?.external_ref,
      incurredAt: req.body?.incurred_at,
      metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
      evidenceStatus,
      verificationRef: req.body?.verification_ref,
      calculationMethod: req.body?.calculation_method,
      calculationInputs: req.body?.calculation_inputs,
    });
    return res.status(201).json({ success: true, event });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// IA locale : coût estimé à partir du temps machine + énergie configurée.
router.post('/clients/:clientId/local-ai', async (req, res) => {
  try {
    const seconds = Math.max(0, Number(req.body?.runtime_seconds || 0));
    if (!seconds) return res.status(400).json({ error: 'runtime_seconds requis' });
    const hours = seconds / 3600;
    const storedRates = await loadLocalRates();
    const telemetry = normalizeLocalTelemetry(req.body?.telemetry, seconds);
    const configuredPowerWatts = Math.max(0, Number(req.body?.power_watts ?? storedRates.power_watts));
    const telemetryLoadRatio = telemetry
      ? telemetry.power.average_estimated_system_watts / (telemetry.power.configured_ceiling_watts || telemetry.power.average_estimated_system_watts)
      : 1;
    const powerWatts = telemetry
      ? Number((configuredPowerWatts * Math.max(0.05, Math.min(1.5, telemetryLoadRatio))).toFixed(3))
      : configuredPowerWatts;
    const energyRate = Math.max(0, Number(req.body?.energy_eur_kwh ?? storedRates.energy_eur_kwh));
    const machineRate = Math.max(0, Number(req.body?.machine_eur_hour ?? storedRates.machine_eur_hour));
    if (!(powerWatts > 0) || !(energyRate > 0) || !(machineRate > 0)) {
      return res.status(422).json({
        error: 'Tarification IA locale incomplète: puissance, prix du kWh et coût machine/heure doivent être supérieurs à zéro.',
        code: 'local_ai_rates_unconfigured',
      });
    }
    const energyEur = hours * (powerWatts / 1000) * energyRate;
    const machineEur = hours * machineRate;
    const actualCostMinor = minor((energyEur + machineEur) * 100);
    const externalRef = clean(req.body?.external_ref, 300) || `local-ai:${crypto.randomUUID()}`;

    const event = await createCostEvent({
      clientId: req.params.clientId,
      projectId: clean(req.body?.project_id, 120) || null,
      costCenterId: clean(req.body?.cost_center_id, 120) || null,
      sourceType: 'local_ai',
      provider: 'jsinnovia-local',
      description: req.body?.description || `IA locale — ${clean(req.body?.model, 120) || 'modèle local'}`,
      actualCostMinor,
      externalRef,
      evidenceStatus: 'estimated',
      calculationMethod: telemetry ? 'local_agent_telemetry_machine_plus_energy' : 'runtime_machine_plus_energy',
      calculationInputs: {
        runtime_seconds: seconds,
        power_watts: powerWatts,
        configured_power_watts: configuredPowerWatts,
        telemetry_load_ratio: telemetry ? Number(telemetryLoadRatio.toFixed(6)) : null,
        power_source: telemetry ? 'local_agent_telemetry_estimate' : 'configured_nominal_power',
        energy_eur_kwh: energyRate,
        machine_eur_hour: machineRate,
        telemetry_summary_id: telemetry?.summary_id || null,
        telemetry_sample_count: telemetry?.sample_count || 0,
      },
      metadata: {
        runtime_seconds: seconds,
        power_watts: powerWatts,
        configured_power_watts: configuredPowerWatts,
        telemetry_load_ratio: telemetry ? Number(telemetryLoadRatio.toFixed(6)) : null,
        energy_eur_kwh: energyRate,
        machine_eur_hour: machineRate,
        energy_eur: Number(energyEur.toFixed(6)),
        machine_eur: Number(machineEur.toFixed(6)),
        model: clean(req.body?.model, 120) || null,
        telemetry,
        telemetry_used: Boolean(telemetry),
        power_source: telemetry ? 'local_agent_telemetry_estimate' : 'configured_nominal_power',
        estimated: true,
      },
    });
    return res.status(201).json({
      success: true,
      event,
      calculation: {
        evidence_status: 'estimated',
        telemetry_used: Boolean(telemetry),
        power_watts: powerWatts,
        energy_eur: Number(energyEur.toFixed(6)),
        machine_eur: Number(machineEur.toFixed(6)),
        total_eur: Number((energyEur + machineEur).toFixed(6)),
      },
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// Pont AI Cost Control -> ledger client canonique. client_key doit être Client.id.
router.post('/clients/:clientId/import-ai-usage', async (req, res) => {
  try {
    if (!AI_KEY) throw new Error('Supabase AI Cost non configuré');
    const client = await getClient(req.params.clientId);
    const window = monthWindow(req.body?.month || req.query?.month);
    const rows = await rest(AI_URL, AI_KEY,
      `ai_cost_usage?select=*&client_key=eq.${encodeURIComponent(client.id)}&created_at=gte.${encodeURIComponent(window.start.toISOString())}&created_at=lt.${encodeURIComponent(window.end.toISOString())}&order=created_at.asc&limit=10000`,
      { method: 'GET' },
    );
    let imported = 0;
    for (const row of rows || []) {
      if (row.pricing_warning === 'model_unpriced') {
        return res.status(422).json({ error: `Modèle non tarifé: ${row.model || 'inconnu'}`, code: 'ai_usage_unpriced' });
      }
      const externalRef = `ai-usage:${row.request_id || row.id}`;
      const before = await crmSelect(`client_cost_events?select=id&source_type=eq.llm_api&external_ref=eq.${encodeURIComponent(externalRef)}&limit=1`).catch(() => []);
      if (before?.length) continue;
      const converted = sourceToEurMinor(Number(row.cost_usd || 0), 'USD', process.env);
      const estimated = row.cost_estimated !== false;
      await createCostEvent({
        clientId: client.id,
        sourceType: 'llm_api',
        provider: row.provider || 'openai',
        description: `LLM API — ${row.model || 'modèle'}`,
        actualCostMinor: converted.totalMinor,
        externalRef,
        incurredAt: row.created_at,
        evidenceStatus: estimated ? 'estimated' : 'actual',
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
          input_tokens: row.input_tokens,
          output_tokens: row.output_tokens,
          cost_usd: row.cost_usd,
          cost_estimated: row.cost_estimated,
          source_currency: 'USD',
          fx_rate: converted.fxRate,
          fx_source: converted.fxSource,
        },
      });
      imported += 1;
    }
    return res.json({ success: true, client_id: client.id, month: window.month, imported, scanned: rows?.length || 0 });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

// Import des fournisseurs depuis leurs preuves API, puis ledger canonique.
router.post('/cost-centers/:id/import-external', async (req, res) => {
  try {
    const centers = await crmSelect(`client_cost_centers?select=*&id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
    const center = centers?.[0];
    if (!center?.client_id) return res.status(422).json({ error: 'Cost center sans client_id canonique' });
    const window = monthWindow(req.body?.month || req.query?.month);
    const results = await importCostCenter(center, window);
    return res.json({ success: true, client_id: center.client_id, month: window.month, results });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

// Règle de marge/inclusion par client et type de coût.
router.put('/clients/:clientId/rules/:costType', async (req, res) => {
  try {
    const client = await getClient(req.params.clientId);
    const costType = clean(req.params.costType, 60).toLowerCase();
    if (costType !== 'all' && !SOURCE_TYPES.has(costType)) return res.status(400).json({ error: 'Type de coût invalide' });
    const mode = ['percent', 'at_cost', 'fixed', 'included'].includes(req.body?.billing_mode) ? req.body.billing_mode : 'percent';
    const payload = {
      client_id: client.id,
      cost_type: costType,
      enabled: req.body?.enabled !== false,
      billing_mode: mode,
      markup_percent: percent(req.body?.markup_percent, 0),
      fixed_fee_minor: minor(req.body?.fixed_fee_minor),
      minimum_minor: minor(req.body?.minimum_minor),
      notes: clean(req.body?.notes, 1000) || null,
      metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
      updated_at: new Date().toISOString(),
    };
    const rows = await rest(CRM_URL, CRM_KEY, 'client_billing_rules?on_conflict=client_id,cost_type', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(payload),
    });
    return res.json({ success: true, rule: rows?.[0] || payload });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// Génère une facture CORE Facture liée au Client.id à partir des coûts non encore facturés.
router.post('/clients/:clientId/generate-draft', async (req, res) => {
  try {
    const client = await getClient(req.params.clientId);
    const window = monthWindow(req.body?.month || req.query?.month);
    const events = await listCostEvents(client.id, window, true);
    const eligibleEvents = (events || []).filter((event) => evidenceStatus(event) !== 'unverified');
    const lines = buildInvoiceLines(eligibleEvents);
    if (!lines.length) return res.status(409).json({ error: 'Aucun coût refacturable non facturé pour cette période' });

    const amountHt = Number(lines.reduce((sum, line) => sum + Number(line.total || 0), 0).toFixed(2));
    const vat = Number((amountHt * 0.21).toFixed(2));
    const amountTtc = Number((amountHt + vat).toFixed(2));
    const numero = await nextCoreInvoiceNumber(window.year);
    const due = new Date();
    due.setUTCDate(due.getUTCDate() + 30);

    const invoice = await agentFetch('/data/Facture', {
      method: 'POST',
      body: JSON.stringify({
        numero,
        objet: `Frais techniques et IA — ${window.month}`,
        client_id: client.id,
        client_nom: clientName(client),
        lignes: lines,
        montant_ht: amountHt,
        tva: vat,
        montant_ttc: amountTtc,
        statut: 'brouillon',
        date_echeance: due.toISOString().slice(0, 10),
        periode: window.month,
        notes: 'Générée depuis le ledger client_cost_events. Les coûts réels et marges restent auditables côté Cockpit.',
      }),
    });

    if (!invoice?.id) throw new Error('Facture créée sans identifiant');
    const eventIds = eligibleEvents.map((event) => event.id).filter(Boolean);
    if (eventIds.length) {
      await crmPatch(
        'client_cost_events',
        `id=in.(${eventIds.map((id) => encodeURIComponent(id)).join(',')})&facture_id=is.null`,
        { facture_id: String(invoice.id) },
      );
    }

    return res.status(201).json({ success: true, client_id: client.id, month: window.month, invoice, source_events: eligibleEvents.length, excluded_unverified: (events || []).length - eligibleEvents.length });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

module.exports = {
  router,
  createCostEvent,
  costEventLookupPath,
  applyBillingRule,
  summarize,
  buildInvoiceLines,
  monthWindow,
  normalizedLocalRates,
  normalizeLocalTelemetry,
  crmRequest,
};
