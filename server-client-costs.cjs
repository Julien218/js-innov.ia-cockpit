const express = require('express');
const crypto = require('crypto');
const { importOpenAICharges, importRailwayCharges } = require('./server-cost-centers.cjs');

const router = express.Router();

const CRM_URL = process.env.SUPABASE_CRM_URL || 'https://gfjpryakxzdzwnazlsfz.supabase.co';
const CRM_KEY = process.env.SUPABASE_CRM_KEY || '';
const AI_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const AI_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.VITE_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '';

const DEFAULT_MARKUP_PERCENT = Math.max(0, Number(process.env.CLIENT_COST_DEFAULT_MARKUP_PERCENT || 0));
const LOCAL_AI_POWER_WATTS = Math.max(0, Number(process.env.LOCAL_AI_POWER_WATTS || 0));
const LOCAL_AI_ENERGY_EUR_KWH = Math.max(0, Number(process.env.LOCAL_AI_ENERGY_EUR_KWH || 0));
const LOCAL_AI_MACHINE_EUR_HOUR = Math.max(0, Number(process.env.LOCAL_AI_MACHINE_EUR_HOUR || 0));

const SOURCE_TYPES = new Set([
  'llm_api', 'railway', 'local_ai', 'github', 'storage', 'communications',
  'api', 'media_ai', 'supabase', 'dropbox', 'twilio', 'other',
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
  if (!key) throw new Error('Configuration Supabase serveur manquante');
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: { ...authHeaders(key), ...(options.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error || `Supabase ${response.status}`);
  return data;
}

async function crmSelect(path) {
  return rest(CRM_URL, CRM_KEY, path, { method: 'GET' });
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
}) {
  await getClient(clientId);
  const type = SOURCE_TYPES.has(sourceType) ? sourceType : 'other';
  const rule = await loadBillingRule(clientId, type);
  const priced = applyBillingRule(actualCostMinor, rule);
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
    metadata: { ...metadata, billing_mode: priced.mode },
  };
  const inserted = await crmInsert('client_cost_events', row, externalRef ? 'source_type,external_ref' : null);
  return inserted?.[0] || row;
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
  const bySource = {};
  let actual = 0;
  let billable = 0;
  for (const event of events || []) {
    actual += minor(event.actual_cost_minor);
    billable += event.billable ? minor(event.billable_minor) : 0;
    const key = event.source_type || 'other';
    bySource[key] ||= { source_type: key, actual_cost_minor: 0, billable_minor: 0, events: 0 };
    bySource[key].actual_cost_minor += minor(event.actual_cost_minor);
    bySource[key].billable_minor += event.billable ? minor(event.billable_minor) : 0;
    bySource[key].events += 1;
  }
  return {
    actual_cost_minor: actual,
    billable_minor: billable,
    margin_minor: Math.max(0, billable - actual),
    by_source: Object.values(bySource),
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
    if (!event.billable || minor(event.billable_minor) <= 0) continue;
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
    const powerWatts = Math.max(0, Number(req.body?.power_watts ?? LOCAL_AI_POWER_WATTS));
    const energyRate = Math.max(0, Number(req.body?.energy_eur_kwh ?? LOCAL_AI_ENERGY_EUR_KWH));
    const machineRate = Math.max(0, Number(req.body?.machine_eur_hour ?? LOCAL_AI_MACHINE_EUR_HOUR));
    const energyEur = hours * (powerWatts / 1000) * energyRate;
    const machineEur = hours * machineRate;
    const actualCostMinor = minor((energyEur + machineEur) * 100);
    const externalRef = clean(req.body?.external_ref, 300) || `local-ai:${crypto.randomUUID()}`;

    const event = await createCostEvent({
      clientId: req.params.clientId,
      projectId: clean(req.body?.project_id, 120) || null,
      sourceType: 'local_ai',
      provider: 'jsinnovia-local',
      description: req.body?.description || `IA locale — ${clean(req.body?.model, 120) || 'modèle local'}`,
      actualCostMinor,
      externalRef,
      metadata: {
        runtime_seconds: seconds,
        power_watts: powerWatts,
        energy_eur_kwh: energyRate,
        machine_eur_hour: machineRate,
        energy_eur: Number(energyEur.toFixed(6)),
        machine_eur: Number(machineEur.toFixed(6)),
        model: clean(req.body?.model, 120) || null,
        estimated: true,
      },
    });
    return res.status(201).json({ success: true, event });
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
      const externalRef = `ai-usage:${row.request_id || row.id}`;
      const before = await crmSelect(`client_cost_events?select=id&source_type=eq.llm_api&external_ref=eq.${encodeURIComponent(externalRef)}&limit=1`).catch(() => []);
      if (before?.length) continue;
      await createCostEvent({
        clientId: client.id,
        sourceType: 'llm_api',
        provider: row.provider || 'openai',
        description: `LLM API — ${row.model || 'modèle'}`,
        actualCostMinor: minor(Number(row.cost_usd || 0) * Number(process.env.BILLING_EUR_PER_USD || 0.92) * 100),
        externalRef,
        incurredAt: row.created_at,
        metadata: {
          ai_cost_usage_id: row.id,
          request_id: row.request_id,
          model: row.model,
          input_tokens: row.input_tokens,
          output_tokens: row.output_tokens,
          cost_usd: row.cost_usd,
          cost_estimated: row.cost_estimated,
        },
      });
      imported += 1;
    }
    return res.json({ success: true, client_id: client.id, month: window.month, imported, scanned: rows?.length || 0 });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

// Import OpenAI/Railway depuis les mappings existants du cost center, puis ledger canonique.
router.post('/cost-centers/:id/import-external', async (req, res) => {
  try {
    const centers = await crmSelect(`client_cost_centers?select=*&id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
    const center = centers?.[0];
    if (!center?.client_id) return res.status(422).json({ error: 'Cost center sans client_id canonique' });
    await getClient(center.client_id);
    const window = monthWindow(req.body?.month || req.query?.month);
    const mappings = await crmSelect(`client_external_mappings?select=*&cost_center_id=eq.${encodeURIComponent(center.id)}&is_active=eq.true&limit=500`);
    const results = [];

    for (const mapping of mappings || []) {
      let result = null;
      if (mapping.service_type === 'openai_project') result = await importOpenAICharges(mapping, window.year, window.monthNumber);
      if (mapping.service_type === 'railway_project') result = await importRailwayCharges(mapping, window.year, window.monthNumber);
      if (!result) continue;

      let created = 0;
      for (const line of result.lines || []) {
        if (minor(line.total_minor) <= 0) continue;
        const sourceType = line.line_type === 'railway' ? 'railway' : 'llm_api';
        const ref = line.external_ref || `${sourceType}:${mapping.external_id}:${window.month}:${crypto.randomUUID()}`;
        const exists = await crmSelect(`client_cost_events?select=id&source_type=eq.${encodeURIComponent(sourceType)}&external_ref=eq.${encodeURIComponent(ref)}&limit=1`).catch(() => []);
        if (exists?.length) continue;
        await createCostEvent({
          clientId: center.client_id,
          costCenterId: center.id,
          sourceType,
          provider: sourceType === 'railway' ? 'railway' : 'openai',
          description: line.description,
          actualCostMinor: line.total_minor,
          externalRef: ref,
          incurredAt: window.start.toISOString(),
          metadata: { ...(line.metadata || {}), mapping_id: mapping.id, period: window.month },
        });
        created += 1;
      }
      results.push({ mapping_id: mapping.id, service_type: mapping.service_type, created, error: result.error || null });
    }
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
    const lines = buildInvoiceLines(events || []);
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
    await crmPatch(
      'client_cost_events',
      `client_id=eq.${encodeURIComponent(client.id)}&incurred_at=gte.${encodeURIComponent(window.start.toISOString())}&incurred_at=lt.${encodeURIComponent(window.end.toISOString())}&facture_id=is.null&billable=eq.true`,
      { facture_id: String(invoice.id) },
    );

    return res.status(201).json({ success: true, client_id: client.id, month: window.month, invoice, source_events: events.length });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

module.exports = {
  router,
  applyBillingRule,
  summarize,
  buildInvoiceLines,
  monthWindow,
};
