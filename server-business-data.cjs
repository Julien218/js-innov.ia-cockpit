const express = require('express');

const router = express.Router();
const SUPABASE_URL = process.env.SUPABASE_CRM_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_CRM_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const TABLES = new Map([
  ['Client', 'clients_fr'], ['Lead', 'leads_fr'], ['Projet', 'projets'],
  ['Service', 'services_fr'], ['Tache', 'taches'], ['Devis', 'devis'],
  ['Facture', 'factures'], ['Commission', 'commissions_fr'], ['Demande', 'demandes'],
  ['LogAction', 'logs_actions'], ['Asset', 'Asset'], ['AssetHistory', 'AssetHistory'],
  ['SystemConfig', 'SystemConfig'], ['AutomationAudit', 'AutomationAudit'], ['Validation', 'validations'], ['validations', 'validations'],
]);
const CREATED_DATE_ENTITIES = new Set(['Service', 'Validation', 'LogAction']);
const cleanIdentifier = value => /^[a-z_][a-z0-9_]*$/i.test(String(value || '')) ? String(value) : null;

function normalizeRows(entity, rows) {
  if (!Array.isArray(rows)) return [];
  if (entity === 'SystemConfig') return rows.map(row => ({ ...row, id: row.key }));
  return rows;
}

async function request(resource, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase métier non configuré');
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
  if (!response.ok) throw new Error(`Supabase métier HTTP ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
  return text ? JSON.parse(text) : null;
}

router.use(async (req, res, next) => {
  const segments = req.path.split('/').filter(Boolean);
  const entity = segments[0];
  const table = TABLES.get(entity);
  if (!table) return next();

  try {
    const primaryKey = entity === 'SystemConfig' ? 'key' : 'id';
    const id = segments[1] ? String(segments[1]).slice(0, 300) : '';
    const params = new URLSearchParams({ select: '*' });
    if (id) params.set(primaryKey, `eq.${id}`);
    for (const [key, value] of Object.entries(req.query || {})) {
      if (['sort', 'order'].includes(key)) continue;
      const column = cleanIdentifier(key);
      if (column) params.set(column, `eq.${String(value).slice(0, 1000)}`);
    }
    const requestedSort = cleanIdentifier(req.query.sort);
    if (requestedSort) {
      const sort = CREATED_DATE_ENTITIES.has(entity) && requestedSort === 'created_at' ? 'created_date' : requestedSort;
      params.set('order', `${sort}.${req.query.order === 'desc' ? 'desc' : 'asc'}`);
    }
    const resource = `${table}?${params}`;

    if (req.method === 'GET') {
      const rows = normalizeRows(entity, await request(resource));
      if (id && !rows[0]) return res.status(404).json({ error: 'Ressource introuvable' });
      return res.json(id ? rows[0] : rows);
    }

    const payload = { ...(req.body || {}) };
    if (entity === 'SystemConfig') delete payload.id;
    if (req.method === 'POST') {
      const rows = normalizeRows(entity, await request(table, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) }));
      return res.status(201).json(rows[0] || null);
    }
    if (req.method === 'PATCH' && id) {
      const rows = normalizeRows(entity, await request(`${table}?${primaryKey}=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) }));
      if (!rows[0]) return res.status(404).json({ error: 'Ressource introuvable' });
      return res.json(rows[0]);
    }
    if (req.method === 'DELETE' && id) {
      await request(`${table}?${primaryKey}=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return res.status(204).end();
    }
    return res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (error) {
    console.error('[business-data]', entity, error.message);
    return res.status(503).json({ error: 'Données métier momentanément indisponibles' });
  }
});

module.exports = router;
module.exports.TABLES = TABLES;

