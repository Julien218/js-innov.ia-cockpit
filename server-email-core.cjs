/**
 * server-email-core.cjs — Framework Email Central Cockpit JS-Innov.IA
 *
 * Implémente :
 * 1. Configuration multi-marques dynamique (table Brand via Supabase REST + cache 5 min + fallback 7 marques)
 * 2. Fonction getSmtpConfig(brandSlug)
 * 3. Fonction logEmail(data)
 * 4. Fonction enqueueEmail(emailLogId, priority)
 * 5. Fonction processQueue() — worker principal avec calcul de backoff exponentiel et restart recovery
 * 6. Fonction checkIdempotency(key)
 * 7. Fonction sendEmail({ ... })
 * 8. Routes API Express (/send, /logs, /:id, /:id/retry, /:id/cancel, /stats, /templates, /brands)
 * 9. Compatibilité backward (POST /official via EMAIL_PROXY_KEY)
 * 10. Worker interval (30s) avec cleanup
 */

const express = require('express');
const nodemailer = require('nodemailer');
const { applyBrandSignature, identityForBrand } = require('./server-email-branding.cjs');
const crypto = require('crypto');
const { requireSession, ROLE_LEVEL } = require('./server-security.cjs');

const router = express.Router();

// ── Configuration & Constantes Supabase ───────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ── Fallback 7 Marques Hardcodées (si Supabase indisponible) ──────
const FALLBACK_BRANDS = [
  { slug: 'js-innov-ia', name: 'JS-Innov.IA', from_name: 'JS-Innov.IA', from_address: 'info@jsinnovia.com', default_from: '"JS-Innov.IA" <info@jsinnovia.com>', is_active: true, active: true },
  { slug: 'assurances-dour', name: 'Assurances-Dour.be', from_name: 'Assurances-Dour.be', from_address: 'info@assurances-dour.be', default_from: '"Assurances-Dour.be" <info@assurances-dour.be>', is_active: true, active: true },
  { slug: 'store', name: 'JS-Innov.IA Store', default_from: 'JS-Innov.IA Store <info@jsinnovia.store>', is_active: true },
  { slug: 'villeconnect', name: 'VilleConnect', default_from: 'VilleConnect <info@jsinnovia.store>', is_active: true },
  { slug: 'cockpit', name: 'Cockpit JS-Innov.IA', default_from: 'Cockpit JS-Innov.IA <info@jsinnovia.store>', is_active: true },
  { slug: 'immo-connect', name: 'Immo Connect', default_from: 'Immo Connect <info@jsinnovia.store>', is_active: true },
  { slug: 'resto-connect', name: 'Resto Connect', default_from: 'Resto Connect <info@jsinnovia.store>', is_active: true },
];

const BRAND_ALIASES = {
  'jsinnovia': 'js-innov-ia',
  'assurances': 'assurances-dour',
  'js-innov-ia-store': 'store',
};

// ── Cache des Marques en Mémoire ──────────────────────────────────
const brandCache = new Map();
let lastBrandFetchTime = 0;
const BRAND_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Stockage local en mémoire si Supabase REST est inaccessible (tests unitaires / dev)
const memoryStore = {
  logs: new Map(),
  queue: new Map(),
  templates: new Map(),
  idCounter: 1,
};

function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

