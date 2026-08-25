const express = require('express');
const crypto = require('crypto');
const { requireSession } = require('./server-security.cjs');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const INGEST_KEY = process.env.AI_COST_INGEST_KEY || '';

const DEFAULT_PRICING = {
  'gpt-5.6': { label: 'GPT-5.6 Sol', input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5.6-sol': { label: 'GPT-5.6 Sol', input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5.6-terra': { label: 'GPT-5.6 Terra', input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5.6-luna': { label: 'GPT-5.6 Luna', input: 1, cachedInput: 0.1, output: 6 },
};

const DEFAULT_ROUTING = {
  auto_route: true,
  default_model: 'gpt-5.6-terra',
  simple_model: 'gpt-5.6-luna',
  balanced_model: 'gpt-5.6-terra',
  complex_model: 'gpt-5.6-sol',
  max_request_usd: 2,
};

const PROCESSING_MULTIPLIERS = {
  standard: 1,
  batch: 0.5,
  priority: 2,
  data_residency: 1.1,
};

function safeJsonEnv(name, fallback) {
  try {
    if (!process.env[name]) return fallback;
    const parsed = JSON.parse(process.env[name]);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const PRICING = { ...DEFAULT_PRICING, ...safeJsonEnv('AI_COST_PRICING_JSON', {}) };

function toNonNegativeInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function toNonNegativeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function findPricing(model) {
  const key = String(model || '').toLowerCase();
  if (PRICING[key]) return { key, ...PRICING[key] };
  const snapshotMatch = Object.keys(PRICING)
    .filter((candidate) => candidate !== 'gpt-5.6')
    .find((candidate) => key.startsWith(`${candidate}-`));
  return snapshotMatch ? { key: snapshotMatch, ...PRICING[snapshotMatch] } : null;
}

function calculateCost({ model, inputTokens = 0, cachedInputTokens = 0, outputTokens = 0, processingMode = 'standard' }) {
  const pricing = findPricing(model);
  if (!pricing) return { costUsd: 0, priced: false, pricingKey: null, warning: 'model_unpriced' };

  const input = toNonNegativeInt(inputTokens);
  const cached = Math.min(input, toNonNegativeInt(cachedInputTokens));
  const uncached = Math.max(0, input - cached);
  const output = toNonNegativeInt(outputTokens);
  const mode = PROCESSING_MULTIPLIERS[processingMode] ? processingMode : 'standard';
  const multiplier = PROCESSING_MULTIPLIERS[mode];

  const raw = (
    (uncached * pricing.input) +
    (cached * pricing.cachedInput) +
    (output * pricing.output)
  ) / 1_000_000;

  return {
    costUsd: Number((raw * multiplier).toFixed(8)),
    priced: true,
    pricingKey: pricing.key,
    warning: input > 270_000 ? 'long_context_estimate' : null,
  };
}

function normalizeUsage(raw = {}, actor = 'service') {
  const usage = raw.usage && typeof raw.usage === 'object' ? raw.usage : raw;
  const inputTokens = toNonNegativeInt(
    raw.input_tokens ?? usage.input_tokens ?? usage.prompt_tokens
  );
  const cachedInputTokens = toNonNegativeInt(
    raw.cached_input_tokens ?? usage.cached_input_tokens ??
    usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens
  );
  const outputTokens = toNonNegativeInt(
    raw.output_tokens ?? usage.output_tokens ?? usage.completion_tokens
  );
  const model = String(raw.model || usage.model || 'unknown').slice(0, 120);
  const processingMode = PROCESSING_MULTIPLIERS[raw.processing_mode] ? raw.processing_mode : 'standard';
  const explicitCost = Number(raw.cost_usd);
  const calculated = calculateCost({ model, inputTokens, cachedInputTokens, outputTokens, processingMode });
  const hasExplicitCost = Number.isFinite(explicitCost) && explicitCost >= 0;
  const createdAt = raw.created_at && !Number.isNaN(Date.parse(raw.created_at))
    ? new Date(raw.created_at).toISOString()
    : new Date().toISOString();

  const metadata = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
    ? raw.metadata
    : {};

  return {
    created_at: createdAt,
    provider: String(raw.provider || 'openai').slice(0, 50),
    model,
    input_tokens: inputTokens,
    cached_input_tokens: Math.min(inputTokens, cachedInputTokens),
    output_tokens: outputTokens,
    cost_usd: hasExplicitCost ? Number(explicitCost.toFixed(8)) : calculated.costUsd,
    cost_estimated: !hasExplicitCost,
    pricing_key: calculated.pricingKey,
    pricing_warning: hasExplicitCost ? null : calculated.warning,
    processing_mode: processingMode,
    project_key: raw.project_key ? String(raw.project_key).slice(0, 120) : null,
    project_name: raw.project_name ? String(raw.project_name).slice(0, 180) : null,
    client_key: raw.client_key ? String(raw.client_key).slice(0, 120) : null,
    client_name: raw.client_name ? String(raw.client_name).slice(0, 180) : null,
    source: String(raw.source || 'unknown').slice(0, 120),
    request_id: raw.request_id || raw.response_id || raw.id
      ? String(raw.request_id || raw.response_id || raw.id).slice(0, 180)
      : null,
    metadata: {
      ...metadata,
      pricing_match: calculated.priced,
    },
    created_by: String(actor || 'service').slice(0, 180),
  };
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_SECRET) throw new Error('Supabase server secret not configured');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET,
      Authorization: `Bearer ${SUPABASE_SECRET}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
  return text ? JSON.parse(text) : [];
}

async function select(path) {
  return supabaseRequest(path, { method: 'GET' });
}

async function insertUsageRows(rows) {
  return supabaseRequest('ai_cost_usage?on_conflict=request_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(rows),
  });
}

async function recordUsage(raw, actor = 'service') {
  const row = normalizeUsage(raw, actor);
  const inserted = await insertUsageRows([row]);
  return inserted[0] || row;
}

function constantTimeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function serviceAuthorized(req) {
  return Boolean(INGEST_KEY) && constantTimeEqual(req.headers['x-ai-cost-key'], INGEST_KEY);
}

const adminGuard = requireSession('admin');

function allowIngestOrAdmin(req, res, next) {
  if (serviceAuthorized(req)) {
    req.aiCostActor = 'service';
    return next();
  }
  return adminGuard(req, res, () => {
    req.aiCostActor = req.user?.email || 'admin';
    next();
  });
}

function monthWindow(value) {
  const now = new Date();
  const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')) ? String(value) : fallback;
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { month, start, end, daysInMonth };
}

async function loadMonthEvents(window) {
  return select(
    `ai_cost_usage?select=id,created_at,provider,model,input_tokens,cached_input_tokens,output_tokens,cost_usd,cost_estimated,pricing_warning,processing_mode,project_key,project_name,client_key,client_name,source,request_id&created_at=gte.${encodeURIComponent(window.start.toISOString())}&created_at=lt.${encodeURIComponent(window.end.toISOString())}&order=created_at.asc&limit=20000`
  );
}

async function loadBudgets() {
  return select('ai_cost_budgets?select=*&order=scope_type.asc,scope_key.asc');
}

async function loadRouting() {
  const rows = await select('ai_cost_settings?select=key,value&key=eq.routing_policy&limit=1');
  return { ...DEFAULT_ROUTING, ...(rows[0]?.value || {}) };
}

function aggregateBy(events, keyFn, labelFn) {
  const map = new Map();
  for (const event of events) {
    const key = keyFn(event) || 'none';
    const label = labelFn(event) || 'Non attribué';
    const current = map.get(key) || { key, label, cost_usd: 0, requests: 0, input_tokens: 0, output_tokens: 0 };
    current.cost_usd += Number(event.cost_usd || 0);
    current.requests += 1;
    current.input_tokens += Number(event.input_tokens || 0);
    current.output_tokens += Number(event.output_tokens || 0);
    map.set(key, current);
  }
  return [...map.values()]
    .map((item) => ({ ...item, cost_usd: Number(item.cost_usd.toFixed(6)) }))
    .sort((a, b) => b.cost_usd - a.cost_usd);
}

function scopeSpend(events, budget) {
  if (budget.scope_type === 'project') {
    return events.filter((event) => event.project_key === budget.scope_key).reduce((sum, event) => sum + Number(event.cost_usd || 0), 0);
  }
  if (budget.scope_type === 'client') {
    return events.filter((event) => event.client_key === budget.scope_key).reduce((sum, event) => sum + Number(event.cost_usd || 0), 0);
  }
  return events.reduce((sum, event) => sum + Number(event.cost_usd || 0), 0);
}

function evaluateBudget(spend, budget = {}) {
  const monthlyBudget = toNonNegativeNumber(budget.monthly_budget_usd, 0);
  const hardLimit = toNonNegativeNumber(budget.hard_limit_usd, 0);
  const alerts = Array.isArray(budget.alert_thresholds) ? budget.alert_thresholds : [50, 75, 90];
  const percent = monthlyBudget > 0 ? (spend / monthlyBudget) * 100 : 0;
  const reached = alerts.filter((value) => Number(value) > 0 && percent >= Number(value));
  return {
    spend_usd: Number(spend.toFixed(6)),
    budget_usd: monthlyBudget,
    hard_limit_usd: hardLimit,
    percent: Number(percent.toFixed(2)),
    reached_thresholds: reached,
    blocked: Boolean(budget.enabled && hardLimit > 0 && spend >= hardLimit),
  };
}

function recommendModel(complexity, routing = DEFAULT_ROUTING) {
  if (!routing.auto_route) return routing.default_model || DEFAULT_ROUTING.default_model;
  const normalized = String(complexity || 'balanced').toLowerCase();
  if (['simple', 'low', '1', 'luna'].includes(normalized)) return routing.simple_model || DEFAULT_ROUTING.simple_model;
  if (['complex', 'high', '3', 'sol'].includes(normalized)) return routing.complex_model || DEFAULT_ROUTING.complex_model;
  return routing.balanced_model || routing.default_model || DEFAULT_ROUTING.balanced_model;
}

function buildSummary(events, budgets, routing, window) {
  const totalCost = events.reduce((sum, event) => sum + Number(event.cost_usd || 0), 0);
  const totalInput = events.reduce((sum, event) => sum + Number(event.input_tokens || 0), 0);
  const totalOutput = events.reduce((sum, event) => sum + Number(event.output_tokens || 0), 0);
  const estimatedCount = events.filter((event) => event.cost_estimated).length;
  const unpricedCount = events.filter((event) => event.pricing_warning === 'model_unpriced').length;

  const dailyMap = new Map();
  for (let day = 1; day <= window.daysInMonth; day += 1) {
    const key = `${window.month}-${String(day).padStart(2, '0')}`;
    dailyMap.set(key, { date: key, cost_usd: 0, requests: 0 });
  }
  for (const event of events) {
    const key = String(event.created_at).slice(0, 10);
    if (!dailyMap.has(key)) continue;
    const item = dailyMap.get(key);
    item.cost_usd += Number(event.cost_usd || 0);
    item.requests += 1;
  }

  const budgetStatus = budgets.map((budget) => ({
    ...budget,
    ...evaluateBudget(scopeSpend(events, budget), budget),
  }));
  const globalBudget = budgetStatus.find((budget) => budget.scope_type === 'global') || null;

  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const elapsedDays = window.month === currentMonth ? Math.max(1, now.getUTCDate()) : window.daysInMonth;
  const forecast = window.month === currentMonth
    ? (totalCost / elapsedDays) * window.daysInMonth
    : totalCost;

  return {
    month: window.month,
    totals: {
      cost_usd: Number(totalCost.toFixed(6)),
      forecast_usd: Number(forecast.toFixed(6)),
      requests: events.length,
      input_tokens: totalInput,
      output_tokens: totalOutput,
      estimated_requests: estimatedCount,
      unpriced_requests: unpricedCount,
    },
    daily: [...dailyMap.values()].map((item) => ({ ...item, cost_usd: Number(item.cost_usd.toFixed(6)) })),
    by_model: aggregateBy(events, (event) => event.model, (event) => event.model),
    by_project: aggregateBy(events, (event) => event.project_key, (event) => event.project_name || event.project_key),
    by_client: aggregateBy(events, (event) => event.client_key, (event) => event.client_name || event.client_key),
    budgets: budgetStatus,
    global_budget: globalBudget,
    routing,
    pricing: PRICING,
    ingest_ready: Boolean(INGEST_KEY),
  };
}

router.get('/summary', adminGuard, async (req, res) => {
  try {
    const window = monthWindow(req.query.month);
    const [events, budgets, routing] = await Promise.all([loadMonthEvents(window), loadBudgets(), loadRouting()]);
    res.json(buildSummary(events, budgets, routing, window));
  } catch (error) {
    console.error('[ai-cost] summary failed:', error.message);
    res.status(503).json({ error: 'AI Cost Control indisponible', details: error.message });
  }
});

router.get('/usage', adminGuard, async (req, res) => {
  try {
    const window = monthWindow(req.query.month);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const rows = await select(
      `ai_cost_usage?select=*&created_at=gte.${encodeURIComponent(window.start.toISOString())}&created_at=lt.${encodeURIComponent(window.end.toISOString())}&order=created_at.desc&limit=${limit}`
    );
    res.json({ month: window.month, items: rows });
  } catch (error) {
    res.status(503).json({ error: 'Historique indisponible' });
  }
});

router.post('/usage', allowIngestOrAdmin, async (req, res) => {
  try {
    const sourceRows = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : [req.body || {}];
    const rows = sourceRows.map((item) => normalizeUsage(item, req.aiCostActor));
    const inserted = await insertUsageRows(rows);
    res.status(201).json({ success: true, inserted: inserted.length, items: inserted });
  } catch (error) {
    console.error('[ai-cost] ingest failed:', error.message);
    res.status(400).json({ error: 'Consommation non enregistrée', details: error.message });
  }
});

router.put('/budget', adminGuard, async (req, res) => {
  const scopeType = ['global', 'project', 'client'].includes(req.body?.scope_type) ? req.body.scope_type : 'global';
  const scopeKey = scopeType === 'global' ? 'global' : String(req.body?.scope_key || '').slice(0, 120);
  if (!scopeKey) return res.status(400).json({ error: 'scope_key requis' });

  const monthlyBudget = toNonNegativeNumber(req.body?.monthly_budget_usd, 0);
  const hardLimit = toNonNegativeNumber(req.body?.hard_limit_usd, 0);
  const alertThresholds = Array.isArray(req.body?.alert_thresholds)
    ? req.body.alert_thresholds.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n <= 100).slice(0, 10)
    : [50, 75, 90];

  try {
    const rows = await supabaseRequest('ai_cost_budgets?on_conflict=scope_type,scope_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        scope_type: scopeType,
        scope_key: scopeKey,
        scope_name: req.body?.scope_name ? String(req.body.scope_name).slice(0, 180) : scopeKey,
        monthly_budget_usd: monthlyBudget,
        hard_limit_usd: hardLimit,
        alert_thresholds: alertThresholds,
        enabled: req.body?.enabled !== false,
        updated_at: new Date().toISOString(),
        updated_by: req.user?.email || 'admin',
      }),
    });
    res.json({ success: true, budget: rows[0] });
  } catch (error) {
    console.error('[ai-cost] budget update failed:', error.message);
    res.status(503).json({ error: 'Budget non enregistré' });
  }
});

router.put('/routing', adminGuard, async (req, res) => {
  const allowedModels = new Set(Object.keys(PRICING));
  const next = {
    auto_route: req.body?.auto_route !== false,
    default_model: allowedModels.has(req.body?.default_model) ? req.body.default_model : DEFAULT_ROUTING.default_model,
    simple_model: allowedModels.has(req.body?.simple_model) ? req.body.simple_model : DEFAULT_ROUTING.simple_model,
    balanced_model: allowedModels.has(req.body?.balanced_model) ? req.body.balanced_model : DEFAULT_ROUTING.balanced_model,
    complex_model: allowedModels.has(req.body?.complex_model) ? req.body.complex_model : DEFAULT_ROUTING.complex_model,
    max_request_usd: toNonNegativeNumber(req.body?.max_request_usd, DEFAULT_ROUTING.max_request_usd),
  };

  try {
    const rows = await supabaseRequest('ai_cost_settings?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ key: 'routing_policy', value: next, updated_at: new Date().toISOString(), updated_by: req.user?.email || 'admin' }),
    });
    res.json({ success: true, routing: rows[0]?.value || next });
  } catch (error) {
    console.error('[ai-cost] routing update failed:', error.message);
    res.status(503).json({ error: 'Politique de routage non enregistrée' });
  }
});

router.post('/authorize', allowIngestOrAdmin, async (req, res) => {
  try {
    const result = await authorizeUsage(req.body || {});
    res.json(result);
  } catch (error) {
    console.error('[ai-cost] authorize failed:', error.message);
    res.status(503).json({ error: 'Contrôle budgétaire indisponible' });
  }
});

async function authorizeUsage(input = {}) {
    const window = monthWindow();
    const [events, budgets, routing] = await Promise.all([loadMonthEvents(window), loadBudgets(), loadRouting()]);
    const estimatedCost = toNonNegativeNumber(input.estimated_cost_usd, 0);
    const model = recommendModel(input.complexity, routing);
    const checks = budgets
      .filter((budget) => budget.enabled && (
        budget.scope_type === 'global' ||
        (budget.scope_type === 'project' && budget.scope_key === input.project_key) ||
        (budget.scope_type === 'client' && budget.scope_key === input.client_key)
      ))
      .map((budget) => ({ budget, spend: scopeSpend(events, budget) }));

    let allowed = true;
    let reason = null;
    for (const check of checks) {
      const hardLimit = toNonNegativeNumber(check.budget.hard_limit_usd, 0);
      if (hardLimit > 0 && check.spend + estimatedCost > hardLimit) {
        allowed = false;
        reason = `hard_limit_${check.budget.scope_type}`;
        break;
      }
    }
    if (allowed && routing.max_request_usd > 0 && estimatedCost > routing.max_request_usd) {
      allowed = false;
      reason = 'request_cost_limit';
    }

    return { allowed, reason, recommended_model: model, routing, estimated_cost_usd: estimatedCost };
}

module.exports = {
  router,
  calculateCost,
  normalizeUsage,
  recordUsage,
  evaluateBudget,
  authorizeUsage,
  recommendModel,
  DEFAULT_PRICING,
  DEFAULT_ROUTING,
};
