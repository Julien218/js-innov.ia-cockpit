const express = require('express');
const { fetchInsuranceEmails, fetchInsuranceEmail } = require('./server-insurance-mailbox.cjs');

const router = express.Router();

const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';
const OLIVIER_EMAIL = 'olivier.trevis@pv.be';
const SUPERADMIN_ROLES = new Set(['superadmin', 'super_admin']);
const UPSTREAM_TIMEOUT_MS = Number(process.env.INSURANCE_PROXY_TIMEOUT_MS || 20000);
const SYNC_INTERVAL_MS = Math.max(60_000, Number(process.env.INSURANCE_EMAIL_SYNC_INTERVAL_MS || 300_000));

function hasInsuranceAccess(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  const role = String(user?.role || '').trim().toLowerCase();
  return SUPERADMIN_ROLES.has(role) || email === OLIVIER_EMAIL;
}

function requireInsuranceAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Session requise.' });
  if (!hasInsuranceAccess(req.user)) {
    return res.status(403).json({ error: 'Accès Assurances-Dour réservé à Julien et Olivier.' });
  }
  return next();
}

function cleanForAnalysis(value, maxLength = 12000) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .slice(0, maxLength);
}

async function callAgent(path, { method = 'GET', body } = {}) {
  if (!AGENT_URL) throw new Error('JSINNOVIA_AGENT_URL non configurée');
  if (!AGENT_KEY) throw new Error('AGENT_API_KEY non configurée');

  const response = await fetch(`${AGENT_URL.replace(/\/$/, '')}/insurance${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': AGENT_KEY,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    throw Object.assign(new Error(data.error || `Backend assurances HTTP ${response.status}`), {
      statusCode: response.status,
      payload: data,
    });
  }
  return { status: response.status, data };
}

async function buildMailboxBatch(limit = 25) {
  const index = await fetchInsuranceEmails({ limit: Math.min(Number(limit) || 25, 50) });
  const messages = [];
  for (const meta of index.emails || []) {
    const email = await fetchInsuranceEmail(meta.uid);
    messages.push({
      mailbox: 'assurances',
      uid: email.uid,
      message_id: email.messageId || meta.messageId || '',
      in_reply_to: email.inReplyTo || meta.inReplyTo || '',
      email_date: email.date || meta.date || null,
      from: cleanForAnalysis(email.from, 500),
      to: cleanForAnalysis(email.to, 500),
      cc: cleanForAnalysis(email.cc, 500),
      subject: cleanForAnalysis(email.subject, 500),
      text: cleanForAnalysis(email.text, 12000),
      attachments: Array.isArray(email.attachments) ? email.attachments.slice(0, 20) : [],
    });
  }
  return { messages, mailboxTotal: index.total || 0 };
}

async function syncInsuranceMailbox(limit = 25) {
  const batch = await buildMailboxBatch(limit);
  if (!batch.messages.length) {
    return { analyzed: 0, created: 0, skipped: 0, mailbox_total: batch.mailboxTotal };
  }
  const result = await callAgent('/email-tasks/analyze-batch', {
    method: 'POST',
    body: { messages: batch.messages },
  });
  return { ...result.data, mailbox_total: batch.mailboxTotal };
}

router.use(requireInsuranceAccess);

router.post('/email-tasks/sync', async (req, res) => {
  try {
    const result = await syncInsuranceMailbox(req.body?.limit || 25);
    return res.json(result);
  } catch (error) {
    console.error('[assurances] email sync failed:', error.message);
    return res.status(error.statusCode || 502).json({ error: error.message || 'Synchronisation impossible.' });
  }
});

router.patch('/email-tasks/:id', async (req, res) => {
  try {
    const actorEmail = String(req.user?.email || '').toLowerCase();
    const actorName = String(req.user?.full_name || actorEmail || 'Utilisateur cockpit');
    const result = await callAgent(`/email-tasks/${encodeURIComponent(req.params.id)}`, {
      method: 'PATCH',
      body: { ...req.body, actor_email: actorEmail, actor_name: actorName },
    });
    return res.status(result.status).json(result.data);
  } catch (error) {
    return res.status(error.statusCode || 502).json({ error: error.message || 'Mise à jour impossible.' });
  }
});

router.use(async (req, res) => {
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }
  try {
    const body = ['POST', 'PATCH'].includes(req.method) ? req.body : undefined;
    const result = await callAgent(req.url, { method: req.method, body });
    return res.status(result.status).json(result.data);
  } catch (error) {
    console.error('[assurances proxy]', error.message);
    return res.status(error.statusCode || 502).json({ error: error.message || 'Service assurances indisponible.' });
  }
});

let schedulerStarted = false;
function startInsuranceEmailSyncScheduler() {
  if (schedulerStarted || process.env.INSURANCE_EMAIL_SYNC_ENABLED !== 'true') return;
  schedulerStarted = true;
  const run = () => syncInsuranceMailbox(Number(process.env.INSURANCE_EMAIL_SYNC_BATCH || 25))
    .then((result) => console.log('[assurances] mailbox sync', result))
    .catch((error) => console.error('[assurances] scheduled sync failed:', error.message));
  const first = setTimeout(run, 30_000);
  first.unref?.();
  const interval = setInterval(run, SYNC_INTERVAL_MS);
  interval.unref?.();
}

module.exports = router;
module.exports.startInsuranceEmailSyncScheduler = startInsuranceEmailSyncScheduler;
module.exports.hasInsuranceAccess = hasInsuranceAccess;
module.exports.syncInsuranceMailbox = syncInsuranceMailbox;
