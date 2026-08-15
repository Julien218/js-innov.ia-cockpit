const express = require('express');
const { requireSession } = require('./server-security.cjs');

const router = express.Router();
const adminGuard = requireSession('admin');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.VITE_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.AGENT_API_KEY || '';
const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN || '';
const RAILWAY_COSTS_ENDPOINT = process.env.RAILWAY_COSTS_ENDPOINT || '';
const BILLING_EUR_PER_USD = Number(process.env.BILLING_EUR_PER_USD || 0.92);

function monthValue(value) {
  const now = new Date();
  const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')) ? String(value) : fallback;
}

function monthWindow(month) {
  const [year, number] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, number - 1, 1)).toISOString(),
    end: new Date(Date.UTC(year, number, 1)).toISOString(),
  };
}

function normalizeProvider(value) {
  return String(value || 'other').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 50) || 'other';
}

function secretSegment(value, fallback = 'NON_NOMME') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  return normalized || fallback;
}

function projectCostCenterCode(projectId, projectName) {
  return `PROJECT_${secretSegment(projectName).slice(0, 28)}_${secretSegment(projectId).slice(0, 8)}`;
}

function eurMinorFromUsd(value) {
  return Math.round(Number(value || 0) * BILLING_EUR_PER_USD * 100);
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SECRET) throw new Error('Supabase server configuration missing');
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

async function upsert(tableAndConflict, body) {
  return supabaseRequest(tableAndConflict, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
}

async function agentRequest(table, method = 'GET', body = null, id = null, filters = null) {
  if (!AGENT_KEY) throw new Error('AGENT_API_KEY not configured');
  const params = filters ? `?${new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]))}` : '';
  const url = id ? `${AGENT_URL}/data/${table}/${id}` : `${AGENT_URL}/data/${table}${params}`;
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY },
    body: body && ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Agent API ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
  return text ? JSON.parse(text) : null;
}

async function ensureClientCostCenter({ existingScope, clientId, clientName, projectId, projectName, metadata = {} }) {
  if (existingScope?.cost_center_id) return existingScope.cost_center_id;
  const productCode = projectCostCenterCode(projectId, projectName);
  const existing = await agentRequest('client_cost_centers', 'GET', null, null, { product_code: productCode });
  if (Array.isArray(existing) && existing[0]?.id) return existing[0].id;

  let client = null;
  if (clientId) client = await agentRequest('Client', 'GET', null, clientId).catch(() => null);
  const displayName = client?.entreprise || clientName || [client?.nom, client?.prenom].filter(Boolean).join(' ') || 'Client';
  const created = await agentRequest('client_cost_centers', 'POST', {
    product_code: productCode,
    client_name: displayName,
    client_email: client?.email || null,
    client_address: client?.adresse || null,
    client_vat_number: client?.tva || client?.numero_tva || null,
    monthly_fee_minor: Math.max(0, Number(metadata.monthly_fee_minor || 0)),
    currency: 'EUR',
    is_active: true,
    metadata: {
      owner_type: 'client',
      project_id: projectId,
      project_name: projectName,
      billing_mode: 'draft_for_approval',
      managed_by: 'project-costs',
    },
  });
  return created?.id;
}

async function mirrorBillingMapping(scope, provider, externalId, externalLabel) {
  if (!scope?.cost_center_id || !externalId || !['openai', 'railway'].includes(provider)) return;
  const serviceType = `${provider}_project`;
  const existing = await agentRequest('client_external_mappings', 'GET', null, null, {
    service_type: serviceType,
    external_id: externalId,
    is_active: 'true',
  }).catch(() => []);
  if (Array.isArray(existing) && existing.length) return;
  await agentRequest('client_external_mappings', 'POST', {
    cost_center_id: scope.cost_center_id,
    service_type: serviceType,
    external_id: externalId,
    external_label: externalLabel || scope.project_name,
    is_active: true,
    metadata: { project_id: scope.project_id, managed_by: 'project-costs' },
  });
}

