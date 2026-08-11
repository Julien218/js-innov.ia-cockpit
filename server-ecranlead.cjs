const express = require('express');
const crypto = require('crypto');

const router = express.Router();
const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';
const SYNC_KEY = process.env.ECRANLEAD_SYNC_KEY || '';

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function normalizePayload(body = {}) {
  const externalId = clean(body.external_id || body.id, 120);
  const nom = clean(body.nom, 120);
  const email = clean(body.email, 254).toLowerCase();
  if (!externalId) return { error: 'external_id requis' };
  if (!nom) return { error: 'nom requis' };
  if (!validEmail(email)) return { error: 'email valide requis' };

  const allowedStatuses = new Set(['nouveau', 'contacte', 'qualifie', 'proposition', 'gagne', 'perdu']);
  const statut = allowedStatuses.has(body.statut) ? body.statut : (body.contrat_signe ? 'gagne' : 'nouveau');

  return {
    lead: {
      nom,
      prenom: clean(body.prenom, 120),
      email,
      telephone: clean(body.telephone, 80),
      entreprise: clean(body.entreprise, 180),
      source: 'ecran_led',
      statut,
      notes: clean(body.notes, 3000),
      external_source: 'ecranlead',
      external_id: externalId,
      contrat_signe: body.contrat_signe === true,
      secteur: clean(body.secteur, 180),
      source_metadata: body.source_metadata && typeof body.source_metadata === 'object' && !Array.isArray(body.source_metadata)
        ? body.source_metadata
        : {},
    },
    externalId,
  };
}

async function agentRequest(path, options = {}) {
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
  if (!response.ok) {
    const error = new Error(data.error || `Agent ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function findLead(externalId) {
  const query = new URLSearchParams({ external_source: 'ecranlead', external_id: externalId, limit: '2' });
  const rows = await agentRequest(`/data/Lead?${query.toString()}`);
  return Array.isArray(rows) ? rows[0] : null;
}

async function upsertLead(payload) {
  const existing = await findLead(payload.external_id);
  if (existing?.id) {
    const lead = await agentRequest(`/data/Lead/${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return { lead, created: false };
  }
  try {
    const lead = await agentRequest('/data/Lead', { method: 'POST', body: JSON.stringify(payload) });
    return { lead, created: true };
  } catch (error) {
    // En cas de course concurrente, la contrainte UNIQUE tranche puis on relit.
    const afterRace = await findLead(payload.external_id);
    if (!afterRace?.id) throw error;
    const lead = await agentRequest(`/data/Lead/${encodeURIComponent(afterRace.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return { lead, created: false };
  }
}

async function upsertClientFromSignedLead(lead) {
  if (!lead.contrat_signe) return null;
  const query = new URLSearchParams({ email: lead.email, limit: '2' });
  const existingRows = await agentRequest(`/data/Client?${query.toString()}`);
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  const payload = {
    nom: lead.nom,
    prenom: lead.prenom || '',
    email: lead.email,
    telephone: lead.telephone || '',
    entreprise: lead.entreprise || '',
    statut: 'actif',
    notes: [lead.notes, `Converti automatiquement depuis EcranLead (${lead.external_id}).`].filter(Boolean).join('\n').slice(0, 3000),
  };
  if (existing?.id) {
    return agentRequest(`/data/Client/${encodeURIComponent(existing.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
  }
  return agentRequest('/data/Client', { method: 'POST', body: JSON.stringify(payload) });
}

async function audit(leadId, details) {
  try {
    await agentRequest('/data/LogAction', {
      method: 'POST',
      body: JSON.stringify({ action: 'sync_ecranlead', entite: 'Lead', entite_id: leadId || null, details }),
    });
  } catch (error) {
    console.warn('[ecranlead] audit log failed:', error.message);
  }
}

router.post('/', async (req, res) => {
  if (!SYNC_KEY) return res.status(503).json({ error: 'ECRANLEAD_SYNC_KEY non configurée' });
  if (!safeEqual(req.headers['x-ecranlead-key'], SYNC_KEY)) return res.status(401).json({ error: 'Clé de synchronisation invalide' });

  const normalized = normalizePayload(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  try {
    const { lead, created } = await upsertLead(normalized.lead);
    const client = normalized.lead.contrat_signe ? await upsertClientFromSignedLead(normalized.lead) : null;
    if (client?.id && lead?.id) {
      await agentRequest(`/data/Lead/${encodeURIComponent(lead.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ statut: 'gagne', contrat_signe: true, date_conversion_client: new Date().toISOString() }),
      });
    }
    await audit(lead?.id, {
      external_id: normalized.externalId,
      lead_created: created,
      client_converted: Boolean(client?.id),
      source: 'ecranlead',
    });
    res.status(created ? 201 : 200).json({ success: true, lead, client: client || null, source_of_truth: 'cockpit' });
  } catch (error) {
    console.error('[ecranlead] sync failed:', error.message);
    res.status(502).json({ error: 'Synchronisation EcranLead indisponible' });
  }
});

module.exports = { router, normalizePayload, safeEqual };
