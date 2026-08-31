const express = require('express');
const router = express.Router();
const { cleanTenant, resolveTenant } = require('./server-tenant.cjs');
const { hasPermission } = require('./server-permission-policy.cjs');
const { invoiceScope, readClientInvoices } = require('./server-client-invoices.cjs');
const { normalizeDemandeWrite } = require('./server-demande-status.cjs');

const ROLE_LEVEL = { client: 1, collaborateur: 2, admin: 3, superadmin: 4 };
const TENANT_TABLES = new Set(['Client', 'Projet', 'Tache', 'Devis', 'Facture', 'Demande']);
const CLIENT_READ_TABLES = new Set(['Projet', 'Devis', 'Facture', 'Demande']);
const ADMIN_TABLES = new Set(['LogAction', 'Validation', 'Commission']);
const TABLE_PERMISSIONS = Object.freeze({
  Client: 'clients', Projet: 'projects', Tache: 'tasks', Devis: 'quotes', Facture: 'invoices', Demande: 'requests',
  LogAction: 'logs', Validation: 'validations', Commission: 'commissions',
});
const AGENT_PROXY_URL = process.env.JSINNOVIA_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_PROXY_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';

const CLIENT_VISIBLE_FIELDS = {
  Projet: new Set(['id', 'nom', 'description', 'statut', 'date_debut', 'date_fin_prevue', 'progression', 'priorite', 'client_nom', 'created_at', 'updated_at']),
  Devis: new Set(['id', 'numero', 'objet', 'client_nom', 'projet_id', 'lignes', 'montant_ht', 'tva', 'montant_ttc', 'statut', 'date_validite', 'created_at', 'updated_at']),
  Facture: new Set(['id', 'numero', 'objet', 'client_nom', 'devis_id', 'lignes', 'montant_ht', 'tva', 'montant_ttc', 'statut', 'date_echeance', 'date_paiement', 'mode_paiement', 'created_at', 'updated_at']),
  Demande: new Set(['id', 'nom', 'email', 'telephone', 'entreprise', 'message', 'type', 'statut', 'created_at', 'updated_at']),
};

async function agentRequest(path, { method = 'GET', body, tenant, signal, redirect } = {}) {
  if (!AGENT_PROXY_KEY) {
    const error = new Error('Clé du service jsinnovia-agent non configurée.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${AGENT_PROXY_URL}${path}`, {
    method,
    ...(signal ? { signal } : {}),
    ...(redirect ? { redirect } : {}),
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': AGENT_PROXY_KEY,
      ...(tenant ? { 'x-organisation-id': tenant } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const contentType = response.headers.get('content-type') || 'application/json';
  const raw = await response.text();
  return { response, contentType, raw };
}

function publicClientRecord(table, record) {
  const allowed = CLIENT_VISIBLE_FIELDS[table];
  if (!allowed || !record || typeof record !== 'object' || Array.isArray(record)) return null;
  return Object.fromEntries(Object.entries(record).filter(([key]) => allowed.has(key)));
}

function minimizeClientResponse(table, raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (Array.isArray(data)) return JSON.stringify(data.map((row) => publicClientRecord(table, row)).filter(Boolean));
  if (data && typeof data === 'object' && !data.error) return JSON.stringify(publicClientRecord(table, data) || {});
  return raw;
}

router.use(async (req, res) => {
  try {
    const table = req.path.split('/').filter(Boolean)[0];
    const role = req.user?.role || 'client';
    const requiredPermission = TABLE_PERMISSIONS[table];
    if (requiredPermission && !hasPermission(req.user, requiredPermission)) {
      return res.status(403).json({ error: 'Accès à cette ressource non autorisé' });
    }
    if (role === 'client' && (req.method !== 'GET' || !CLIENT_READ_TABLES.has(table))) {
      return res.status(403).json({ error: 'Cette opération nécessite un collaborateur.' });
    }
    if (ADMIN_TABLES.has(table) && (ROLE_LEVEL[role] || 0) < ROLE_LEVEL.admin) {
      return res.status(403).json({ error: 'Cette ressource nécessite un administrateur.' });
    }

    if (role === 'client' && table === 'Facture') {
      const scope = invoiceScope(req.user);
      if (scope) {
        res.setHeader('Cache-Control', 'private, no-store');
        const parts = req.path.split('/').filter(Boolean);
        if (parts.length > 2 || req.headers['x-managed-organisation']) return res.status(403).json({ error: 'Consultation des factures destinataires uniquement.' });
        // Browser-supplied client/organisation/filter parameters cannot widen scope.
        return res.json(await readClientInvoices(scope, agentRequest, parts[1] || null));
      }
    }

    const tenant = TENANT_TABLES.has(table) ? resolveTenant(req) : null;
    const target = new URL(`/data${req.url}`, AGENT_PROXY_URL);
    if (tenant && req.method === 'GET' && req.path.split('/').filter(Boolean).length === 1) {
      target.searchParams.set('organisation_id', tenant);
    }

    let payload = req.body;
    if (table === 'Demande' && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
      payload = normalizeDemandeWrite(payload, req.method);
    }
    if (tenant && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (payload?.organisation_id && cleanTenant(payload.organisation_id) !== tenant) {
        return res.status(403).json({ error: 'Organisation du document non autorisée.' });
      }
      payload = {
        ...(payload || {}),
        organisation_id: tenant,
        ...(req.method === 'POST'
          ? { created_by: req.user?.email || req.user?.id || 'cockpit' }
          : { updated_by: req.user?.email || req.user?.id || 'cockpit' }),
      };
    }

    const result = await agentRequest(`${target.pathname}${target.search}`, {
      method: req.method,
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? payload : undefined,
      tenant,
    });
    if (result.response.status === 204 || !result.raw) return res.status(result.response.status).end();

    const body = role === 'client' && req.method === 'GET' && result.response.ok
      ? minimizeClientResponse(table, result.raw)
      : result.raw;
    return res.status(result.response.status).set('Content-Type', result.contentType).send(body);
  } catch (error) {
    console.error('[HainoFlow data proxy]', error.message);
    return res.status(error.status || 502).json({ error: error.message });
  }
});

module.exports = router;
