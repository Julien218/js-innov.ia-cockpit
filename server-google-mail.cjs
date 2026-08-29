const express = require('express');
const {
  encryptToken, decryptToken, encodeState, decodeState,
  gmailMessageToEmail, shouldTrashPromotion,
} = require('./server-google-mail-core.cjs');

const router = express.Router();
const DATABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const DATABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const CLIENT_SECRET = () => process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const ENCRYPTION_KEY = () => process.env.GOOGLE_MAIL_ENCRYPTION_KEY || '';
const ORGANISATION = 'jsinnovia';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.modify'];
let scheduler = null;
let running = null;

async function rest(path, options = {}) {
  if (!DATABASE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY non configurée');
  const response = await fetch(`${DATABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: DATABASE_KEY, Authorization: `Bearer ${DATABASE_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = raw; }
  if (!response.ok) throw new Error(body?.message || body?.error || `Supabase HTTP ${response.status}`);
  return body;
}

function configured() {
  return Boolean(CLIENT_ID() && CLIENT_SECRET() && ENCRYPTION_KEY() && DATABASE_KEY);
}

function redirectUri(req) {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/google-mail/callback`;
}

function publicAccount(account) {
  const { refresh_token_encrypted: _secret, ...safe } = account;
  return safe;
}

async function accounts(activeOnly = false) {
  return rest(`google_mail_accounts?select=*&organisation=eq.${ORGANISATION}${activeOnly ? '&active=eq.true' : ''}&order=connected_at.desc`);
}

async function accountById(id) {
  const rows = await rest(`google_mail_accounts?select=*&organisation=eq.${ORGANISATION}&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!rows?.[0]) throw new Error('Boîte Google introuvable');
  return rows[0];
}

async function tokenRequest(params) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(body.error_description || body.error || `Google OAuth HTTP ${response.status}`);
  return body;
}

async function accessToken(account) {
  const refreshToken = decryptToken(account.refresh_token_encrypted, ENCRYPTION_KEY());
  const result = await tokenRequest({
    client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(), refresh_token: refreshToken, grant_type: 'refresh_token',
  });
  return result.access_token;
}

async function gmail(account, path, options = {}) {
  const token = await accessToken(account);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : {};
  if (!response.ok) throw new Error(body?.error?.message || `Gmail HTTP ${response.status}`);
  return body;
}

async function gmailMessage(account, id, format = 'full') {
  return gmail(account, `messages/${encodeURIComponent(id)}?format=${format}`);
}

async function normalizedMessage(account, id, includeAttachments = false) {
  const raw = await gmailMessage(account, id, 'full');
  const email = gmailMessageToEmail(raw);
  if (includeAttachments) {
    email.attachments = await Promise.all((email.attachments || []).map(async (attachment) => {
      if (!attachment.attachmentId) return attachment;
      const body = await gmail(account, `messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment.attachmentId)}`);
      return { ...attachment, contentType: attachment.mimeType, content_base64: body.data ? Buffer.from(body.data, 'base64url').toString('base64') : null };
    }));
  }
  return email;
}

async function listMessages(account, query, limit = 50) {
  const result = await gmail(account, `messages?maxResults=${Math.min(Math.max(Number(limit) || 50, 1), 100)}&q=${encodeURIComponent(query)}`);
  const messages = await Promise.all((result.messages || []).map((item) => gmailMessage(account, item.id, 'full')));
  return messages;
}

async function cleanupAccount(account, actor = 'nova-google-mail') {
  if (!account.active || !account.auto_trash_promotions) return { account_id: account.id, skipped: true, reason: 'rule_disabled' };
  const stats = { account_id: account.id, email: account.email, scanned: 0, trashed: 0, protected: 0, failed: 0 };
  try {
    const days = Math.min(Math.max(Number(account.promotion_retention_days) || 2, 1), 30);
    const messages = await listMessages(account, `category:promotions in:inbox older_than:${days}d`, 100);
    for (const message of messages) {
      stats.scanned += 1;
      try {
        const already = await rest(`google_mail_cleanup_log?select=id&account_id=eq.${account.id}&message_id=eq.${encodeURIComponent(message.id)}&action=eq.trashed&restored_at=is.null&limit=1`);
        if (already?.length) continue;
        const decision = shouldTrashPromotion(message, account.protected_senders || []);
        const email = gmailMessageToEmail(message);
        if (!decision.eligible) { stats.protected += 1; continue; }
        await gmail(account, `messages/${encodeURIComponent(message.id)}/trash`, { method: 'POST', body: '{}' });
        await rest('google_mail_cleanup_log', {
          method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
            organisation: ORGANISATION, account_id: account.id, message_id: message.id, thread_id: message.threadId,
            sender: String(email.from || '').slice(0, 500), subject: String(email.subject || '').slice(0, 500),
            action: 'trashed', reason: decision.reason, confidence: decision.confidence, acted_by: actor,
            metadata: { labels: email.labels },
          }),
        });
        stats.trashed += 1;
      } catch (_) { stats.failed += 1; }
    }
    await rest(`google_mail_accounts?id=eq.${account.id}`, { method: 'PATCH', body: JSON.stringify({ last_scan_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }) });
  } catch (error) {
    stats.failed += 1;
    stats.error = error.message;
    await rest(`google_mail_accounts?id=eq.${account.id}`, { method: 'PATCH', body: JSON.stringify({ last_scan_at: new Date().toISOString(), last_error: error.message, updated_at: new Date().toISOString() }) }).catch(() => {});
  }
  return stats;
}

