// ============================================================
// server-governance.cjs — Data Governance & RGPD API
// Cockpit JS-Innov.IA
//
// Endpoints:
//   Audit Log:
//     GET  /api/governance/audit                    — list audit entries (admin+)
//     POST /api/governance/audit                    — create audit entry (internal)
//
//   Data Classification:
//     GET  /api/governance/classifications           — list classifications
//
//   Processing Activities (Art. 30 RGPD):
//     GET    /api/governance/processing-activities
//     POST   /api/governance/processing-activities    (admin+)
//     PUT    /api/governance/processing-activities/:id (admin+)
//     DELETE /api/governance/processing-activities/:id (superadmin)
//
//   Subprocessor Registry (Art. 28 RGPD):
//     GET    /api/governance/subprocessors
//     POST   /api/governance/subprocessors             (admin+)
//     PUT    /api/governance/subprocessors/:id         (admin+)
//     DELETE /api/governance/subprocessors/:id         (superadmin)
//
//   Consent Records:
//     GET    /api/governance/consents
//     POST   /api/governance/consents                  (admin+)
//     POST   /api/governance/consents/:id/withdraw     (admin+)
//
//   Data Subject Requests (RGPD):
//     GET    /api/governance/dsr
//     POST   /api/governance/dsr                       (client+)
//     GET    /api/governance/dsr/:id
//     PUT    /api/governance/dsr/:id                   (admin+)
//     POST   /api/governance/dsr/:id/export            (admin+)
//     POST   /api/governance/dsr/:id/complete          (admin+)
//
//   Retention Policies:
//     GET    /api/governance/retention-policies
//     PUT    /api/governance/retention-policies/:id    (admin+)
//
//   Data Export (Art. 20 RGPD):
//     POST  /api/governance/export                     (client+)
//
//   Data Erasure (Art. 17 RGPD):
//     POST  /api/governance/erasure                    (admin+)
//
// Security:
//   - Toutes les routes require une session valide (cookie HttpOnly)
//   - RBAC: superadmin > admin > collaborateur > client
//   - Multi-tenant: filtrage par organisation_id/tenant_id
//   - Audit: chaque action sensible est journalisee
// ============================================================

const express = require('express');
const crypto = require('crypto');
const cookie = require('cookie');

const router = express.Router();

// ─── Configuration Supabase (gfj = donnees metier) ─────────────────
const SUPABASE_URL = process.env.SUPABASE_CRM_URL || process.env.SUPABASE_URL || 'https://gfjpryakxzdzwnazlsfz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_CRM_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const ROLE_LEVEL = { client: 1, collaborateur: 2, admin: 3, superadmin: 4 };

// ─── Helpers ────────────────────────────────────────────────────────

function hashIP(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 32);
}

function getUserFromReq(req) {
  return req.user || null;
}

function requireMinRole(minRole) {
  return async (req, res, next) => {
    try {
      const user = req.user || await resolveSessionFromCookie(req);
      if (!user) return res.status(401).json({ error: 'Session requise' });
      if ((ROLE_LEVEL[user.role] || 0) < (ROLE_LEVEL[minRole] || 0)) {
        return res.status(403).json({ error: 'Droits insuffisants' });
      }
      req.user = user;
      res.setHeader('Cache-Control', 'no-store');
      next();
    } catch (error) {
      console.error('[governance] auth failed:', error.message);
      res.status(503).json({ error: 'Validation de session indisponible' });
    }
  };
}

// Resolve session from cookie (same logic as server-security.cjs)
async function resolveSessionFromCookie(req) {
  const SUPABASE_AUTH_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
  const SUPABASE_AUTH_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!SUPABASE_AUTH_KEY) return null;

  const token = cookie.parse(req.headers.cookie || '').session;
  if (!token) return null;

  try {
    const sessResp = await fetch(`${SUPABASE_AUTH_URL}/rest/v1/cockpit_sessions?select=user_id,expires_at&token=eq.${encodeURIComponent(token)}&limit=1`, {
      headers: { apikey: SUPABASE_AUTH_KEY, Authorization: `Bearer ${SUPABASE_AUTH_KEY}` }
    });
    const sessions = await sessResp.json();
    const session = sessions[0];
    if (!session || new Date(session.expires_at) <= new Date()) return null;

    const userResp = await fetch(`${SUPABASE_AUTH_URL}/rest/v1/cockpit_users?select=id,email,full_name,role,organisation,is_active&id=eq.${encodeURIComponent(session.user_id)}&is_active=eq.true&limit=1`, {
      headers: { apikey: SUPABASE_AUTH_KEY, Authorization: `Bearer ${SUPABASE_AUTH_KEY}` }
    });
    const users = await userResp.json();
    return users[0] || null;
  } catch (e) {
    console.error('[governance] session resolve error:', e.message);
    return null;
  }
}

