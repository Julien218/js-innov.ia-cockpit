const express = require('express');
const { stableRef } = require('./server-cost-accounting-core.cjs');
const { crmRequest } = require('./server-client-costs.cjs');

const router = express.Router();

const CRM_URL = process.env.SUPABASE_CRM_URL || 'https://gfjpryakxzdzwnazlsfz.supabase.co';
const CRM_KEY = process.env.SUPABASE_CRM_KEY || '';
const AI_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const AI_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.VITE_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '';
const EUR_PER_USD = Math.max(0, Number(process.env.BILLING_EUR_PER_USD || 0));
const FX_SOURCE = String(process.env.BILLING_FX_SOURCE || '').trim();
const DEFAULT_MARKUP_PERCENT = Math.max(0, Number(process.env.CLIENT_COST_DEFAULT_MARKUP_PERCENT || 0));

function safe(value, max = 300) {
  return String(value || '').trim().slice(0, max);
}

function nonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
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
  if (base === CRM_URL) return crmRequest(path, options);
  if (!key) throw new Error('Configuration Supabase serveur manquante');
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: { ...authHeaders(key), ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) throw new Error(data?.message || data?.error || `Supabase ${response.status}`);
  return data;
}

async function agentFetch(path) {
  if (!AGENT_KEY) throw new Error('AGENT_API_KEY manquante');
  const response = await fetch(`${AGENT_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY },
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

async function loadRule(clientId) {
  const path = `client_billing_rules?select=*&client_id=eq.${encodeURIComponent(clientId)}&enabled=eq.true&cost_type=in.(llm_api,all)&limit=10`;
  const rows = await rest(CRM_URL, CRM_KEY, path, { method: 'GET' }).catch(() => []);
  return (rows || []).find((row) => row.cost_type === 'llm_api')
    || (rows || []).find((row) => row.cost_type === 'all')
    || null;
}

function usageScope(row = {}) {
  const metadata = row.metadata || {};
  const distinct = (values) => new Set(values.map((value) => safe(value, 120)).filter(Boolean)).size;
  if (distinct([row.client_key, metadata.canonical_client_id]) > 1
    || distinct([row.project_key, metadata.canonical_project_id, metadata.project_id]) > 1) {
    throw new Error('Identifiants client/projet contradictoires dans une consommation IA');
  }
  const clientId = safe(row.client_key || metadata.canonical_client_id, 120) || null;
  const projectId = safe(row.project_key || metadata.canonical_project_id || metadata.project_id, 120) || null;
  const costCenterId = safe(metadata.cost_center_id, 120) || null;
  return { clientId, projectId, costCenterId, billable: metadata.billable !== false && Boolean(clientId && projectId) };
}

function aggregateAiUsage(rows = []) {
  const groups = new Map();
  const unpriced = [];

  for (const row of rows) {
    if (row?.pricing_warning === 'model_unpriced') {
      unpriced.push({ id: row.id, model: row.model || 'unknown' });
      continue;
    }
    const provider = safe(row?.provider || 'openai', 60) || 'openai';
    const model = safe(row?.model || 'unknown', 120) || 'unknown';
    const scope = usageScope(row);
    const key = JSON.stringify([scope.clientId, scope.projectId, scope.costCenterId, scope.billable, provider, model]);
    const current = groups.get(key) || {
      ...scope,
      provider,
      model,
      requests: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      estimatedRequests: 0,
      explicitCostRequests: 0,
    };
    current.requests += 1;
    current.inputTokens += nonNegative(row?.input_tokens);
    current.cachedInputTokens += nonNegative(row?.cached_input_tokens);
    current.outputTokens += nonNegative(row?.output_tokens);
    current.costUsd += nonNegative(row?.cost_usd);
    if (row?.cost_estimated === false) current.explicitCostRequests += 1;
    else current.estimatedRequests += 1;
    groups.set(key, current);
  }

  return { groups: [...groups.values()], unpriced };
}

function ledgerReference(clientId, month, group) {
  return `ai-usage-month-v2:${clientId}:${month}:${stableRef([group.projectId, group.costCenterId, group.billable, group.provider, group.model])}`;
}

function validateGroupScope(group, clientId, projects, centers) {
  if (group.clientId && group.clientId !== String(clientId)) throw new Error('Client de consommation incompatible');
  if (group.projectId && !projects.some((p) => String(p.id) === group.projectId && String(p.client_id) === String(clientId))) {
    throw new Error('Projet IA absent du registre ou rattaché à un autre client');
  }
  if (group.costCenterId && !centers.some((c) => String(c.id) === group.costCenterId && String(c.client_id) === String(clientId)
    && (!group.projectId || c.metadata?.project_id === group.projectId))) {
    throw new Error('Centre de coût incompatible avec le client/projet');
  }
}

function resolveUsageCenters(rows, clientId, projects, centers) {
  return rows.map((row) => {
    const scope = usageScope(row);
    validateGroupScope(scope, clientId, projects, centers);
    const matches = centers.filter((center) => String(center.client_id) === String(clientId)
      && (scope.costCenterId ? String(center.id) === scope.costCenterId : scope.projectId && center.metadata?.project_id === scope.projectId));
    const center = matches.length === 1 ? matches[0] : null;
    return { ...row, metadata: {
      ...(row.metadata || {}),
      cost_center_id: center?.id || scope.costCenterId,
      billable: scope.billable && matches.length <= 1 && center?.metadata?.billable !== false,
    } };
  });
}

function applyExactRule(actualEur, rule = null) {
  const actual = nonNegative(actualEur);
  const mode = ['percent', 'at_cost', 'fixed', 'included'].includes(rule?.billing_mode)
    ? rule.billing_mode
    : 'percent';

  if (mode === 'included') {
    return { actualEur: actual, billableEur: 0, markupPercent: 0, billable: false, mode };
  }

  if (mode === 'fixed') {
    const fixed = nonNegative(rule?.fixed_fee_minor) / 100;
    const minimum = nonNegative(rule?.minimum_minor) / 100;
    return {
      actualEur: actual,
      billableEur: Math.max(fixed, minimum),
      markupPercent: 0,
      billable: true,
      mode,
    };
  }

  const markupPercent = mode === 'at_cost'
    ? 0
    : nonNegative(rule?.markup_percent, DEFAULT_MARKUP_PERCENT);
  const minimum = nonNegative(rule?.minimum_minor) / 100;
  const billableEur = Math.max(actual * (1 + markupPercent / 100), minimum);
  return { actualEur: actual, billableEur, markupPercent, billable: true, mode };
}

async function upsertLedgerGroup(clientId, window, group, rule) {
  const exactUsd = Number(group.costUsd.toFixed(8));
  const exactEur = exactUsd * EUR_PER_USD;
  const priced = applyExactRule(exactEur, group.billable ? rule : { billing_mode: 'included' });
  const actualMinor = Math.max(0, Math.round(priced.actualEur * 100));
  const billableMinor = Math.max(0, Math.round(priced.billableEur * 100));
  const externalRef = ledgerReference(clientId, window.month, group);

  const existing = await rest(
    CRM_URL,
    CRM_KEY,
    `client_cost_events?select=id,facture_id,invoice_id&source_type=eq.llm_api&external_ref=eq.${encodeURIComponent(externalRef)}&limit=1`,
    { method: 'GET' },
  );

  if (existing?.[0]?.facture_id || existing?.[0]?.invoice_id) {
    return { status: 'locked_invoiced', externalRef, actualMinor, billableMinor };
  }

  const payload = {
    client_id: String(clientId),
    project_id: group.projectId,
    cost_center_id: group.costCenterId,
    source_type: 'llm_api',
    provider: group.provider,
    description: `LLM API — ${group.model} — ${window.month}`,
    actual_cost_minor: actualMinor,
    markup_percent: priced.markupPercent,
    billable_minor: billableMinor,
    currency: 'EUR',
    billable: priced.billable,
    external_ref: externalRef,
    incurred_at: window.start.toISOString(),
    metadata: {
      evidence_status: group.estimatedRequests > 0 ? 'estimated' : 'actual',
      verification_ref: group.estimatedRequests > 0 ? null : externalRef,
      calculation_method: group.estimatedRequests > 0 ? 'provider_token_pricing_monthly_aggregation' : null,
      calculation_inputs: group.estimatedRequests > 0 ? {
        request_count: group.requests,
        input_tokens: group.inputTokens,
        cached_input_tokens: group.cachedInputTokens,
        output_tokens: group.outputTokens,
        cost_usd_precise: exactUsd,
      } : null,
      aggregation: 'monthly_by_client_project_center_provider_model_v2',
      attribution_status: group.projectId ? 'project_verified' : 'project_unassigned',
      month: window.month,
      model: group.model,
      provider: group.provider,
      request_count: group.requests,
      estimated_request_count: group.estimatedRequests,
      explicit_cost_request_count: group.explicitCostRequests,
      input_tokens: group.inputTokens,
      cached_input_tokens: group.cachedInputTokens,
      output_tokens: group.outputTokens,
      cost_usd_precise: exactUsd,
      actual_cost_eur_precise: Number(priced.actualEur.toFixed(8)),
      billable_eur_precise: Number(priced.billableEur.toFixed(8)),
      eur_per_usd: EUR_PER_USD,
      fx_source: FX_SOURCE,
      billing_mode: priced.mode,
      rounding: 'aggregate_then_cent',
    },
  };

  // Insert-only on conflict, then conditional update: never overwrite an invoice
  // attached concurrently after our initial read.
  let rows = await rest(
    CRM_URL,
    CRM_KEY,
    'client_cost_events?on_conflict=source_type,external_ref',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(payload),
    },
  );
  if (!rows?.length) {
    rows = await rest(CRM_URL, CRM_KEY,
      `client_cost_events?source_type=eq.llm_api&external_ref=eq.${encodeURIComponent(externalRef)}&facture_id=is.null&invoice_id=is.null`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) });
    if (!rows?.length) return { status: 'locked_invoiced', externalRef, actualMinor, billableMinor };
  }

  return {
    status: existing?.length ? 'updated' : 'created',
    event: rows?.[0] || payload,
    exactUsd,
    exactEur: priced.actualEur,
    billableEur: priced.billableEur,
  };
}

// Route prioritaire : agrège les micro-coûts LLM avant l'arrondi au centime.
router.post('/clients/:clientId/import-ai-usage', async (req, res) => {
  try {
    if (!AI_KEY) throw new Error('Supabase AI Cost non configuré');
    if (!(EUR_PER_USD > 0) || !FX_SOURCE) {
      return res.status(422).json({ error: 'BILLING_EUR_PER_USD et BILLING_FX_SOURCE requis pour une conversion comptable traçable', code: 'fx_rate_unconfigured' });
    }
    const client = await getClient(req.params.clientId);
    const window = monthWindow(req.body?.month || req.query?.month);
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      if (offset >= 100000) throw new Error('Volume IA trop important pour cet import : aucun coût écrit');
      const page = await rest(AI_URL, AI_KEY,
        `ai_cost_usage?select=*&client_key=eq.${encodeURIComponent(client.id)}&created_at=gte.${encodeURIComponent(window.start.toISOString())}&created_at=lt.${encodeURIComponent(window.end.toISOString())}&order=created_at.asc,id.asc&limit=1000&offset=${offset}`,
        { method: 'GET' });
      if (!Array.isArray(page)) throw new Error('Réponse de consommation IA invalide');
      rows.push(...page);
      if (page.length < 1000) break;
    }

    const projects = await agentFetch(`/data/Projet?client_id=${encodeURIComponent(client.id)}&limit=1000`);
    const centers = await rest(CRM_URL, CRM_KEY, `client_cost_centers?select=*&client_id=eq.${encodeURIComponent(client.id)}&is_active=eq.true&limit=1000`, { method: 'GET' });
    if (!Array.isArray(projects) || !Array.isArray(centers) || projects.length >= 1000 || centers.length >= 1000) {
      throw new Error('Registre client/projet incomplet pour valider cet import');
    }
    const aggregate = aggregateAiUsage(resolveUsageCenters(rows, client.id, projects, centers));
    if (aggregate.unpriced.length) {
      return res.status(422).json({
        error: 'Consommations IA non tarifées détectées — import bloqué pour éviter une sous-facturation.',
        code: 'ai_usage_unpriced',
        unpriced: aggregate.unpriced.slice(0, 50),
      });
    }

    const rule = await loadRule(client.id);
    // Legacy totals overlap the v2 groups. Reconcile them explicitly, never add
    // a second monthly total or silently rewrite previously billed history.
    const legacy = await rest(CRM_URL, CRM_KEY,
      `client_cost_events?select=id&client_id=eq.${encodeURIComponent(client.id)}&source_type=eq.llm_api&incurred_at=gte.${encodeURIComponent(window.start.toISOString())}&incurred_at=lt.${encodeURIComponent(window.end.toISOString())}&or=(external_ref.is.null,external_ref.not.like.ai-usage-month-v2:*)&limit=1`,
      { method: 'GET' });
    if (legacy?.length) return res.status(409).json({ code: 'ai_usage_reconciliation_required', error: 'Des coûts IA existent déjà pour ce mois. Rapprochement requis avant import, aucune ligne modifiée.' });
    const previous = await rest(CRM_URL, CRM_KEY,
      `client_cost_events?select=external_ref&client_id=eq.${encodeURIComponent(client.id)}&external_ref=like.ai-usage-month-v2:${encodeURIComponent(client.id)}:${window.month}:*&limit=1000`, { method: 'GET' });
    const refs = new Set(aggregate.groups.map((group) => ledgerReference(client.id, window.month, group)));
    if (previous.length >= 1000 || previous.some((event) => !refs.has(event.external_ref))) {
      return res.status(409).json({ code: 'ai_usage_reconciliation_required', error: 'Une attribution mensuelle a changé depuis le dernier import : rapprochement requis.' });
    }
    if (aggregate.groups.length > 1 && (rule?.billing_mode === 'fixed' || Number(rule?.minimum_minor) > 0)) {
      return res.status(422).json({ code: 'billing_rule_allocation_required', error: 'Forfait ou minimum mensuel : répartition explicite entre projets nécessaire avant import.' });
    }
    const results = [];
    let actualEur = 0;
    let billableEur = 0;
    let requests = 0;

    for (const group of aggregate.groups) {
      const result = await upsertLedgerGroup(client.id, window, group, rule);
      results.push(result);
      if (result.status !== 'locked_invoiced') {
        actualEur += Number(result.exactEur || 0);
        billableEur += Number(result.billableEur || 0);
      }
      requests += group.requests;
    }

    return res.json({
      success: true,
      client_id: client.id,
      month: window.month,
      requests,
      groups: aggregate.groups.length,
      actual_cost_eur_precise: Number(actualEur.toFixed(8)),
      billable_eur_precise: Number(billableEur.toFixed(8)),
      invoice_rounding: 'cent_after_monthly_model_aggregation',
      results,
    });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

module.exports = {
  router,
  aggregateAiUsage,
  applyExactRule,
  monthWindow,
  usageScope,
  ledgerReference,
  validateGroupScope,
  upsertLedgerGroup,
  resolveUsageCenters,
};
