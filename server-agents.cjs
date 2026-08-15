const express = require('express');
const { requireSession, ROLE_LEVEL } = require('./server-security.cjs');
const { postgresRest } = require('./server-postgres.cjs');

const router = express.Router();
const BASE44_URL = 'https://app.base44.com/api/agents';
const BASE44_API_KEY = process.env.BASE44_API_KEY || process.env.VITE_BASE44_API_KEY || '';
const ALLOWED_AGENT_IDS = new Set([
  '6a1845e17cc526d1e44965bc',
  '6a0208edd1e235b62b4bda38',
  '69fcda52258a254f4220b0bd',
  '6a0371a87c9257126b051d5a',
  '6a22f0c096ce009a943f4a05',
  '69ff4dc771a2cdab275f8a00',
  '6a035427dca907aa03b71398',
  '69e732e1d54abfd1783f5d06',
]);

const SUPABASE_URL = process.env.SUPABASE_CRM_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_CRM_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function database(resource, options = {}) {
  if (process.env.DATABASE_URL) return postgresRest(resource, options);
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Base des abonnements non configurée');
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
  if (!response.ok) throw new Error(`Entitlements HTTP ${response.status}`);
  return text ? JSON.parse(text) : null;
}

function validAgentId(value) {
  const id = String(value || '');
  return ALLOWED_AGENT_IDS.has(id) ? id : null;
}

async function clientCanUseAgent(user, agentId) {
  if ((ROLE_LEVEL[user?.role] || 0) >= ROLE_LEVEL.collaborateur) return true;
  const code = `ai_agent:${agentId}`;
  const email = String(user?.email || '').toLowerCase();
  const rows = await database(`client_module_entitlements?select=id&email=eq.${encodeURIComponent(email)}&module_code=eq.${encodeURIComponent(code)}&enabled=eq.true&limit=1`);
  return Array.isArray(rows) && rows.length > 0;
}

async function requireAgentAccess(req, res, next) {
  try {
    const agentId = validAgentId(req.params.agentId);
    if (!agentId) return res.status(404).json({ error: 'Agent inconnu' });
    if (!await clientCanUseAgent(req.user, agentId)) {
      return res.status(403).json({ error: 'Agent non inclus dans votre abonnement' });
    }
    req.agentId = agentId;
    next();
  } catch (error) {
    console.error('[agents] entitlement:', error.message);
    res.status(503).json({ error: 'Vérification de l’abonnement indisponible' });
  }
}

async function forwardToBase44(req, res, suffix, body) {
  if (!BASE44_API_KEY) return res.status(503).json({ error: 'Service Agents IA non configuré' });
  try {
    const response = await fetch(`${BASE44_URL}/${req.agentId}${suffix}`, {
      method: 'POST',
      headers: { api_key: BASE44_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';
    res.status(response.status).set('Content-Type', contentType).send(text);
  } catch (error) {
    console.error('[agents] proxy:', error.message);
    res.status(502).json({ error: 'Service Agent IA momentanément indisponible' });
  }
}

router.use(requireSession('client'));

router.post('/:agentId/conversations', requireAgentAccess, (req, res) => {
  forwardToBase44(req, res, '/conversations', {});
});

router.post('/:agentId/conversations/:conversationId/messages', requireAgentAccess, (req, res) => {
  const conversationId = String(req.params.conversationId || '');
  const content = String(req.body?.content || '').trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(conversationId)) return res.status(400).json({ error: 'Conversation invalide' });
  if (!content || content.length > 20000) return res.status(400).json({ error: 'Message invalide' });
  forwardToBase44(req, res, `/conversations/${conversationId}/messages`, { role: 'user', content });
});

router.post('/admin/grants', requireSession('admin'), async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const agentId = validAgentId(req.body?.agentId);
    const enabled = req.body?.enabled !== false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !agentId) return res.status(400).json({ error: 'Attribution invalide' });
    const now = new Date().toISOString();
    await database('client_module_entitlements?on_conflict=email,module_code', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ email, module_code: `ai_agent:${agentId}`, enabled, source_order_id: null, activated_at: now, updated_at: now }),
    });
    res.json({ success: true, email, agentId, enabled });
  } catch (error) {
    console.error('[agents] grant:', error.message);
    res.status(503).json({ error: 'Attribution indisponible' });
  }
});

module.exports = router;