async function supabaseQuery(path, options = {}) {
  if (!SUPABASE_KEY) throw new Error('Supabase CRM key not configured');
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Supabase ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!text) return null;
  return JSON.parse(text);
}

// ─── Audit Trail Helper ────────────────────────────────────────────

async function auditLog(req, action, entityType, entityId, description, metadata = {}, severity = 'info') {
  try {
    const user = getUserFromReq(req);
    const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    const ua = (req.headers['user-agent'] || '').slice(0, 100);

    await supabaseQuery('rpc/log_action', {
      method: 'POST',
      body: JSON.stringify({
        p_action: action,
        p_entity_type: entityType,
        p_entity_id: entityId ? String(entityId) : null,
        p_actor_id: user?.id || null,
        p_actor_email: user?.email || null,
        p_actor_role: user?.role || null,
        p_description: description,
        p_metadata: metadata,
        p_severity: severity,
        p_source: 'cockpit',
        p_tenant_id: user?.organisation || 'jsinnovia',
      }),
    });
  } catch (e) {
    console.warn('[governance] audit log failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════════════

router.get('/audit', requireMinRole('admin'), async (req, res) => {
  try {
    const { action, entity_type, severity, limit = 100, offset = 0 } = req.query;
    let path = 'audit_log_recent?';
    const filters = [];
    if (action) filters.push(`action=eq.${encodeURIComponent(action)}`);
    if (entity_type) filters.push(`entity_type=eq.${encodeURIComponent(entity_type)}`);
    if (severity) filters.push(`severity=eq.${encodeURIComponent(severity)}`);
    path += filters.join('&');
    if (filters.length > 0) path += '&';
    path += `limit=${Math.min(parseInt(limit) || 100, 500)}&offset=${parseInt(offset) || 0}`;

    const rows = await supabaseQuery(path);
    res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    console.error('[governance] audit list:', error.message);
    res.status(503).json({ error: error.message });
  }
});

router.post('/audit', requireMinRole('collaborateur'), async (req, res) => {
  try {
    const { action, entity_type, entity_id, description, metadata, severity } = req.body;
    if (!action) return res.status(400).json({ error: 'action requis' });
    await auditLog(req, action, entity_type, entity_id, description, metadata || {}, severity || 'info');
    res.json({ success: true });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DATA CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════

router.get('/classifications', requireMinRole('client'), async (req, res) => {
  try {
    const rows = await supabaseQuery('data_classification?is_active=eq.true&order=sort_order.asc');
    res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PROCESSING ACTIVITIES (Art. 30 RGPD)
// ═══════════════════════════════════════════════════════════════════

router.get('/processing-activities', requireMinRole('admin'), async (req, res) => {
  try {
    const rows = await supabaseQuery('processing_activity?order=created_at.desc');
    res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.post('/processing-activities', requireMinRole('admin'), async (req, res) => {
  try {
    const body = req.body;
    const user = getUserFromReq(req);
    const payload = {
      name: body.name,
      purpose: body.purpose,
      categories_of_persons: body.categories_of_persons || null,
      categories_of_data: body.categories_of_data || null,
      legal_basis: body.legal_basis || null,
      legal_basis_note: body.legal_basis_note || null,
      recipients: body.recipients || null,
      subprocessors: body.subprocessors || null,
      transfers_outside_eee: body.transfers_outside_eee || false,
      transfer_mechanism: body.transfer_mechanism || null,
      retention_period: body.retention_period || null,
      security_measures: body.security_measures || null,
      owner: body.owner || user?.email || null,
      tenant_id: user?.organisation || 'jsinnovia',
      legal_validation_status: 'pending',
    };
    const rows = await supabaseQuery('processing_activity', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    await auditLog(req, 'create', 'ProcessingActivity', row?.id, `Traitement créé: ${body.name}`);
    res.json({ success: true, data: row });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.put('/processing-activities/:id', requireMinRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    const updateFields = { ...body, updated_at: new Date().toISOString() };
    delete updateFields.id;
    delete updateFields.created_at;
    const rows = await supabaseQuery(`processing_activity?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(updateFields),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    await auditLog(req, 'update', 'ProcessingActivity', id, `Traitement modifié: ${body.name || id}`);
    res.json({ success: true, data: row });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.delete('/processing-activities/:id', requireMinRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    await supabaseQuery(`processing_activity?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    await auditLog(req, 'delete', 'ProcessingActivity', id, `Traitement supprimé: ${id}`, {}, 'warning');
    res.json({ success: true });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// SUBPROCESSOR REGISTRY (Art. 28 RGPD)
// ═══════════════════════════════════════════════════════════════════

router.get('/subprocessors', requireMinRole('admin'), async (req, res) => {
  try {
    const rows = await supabaseQuery('subprocessor_registry?is_active=eq.true&order=provider_name.asc');
    res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.post('/subprocessors', requireMinRole('admin'), async (req, res) => {
  try {
    const body = req.body;
    const user = getUserFromReq(req);
    const payload = {
      provider_name: body.provider_name,
      service_purpose: body.service_purpose,
      categories_of_data: body.categories_of_data || null,
      processing_location: body.processing_location || null,
      dpa_signed: body.dpa_signed || false,
      dpa_date: body.dpa_date || null,
      transfer_mechanism: body.transfer_mechanism || null,
      sub_subprocessors: body.sub_subprocessors || null,
      validation_status: 'pending',
      owner: body.owner || user?.email || null,
      tenant_id: user?.organisation || 'jsinnovia',
    };
    const rows = await supabaseQuery('subprocessor_registry', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    await auditLog(req, 'create', 'Subprocessor', row?.id, `Sous-traitant ajouté: ${body.provider_name}`);
    res.json({ success: true, data: row });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.put('/subprocessors/:id', requireMinRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    const updateFields = { ...body, updated_at: new Date().toISOString() };
    delete updateFields.id;
    delete updateFields.created_at;
    const rows = await supabaseQuery(`subprocessor_registry?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(updateFields),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    await auditLog(req, 'update', 'Subprocessor', id, `Sous-traitant modifié: ${body.provider_name || id}`);
    res.json({ success: true, data: row });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.delete('/subprocessors/:id', requireMinRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    await supabaseQuery(`subprocessor_registry?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    await auditLog(req, 'delete', 'Subprocessor', id, `Sous-traitant supprimé: ${id}`, {}, 'warning');
    res.json({ success: true });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// CONSENT RECORDS
// ═══════════════════════════════════════════════════════════════════

router.get('/consents', requireMinRole('admin'), async (req, res) => {
  try {
    const { email, status, limit = 100 } = req.query;
    let path = 'consent_record?';
    const filters = [];
    if (email) filters.push(`person_email=eq.${encodeURIComponent(email)}`);
    if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
    path += filters.join('&');
    if (filters.length > 0) path += '&';
    path += `order=created_at.desc&limit=${Math.min(parseInt(limit) || 100, 500)}`;
    const rows = await supabaseQuery(path);
    res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.post('/consents', requireMinRole('admin'), async (req, res) => {
  try {
    const body = req.body;
    const user = getUserFromReq(req);
    const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    const payload = {
      person_email: body.person_email,
      person_name: body.person_name || null,
      person_id: body.person_id || null,
      purpose: body.purpose,
      text_version: body.text_version || null,
      text_hash: body.text_hash || null,
      method: body.method || 'web_form',
      status: 'active',
      proof_metadata: { ip_hash: hashIP(ip), ua: (req.headers['user-agent'] || '').slice(0, 80) },
      tenant_id: user?.organisation || 'jsinnovia',
      processing_activity_id: body.processing_activity_id || null,
    };
    const rows = await supabaseQuery('consent_record', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    await auditLog(req, 'create', 'ConsentRecord', row?.id, `Consentement enregistré: ${body.purpose} (${body.person_email})`);
    res.json({ success: true, data: row });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.post('/consents/:id/withdraw', requireMinRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await supabaseQuery(`consent_record?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'withdrawn', withdrawn_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    await auditLog(req, 'update', 'ConsentRecord', id, `Consentement retiré: ${id}`, {}, 'warning');
    res.json({ success: true, data: row });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DATA SUBJECT REQUESTS (RGPD)
// ═══════════════════════════════════════════════════════════════════

router.get('/dsr', requireMinRole('admin'), async (req, res) => {
  try {
    const { status, type, limit = 50 } = req.query;
    let path = 'data_subject_request?';
    const filters = [];
    if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
    if (type) filters.push(`request_type=eq.${encodeURIComponent(type)}`);
    path += filters.join('&');
    if (filters.length > 0) path += '&';
    path += `order=created_at.desc&limit=${Math.min(parseInt(limit) || 50, 200)}`;
    const rows = await supabaseQuery(path);
    res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.post('/dsr', requireMinRole('client'), async (req, res) => {
  try {
    const body = req.body;
    const user = getUserFromReq(req);
    const payload = {
      request_type: body.request_type,
      requester_name: body.requester_name || user?.full_name || null,
      requester_email: body.requester_email || user?.email || null,
      requester_phone: body.requester_phone || null,
      requester_id: user?.id || null,
      description: body.description || null,
      scope: body.scope || null,
      tenant_id: user?.organisation || 'jsinnovia',
      status: 'received',
    };
    const rows = await supabaseQuery('data_subject_request', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    await auditLog(req, 'gdpr_request', 'DataSubjectRequest', row?.id, `Demande RGPD créée: ${body.request_type} (${payload.requester_email})`, { request_type: body.request_type }, 'warning');
    res.json({ success: true, data: row });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.get('/dsr/:id', requireMinRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await supabaseQuery(`data_subject_request?id=eq.${encodeURIComponent(id)}&limit=1`);
    res.json({ success: true, data: Array.isArray(rows) ? rows[0] : null });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.put('/dsr/:id', requireMinRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    const updateFields = { ...body, updated_at: new Date().toISOString() };
    delete updateFields.id;
    delete updateFields.created_at;
    const rows = await supabaseQuery(`data_subject_request?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(updateFields),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    await auditLog(req, 'update', 'DataSubjectRequest', id, `Demande RGPD modifiée: ${id} → ${body.status || '?'}`);
    res.json({ success: true, data: row });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.post('/dsr/:id/complete', requireMinRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution_summary, legal_retention_note } = req.body;
    const rows = await supabaseQuery(`data_subject_request?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'completed',
        completed_at: new Date().toISOString(),
        resolution_summary: resolution_summary || null,
        legal_retention_note: legal_retention_note || null,
        updated_at: new Date().toISOString(),
      }),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    await auditLog(req, 'gdpr_request', 'DataSubjectRequest', id, `Demande RGPD clôturée: ${id}`, { resolution_summary }, 'warning');
    res.json({ success: true, data: row });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// RETENTION POLICIES
// ═══════════════════════════════════════════════════════════════════

router.get('/retention-policies', requireMinRole('admin'), async (req, res) => {
  try {
    const rows = await supabaseQuery('retention_policy?is_active=eq.true&order=category.asc');
    res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.put('/retention-policies/:id', requireMinRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    const updateFields = { ...body, updated_at: new Date().toISOString() };
    delete updateFields.id;
    delete updateFields.created_at;
    const rows = await supabaseQuery(`retention_policy?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(updateFields),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    await auditLog(req, 'update', 'RetentionPolicy', id, `Politique de conservation modifiée: ${body.category_label || id}`);
    res.json({ success: true, data: row });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DATA EXPORT (Art. 20 RGPD — Portabilité)
// ═══════════════════════════════════════════════════════════════════

router.post('/export', requireMinRole('client'), async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const tenant = user?.organisation || 'jsinnovia';

    // Collect all data for the user's tenant (or just their personal data if client)
    const exportData = {
      exported_at: new Date().toISOString(),
      exported_by: { id: user?.id, email: user?.email, role: user?.role },
      tenant_id: tenant,
    };

    // For clients: only their data. For admin+: all tenant data.
    if (user?.role === 'client') {
      // Export only the client's personal data
      const clientFilter = `?email=eq.${encodeURIComponent(user.email)}&organisation_id=eq.${encodeURIComponent(tenant)}&select=*`;
      exportData.clients = await supabaseQuery(`Client${clientFilter}`) || [];
      exportData.leads = await supabaseQuery(`Lead${clientFilter}`) || [];
      exportData.demandes = await supabaseQuery(`Demande${clientFilter}`) || [];
      // Get documents for this client
      exportData.documents = await supabaseQuery(`DocumentIndex?tenant_id=eq.${encodeURIComponent(tenant)}&select=id,filename,mime_type,size_bytes,created_at`) || [];
    } else {
      // Admin+: export all tenant data
      const orgFilter = `?organisation_id=eq.${encodeURIComponent(tenant)}&select=*`;
      exportData.clients = await supabaseQuery(`Client${orgFilter}`) || [];
      exportData.leads = await supabaseQuery(`Lead${orgFilter}`) || [];
      exportData.demandes = await supabaseQuery(`Demande${orgFilter}`) || [];
      exportData.devis = await supabaseQuery(`Devis${orgFilter}`) || [];
      exportData.factures = await supabaseQuery(`Facture${orgFilter}`) || [];
      exportData.projets = await supabaseQuery(`Projet${orgFilter}`) || [];
      exportData.taches = await supabaseQuery(`Tache${orgFilter}`) || [];
      exportData.documents = await supabaseQuery(`DocumentIndex?tenant_id=eq.${encodeURIComponent(tenant)}&deleted_at=is.null&select=*`) || [];
    }

    // Filter out sensitive fields from export
    const sanitize = (arr) => (arr || []).map(row => {
      const { ...data } = row;
      return data;
    });

    Object.keys(exportData).forEach(k => {
      if (Array.isArray(exportData[k])) exportData[k] = sanitize(exportData[k]);
    });

    await auditLog(req, 'export', 'DataExport', null, `Export de données par ${user?.email} (${user?.role})`, { scope: user?.role === 'client' ? 'personal' : 'tenant' }, 'warning');

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="export_${tenant}_${Date.now()}.json"`);
    res.json(exportData);
  } catch (error) {
    console.error('[governance] export error:', error.message);
    res.status(503).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DATA ERASURE (Art. 17 RGPD — Droit à l'effacement)
// ═══════════════════════════════════════════════════════════════════

router.post('/erasure', requireMinRole('admin'), async (req, res) => {
  try {
    const { email, scope = 'personal', reason, legal_retention_note } = req.body;
    if (!email) return res.status(400).json({ error: 'email requis' });
    if (!reason) return res.status(400).json({ error: 'reason (motif) requis' });

    const user = getUserFromReq(req);
    const tenant = user?.organisation || 'jsinnovia';
    const results = { email, scope, reason, timestamp: new Date().toISOString(), actions: [] };

    // Step 1: Identify data
    const clients = await supabaseQuery(`Client?email=eq.${encodeURIComponent(email)}&organisation_id=eq.${encodeURIComponent(tenant)}&select=id,nom,prenom`) || [];
    results.identified = { clients: clients.length };

    // Step 2: Check legal retention obligations
    // NOTE: Factures must be retained for 7 years ( Belgian accounting law)
    // We anonymize instead of deleting for invoices
    if (legal_retention_note) {
      results.legal_retention = legal_retention_note;
    }

    // Step 3: Anonymize client data (not delete, to preserve referential integrity)
    for (const client of clients) {
      await supabaseQuery(`Client?id=eq.${encodeURIComponent(client.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nom: '[ANONYMIZED]',
          prenom: '[ANONYMIZED]',
          email: null,
          telephone: null,
          adresse: null,
          ville: null,
          notes: null,
          updated_at: new Date().toISOString(),
        }),
      });
      results.actions.push({ entity: 'Client', id: client.id, action: 'anonymized' });
    }

    // Anonymize leads
    const leads = await supabaseQuery(`Lead?email=eq.${encodeURIComponent(email)}&organisation_id=eq.${encodeURIComponent(tenant)}&select=id`) || [];
    for (const lead of leads) {
      await supabaseQuery(`Lead?id=eq.${encodeURIComponent(lead.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nom: '[ANONYMIZED]', prenom: '[ANONYMIZED]', email: null,
          telephone: null, notes: null, updated_at: new Date().toISOString(),
        }),
      });
      results.actions.push({ entity: 'Lead', id: lead.id, action: 'anonymized' });
    }

    // Anonymize demandes
    const demandes = await supabaseQuery(`Demande?email=eq.${encodeURIComponent(email)}&organisation_id=eq.${encodeURIComponent(tenant)}&select=id`) || [];
    for (const dem of demandes) {
      await supabaseQuery(`Demande?id=eq.${encodeURIComponent(dem.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nom: '[ANONYMIZED]', email: null, telephone: null,
          message: '[ANONYMIZED]', updated_at: new Date().toISOString(),
        }),
      });
      results.actions.push({ entity: 'Demande', id: dem.id, action: 'anonymized' });
    }

    // Withdraw consents
    const consents = await supabaseQuery(`consent_record?person_email=eq.${encodeURIComponent(email)}&status=eq.active&select=id`) || [];
    for (const c of consents) {
      await supabaseQuery(`consent_record?id=eq.${encodeURIComponent(c.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'withdrawn', withdrawn_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
      results.actions.push({ entity: 'ConsentRecord', id: c.id, action: 'withdrawn' });
    }

    // NOTE: Factures are NOT deleted (legal retention 7 years)
    // They are kept but the client reference is anonymized
    results.actions.push({ entity: 'Facture', action: 'retained (legal obligation 7 years — Art. 17(3)(b) RGPD)' });

    await auditLog(req, 'gdpr_request', 'DataErasure', email, `Effacement/anonymisation: ${email}`, { reason, scope, actions_count: results.actions.length }, 'warning');

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[governance] erasure error:', error.message);
    res.status(503).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GOVERNANCE DASHBOARD (summary stats)
// ═══════════════════════════════════════════════════════════════════

router.get('/dashboard', requireMinRole('admin'), async (req, res) => {
  try {
    const tenant = req.user?.organisation || 'jsinnovia';

    // Count audit entries
    const auditRows = await supabaseQuery('audit_log?select=id&limit=1') || [];
    // Count DSRs by status
    const dsrReceived = await supabaseQuery('data_subject_request?status=eq.received&select=id') || [];
    const dsrProcessing = await supabaseQuery('data_subject_request?status=eq.processing&select=id') || [];
    const dsrCompleted = await supabaseQuery('data_subject_request?status=eq.completed&select=id') || [];
    // Count subprocessors
    const subprocessors = await supabaseQuery('subprocessor_registry?is_active=eq.true&select=id') || [];
    const dpaSigned = await supabaseQuery('subprocessor_registry?dpa_signed=eq.true&select=id') || [];
    // Processing activities
    const paPending = await supabaseQuery('processing_activity?legal_validation_status=eq.pending&select=id') || [];
    const paValidated = await supabaseQuery('processing_activity?legal_validation_status=eq.validated&select=id') || [];
    // Retention policies
    const rpPending = await supabaseQuery('retention_policy?validation_status=eq.pending&select=id') || [];
    // Consents
    const activeConsents = await supabaseQuery('consent_record?status=eq.active&select=id') || [];

    res.json({
      success: true,
      data: {
        audit_entries: auditRows.length,
        dsr: {
          received: dsrReceived.length,
          processing: dsrProcessing.length,
          completed: dsrCompleted.length,
        },
        subprocessors: {
          total: subprocessors.length,
          dpa_signed: dpaSigned.length,
          dpa_pending: subprocessors.length - dpaSigned.length,
        },
        processing_activities: {
          pending: paPending.length,
          validated: paValidated.length,
        },
        retention_policies: {
          pending_validation: rpPending.length,
        },
        consents: {
          active: activeConsents.length,
        },
      },
    });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

module.exports = router;