async function cleanupAll() {
  if (running) return running;
  running = (async () => {
    const results = [];
    for (const account of await accounts(true)) results.push(await cleanupAccount(account));
    return { success: true, results, completed_at: new Date().toISOString() };
  })().finally(() => { running = null; });
  return running;
}

async function fetchGoogleAccounts() {
  if (!configured()) return [];
  return accounts(true);
}

async function fetchGoogleEmails(accountId, query = 'in:inbox -in:trash', limit = 50) {
  const account = await accountById(accountId);
  return (await listMessages(account, query, limit)).map(gmailMessageToEmail);
}

async function fetchGoogleEmailById(accountId, messageId, includeAttachments = false) {
  return normalizedMessage(await accountById(accountId), messageId, includeAttachments);
}

router.get('/status', (req, res) => res.json({
  success: true,
  configured: configured(),
  requirements: { google_client_id: Boolean(CLIENT_ID()), google_client_secret: Boolean(CLIENT_SECRET()), encryption_key: Boolean(ENCRYPTION_KEY()), database: Boolean(DATABASE_KEY) },
  redirect_uri: redirectUri(req),
}));

router.get('/connect', (req, res) => {
  if (!configured()) return res.status(503).json({ success: false, error: 'Connexion Google non configurée côté serveur.' });
  const brand = ['js-innov-ia', 'assurances-dour'].includes(req.query.brand) ? req.query.brand : 'js-innov-ia';
  const state = encodeState({ user_id: req.user?.id, user_email: req.user?.email, brand }, ENCRYPTION_KEY());
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: CLIENT_ID(), redirect_uri: redirectUri(req), response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  }).toString();
  res.redirect(url.toString());
});

router.get('/callback', async (req, res) => {
  const returnUrl = new URL('/parametres?tab=emails', `${req.protocol}://${req.get('host')}`);
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    const state = decodeState(req.query.state, ENCRYPTION_KEY());
    if (state.user_id && state.user_id !== req.user?.id) throw new Error('Session Google différente de la session Cockpit');
    const tokens = await tokenRequest({
      code: String(req.query.code || ''), client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(),
      redirect_uri: redirectUri(req), grant_type: 'authorization_code',
    });
    if (!tokens.refresh_token) throw new Error('Google n’a pas retourné de jeton hors ligne. Révoquez puis reconnectez la boîte.');
    const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.emailAddress) throw new Error(profile?.error?.message || 'Adresse Gmail introuvable');
    const payload = {
      organisation: ORGANISATION, provider: 'google', email: profile.emailAddress.toLowerCase(), label: profile.emailAddress,
      brand: state.brand, refresh_token_encrypted: encryptToken(tokens.refresh_token, ENCRYPTION_KEY()), scopes: String(tokens.scope || '').split(' ').filter(Boolean),
      active: true, connected_by: req.user?.email || req.user?.id || 'admin', connected_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null,
    };
    await rest('google_mail_accounts?on_conflict=organisation,provider,email', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(payload) });
    returnUrl.searchParams.set('google', 'connected');
  } catch (error) {
    returnUrl.searchParams.set('google_error', error.message.slice(0, 200));
  }
  res.redirect(returnUrl.pathname + returnUrl.search);
});

