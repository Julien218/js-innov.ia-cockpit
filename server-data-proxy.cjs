const express = require('express');
const router = express.Router();
const { cleanTenant, resolveTenant } = require('./server-tenant.cjs');

const ROLE_LEVEL = { client: 1, collaborateur: 2, admin: 3, superadmin: 4 };
const TENANT_TABLES = new Set(['Client', 'Projet', 'Tache', 'Devis', 'Facture', 'Demande']);
const CLIENT_READ_TABLES = new Set(['Projet', 'Devis', 'Facture', 'Demande']);
const ADMIN_TABLES = new Set(['LogAction', 'Validation', 'Commission']);
const AGENT_PROXY_URL = process.env.JSINNOVIA_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_PROXY_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';

async function agentRequest(path, { method = 'GET', body, tenant } = {}) {
  if (!AGENT_PROXY_KEY) {
    const error = new Error('Clé du service jsinnovia-agent non configurée.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${AGENT_PROXY_URL}${path}`, {
    method,
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

router.use(async (req, res) => {
  try {
    const table = req.path.split('/').filter(Boolean)[0];
    const role = req.user?.role || 'client';
    if (role === 'client' && (req.method !== 'GET' || !CLIENT_READ_TABLES.has(table))) {
      return res.status(403).json({ error: 'Cette opération nécessite un collaborateur.' });
    }
    if (ADMIN_TABLES.has(table) && (ROLE_LEVEL[role] || 0) < ROLE_LEVEL.admin) {
      return res.status(403).json({ error: 'Cette ressource nécessite un administrateur.' });
    }

    const tenant = TENANT_TABLES.has(table) ? resolveTenant(req) : null;
    const target = new URL(`/data${req.url}`, AGENT_PROXY_URL);
    if (tenant && req.method === 'GET' && req.path.split('/').filter(Boolean).length === 1) {
      target.searchParams.set('organisation_id', tenant);
    }

    let payload = req.body;
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
    return res.status(result.response.status).set('Content-Type', result.contentType).send(result.raw);
  } catch (error) {
    console.error('[HainoFlow data proxy]', error.message);
    return res.status(error.status || 502).json({ error: error.message });
  }
});

module.exports = router;
