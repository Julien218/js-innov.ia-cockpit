const express = require('express');
const { requireSession } = require('./server-security.cjs');

const router = express.Router();
const adminGuard = requireSession('admin');

const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.VITE_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';

async function agentFetch(table, method = 'GET', body = null, id = null) {
  if (!AGENT_KEY) throw new Error('AGENT_API_KEY not configured');
  const url = id ? `${AGENT_URL}/data/${table}/${id}` : `${AGENT_URL}/data/${table}`;
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY },
    body: body && ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Agent API ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
  return text ? JSON.parse(text) : null;
}

async function agentQuery(table, filters = {}) {
  if (!AGENT_KEY) throw new Error('AGENT_API_KEY not configured');
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => params.set(key, String(value)));
  const response = await fetch(`${AGENT_URL}/data/${table}?${params}`, {
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY },
  });
  if (!response.ok) throw new Error(`Agent API ${response.status}`);
  return response.json();
}

router.get('/pending', adminGuard, async (req, res) => {
  try {
    const invoices = await agentQuery('client_invoices', { status: 'draft' });
    const pending = [];
    for (const invoice of invoices || []) {
      if ((invoice.approval_status || 'pending') !== 'pending') continue;
      const center = await agentFetch('client_cost_centers', 'GET', null, invoice.cost_center_id).catch(() => null);
      pending.push({ ...invoice, cost_center: center });
    }
    res.json({ items: pending });
  } catch (error) {
    res.status(503).json({ error: 'Factures à valider indisponibles', details: error.message });
  }
});

router.post('/:id/approve', adminGuard, async (req, res) => {
  try {
    const invoice = await agentFetch('client_invoices', 'GET', null, req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Facture non trouvée' });
    if (invoice.status !== 'draft') return res.status(409).json({ error: 'Seule une facture brouillon peut être validée' });
    const updated = await agentFetch('client_invoices', 'PATCH', {
      approval_status: 'approved',
      approved_by: req.user?.email || req.user?.id || 'admin',
      approved_at: new Date().toISOString(),
      rejected_by: null,
      rejected_at: null,
      approval_note: req.body?.note ? String(req.body.note).slice(0, 500) : null,
    }, req.params.id);
    res.json({ success: true, invoice: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/reject', adminGuard, async (req, res) => {
  try {
    const invoice = await agentFetch('client_invoices', 'GET', null, req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Facture non trouvée' });
    if (invoice.status !== 'draft') return res.status(409).json({ error: 'Seule une facture brouillon peut être refusée' });
    const updated = await agentFetch('client_invoices', 'PATCH', {
      approval_status: 'rejected',
      rejected_by: req.user?.email || req.user?.id || 'admin',
      rejected_at: new Date().toISOString(),
      approved_by: null,
      approved_at: null,
      approval_note: req.body?.note ? String(req.body.note).slice(0, 500) : null,
    }, req.params.id);
    res.json({ success: true, invoice: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

async function requireApprovedSend(req, res, next) {
  if (req.method !== 'POST' || !/^\/invoices\/[^/]+\/send$/.test(req.path)) return next();
  try {
    const invoiceId = req.path.split('/')[2];
    const invoice = await agentFetch('client_invoices', 'GET', null, invoiceId);
    if (!invoice) return res.status(404).json({ error: 'Facture non trouvée' });
    if (invoice.status === 'sent' || invoice.status === 'paid') return res.status(409).json({ error: 'Facture déjà envoyée ou payée' });
    if ((invoice.approval_status || 'pending') !== 'approved') {
      return res.status(409).json({ error: 'Validation humaine requise avant envoi', approval_status: invoice.approval_status || 'pending' });
    }
    req.billingApproval = {
      approved_by: invoice.approved_by,
      approved_at: invoice.approved_at,
    };
    next();
  } catch (error) {
    res.status(503).json({ error: 'Contrôle de validation indisponible', details: error.message });
  }
}

module.exports = { router, requireApprovedSend, agentFetch, agentQuery };