async function loadSummary(month) {
  const window = monthWindow(month);
  const [scopes, mappings, externalEntries, aiUsage] = await Promise.all([
    select('project_cost_scopes?select=*&is_active=eq.true&order=owner_type.asc,project_name.asc'),
    select('project_cost_mappings?select=*&is_active=eq.true'),
    select(`project_cost_entries?select=*&period_month=eq.${encodeURIComponent(month)}`),
    select(`ai_cost_usage?select=id,provider,model,cost_usd,project_key,project_name,client_key,client_name,created_at&created_at=gte.${encodeURIComponent(window.start)}&created_at=lt.${encodeURIComponent(window.end)}&limit=20000`),
  ]);

  const items = scopes.map((scope) => {
    const projectAi = aiUsage.filter((event) => event.project_key === scope.project_id);
    const projectExternal = externalEntries.filter((entry) => entry.scope_id === scope.id);
    const providerMap = new Map();

    for (const event of projectAi) {
      const provider = normalizeProvider(event.provider || 'openai');
      const current = providerMap.get(provider) || { provider, cost_usd: 0, cost_eur_minor: 0, requests: 0, sources: new Set() };
      current.cost_usd += Number(event.cost_usd || 0);
      current.cost_eur_minor += eurMinorFromUsd(event.cost_usd || 0);
      current.requests += 1;
      current.sources.add('ai_cost_control');
      providerMap.set(provider, current);
    }

    for (const entry of projectExternal) {
      const provider = normalizeProvider(entry.provider);
      const current = providerMap.get(provider) || { provider, cost_usd: 0, cost_eur_minor: 0, requests: 0, sources: new Set() };
      current.cost_usd += Number(entry.cost_usd || 0);
      current.cost_eur_minor += Number(entry.cost_eur_minor || 0);
      current.sources.add(entry.source || 'external');
      providerMap.set(provider, current);
    }

    const providers = [...providerMap.values()].map((item) => ({
      ...item,
      cost_usd: Number(item.cost_usd.toFixed(6)),
      sources: [...item.sources],
    })).sort((a, b) => b.cost_eur_minor - a.cost_eur_minor);

    return {
      ...scope,
      mappings: mappings.filter((mapping) => mapping.scope_id === scope.id),
      providers,
      ai_requests: projectAi.length,
      total_usd: Number(providers.reduce((sum, item) => sum + item.cost_usd, 0).toFixed(6)),
      total_eur_minor: providers.reduce((sum, item) => sum + Number(item.cost_eur_minor || 0), 0),
    };
  });

  return {
    month,
    items,
    totals: {
      usd: Number(items.reduce((sum, item) => sum + item.total_usd, 0).toFixed(6)),
      eur_minor: items.reduce((sum, item) => sum + item.total_eur_minor, 0),
      internal_eur_minor: items.filter((item) => item.owner_type === 'internal').reduce((sum, item) => sum + item.total_eur_minor, 0),
      client_eur_minor: items.filter((item) => item.owner_type === 'client').reduce((sum, item) => sum + item.total_eur_minor, 0),
    },
  };
}

router.get('/summary', adminGuard, async (req, res) => {
  try {
    res.json(await loadSummary(monthValue(req.query.month)));
  } catch (error) {
    console.error('[project-costs] summary failed:', error.message);
    res.status(503).json({ error: 'Suivi des coûts projet indisponible', details: error.message });
  }
});