// ── Helper API Supabase REST ──────────────────────────────────────
function getSupabaseHeaders(extra = {}) {
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return {
    'apikey': secret,
    'Authorization': `Bearer ${secret}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function supabaseFetch(endpoint, options = {}) {
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!secret) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
      ...options,
      headers: getSupabaseHeaders(options.headers || {}),
    });
    if (!res.ok) {
      return null;
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await res.json();
    }
    return true;
  } catch (err) {
    return null;
  }
}

// ── 1. Configuration multi-marques ───────────────────────────────
async function refreshBrands() {
  const now = Date.now();
  if (brandCache.size > 0 && (now - lastBrandFetchTime) < BRAND_CACHE_TTL_MS) {
    return Array.from(brandCache.values());
  }

  let dbBrands = await supabaseFetch('Brand?select=*');
  if (Array.isArray(dbBrands) && dbBrands.length > 0) {
    brandCache.clear();
    for (const b of dbBrands) {
      if (b && b.slug) {
        brandCache.set(b.slug.toLowerCase(), b);
      }
    }
    lastBrandFetchTime = now;
  } else if (brandCache.size === 0) {
    for (const b of FALLBACK_BRANDS) {
      brandCache.set(b.slug, b);
    }
    lastBrandFetchTime = now;
  }

  return Array.from(brandCache.values());
}

function resolveBrandSlug(slug) {
  if (!slug || typeof slug !== 'string') return 'js-innov-ia';
  const normalized = slug.trim().toLowerCase();
  return BRAND_ALIASES[normalized] || normalized;
}

function getBrand(slug) {
  const resolved = resolveBrandSlug(slug);
  let brand = brandCache.get(resolved);
  if (!brand) {
    brand = FALLBACK_BRANDS.find(b => b.slug === resolved);
  }
  return brand || null;
}

// Initialisation au chargement
refreshBrands().catch(() => {});

// ── 2. Fonction getSmtpConfig(brandSlug) ─────────────────────────
function getSmtpConfig(brandSlug) {
  const resolved = resolveBrandSlug(brandSlug);
  const brand = getBrand(resolved);
  const identity = identityForBrand(resolved);

  const config = {
    host: process.env.SMTP_HOST || 'smtp.ionos.fr',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    user: process.env.EMAIL_JSINNOVIA_ADDRESS || 'info@jsinnovia.com',
    pass: process.env.EMAIL_PASSWORD_JSINNOVIA || process.env.EMAIL_JSINNOVIA_PASSWORD || process.env.EMAIL_PASSWORD || process.env.EMAIL_PASSWORD_STORE || process.env.EMAIL_STORE_PASSWORD || '',
    from: identity.from,
    replyTo: identity.replyTo,
  };

  if (resolved === 'assurances-dour' || resolved === 'assurances') {
    config.user = process.env.EMAIL_ASSURANCES_ADDRESS || 'info@assurances-dour.be';
    config.pass = process.env.EMAIL_PASSWORD_ASSURANCES || process.env.EMAIL_ASSURANCES_PASSWORD || config.pass;
  }

  if (brand && brand.smtp_override) {
    let override = brand.smtp_override;
    if (typeof override === 'string') {
      try { override = JSON.parse(override); } catch (e) { override = null; }
    }
    if (override && typeof override === 'object') {
      if (override.host) config.host = override.host;
      if (override.port) config.port = parseInt(override.port, 10);
      if (override.user) config.user = override.user;
      if (override.pass) config.pass = override.pass;
    }
  }

  return config;
}

// ── Transports SMTP Nodemailer en cache ──────────────────────────
const transportCache = new Map();
function getOrCreateTransport(smtpConfig) {
  const cacheKey = `${smtpConfig.host}:${smtpConfig.port}:${smtpConfig.user}:${smtpConfig.pass}`;
  if (transportCache.has(cacheKey)) {
    return transportCache.get(cacheKey);
  }
  const transport = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.port === 465,
    auth: { user: smtpConfig.user, pass: smtpConfig.pass },
    tls: { rejectUnauthorized: false },
  });
  transportCache.set(cacheKey, transport);
  return transport;
}

// ── 3. Fonction logEmail(data) ───────────────────────────────────
async function logEmail(data) {
  const now = new Date().toISOString();
  const payload = {
    to: data.to,
    cc: data.cc || null,
    bcc: data.bcc || null,
    subject: data.subject,
    text: data.text || null,
    html: data.html || null,
    brand: data.brand || 'js-innov-ia',
    application: data.application || 'cockpit',
    idempotency_key: data.idempotency_key || data.idempotencyKey || null,
    template: data.template || null,
    metadata: data.metadata || null,
    status: data.status || 'pending',
    retry_count: data.retry_count || 0,
    created_at: now,
    updated_at: now,
  };

  const res = await supabaseFetch('EmailLog', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(payload),
  });

  if (Array.isArray(res) && res[0] && res[0].id) {
    return res[0].id;
  }

  const id = generateId();
  const record = { id, ...payload };
  memoryStore.logs.set(id, record);
  return id;
}

// ── 4. Fonction enqueueEmail(emailLogId, priority) ───────────────
async function enqueueEmail(emailLogId, priority = 1) {
  const now = new Date().toISOString();
  const payload = {
    email_log_id: emailLogId,
    priority: parseInt(priority || 1, 10),
    status: 'pending',
    attempts: 0,
    max_attempts: 5,
    next_attempt_at: now,
    locked_at: null,
    last_error_code: null,
    last_error_message: null,
    created_at: now,
  };

  const res = await supabaseFetch('EmailQueue', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(payload),
  });

  if (Array.isArray(res) && res[0] && res[0].id) {
    return res[0].id;
  }

  const id = generateId();
  const record = { id, ...payload };
  memoryStore.queue.set(id, record);
  return id;
}

// ── Calcul du délai de backoff exponentiel ────────────────────────
function calculateBackoffDelay(attempts) {
  const delays = [
    1 * 60 * 1000,       // 1st retry: 1 min
    5 * 60 * 1000,       // 2nd retry: 5 min
    30 * 60 * 1000,      // 3rd retry: 30 min
    2 * 60 * 60 * 1000,  // 4th retry: 2h
    8 * 60 * 60 * 1000,  // 5th+ retry: 8h
  ];
  const idx = Math.min(Math.max(0, attempts - 1), delays.length - 1);
  return delays[idx];
}

// ── 5. Fonction processQueue() ───────────────────────────────────
async function processQueue() {
  const now = new Date();
  const nowIso = now.toISOString();

  // Restart recovery : débloquer rows en status 'sending' locked depuis > 5 min
  const fiveMinAgoIso = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  await supabaseFetch(`EmailQueue?status=eq.sending&locked_at=lt.${fiveMinAgoIso}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'retry', locked_at: null }),
  });

  for (const [qId, qItem] of memoryStore.queue) {
    if (qItem.status === 'sending' && qItem.locked_at && new Date(qItem.locked_at) < new Date(now.getTime() - 5 * 60 * 1000)) {
      qItem.status = 'retry';
      qItem.locked_at = null;
    }
  }

  // Claim items : pending / retry avec next_attempt_at <= now, limit 10
  let queueItems = await supabaseFetch(
    `EmailQueue?status=in.(pending,retry)&next_attempt_at=lte.${encodeURIComponent(nowIso)}&order=priority.asc,next_attempt_at.asc&limit=10`
  );

  if (!Array.isArray(queueItems) || queueItems.length === 0) {
    queueItems = Array.from(memoryStore.queue.values())
      .filter(item => (item.status === 'pending' || item.status === 'retry') && new Date(item.next_attempt_at || 0) <= now)
      .sort((a, b) => (a.priority - b.priority) || (new Date(a.next_attempt_at) - new Date(b.next_attempt_at)))
      .slice(0, 10);
  }

  for (const item of queueItems) {
    item.status = 'sending';
    item.locked_at = nowIso;

    await supabaseFetch(`EmailQueue?id=eq.${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'sending', locked_at: nowIso }),
    });

    if (memoryStore.queue.has(item.id)) {
      memoryStore.queue.get(item.id).status = 'sending';
      memoryStore.queue.get(item.id).locked_at = nowIso;
    }

    let emailLog = await supabaseFetch(`EmailLog?id=eq.${item.email_log_id}&limit=1`);
    if (Array.isArray(emailLog) && emailLog[0]) {
      emailLog = emailLog[0];
    } else {
      emailLog = memoryStore.logs.get(item.email_log_id) || null;
    }

    if (!emailLog) {
      item.status = 'failed';
      item.last_error_message = 'EmailLog non trouvé';
      continue;
    }

    const smtpCfg = getSmtpConfig(emailLog.brand);
    const transport = getOrCreateTransport(smtpCfg);

    try {
      const mailOptions = {
        from: smtpCfg.from,
        replyTo: smtpCfg.replyTo,
        to: emailLog.to,
        cc: emailLog.cc || undefined,
        bcc: emailLog.bcc || undefined,
        subject: emailLog.subject,
        text: emailLog.text || undefined,
        html: emailLog.html || undefined,
      };

      const sendRes = await transport.sendMail(mailOptions);
      const messageId = sendRes.messageId || sendRes.message_id || 'msg_' + Date.now();
      const sentTime = new Date().toISOString();

      await supabaseFetch(`EmailLog?id=eq.${emailLog.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'sent', sent_at: sentTime, message_id: messageId, updated_at: sentTime }),
      });

      await supabaseFetch(`EmailQueue?id=eq.${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'sent', locked_at: null }),
      });

      if (memoryStore.logs.has(emailLog.id)) {
        const l = memoryStore.logs.get(emailLog.id);
        l.status = 'sent';
        l.sent_at = sentTime;
        l.message_id = messageId;
      }
      if (memoryStore.queue.has(item.id)) {
        const q = memoryStore.queue.get(item.id);
        q.status = 'sent';
      }

    } catch (err) {
      const attempts = (item.attempts || 0) + 1;
      const retryCount = (emailLog.retry_count || 0) + 1;
      const maxAttempts = item.max_attempts || 5;

      if (attempts < maxAttempts) {
        const delayMs = calculateBackoffDelay(attempts);
        const nextAttemptIso = new Date(Date.now() + delayMs).toISOString();

        await supabaseFetch(`EmailQueue?id=eq.${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'retry',
            attempts,
            next_attempt_at: nextAttemptIso,
            last_error_code: err.code || 'SEND_ERROR',
            last_error_message: err.message,
            locked_at: null,
          }),
        });

        await supabaseFetch(`EmailLog?id=eq.${emailLog.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'retry',
            retry_count: retryCount,
            last_error: err.message,
            updated_at: new Date().toISOString(),
          }),
        });

        if (memoryStore.queue.has(item.id)) {
          const q = memoryStore.queue.get(item.id);
          q.status = 'retry';
          q.attempts = attempts;
          q.next_attempt_at = nextAttemptIso;
          q.last_error_code = err.code || 'SEND_ERROR';
          q.last_error_message = err.message;
        }
        if (memoryStore.logs.has(emailLog.id)) {
          const l = memoryStore.logs.get(emailLog.id);
          l.status = 'retry';
          l.retry_count = retryCount;
          l.last_error = err.message;
        }

      } else {
        await supabaseFetch(`EmailQueue?id=eq.${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'failed',
            dead_letter: true,
            attempts,
            last_error_code: err.code || 'SEND_ERROR',
            last_error_message: err.message,
            locked_at: null,
          }),
        });

        await supabaseFetch(`EmailLog?id=eq.${emailLog.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'dead_letter',
            retry_count: retryCount,
            last_error: err.message,
            updated_at: new Date().toISOString(),
          }),
        });

        if (memoryStore.queue.has(item.id)) {
          const q = memoryStore.queue.get(item.id);
          q.status = 'failed';
          q.dead_letter = true;
          q.attempts = attempts;
          q.last_error_message = err.message;
        }
        if (memoryStore.logs.has(emailLog.id)) {
          const l = memoryStore.logs.get(emailLog.id);
          l.status = 'dead_letter';
          l.retry_count = retryCount;
          l.last_error = err.message;
        }
      }
    }
  }
}

// ── 6. Fonction checkIdempotency(key) ────────────────────────────
async function checkIdempotency(key) {
  if (!key || typeof key !== 'string') return null;

  const logs = await supabaseFetch(`EmailLog?idempotency_key=eq.${encodeURIComponent(key)}&limit=1`);
  if (Array.isArray(logs) && logs[0]) {
    return logs[0];
  }

  for (const log of memoryStore.logs.values()) {
    if (log.idempotency_key === key) {
      return log;
    }
  }

  return null;
}

// ── 7. Fonction sendEmail({ ... }) ────────────────────────────────

// ── Gestion des pièces jointes ─────────────────────────────────────
// Validation et transformation des pièces jointes base64 → nodemailer format
// Supporte : photos, audio, documents, zip, vidéos — tout type MIME
const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024; // 15 MB par fichier
const MAX_TOTAL_ATTACHMENTS = 20 * 1024 * 1024; // 20 MB total
const MAX_ATTACHMENT_COUNT = 10; // max 10 fichiers par email

const ALLOWED_MIME_PREFIXES = [
  'image/', 'audio/', 'video/', 'application/',
  'text/', 'font/', 'model/'
];

const BLOCKED_MIMES = [
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-sh',
  'application/x-bat',
  'application/x-csh',
  'application/x-httpd-php',
];

function validateAndParseAttachments(attachments) {
  if (!attachments) return [];

  const arr = Array.isArray(attachments) ? attachments : [attachments];
  if (arr.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`Trop de pièces jointes (max ${MAX_ATTACHMENT_COUNT})`);
  }

  const result = [];
  let totalSize = 0;

  for (let i = 0; i < arr.length; i++) {
    const att = arr[i];
    if (!att || typeof att !== 'object') {
      throw new Error(`Pièce jointe ${i + 1}: format invalide`);
    }

    // Accepter filename ou filename original
    const filename = att.filename || att.name || `fichier_${i + 1}`;
    if (typeof filename !== 'string' || filename.length > 255) {
      throw new Error(`Pièce jointe ${i + 1}: nom invalide`);
    }

    // Sécurité : pas de chemins de traversal
    const safeFilename = filename.replace(/[\/\\]/g, '_').replace(/\.\./g, '');

    // Content : base64 string
    const content_base64 = att.content_base64 || att.content || att.data;
    if (!content_base64 || typeof content_base64 !== 'string') {
      throw new Error(`Pièce jointe ${safeFilename}: contenu base64 manquant`);
    }

    // Décoder pour vérifier la taille
    const buffer = Buffer.from(content_base64, 'base64');
    if (buffer.length > MAX_ATTACHMENT_SIZE) {
      throw new Error(`Pièce jointe ${safeFilename}: trop volumineuse (${Math.round(buffer.length / 1024 / 1024)} MB, max ${MAX_ATTACHMENT_SIZE / 1024 / 1024} MB)`);
    }

    totalSize += buffer.length;
    if (totalSize > MAX_TOTAL_ATTACHMENTS) {
      throw new Error(`Total des pièces jointes trop volumineux (max ${MAX_TOTAL_ATTACHMENTS / 1024 / 1024} MB)`);
    }

    // Content type
    let contentType = att.content_type || att.contentType || att.type || 'application/octet-stream';

    // Sécurité : bloquer les types MIME dangereux
    if (BLOCKED_MIMES.includes(contentType.toLowerCase())) {
      throw new Error(`Pièce jointe ${safeFilename}: type MIME non autorisé (${contentType})`);
    }

    // Stocker les métadonnées (sans le contenu base64)
    result.push({
      filename: safeFilename,
      content: buffer, // Buffer pour nodemailer
      contentType,
      size: buffer.length,
      metadata: {
        filename: safeFilename,
        content_type: contentType,
        size: buffer.length,
      },
    });
  }

  return result;
}

async function sendEmail({ to, cc, bcc, subject, text, html, brand, application, idempotencyKey, template, metadata, from, priority, attachments }) {
  if (!to) throw new Error('Champ to obligatoire');
  if (!subject) throw new Error('Champ subject obligatoire');
  if (!brand) throw new Error('Champ brand obligatoire');

  const resolvedSlug = resolveBrandSlug(brand);
  const brandConfig = getBrand(resolvedSlug);
  if (!brandConfig) {
    throw new Error(`Marque inconnue : ${brand}`);
  }

  if (idempotencyKey) {
    const existingLog = await checkIdempotency(idempotencyKey);
    if (existingLog) {
      return {
        success: true,
        message_id: existingLog.message_id || null,
        email_log_id: existingLog.id,
        status: existingLog.status,
        cached: true,
      };
    }
  }

  // ── Validation des pièces jointes ──
  const parsedAttachments = attachments ? validateAndParseAttachments(attachments) : [];
  const attachmentMeta = parsedAttachments.length > 0 ? parsedAttachments.map(a => a.metadata) : [];

  const smtpConfig = getSmtpConfig(resolvedSlug);
  if (from && String(from).trim().toLowerCase() !== String(smtpConfig.from).trim().toLowerCase()) {
    throw new Error(`Expéditeur refusé pour la marque ${resolvedSlug}`);
  }
  const signed = applyBrandSignature({
    text,
    html,
    brand: resolvedSlug,
    signatureHtml: brandConfig.signature_html || undefined,
  });

  const emailLogId = await logEmail({
    to,
    cc,
    bcc,
    subject,
    text: signed.text,
    html: signed.html,
    brand: resolvedSlug,
    application: application || 'cockpit',
    idempotencyKey,
    template,
    metadata: { ...(metadata || {}), attachments: attachmentMeta },
    status: 'pending',
  });

  const queueId = await enqueueEmail(emailLogId, priority || 1);

  try {
    const transport = getOrCreateTransport(smtpConfig);
    const mailOptions = {
      from: smtpConfig.from,
      replyTo: smtpConfig.replyTo,
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject,
      text: signed.text || undefined,
      html: signed.html || undefined,
      attachments: parsedAttachments.length > 0 ? parsedAttachments.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })) : undefined,
    };

    const sendRes = await transport.sendMail(mailOptions);
    const messageId = sendRes.messageId || sendRes.message_id || 'msg_' + Date.now();
    const sentTime = new Date().toISOString();

    await supabaseFetch(`EmailLog?id=eq.${emailLogId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'sent', sent_at: sentTime, message_id: messageId, updated_at: sentTime }),
    });

    await supabaseFetch(`EmailQueue?id=eq.${queueId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'sent' }),
    });

    if (memoryStore.logs.has(emailLogId)) {
      const l = memoryStore.logs.get(emailLogId);
      l.status = 'sent';
      l.sent_at = sentTime;
      l.message_id = messageId;
    }
    if (memoryStore.queue.has(queueId)) {
      memoryStore.queue.get(queueId).status = 'sent';
    }

    return {
      success: true,
      message_id: messageId,
      email_log_id: emailLogId,
      status: 'sent',
    };

  } catch (err) {
    const delayMs = calculateBackoffDelay(1);
    const nextAttemptIso = new Date(Date.now() + delayMs).toISOString();

    await supabaseFetch(`EmailQueue?id=eq.${queueId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'retry',
        attempts: 1,
        next_attempt_at: nextAttemptIso,
        last_error_code: err.code || 'SEND_ERROR',
        last_error_message: err.message,
      }),
    });

    await supabaseFetch(`EmailLog?id=eq.${emailLogId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'retry',
        retry_count: 1,
        last_error: err.message,
        updated_at: new Date().toISOString(),
      }),
    });

    if (memoryStore.queue.has(queueId)) {
      const q = memoryStore.queue.get(queueId);
      q.status = 'retry';
      q.attempts = 1;
      q.next_attempt_at = nextAttemptIso;
      q.last_error_message = err.message;
    }
    if (memoryStore.logs.has(emailLogId)) {
      const l = memoryStore.logs.get(emailLogId);
      l.status = 'retry';
      l.retry_count = 1;
      l.last_error = err.message;
    }

    return {
      success: false,
      error: err.message,
      email_log_id: emailLogId,
      status: 'retry',
    };
  }
}

// ── 8. API Routes ─────────────────────────────────────────────────

// POST /api/emails/send (minRole: collaborateur)
router.post('/send', requireSession('collaborateur'), async (req, res) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body.idempotencyKey;
    const { to, cc, bcc, subject, text, html, brand, application, template, metadata, priority, attachments } = req.body;

    const result = await sendEmail({
      to,
      cc,
      bcc,
      subject,
      text,
      html,
      brand,
      application,
      idempotencyKey,
      template,
      metadata,
      priority,
      attachments,
    });

    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// GET /api/emails/brands (minRole: collaborateur)
router.get('/brands', requireSession('collaborateur'), async (req, res) => {
  try {
    const brands = await refreshBrands();
    const activeBrands = brands.filter(b => b.is_active !== false);
    return res.json({ brands: activeBrands });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/emails/logs (minRole: admin)
router.get('/logs', requireSession('admin'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const { brand, status, application, search } = req.query;

    let params = [];
    if (brand) params.push(`brand=eq.${encodeURIComponent(brand)}`);
    if (status) params.push(`status=eq.${encodeURIComponent(status)}`);
    if (application) params.push(`application=eq.${encodeURIComponent(application)}`);
    if (search) params.push(`or=(subject.ilike.*${encodeURIComponent(search)}*,to.ilike.*${encodeURIComponent(search)}*)`);

    params.push(`order=created_at.desc`);
    params.push(`limit=${limit}`);
    params.push(`offset=${offset}`);

    let logs = await supabaseFetch(`EmailLog?${params.join('&')}`);

    if (!Array.isArray(logs)) {
      logs = Array.from(memoryStore.logs.values())
        .filter(l => !brand || l.brand === brand)
        .filter(l => !status || l.status === status)
        .filter(l => !application || l.application === application)
        .filter(l => !search || (l.subject && l.subject.includes(search)) || (l.to && l.to.includes(search)))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(offset, offset + limit);
    }

    return res.json({ logs, limit, offset });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/emails/stats (minRole: admin)
router.get('/stats', requireSession('admin'), async (req, res) => {
  try {
    let allLogs = await supabaseFetch('EmailLog?select=*');
    if (!Array.isArray(allLogs)) {
      allLogs = Array.from(memoryStore.logs.values());
    }

    const by_status = { pending: 0, sent: 0, retry: 0, failed: 0, dead_letter: 0 };
    const by_brand = {};
    const daysMap = {};

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().split('T')[0];
      daysMap[dayStr] = 0;
    }

    for (const log of allLogs) {
      if (log.status && by_status[log.status] !== undefined) {
        by_status[log.status]++;
      }
      if (log.brand) {
        by_brand[log.brand] = (by_brand[log.brand] || 0) + 1;
      }
      if (log.created_at) {
        const dayStr = log.created_at.split('T')[0];
        if (daysMap[dayStr] !== undefined) {
          daysMap[dayStr]++;
        }
      }
    }

    const by_day = Object.keys(daysMap).map(date => ({ date, count: daysMap[date] }));

    return res.json({
      total: allLogs.length,
      by_status,
      by_brand,
      by_day,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/emails/templates (minRole: admin)
router.get('/templates', requireSession('admin'), async (req, res) => {
  try {
    const { brand } = req.query;
    let query = 'EmailTemplate?order=name.asc';
    if (brand) query = `EmailTemplate?brand=eq.${encodeURIComponent(brand)}&order=name.asc`;

    let templates = await supabaseFetch(query);
    if (!Array.isArray(templates)) {
      templates = Array.from(memoryStore.templates.values())
        .filter(t => !brand || t.brand === brand);
    }

    return res.json({ templates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/emails/templates (minRole: admin)
router.post('/templates', requireSession('admin'), async (req, res) => {
  try {
    const { name, brand, subject, text_content, html_content, variables } = req.body;
    if (!name || !subject) {
      return res.status(400).json({ error: 'Champs name et subject obligatoires' });
    }

    const now = new Date().toISOString();
    const payload = {
      name,
      brand: brand || 'js-innov-ia',
      subject,
      text_content: text_content || null,
      html_content: html_content || null,
      variables: variables || [],
      created_at: now,
      updated_at: now,
    };

    const result = await supabaseFetch('EmailTemplate', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    });

    if (Array.isArray(result) && result[0]) {
      return res.status(201).json(result[0]);
    }

    const id = generateId();
    const record = { id, ...payload };
    memoryStore.templates.set(id, record);
    return res.status(201).json(record);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/emails/templates/:id (minRole: admin)
router.put('/templates/:id', requireSession('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, brand, subject, text_content, html_content, variables } = req.body;

    const payload = {
      ...(name && { name }),
      ...(brand && { brand }),
      ...(subject && { subject }),
      ...(text_content !== undefined && { text_content }),
      ...(html_content !== undefined && { html_content }),
      ...(variables !== undefined && { variables }),
      updated_at: new Date().toISOString(),
    };

    const result = await supabaseFetch(`EmailTemplate?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    });

    if (Array.isArray(result) && result[0]) {
      return res.json(result[0]);
    }

    if (memoryStore.templates.has(id)) {
      const existing = memoryStore.templates.get(id);
      Object.assign(existing, payload);
      return res.json(existing);
    }

    return res.status(404).json({ error: 'Template non trouvé' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/emails/templates/:id (minRole: admin)
router.delete('/templates/:id', requireSession('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    await supabaseFetch(`EmailTemplate?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });

    memoryStore.templates.delete(id);
    return res.json({ success: true, id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/emails/:id (minRole: admin)
router.get('/:id', requireSession('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    let logs = await supabaseFetch(`EmailLog?id=eq.${encodeURIComponent(id)}&limit=1`);
    let log = Array.isArray(logs) ? logs[0] : null;

    if (!log) {
      log = memoryStore.logs.get(id) || null;
    }

    if (!log) {
      return res.status(404).json({ error: 'EmailLog non trouvé' });
    }

    return res.json(log);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/emails/:id/attachments (minRole: admin) — métadonnées des pièces jointes
router.get('/:id/attachments', requireSession('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    let logs = await supabaseFetch(`EmailLog?id=eq.${encodeURIComponent(id)}&limit=1`);
    let log = Array.isArray(logs) ? logs[0] : null;

    if (!log) {
      log = memoryStore.logs.get(id) || null;
    }

    if (!log) {
      return res.status(404).json({ error: 'EmailLog non trouvé' });
    }

    // Les métadonnées des pièces jointes sont stockées dans le champ metadata (jsonb)
    const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : (log.metadata || {});
    const attachments = meta.attachments || [];

    return res.json({
      email_id: id,
      attachments: attachments.map((a, i) => ({
        index: i,
        filename: a.filename,
        content_type: a.content_type,
        size: a.size,
        size_human: a.size > 1024 * 1024
          ? (a.size / 1024 / 1024).toFixed(1) + ' MB'
          : a.size > 1024
            ? (a.size / 1024).toFixed(0) + ' KB'
            : a.size + ' B',
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});



// POST /api/emails/:id/retry (minRole: admin)
router.post('/:id/retry', requireSession('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    await supabaseFetch(`EmailLog?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pending', updated_at: new Date().toISOString() }),
    });

    if (memoryStore.logs.has(id)) {
      memoryStore.logs.get(id).status = 'pending';
    }

    const queueId = await enqueueEmail(id, 1);
    return res.json({ success: true, email_log_id: id, queue_id: queueId, status: 'pending' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/emails/:id/cancel (minRole: admin)
router.post('/:id/cancel', requireSession('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    await supabaseFetch(`EmailLog?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() }),
    });

    await supabaseFetch(`EmailQueue?email_log_id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled' }),
    });

    if (memoryStore.logs.has(id)) {
      memoryStore.logs.get(id).status = 'cancelled';
    }
    for (const q of memoryStore.queue.values()) {
      if (q.email_log_id === id) {
        q.status = 'cancelled';
      }
    }

    return res.json({ success: true, email_log_id: id, status: 'cancelled' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── 9. Compatibilité backward (POST /api/emails/official) ───────
const _officialRateLimit = new Map();
const OFFICIAL_RATE_LIMIT_MAX = 10;
const OFFICIAL_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const OFFICIAL_MAX_RECIPIENTS = 20;
const OFFICIAL_MAX_SUBJECT_LEN = 200;
const OFFICIAL_MAX_BODY_BYTES = 500_000;
const OFFICIAL_MAX_METADATA_FIELDS = 5;
const OFFICIAL_MAX_METADATA_VALUE_LEN = 500;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{8,128}$/;

function safeCompareHashes(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function isValidEmail(addr) {
  if (typeof addr !== 'string') return false;
  const match = addr.match(/<([^>]+)>/) || [null, addr.trim()];
  const email = match[1];
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function requireOfficialApiKey(req, res, next) {
  if (req.query.key || req.query['x-agent-key']) {
    return res.status(401).json({ error: 'Unauthorized — key must not be in query string' });
  }

  const providedKey = req.headers['x-agent-key'];
  const serverKey = process.env.EMAIL_PROXY_KEY;

  if (!serverKey) {
    return res.status(503).json({ error: 'Server not configured — EMAIL_PROXY_KEY missing' });
  }

  if (!providedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!safeCompareHashes(providedKey, serverKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

function checkOfficialRateLimit(providedKey) {
  const keyHash = crypto.createHash('sha256').update(String(providedKey)).digest('hex');
  const now = Date.now();
  for (const [k, v] of _officialRateLimit) {
    if (now - v.windowStart > OFFICIAL_RATE_LIMIT_WINDOW_MS) _officialRateLimit.delete(k);
  }
  let entry = _officialRateLimit.get(keyHash);
  if (!entry || now - entry.windowStart > OFFICIAL_RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    _officialRateLimit.set(keyHash, entry);
  }
  entry.count++;
  return entry.count <= OFFICIAL_RATE_LIMIT_MAX;
}

function validateMetadata(metadata) {
  if (metadata === undefined || metadata === null) return null;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { error: 'metadata must be an object' };
  }
  const keys = Object.keys(metadata);
  if (keys.length > OFFICIAL_MAX_METADATA_FIELDS) {
    return { error: `metadata must not exceed ${OFFICIAL_MAX_METADATA_FIELDS} fields` };
  }
  for (const k of keys) {
    if (typeof metadata[k] !== 'string' || metadata[k].length > OFFICIAL_MAX_METADATA_VALUE_LEN) {
      return { error: `metadata.${k} must be a string of max ${OFFICIAL_MAX_METADATA_VALUE_LEN} characters` };
    }
  }
  return null;
}

const _officialIdempotencyStore = new Map();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;

function calculatePayloadFingerprint(body) {
  const relevant = {
    to: body.to,
    subject: body.subject,
    text: body.text,
    html: body.html,
    cc: body.cc,
    bcc: body.bcc,
    replyTo: body.replyTo,
  };
  return crypto.createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

router.post('/official', requireOfficialApiKey, async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Request body must be a non-null JSON object' });
  }

  const providedKey = req.headers['x-agent-key'];
  if (!checkOfficialRateLimit(providedKey)) {
    return res.status(429).json({ error: 'Rate limit exceeded (max 10 requests per minute)' });
  }

  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Missing required header: Idempotency-Key' });
  }
  if (!IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) {
    return res.status(400).json({ error: 'Invalid Idempotency-Key format (must be 8-128 chars: A-Z, a-z, 0-9, _, -)' });
  }

  if ('from' in req.body) {
    return res.status(400).json({ error: 'The "from" field is prohibited — sender is fixed to info@jsinnovia.store' });
  }
  if ('mailbox' in req.body) {
    return res.status(400).json({ error: 'The "mailbox" field is prohibited — mailbox is fixed to info@jsinnovia.store' });
  }

  const { to, cc, bcc, replyTo, subject, text, html, metadata, attachments } = req.body;

  if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
    return res.status(400).json({ error: 'subject is required and must be a non-empty string' });
  }
  if (subject.length > OFFICIAL_MAX_SUBJECT_LEN) {
    return res.status(400).json({ error: `subject exceeds maximum length of ${OFFICIAL_MAX_SUBJECT_LEN} characters` });
  }

  if (!to) {
    return res.status(400).json({ error: 'to is required (string or array of email addresses)' });
  }

  const recipients = (Array.isArray(to) ? to : [to]).map(s => String(s).trim());
  if (recipients.length === 0) {
    return res.status(400).json({ error: 'at least one recipient is required' });
  }
  if (recipients.length > OFFICIAL_MAX_RECIPIENTS) {
    return res.status(400).json({ error: `exceeds maximum of ${OFFICIAL_MAX_RECIPIENTS} recipients` });
  }
  for (const addr of recipients) {
    if (!isValidEmail(addr)) {
      return res.status(400).json({ error: `invalid email address in recipients: "${addr}"` });
    }
  }

  if (text === undefined && html === undefined) {
    return res.status(400).json({ error: 'at least text or html content must be provided' });
  }
  if (text !== undefined && typeof text !== 'string') {
    return res.status(400).json({ error: 'text must be a string' });
  }
  if (html !== undefined && typeof html !== 'string') {
    return res.status(400).json({ error: 'html must be a string' });
  }

  if ((text || '').length + (html || '').length > OFFICIAL_MAX_BODY_BYTES) {
    return res.status(400).json({ error: 'email content exceeds max size limit' });
  }

  if (replyTo !== undefined && !isValidEmail(replyTo)) {
    return res.status(400).json({ error: `invalid replyTo address: "${replyTo}"` });
  }

  const metaErr = validateMetadata(metadata);
  if (metaErr) return res.status(400).json(metaErr);

  const fingerprint = calculatePayloadFingerprint(req.body);
  const now = Date.now();
  for (const [k, v] of _officialIdempotencyStore) {
    if (now - v.timestamp > IDEMPOTENCY_TTL_MS) _officialIdempotencyStore.delete(k);
  }

  const existingIdem = _officialIdempotencyStore.get(idempotencyKey);
  if (existingIdem) {
    if (existingIdem.status === 'pending') {
      return res.status(409).json({ error: 'Concurrent request with same Idempotency-Key' });
    }
    if (existingIdem.fingerprint !== fingerprint) {
      return res.status(409).json({ error: 'Idempotency-Key already used with different payload' });
    }
    return res.status(200).json(existingIdem.response);
  }

  _officialIdempotencyStore.set(idempotencyKey, { status: 'pending', fingerprint, timestamp: now });

  try {
    const toFormatted = Array.isArray(to) ? to.join(', ') : to;
    const sendResult = await sendEmail({
      to: toFormatted,
      cc,
      bcc,
      subject,
      text,
      html,
      brand: 'js-innov-ia',
      application: 'external',
      idempotencyKey,
      metadata,
      attachments,
    });

    if (!sendResult.success && sendResult.status === 'retry') {
      _officialIdempotencyStore.delete(idempotencyKey);
      return res.status(502).json({ error: 'SMTP delivery failed: ' + (sendResult.error || 'Connection error') });
    }

    const successResponse = {
      success: true,
      messageId: sendResult.message_id,
      status: 'sent',
      recipientsCount: recipients.length,
      timestamp: new Date().toISOString(),
    };

    _officialIdempotencyStore.set(idempotencyKey, {
      status: 'completed',
      fingerprint,
      response: successResponse,
      timestamp: Date.now(),
    });

    return res.json(successResponse);
  } catch (err) {
    _officialIdempotencyStore.delete(idempotencyKey);
    return res.status(502).json({ error: 'SMTP delivery failed: ' + err.message });
  }
});

// ── 10. Queue Worker Interval (30s) ───────────────────────────────
const QUEUE_INTERVAL_MS = 30000;
const queueIntervalId = setInterval(() => {
  processQueue().catch(err => console.error('[server-email-core] Queue worker error:', err.message));
}, QUEUE_INTERVAL_MS);

if (queueIntervalId.unref) {
  queueIntervalId.unref();
}

function stopQueueWorker() {
  clearInterval(queueIntervalId);
}

// Export router + named functions
router.getSmtpConfig = getSmtpConfig;
router.logEmail = logEmail;
router.enqueueEmail = enqueueEmail;
router.processQueue = processQueue;
router.checkIdempotency = checkIdempotency;
router.sendEmail = sendEmail;
router.refreshBrands = refreshBrands;
router.calculateBackoffDelay = calculateBackoffDelay;
router.stopQueueWorker = stopQueueWorker;
router.memoryStore = memoryStore;

module.exports = router;
module.exports.getSmtpConfig = getSmtpConfig;
module.exports.logEmail = logEmail;
module.exports.enqueueEmail = enqueueEmail;
module.exports.processQueue = processQueue;
module.exports.checkIdempotency = checkIdempotency;
module.exports.sendEmail = sendEmail;
module.exports.refreshBrands = refreshBrands;
module.exports.calculateBackoffDelay = calculateBackoffDelay;
module.exports.stopQueueWorker = stopQueueWorker;
module.exports.memoryStore = memoryStore;
