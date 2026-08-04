const express = require('express');
const crypto = require('crypto');

const router = express.Router();
const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '';
const pending = new Map();
const requestWindows = new Map();
const ALLOWED_ACTIONS = {
  create_task: { method: 'POST', table: 'Tache', roles: ['collaborateur', 'admin', 'superadmin'], fields: ['titre', 'description', 'priorite', 'date_echeance', 'projet_id', 'assigne_a'] },
  update_task_status: { method: 'PATCH', table: 'Tache', roles: ['collaborateur', 'admin', 'superadmin'], fields: ['statut'], requiresId: true },
  create_lead: { method: 'POST', table: 'Lead', roles: ['admin', 'superadmin'], fields: ['nom', 'prenom', 'email', 'telephone', 'entreprise', 'source', 'notes'] }
};

function agentFetch(path, options = {}) {
  if (!AGENT_KEY) throw new Error('Agent server key not configured');
  return fetch(`${AGENT_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY, ...(options.headers || {}) }
  });
}

function rateAllowed(userId) {
  const now = Date.now();
  const item = requestWindows.get(userId);
  if (!item || now >= item.resetAt) {
    requestWindows.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  item.count += 1;
  return item.count <= 20;
}

async function logAction(user, action, status, details = '') {
  try {
    await agentFetch('/data/LogAction', { method: 'POST', body: JSON.stringify({
      action, module: 'assistant_personnel', statut: status, effectue_par: user.email,
      details: String(details).slice(0, 500)
    }) });
  } catch (error) {
    console.warn('[assistant] audit log failed:', error.message);
  }
}

function sanitizeAction(raw, user) {
  if (!raw || typeof raw !== 'object') return null;
  const definition = ALLOWED_ACTIONS[raw.type];
  if (!definition || !definition.roles.includes(user.role)) return null;
  if (definition.requiresId && !/^[a-zA-Z0-9_-]{1,100}$/.test(String(raw.id || ''))) return null;
  const payload = {};
  for (const field of definition.fields) {
    const value = raw.payload?.[field];
    if (['string', 'number', 'boolean'].includes(typeof value)) payload[field] = typeof value === 'string' ? value.slice(0, 1000) : value;
  }
  if (raw.type === 'create_task') payload.statut = 'a_faire';
  if (raw.type === 'update_task_status' && !['a_faire', 'en_cours', 'terminee', 'bloquee'].includes(payload.statut)) return null;
  return { type: raw.type, id: raw.id, payload, definition };
}

router.post('/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 2000) : '';
  if (!message) return res.status(400).json({ error: 'Message requis' });
  if (!rateAllowed(req.user.id)) return res.status(429).json({ error: 'Trop de requêtes. Réessayez dans une minute.' });

  try {
    const response = await agentFetch('/chat', { method: 'POST', body: JSON.stringify({
      message,
      session_id: `cockpit:${req.user.id}`,
      user_context: { id: req.user.id, role: req.user.role, organisation: req.user.organisation },
      security: { assistant: 'personal', require_confirmation_for_actions: true }
    }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Agent ${response.status}`);

    const action = sanitizeAction(data.proposed_action || data.action, req.user);
    let confirmation = null;
    if (action) {
      const token = crypto.randomBytes(24).toString('hex');
      pending.set(token, { action, userId: req.user.id, expiresAt: Date.now() + 5 * 60_000 });
      confirmation = { token, type: action.type, summary: String(data.action_summary || `Confirmer l’action ${action.type}`).slice(0, 300), expires_in: 300 };
    }
    await logAction(req.user, 'conversation assistant', 'succes', action ? `Action proposée: ${action.type}` : 'Réponse sans action');
    res.json({ message: data.response || data.reply || data.message || 'Réponse vide', confirmation });
  } catch (error) {
    await logAction(req.user, 'conversation assistant', 'erreur', error.message);
    res.status(502).json({ error: 'Assistant momentanément indisponible' });
  }
});

router.post('/confirm', async (req, res) => {
  const token = String(req.body?.token || '');
  const item = pending.get(token);
  pending.delete(token);
  if (!item || item.userId !== req.user.id || item.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'Confirmation invalide ou expirée' });
  }

  const { action } = item;
  const path = `/data/${action.definition.table}${action.definition.requiresId ? `/${action.id}` : ''}`;
  try {
    const response = await agentFetch(path, { method: action.definition.method, body: JSON.stringify(action.payload), headers: { 'idempotency-key': token } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Agent ${response.status}`);
    await logAction(req.user, `action assistant: ${action.type}`, 'succes', `Cible: ${action.id || action.definition.table}`);
    res.json({ success: true, result: data });
  } catch (error) {
    await logAction(req.user, `action assistant: ${action.type}`, 'erreur', error.message);
    res.status(502).json({ error: 'Action non exécutée' });
  }
});

module.exports = router;