router.post('/scopes', adminGuard, async (req, res) => {
  try {
    const ownerType = req.body?.owner_type === 'client' ? 'client' : 'internal';
    const projectId = String(req.body?.project_id || '').trim().slice(0, 120);
    const projectName = String(req.body?.project_name || '').trim().slice(0, 180);
    const clientId = ownerType === 'client' && req.body?.client_id ? String(req.body.client_id).slice(0, 120) : null;
    const clientName = ownerType === 'client' && req.body?.client_name ? String(req.body.client_name).slice(0, 180) : null;
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    if (!projectId || !projectName) return res.status(400).json({ error: 'project_id et project_name requis' });

    const billingMode = ownerType === 'internal'
      ? 'track_only'
      : (req.body?.billing_mode === 'draft_for_approval' ? 'draft_for_approval' : 'track_only');

    const existingRows = await select(`project_cost_scopes?select=*&owner_type=eq.${ownerType}&project_id=eq.${encodeURIComponent(projectId)}&limit=1`);
    const existingScope = existingRows[0] || null;
    let costCenterId = existingScope?.cost_center_id || req.body?.cost_center_id || null;
    if (ownerType === 'client' && billingMode === 'draft_for_approval' && !costCenterId) {
      costCenterId = await ensureClientCostCenter({ existingScope, clientId, clientName, projectId, projectName, metadata });
    }

    const rows = await upsert('project_cost_scopes?on_conflict=owner_type,project_id', {
      owner_type: ownerType,
      client_id: clientId,
      client_name: clientName,
      project_id: projectId,
      project_name: projectName,
      billing_mode: billingMode,
      cost_center_id: costCenterId,
      currency: 'EUR',
      is_active: true,
      metadata,
    });
    res.status(201).json({ success: true, scope: rows[0] });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/scopes/:id/mappings', adminGuard, async (req, res) => {
  try {
    const provider = normalizeProvider(req.body?.provider);
    const externalId = req.body?.external_id ? String(req.body.external_id).trim().slice(0, 240) : null;
    const secretRef = req.body?.secret_ref ? String(req.body.secret_ref).trim().toUpperCase().slice(0, 180) : null;
    if (!externalId && !secretRef) return res.status(400).json({ error: 'external_id ou secret_ref requis' });
    if (secretRef && !/^[A-Z][A-Z0-9_]{5,179}$/.test(secretRef)) return res.status(400).json({ error: 'secret_ref invalide' });

    const scopes = await select(`project_cost_scopes?select=*&id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
    const scope = scopes[0];
    if (!scope) return res.status(404).json({ error: 'Projet suivi introuvable' });

    const rows = await supabaseRequest('project_cost_mappings', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        scope_id: req.params.id,
        provider,
        resource_type: String(req.body?.resource_type || 'project').slice(0, 80),
        external_id: externalId,
        secret_ref: secretRef,
        external_label: req.body?.external_label ? String(req.body.external_label).slice(0, 180) : null,
        is_active: true,
        metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
      }),
    });
    await mirrorBillingMapping(scope, provider, externalId, req.body?.external_label);
    res.status(201).json({ success: true, mapping: rows[0] });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/scopes/:id/costs', adminGuard, async (req, res) => {
  try {
    const month = monthValue(req.body?.period_month);
    const provider = normalizeProvider(req.body?.provider);
    const costUsd = Math.max(0, Number(req.body?.cost_usd || 0));
    const explicitEurMinor = Number(req.body?.cost_eur_minor);
    const costEurMinor = Number.isFinite(explicitEurMinor) && explicitEurMinor >= 0 ? Math.round(explicitEurMinor) : eurMinorFromUsd(costUsd);
    const externalRef = req.body?.external_ref ? String(req.body.external_ref).slice(0, 240) : null;
    const target = externalRef ? 'project_cost_entries?on_conflict=scope_id,external_ref' : 'project_cost_entries';
    const rows = await upsert(target, {
      scope_id: req.params.id,
      period_month: month,
      provider,
      source: String(req.body?.source || 'manual').slice(0, 80),
      description: req.body?.description ? String(req.body.description).slice(0, 240) : null,
      cost_usd: costUsd,
      cost_eur_minor: costEurMinor,
      external_ref: externalRef,
      metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
    });
    res.status(201).json({ success: true, entry: rows[0] });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/scopes/:id/sync-railway', adminGuard, async (req, res) => {
  try {
    if (!RAILWAY_API_TOKEN || !RAILWAY_COSTS_ENDPOINT) return res.status(409).json({ error: 'Railway costs adapter non configuré' });
    const month = monthValue(req.body?.month || req.query.month);
    const [year, monthNumber] = month.split('-');
    const mappings = await select(`project_cost_mappings?select=*&scope_id=eq.${encodeURIComponent(req.params.id)}&provider=eq.railway&is_active=eq.true`);
    const synced = [];

    for (const mapping of mappings) {
      if (!mapping.external_id) continue;
      const url = new URL(RAILWAY_COSTS_ENDPOINT);
      url.searchParams.set('project_id', mapping.external_id);
      url.searchParams.set('year', year);
      url.searchParams.set('month', String(Number(monthNumber)));
      const response = await fetch(url, { headers: { Authorization: `Bearer ${RAILWAY_API_TOKEN}` } });
      if (!response.ok) throw new Error(`Railway costs adapter ${response.status}`);
      const data = await response.json();
      for (const item of (data.costs || data.data || [])) {
        const costUsd = Math.max(0, Number(item.cost || item.amount || 0));
        if (!costUsd) continue;
        const service = item.service || item.name || 'Infrastructure';
        const externalRef = `railway:${mapping.external_id}:${month}:${service}`;
        await upsert('project_cost_entries?on_conflict=scope_id,external_ref', {
          scope_id: req.params.id,
          period_month: month,
          provider: 'railway',
          source: 'railway_adapter',
          description: `Railway — ${service}`,
          cost_usd: costUsd,
          cost_eur_minor: eurMinorFromUsd(costUsd),
          external_ref: externalRef,
          metadata: { railway_project_id: mapping.external_id, service },
        });
        synced.push({ service, cost_usd: costUsd });
      }
    }
    res.json({ success: true, month, synced });
  } catch (error) {
    console.error('[project-costs] railway sync failed:', error.message);
    res.status(502).json({ error: error.message });
  }
});

module.exports = { router, loadSummary, monthValue, eurMinorFromUsd, projectCostCenterCode };