router.get('/accounts', async (_req, res) => {
  try { res.json({ success: true, configured: configured(), accounts: (await accounts()).map(publicAccount) }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/accounts/:id', async (req, res) => {
  try {
    await accountById(req.params.id);
    const patch = {};
    if (typeof req.body.active === 'boolean') patch.active = req.body.active;
    if (typeof req.body.auto_trash_promotions === 'boolean') patch.auto_trash_promotions = req.body.auto_trash_promotions;
    if (req.body.brand && ['js-innov-ia', 'assurances-dour'].includes(req.body.brand)) patch.brand = req.body.brand;
    if (req.body.label !== undefined) patch.label = String(req.body.label || '').slice(0, 120);
    if (req.body.promotion_retention_days !== undefined) patch.promotion_retention_days = Math.min(Math.max(Number(req.body.promotion_retention_days) || 2, 1), 30);
    if (Array.isArray(req.body.protected_senders)) patch.protected_senders = req.body.protected_senders.map((value) => String(value).trim().toLowerCase()).filter(Boolean).slice(0, 100);
    const rows = await rest(`google_mail_accounts?id=eq.${req.params.id}&organisation=eq.${ORGANISATION}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
    res.json({ success: true, account: publicAccount(rows?.[0] || {}) });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.delete('/accounts/:id', async (req, res) => {
  try {
    const account = await accountById(req.params.id);
    const token = decryptToken(account.refresh_token_encrypted, ENCRYPTION_KEY());
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => null);
    await rest(`google_mail_accounts?id=eq.${account.id}`, { method: 'PATCH', body: JSON.stringify({ active: false, auto_trash_promotions: false, last_error: 'Connexion révoquée', updated_at: new Date().toISOString() }) });
    res.json({ success: true });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/messages', async (req, res) => {
  try {
    const account = await accountById(req.query.account_id);
    const query = req.query.folder === 'sent' ? 'in:sent -in:trash' : 'in:inbox -in:trash';
    const messages = await listMessages(account, query, req.query.limit || 50);
    res.json({ success: true, emails: messages.map(gmailMessageToEmail) });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/messages/:id', async (req, res) => {
  try { res.json({ success: true, email: gmailMessageToEmail(await gmailMessage(await accountById(req.query.account_id), req.params.id)) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/messages/:id/trash', async (req, res) => {
  try {
    const account = await accountById(req.query.account_id);
    await gmail(account, `messages/${encodeURIComponent(req.params.id)}/trash`, { method: 'POST', body: '{}' });
    res.json({ success: true, recoverable: true });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/messages/:id/archive', async (req, res) => {
  try {
    const account = await accountById(req.query.account_id);
    await gmail(account, `messages/${encodeURIComponent(req.params.id)}/modify`, { method: 'POST', body: JSON.stringify({ removeLabelIds: ['INBOX'] }) });
    res.json({ success: true });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/accounts/:id/scan', async (req, res) => {
  try { res.json({ success: true, result: await cleanupAccount(await accountById(req.params.id), req.user?.email || 'admin') }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/cleanup-log', async (req, res) => {
  try {
    const accountFilter = req.query.account_id ? `&account_id=eq.${encodeURIComponent(req.query.account_id)}` : '';
    const rows = await rest(`google_mail_cleanup_log?select=*&organisation=eq.${ORGANISATION}${accountFilter}&order=acted_at.desc&limit=100`);
    res.json({ success: true, logs: rows || [] });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/cleanup-log/:id/restore', async (req, res) => {
  try {
    const rows = await rest(`google_mail_cleanup_log?select=*&id=eq.${req.params.id}&organisation=eq.${ORGANISATION}&limit=1`);
    const log = rows?.[0];
    if (!log || log.action !== 'trashed') throw new Error('Journal de suppression introuvable');
    const account = await accountById(log.account_id);
    await gmail(account, `messages/${encodeURIComponent(log.message_id)}/untrash`, { method: 'POST', body: '{}' });
    await rest(`google_mail_cleanup_log?id=eq.${log.id}`, { method: 'PATCH', body: JSON.stringify({ restored_at: new Date().toISOString(), acted_by: req.user?.email || 'admin' }) });
    res.json({ success: true });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

function startGoogleMailScheduler() {
  if (!configured()) return { started: false, reason: 'OAuth Google incomplet' };
  if (scheduler) return { started: true, interval_minutes: 15 };
  const run = () => cleanupAll().catch((error) => console.warn('Google mail cleanup:', error.message));
  const initial = setTimeout(run, 30_000);
  initial.unref?.();
  scheduler = setInterval(run, 15 * 60 * 1000);
  scheduler.unref?.();
  return { started: true, interval_minutes: 15 };
}

module.exports = {
  router, startGoogleMailScheduler, cleanupAll, cleanupAccount,
  fetchGoogleAccounts, fetchGoogleEmails, fetchGoogleEmailById, isGoogleMailConfigured: configured,
};
