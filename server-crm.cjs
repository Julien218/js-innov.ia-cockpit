const express = require('express');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_CRM_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_CRM_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CLIENT_STATUSES = new Set(['actif', 'inactif', 'prospect', 'archive']);

function assertConfigured() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('CRM Supabase non configuré');
}

async function crmRequest(resource, options = {}) {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`CRM Supabase HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
  return text ? JSON.parse(text) : null;
}

function cleanText(value, maxLength = 300) {
  return String(value || '').trim().slice(0, maxLength) || null;
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email client invalide');
  return email;
}

function normalizeClientPayload(input = {}, { partial = false } = {}) {
  const payload = {};
  const textFields = ['nom', 'prenom', 'telephone', 'entreprise', 'adresse', 'ville', 'code_postal', 'notes'];
  for (const field of textFields) {
    if (!partial || Object.prototype.hasOwnProperty.call(input, field)) payload[field] = cleanText(input[field], field === 'notes' ? 2000 : 300);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, 'email')) payload.email = cleanEmail(input.email);
  if (!partial || Object.prototype.hasOwnProperty.call(input, 'statut')) {
    const status = String(input.statut || 'prospect').trim().toLowerCase();
    if (!CLIENT_STATUSES.has(status)) throw new Error('Statut client invalide');
    payload.statut = status;
  }
  if (!partial && !payload.nom) throw new Error('Nom client requis');
  return payload;
}

function splitContactName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { prenom: parts[0] || null, nom: parts[0] || null };
  return { prenom: parts.shift(), nom: parts.join(' ') };
}

async function ensureCrmClient(order = {}) {
  const email = cleanEmail(order.email);
  const rows = await crmRequest(`clients_fr?select=*&email=eq.${encodeURIComponent(email)}&limit=1`);
  const existing = Array.isArray(rows) ? rows[0] || null : null;
  const name = splitContactName(order.contact_name || order.full_name || '');
  const now = new Date().toISOString();
  const details = {
    email,
    statut: 'actif',
    updated_at: now,
    ...(name.nom ? { nom: name.nom } : {}),
    ...(name.prenom ? { prenom: name.prenom } : {}),
    ...(cleanText(order.company, 300) ? { entreprise: cleanText(order.company, 300) } : {}),
    ...(cleanText(order.phone, 100) ? { telephone: cleanText(order.phone, 100) } : {}),
    ...(cleanText(order.installation_address, 500) ? { adresse: cleanText(order.installation_address, 500) } : {}),
  };

  if (existing?.id) {
    const updated = await crmRequest(`clients_fr?id=eq.${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(details),
    });
    return Array.isArray(updated) ? updated[0] || existing : existing;
  }

  const created = await crmRequest('clients_fr', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      ...details,
      nom: details.nom || email.split('@')[0],
      prenom: details.prenom || null,
      notes: cleanText(order.crm_notes, 2000) || 'Créé automatiquement lors du provisioning client.',
    }),
  });
  return Array.isArray(created) ? created[0] || null : null;
}

router.get('/clients', async (_req, res) => {
  try {
    const rows = await crmRequest('clients_fr?select=*&order=created_at.desc');
    res.json({ success: true, clients: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    console.error('[crm] list:', error.message);
    res.status(503).json({ error: 'CRM clients indisponible' });
  }
});

router.post('/clients', async (req, res) => {
  try {
    const payload = normalizeClientPayload(req.body || {});
    const rows = await crmRequest('clients_fr', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    res.status(201).json({ success: true, client: Array.isArray(rows) ? rows[0] || null : null });
  } catch (error) {
    console.error('[crm] create:', error.message);
    res.status(400).json({ error: error.message });
  }
});

router.patch('/clients/:id', async (req, res) => {
  try {
    const payload = normalizeClientPayload(req.body || {}, { partial: true });
    const rows = await crmRequest(`clients_fr?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }),
    });
    const client = Array.isArray(rows) ? rows[0] || null : null;
    if (!client) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ success: true, client });
  } catch (error) {
    console.error('[crm] update:', error.message);
    res.status(400).json({ error: error.message });
  }
});

router.delete('/clients/:id', async (req, res) => {
  try {
    await crmRequest(`clients_fr?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    res.status(204).end();
  } catch (error) {
    console.error('[crm] delete:', error.message);
    res.status(503).json({ error: 'Suppression du client impossible' });
  }
});

module.exports = router;
module.exports.crmRequest = crmRequest;
module.exports.ensureCrmClient = ensureCrmClient;
module.exports.normalizeClientPayload = normalizeClientPayload;
module.exports.splitContactName = splitContactName;
