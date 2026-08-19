const express = require('express');
const crypto = require('crypto');
const { requireSession } = require('./server-security.cjs');

const router = express.Router();
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const INGEST_KEY = process.env.FINOPS_INGEST_KEY || '';

const POLICIES = new Set(['standard_margin', 'fixed_plus_overage', 'technical_costs_only', 'custom']);
const CATEGORIES = new Set(['llm_cloud','llm_local','gpu_local','cpu_local','electricity','machine_amortization','storage','railway','github','voice','image','video','3d','email_sms','human_time','other']);

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function constantTimeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function serviceAuthorized(req) {
  return Boolean(INGEST_KEY) && constantTimeEqual(req.headers['x-finops-key'], INGEST_KEY);
}

const adminGuard = requireSession('admin');
function ingestOrAdmin(req, res, next) {
  if (serviceAuthorized(req)) {
    req.finopsActor = 'service';
    return next();
  }
  return adminGuard(req, res, () => {
    req.finopsActor = req.user?.email || 'admin';
    next();
  });
}

async function supabase(path, options = {}) {
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

async function loadPolicy(clientKey, entityKey) {
  const exact = await supabase(`finops_policies?select=*&client_key=eq.${encodeURIComponent(clientKey)}&entity_key=eq.${encodeURIComponent(entityKey)}&limit=1`, { method: 'GET' });
  if (exact[0]) return exact[0];
  const fallback = await supabase(`finops_policies?select=*&client_key=eq.${encodeURIComponent(clientKey)}&entity_key=eq.__default__&limit=1`, { method: 'GET' });
  return fallback[0] || {
    policy: 'standard_margin',
    markup_percent: 50,
    minimum_margin_percent: 30,
    minimum_invoice_eur: 0,
  };
}

function computeBillable(cost, policy) {
  const base = safeNumber(cost);
  if (policy.policy === 'technical_costs_only') return base;
  if (policy.policy === 'fixed_plus_overage') return base;
  if (policy.policy === 'custom') return base * (1 + safeNumber(policy.markup_percent) / 100);
  return base * (1 + safeNumber(policy.markup_percent, 50) / 100);
}

function normalizeEvent(raw, policy, actor) {
  const required = ['client_key', 'entity_key', 'project_key', 'service_key', 'category'];
  const missing = required.filter(k => !String(raw[k] || '').trim());
  if (missing.length) throw new Error(`Missing fields: ${missing.join(', ')}`);
  const category = String(raw.category);
  if (!CATEGORIES.has(category)) throw new Error('Invalid category');
  const cost = safeNumber(raw.cost_eur);
  const billable = raw.billable_eur == null ? computeBillable(cost, policy) : safeNumber(raw.billable_eur);
  return {
    created_at: raw.created_at && !Number.isNaN(Date.parse(raw.created_at)) ? new Date(raw.created_at).toISOString() : new Date().toISOString(),
    client_key: String(raw.client_key).slice(0, 120),
    client_name: raw.client_name ? String(raw.client_name).slice(0, 180) : null,
    entity_key: String(raw.entity_key).slice(0, 120),
    entity_name: raw.entity_name ? String(raw.entity_name).slice(0, 180) : null,
    project_key: String(raw.project_key).slice(0, 120),
    project_name: raw.project_name ? String(raw.project_name).slice(0, 180) : null,
    service_key: String(raw.service_key).slice(0, 120),
    job_key: raw.job_key ? String(raw.job_key).slice(0, 180) : null,
    category,
    provider: raw.provider ? String(raw.provider).slice(0, 120) : null,
    model: raw.model ? String(raw.model).slice(0, 180) : null,
    quantity: safeNumber(raw.quantity),
    unit: raw.unit ? String(raw.unit).slice(0, 40) : null,
    cost_eur: Number(cost.toFixed(8)),
    billable_eur: Number(billable.toFixed(8)),
    billing_policy: policy.policy,
    metadata: raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata : {},
    source: String(raw.source || 'unknown').slice(0, 120),
    event_key: raw.event_key ? String(raw.event_key).slice(0, 200) : null,
    created_by: String(actor || 'service').slice(0, 180),
  };
}

router.get('/health', requireSession('admin'), (req, res) => res.json({ ok: true, service: 'project-finops' }));

router.post('/events', ingestOrAdmin, async (req, res) => {
  try {
    const rawEvents = Array.isArray(req.body) ? req.body : [req.body || {}];
    const rows = [];
    for (const raw of rawEvents.slice(0, 500)) {
      const policy = await loadPolicy(raw.client_key, raw.entity_key);
      rows.push(normalizeEvent(raw, policy, req.finopsActor));
    }
    const inserted = await supabase('finops_events?on_conflict=event_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(rows),
    });
    res.status(201).json({ ok: true, count: inserted.length, events: inserted });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/summary', requireSession('admin'), async (req, res) => {
  try {
    const now = new Date();
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;
    const [year, number] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, number - 1, 1)).toISOString();
    const end = new Date(Date.UTC(year, number, 1)).toISOString();
    const events = await supabase(`finops_events?select=*&created_at=gte.${encodeURIComponent(start)}&created_at=lt.${encodeURIComponent(end)}&order=created_at.desc&limit=20000`, { method: 'GET' });
    const aggregate = (keyFn) => {
      const map = new Map();
      for (const event of events) {
        const key = keyFn(event);
        const current = map.get(key) || { key, cost_eur: 0, billable_eur: 0, events: 0 };
        current.cost_eur += Number(event.cost_eur || 0);
        current.billable_eur += Number(event.billable_eur || 0);
        current.events += 1;
        map.set(key, current);
      }
      return [...map.values()].map(r => ({ ...r, cost_eur: Number(r.cost_eur.toFixed(4)), billable_eur: Number(r.billable_eur.toFixed(4)), margin_eur: Number((r.billable_eur-r.cost_eur).toFixed(4)) })).sort((a,b) => b.cost_eur-a.cost_eur);
    };
    const totalCost = events.reduce((sum, e) => sum + Number(e.cost_eur || 0), 0);
    const totalBillable = events.reduce((sum, e) => sum + Number(e.billable_eur || 0), 0);
    res.json({
      month,
      totals: { cost_eur: Number(totalCost.toFixed(4)), billable_eur: Number(totalBillable.toFixed(4)), margin_eur: Number((totalBillable-totalCost).toFixed(4)), events: events.length },
      by_client: aggregate(e => e.client_key),
      by_entity: aggregate(e => `${e.client_key}:${e.entity_key}`),
      by_project: aggregate(e => `${e.client_key}:${e.entity_key}:${e.project_key}`),
      by_category: aggregate(e => e.category),
      recent: events.slice(0, 100),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/policies', requireSession('admin'), async (req, res) => {
  try {
    const rows = await supabase('finops_policies?select=*&order=client_key.asc,entity_key.asc', { method: 'GET' });
    res.json({ policies: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/policies', requireSession('admin'), async (req, res) => {
  try {
    const raw = req.body || {};
    if (!raw.client_key || !raw.entity_key || !POLICIES.has(raw.policy)) return res.status(400).json({ error: 'client_key, entity_key and valid policy required' });
    const row = {
      client_key: String(raw.client_key).slice(0,120), entity_key: String(raw.entity_key).slice(0,120),
      client_name: raw.client_name ? String(raw.client_name).slice(0,180) : null,
      entity_name: raw.entity_name ? String(raw.entity_name).slice(0,180) : null,
      policy: raw.policy,
      markup_percent: safeNumber(raw.markup_percent, raw.policy === 'technical_costs_only' ? 0 : 50),
      minimum_margin_percent: safeNumber(raw.minimum_margin_percent, 30),
      minimum_invoice_eur: safeNumber(raw.minimum_invoice_eur),
      metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
      updated_at: new Date().toISOString(),
      updated_by: req.user?.email || 'admin',
    };
    const result = await supabase('finops_policies?on_conflict=client_key,entity_key', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify([row]),
    });
    res.json(result[0] || row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
