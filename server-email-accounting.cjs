const express = require('express');
const crypto = require('crypto');
const { fetchEmails, fetchEmailById, getMailboxConfig, isAliasMailbox, sendEmail } = require('./server-email.cjs');
const { storeBuffer, isDropboxConfigured } = require('./server-documents.cjs');
const { createCostEvent } = require('./server-client-costs.cjs');
const { classifyEmail, extractAccountingMetadata, shouldArchiveAttachment, sourceTypeForProvider, buildDailyDigest } = require('./server-email-accounting-core.cjs');

const router = express.Router();
// Journaux privés dans le Supabase du Cockpit. Les écritures AI Cost restent
// déléguées à server-client-costs, qui utilise son relais CRM authentifié.
const DATABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const DATABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ORGANISATION = 'jsinnovia';
const SCAN_MAILBOXES = ['store', 'assurances'];
let running = null;
let scheduler = null;

async function rest(path, options = {}) {
  if (!DATABASE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY non configurée');
  const response = await fetch(`${DATABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: DATABASE_KEY, Authorization: `Bearer ${DATABASE_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(body?.message || body?.error || `Supabase HTTP ${response.status}`);
  return body;
}

const localDate = (value = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.NOVA_EMAIL_REPORT_TIMEZONE || 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(value);

async function existingItem(mailbox, uid) {
  const rows = await rest(`email_accounting_items?select=*&organisation=eq.${ORGANISATION}&mailbox=eq.${encodeURIComponent(mailbox)}&message_uid=eq.${encodeURIComponent(String(uid))}&limit=1`);
  return rows?.[0] || null;
}

async function insertItem(row) {
  const rows = await rest('email_accounting_items', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
  return rows?.[0] || row;
}

async function patchItem(id, patch) {
  const rows = await rest(`email_accounting_items?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
  return rows?.[0] || null;
}

async function processMessage(mailbox, summary) {
  if (await existingItem(mailbox, summary.uid)) return { skipped: true };
  const email = await fetchEmailById(mailbox, summary.uid, true, { markSeen: false });
  const classification = classifyEmail(email);
  const accounting = extractAccountingMetadata(email);
  const cfg = getMailboxConfig(mailbox);
  const documents = [];
  let error = null;

  if (['invoice', 'subscription_invoice'].includes(classification.category)) {
    for (const attachment of email.attachments || []) {
      if (!attachment.content_base64 || !shouldArchiveAttachment(attachment)) continue;
      try {
        const document = await storeBuffer({
          user: { role: 'superadmin', email: 'nova@jsinnovia.local', organisation: ORGANISATION },
          organisation: ORGANISATION,
          brand: cfg?.brand || 'js-innov-ia',
          clientId: null,
          category: 'factures-fournisseurs',
          filename: attachment.filename || `piece-${summary.uid}.pdf`,
          mimeType: attachment.contentType || 'application/octet-stream',
          buffer: Buffer.from(attachment.content_base64, 'base64'),
          source: 'email-accounting',
          emailMessageId: `${mailbox}:${email.messageId || summary.uid}`,
        });
        documents.push(document);
      } catch (archiveError) {
        error = archiveError.message;
      }
    }
  }

  const first = documents[0] || null;
  return insertItem({
    organisation: ORGANISATION,
    mailbox,
    message_uid: String(summary.uid),
    message_id: email.messageId || null,
    sender: String(email.from || '').slice(0, 500),
    subject: String(email.subject || '(sans objet)').slice(0, 500),
    received_at: email.date || summary.date || new Date().toISOString(),
    category: classification.category,
    confidence: classification.confidence,
    status: error ? 'failed' : (classification.needsReview ? 'awaiting_review' : 'reported'),
    provider: accounting.provider,
    invoice_number: accounting.invoice_number,
    amount_minor: accounting.amount_minor,
    currency: accounting.currency || 'EUR',
    document_id: first?.id || null,
    document_filename: first?.filename || null,
    dropbox_path: first?.dropbox_path || null,
    error,
    metadata: { attachment_names: (email.attachments || []).map((item) => item.filename), document_ids: documents.map((item) => item.id).filter(Boolean), journal_id: `email-accounting-${crypto.randomUUID()}` },
  });
}

async function scanMailboxes() {
  const startedAt = new Date();
  const stats = { scanned: 0, created: 0, skipped: 0, failed: 0, mailboxes: {} };
  for (const mailbox of SCAN_MAILBOXES) {
    const cfg = getMailboxConfig(mailbox);
    if (!cfg?.password || isAliasMailbox(mailbox)) {
      stats.mailboxes[mailbox] = { configured: false };
      continue;
    }
    try {
      const result = await fetchEmails(mailbox, { limit: 100, offset: 0 });
      const cutoff = Date.now() - (Number(process.env.NOVA_EMAIL_SCAN_LOOKBACK_DAYS || 2) * 86400000);
      const recent = (result.emails || []).filter((item) => !item.date || new Date(item.date).getTime() >= cutoff);
      for (const summary of recent) {
        stats.scanned += 1;
        try {
          const item = await processMessage(mailbox, summary);
          item?.skipped ? stats.skipped++ : stats.created++;
        } catch (error) {
          stats.failed += 1;
          console.error('[email-accounting] message failed', { mailbox, uid: summary.uid, error: error.message });
        }
      }
      stats.mailboxes[mailbox] = { configured: true, total: result.total, recent: recent.length };
    } catch (error) {
      stats.failed += 1;
      stats.mailboxes[mailbox] = { configured: true, error: error.message };
    }
  }
  stats.duration_ms = Date.now() - startedAt.getTime();
  console.info('[email-accounting] scan complete', stats);
  return stats;
}

async function itemsForDate(date) {
  const since = new Date(Date.now() - 48 * 3600000).toISOString();
  const rows = await rest(`email_accounting_items?select=*&organisation=eq.${ORGANISATION}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=500`);
  return (rows || []).filter((item) => localDate(new Date(item.created_at)) === date);
}

async function sendDailyReport({ force = false } = {}) {
  const date = localDate();
  const existing = await rest(`email_daily_reports?select=*&organisation=eq.${ORGANISATION}&report_date=eq.${date}&limit=1`);
  if (existing?.[0]?.status === 'sent' && !force) return existing[0];
  const digest = buildDailyDigest(date, await itemsForDate(date));
  const recipient = process.env.NOVA_EMAIL_REPORT_TO || process.env.EMAIL_JSINNOVIA_ADDRESS || 'info@jsinnovia.com';
  let report = existing?.[0];
  if (!report) {
    const rows = await rest('email_daily_reports', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ organisation: ORGANISATION, report_date: date, status: 'pending', recipient, subject: digest.subject, summary: digest.text, counters: digest.counts }) });
    report = rows?.[0];
  }
  try {
    const sent = await sendEmail('jsinnovia', { to: recipient, subject: digest.subject, text: digest.text });
    const rows = await rest(`email_daily_reports?id=eq.${report.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), message_id: sent.messageId, summary: digest.text, counters: digest.counts, error: null, updated_at: new Date().toISOString() }) });
    return rows?.[0] || report;
  } catch (error) {
    await rest(`email_daily_reports?id=eq.${report.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error: error.message, updated_at: new Date().toISOString() }) });
    throw error;
  }
}

async function runCycle({ sendReport = false, forceReport = false } = {}) {
  if (running) return running;
  running = (async () => {
    const scan = await scanMailboxes();
    const report = sendReport ? await sendDailyReport({ force: forceReport }) : null;
    return { scan, report };
  })().finally(() => { running = null; });
  return running;
}

function schedulerTick() {
  const hour = Number(new Intl.DateTimeFormat('fr-BE', { timeZone: process.env.NOVA_EMAIL_REPORT_TIMEZONE || 'Europe/Brussels', hour: '2-digit', hour12: false }).format(new Date()));
  return runCycle({ sendReport: hour >= Number(process.env.NOVA_EMAIL_REPORT_HOUR || 18) }).catch((error) => console.error('[email-accounting] scheduler:', error.message));
}

function startEmailAccountingScheduler() {
  if (process.env.NOVA_EMAIL_ACCOUNTING_ENABLED === 'false') return { started: false, reason: 'disabled' };
  if (!DATABASE_KEY) return { started: false, reason: 'SUPABASE_SERVICE_ROLE_KEY missing' };
  if (scheduler) return { started: true, reason: 'already_started' };
  setTimeout(schedulerTick, 15000).unref?.();
  scheduler = setInterval(schedulerTick, Math.max(300000, Number(process.env.NOVA_EMAIL_SCAN_INTERVAL_MS || 900000)));
  scheduler.unref?.();
  return { started: true, reportHour: Number(process.env.NOVA_EMAIL_REPORT_HOUR || 18), timezone: process.env.NOVA_EMAIL_REPORT_TIMEZONE || 'Europe/Brussels' };
}

router.get('/status', async (_req, res) => {
  try {
    const reports = await rest(`email_daily_reports?select=*&organisation=eq.${ORGANISATION}&order=report_date.desc&limit=1`);
    const pending = await rest(`email_accounting_items?select=id&organisation=eq.${ORGANISATION}&status=eq.awaiting_review&limit=1000`);
    res.json({ success: true, enabled: process.env.NOVA_EMAIL_ACCOUNTING_ENABLED !== 'false', running: Boolean(running), dropbox_configured: isDropboxConfigured(), report_hour: Number(process.env.NOVA_EMAIL_REPORT_HOUR || 18), timezone: process.env.NOVA_EMAIL_REPORT_TIMEZONE || 'Europe/Brussels', pending_reviews: pending?.length || 0, last_report: reports?.[0] || null });
  } catch (error) { res.status(503).json({ error: error.message }); }
});

router.get('/items', async (req, res) => {
  try {
    const status = ['awaiting_review', 'approved', 'ignored', 'reported', 'failed'].includes(req.query.status) ? `&status=eq.${req.query.status}` : '';
    const rows = await rest(`email_accounting_items?select=*&organisation=eq.${ORGANISATION}${status}&order=received_at.desc&limit=200`);
    res.json({ success: true, items: rows || [] });
  } catch (error) { res.status(503).json({ error: error.message }); }
});

router.get('/reports', async (_req, res) => {
  try { res.json({ success: true, reports: await rest(`email_daily_reports?select=*&organisation=eq.${ORGANISATION}&order=report_date.desc&limit=31`) || [] }); }
  catch (error) { res.status(503).json({ error: error.message }); }
});

router.post('/run', async (req, res) => {
  try { res.json({ success: true, ...(await runCycle({ sendReport: req.body?.send_report === true, forceReport: req.body?.force_report === true })) }); }
  catch (error) { res.status(503).json({ error: error.message }); }
});

router.post('/items/:id/review', async (req, res) => {
  try {
    const rows = await rest(`email_accounting_items?select=*&id=eq.${encodeURIComponent(req.params.id)}&organisation=eq.${ORGANISATION}&limit=1`);
    const item = rows?.[0];
    if (!item) return res.status(404).json({ error: 'Élément introuvable' });
    const decision = req.body?.decision;
    if (decision === 'ignore') return res.json({ success: true, item: await patchItem(item.id, { status: 'ignored', reviewed_by: req.user?.email, reviewed_at: new Date().toISOString() }) });
    if (decision === 'archive_only') return res.json({ success: true, item: await patchItem(item.id, { status: 'approved', client_id: req.body?.client_id || null, project_id: req.body?.project_id || null, reviewed_by: req.user?.email, reviewed_at: new Date().toISOString() }) });
    if (decision !== 'import_cost') return res.status(400).json({ error: 'Décision invalide' });
    const clientId = String(req.body?.client_id || '').trim();
    const amountMinor = Number(req.body?.amount_minor || item.amount_minor || 0);
    if (!clientId || !Number.isInteger(amountMinor) || amountMinor <= 0 || (item.currency || 'EUR') !== 'EUR') return res.status(400).json({ error: 'Client, montant EUR vérifié et décision explicite requis' });
    if (!item.document_id) return res.status(400).json({ error: 'Une preuve Dropbox est requise avant import comptable' });
    const event = await createCostEvent({ clientId, projectId: req.body?.project_id || null, sourceType: sourceTypeForProvider(item.provider), provider: item.provider, description: `Facture fournisseur ${item.invoice_number || item.subject}`, actualCostMinor: amountMinor, externalRef: `email-invoice:${item.id}`, incurredAt: item.received_at, evidenceStatus: 'manual_verified', verificationRef: `document:${item.document_id}`, calculationMethod: 'invoice_total_manual_review', calculationInputs: { email_item_id: item.id, invoice_number: item.invoice_number }, metadata: { email_item_id: item.id, document_id: item.document_id, approved_by: req.user?.email } });
    const updated = await patchItem(item.id, { status: 'approved', client_id: clientId, project_id: req.body?.project_id || null, amount_minor: amountMinor, cost_event_id: event.id || null, reviewed_by: req.user?.email, reviewed_at: new Date().toISOString() });
    res.json({ success: true, item: updated, cost_event: event });
  } catch (error) { res.status(503).json({ error: error.message }); }
});

module.exports = { router, startEmailAccountingScheduler, runCycle, scanMailboxes, sendDailyReport };
