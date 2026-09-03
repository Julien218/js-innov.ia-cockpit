const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { ensureReady, getPool } = require('./server-postgres.cjs');
const { requireSession } = require('./server-security.cjs');

const router = express.Router();
const WORKER_INTERVAL_MS = 30_000;
const DEFAULT_COMMERCIAL_CODE = 'JP';
const QUOTE_DELAY_MINUTES = 35;
const EMAIL_REGEX = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
const ALLOWED_OFFERS = new Set(['annual', 'festival']);
const ALLOWED_BILLING = new Set(['monthly', 'annual', 'one_off']);
const COMMERCIAL_CODE_REGEX = /^[A-Z0-9-]{2,20}$/;

function safeHashEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a || '')).digest();
  const right = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(left, right);
}

function requireBridge(req, res, next) {
  const configured = process.env.COMMERCE_BRIDGE_KEY || '';
  const provided = req.headers['x-commerce-key'] || '';
  if (!configured || !provided || !safeHashEqual(configured, provided)) {
    return res.status(401).json({ error: 'Passerelle Pixelium non autorisée' });
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
}

function clean(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeRequest(body = {}) {
  const firstName = clean(body.firstName || body.prenom, 120);
  const lastName = clean(body.lastName || body.nom, 120);
  const email = clean(body.email, 254).toLowerCase();
  const phone = clean(body.phone || body.telephone, 80);
  const company = clean(body.company || body.entreprise, 180) || null;
  const message = clean(body.message, 4000) || null;
  const offerCode = clean(body.offerCode || body.offer || 'annual', 40).toLowerCase();
  let billingMode = clean(body.billingMode, 40).toLowerCase() || null;
  const commercialCode = clean(body.commercialCode || DEFAULT_COMMERCIAL_CODE, 20).toUpperCase();
  const externalId = clean(body.externalId || body.submissionId, 120) || crypto.randomUUID();

  if (!firstName || !lastName || !email || !phone) throw new Error('Coordonnées incomplètes');
  if (!EMAIL_REGEX.test(email)) throw new Error('Adresse e-mail invalide');
  if (!ALLOWED_OFFERS.has(offerCode)) throw new Error('Offre Pixelium invalide');
  if (offerCode === 'annual' && !billingMode) billingMode = 'monthly';
  if (offerCode === 'festival') billingMode = 'one_off';
  if (!ALLOWED_BILLING.has(billingMode)) throw new Error('Mode de paiement invalide');
  if (!normalizeBoolean(body.rgpdAccepted ?? body.rgpd ?? body.privacyAccepted)) throw new Error('Consentement RGPD requis');

  return {
    externalId,
    firstName,
    lastName,
    email,
    phone,
    company,
    message,
    offerCode,
    billingMode,
    commercialCode,
    visualCreation: normalizeBoolean(body.visualCreation ?? body.creationVisuelle),
    metadata: {
      page: clean(body.page || '/#devis', 200),
      userAgent: clean(body.userAgent, 500),
      referral: clean(body.referral, 120),
    },
  };
}

function priceConfigFor(request) {
  const taxMode = clean(process.env.PIXELIUM_PRICE_TAX_MODE, 20).toUpperCase();
  let raw = '';
  let period = '';
  if (request.offer_code === 'annual' && request.billing_mode === 'monthly') {
    raw = process.env.PIXELIUM_PRICE_MONTHLY_CENTS || '';
    period = 'month';
  } else if (request.offer_code === 'annual' && request.billing_mode === 'annual') {
    raw = process.env.PIXELIUM_PRICE_ANNUAL_CENTS || '';
    period = 'year';
  } else if (request.offer_code === 'festival') {
    raw = process.env.PIXELIUM_PRICE_FESTIVAL_CENTS || '';
    period = 'one_off';
  }
  const cents = Number(raw);
  const validTax = ['HTVA', 'TVAC'].includes(taxMode);
  return {
    ready: Number.isInteger(cents) && cents >= 0 && validTax,
    cents: Number.isInteger(cents) && cents >= 0 ? cents : null,
    period,
    taxMode: validTax ? taxMode : null,
  };
}

function smtpConfig() {
  const user = clean(process.env.PIXELIUM_EMAIL_ADDRESS, 254);
  const pass = String(process.env.PIXELIUM_EMAIL_PASSWORD || '');
  const host = clean(process.env.PIXELIUM_SMTP_HOST || 'smtp.ionos.fr', 200);
  const port = Number(process.env.PIXELIUM_SMTP_PORT || '465');
  return {
    ready: Boolean(user && pass && host && Number.isInteger(port) && port > 0),
    user,
    pass,
    host,
    port,
    from: `${clean(process.env.PIXELIUM_EMAIL_FROM_NAME || 'Pixelium', 120)} <${user}>`,
    replyTo: clean(process.env.PIXELIUM_REPLY_TO || user, 254),
  };
}

let transport;
let transportKey = '';
function getTransport(config) {
  const key = `${config.host}:${config.port}:${config.user}:${config.pass}`;
  if (!transport || transportKey !== key) {
    transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
    });
    transportKey = key;
  }
  return transport;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(cents) {
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100);
}

function offerLabel(request) {
  if (request.offer_code === 'festival') return 'Diffusion — Semaine Festival';
  if (request.billing_mode === 'annual') return 'Diffusion annuelle — paiement annuel';
  return 'Diffusion annuelle — paiement mensuel';
}

function confirmationEmail(request) {
  const fullName = `${request.first_name} ${request.last_name}`.trim();
  return {
    subject: `Pixelium — demande reçue ${request.commercial_reference}`,
    text: `Bonjour ${fullName},\\n\\nVotre demande Pixelium a bien été reçue sous la référence ${request.commercial_reference}. Votre devis personnalisé est programmé pour être transmis environ 35 minutes après votre demande.\\n\\nPixelium`,
    html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55"><h2>Merci ${escapeHtml(request.first_name)}.</h2><p>Votre demande <strong>Pixelium</strong> a bien été reçue.</p><p>Référence : <strong>${escapeHtml(request.commercial_reference)}</strong></p><p>Votre devis personnalisé est programmé pour être transmis environ <strong>35 minutes</strong> après votre demande.</p><p>À bientôt,<br><strong>Pixelium</strong></p></div>`,
  };
}

function quoteEmail(request, pricing) {
  const fullName = `${request.first_name} ${request.last_name}`.trim();
  const amount = money(pricing.cents);
  const period = pricing.period === 'month' ? '/ mois' : pricing.period === 'year' ? '/ an' : '';
  const visual = request.visual_creation ? '<li>Création/adaptation visuelle demandée : oui</li>' : '<li>Création/adaptation visuelle demandée : non</li>';
  return {
    subject: `Votre devis Pixelium — ${request.commercial_reference}`,
    text: `Bonjour ${fullName},\\n\\nVoici votre devis Pixelium.\\nOffre : ${offerLabel(request)}\\nMontant : ${amount} ${period} ${pricing.taxMode}\\nRéférence : ${request.commercial_reference}\\n\\nCe devis est préparé automatiquement à partir des informations transmises. Le contrat définitif sera établi après votre accord.\\n\\nPixelium`,
    html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55;max-width:680px;margin:auto"><div style="padding:20px 24px;background:#111827;color:#fff;border-radius:14px 14px 0 0"><h1 style="margin:0;font-size:24px">PIXELIUM</h1><p style="margin:6px 0 0">Votre devis personnalisé</p></div><div style="padding:24px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 14px 14px"><p>Bonjour ${escapeHtml(request.first_name)},</p><p>Votre devis est prêt.</p><table style="width:100%;border-collapse:collapse;margin:20px 0"><tr><td style="padding:10px;border-bottom:1px solid #e5e7eb">Référence</td><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right"><strong>${escapeHtml(request.commercial_reference)}</strong></td></tr><tr><td style="padding:10px;border-bottom:1px solid #e5e7eb">Offre</td><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${escapeHtml(offerLabel(request))}</td></tr><tr><td style="padding:10px">Montant</td><td style="padding:10px;text-align:right;font-size:20px"><strong>${escapeHtml(amount)} ${escapeHtml(period)} ${escapeHtml(pricing.taxMode)}</strong></td></tr></table><ul>${visual}</ul><p style="font-size:13px;color:#6b7280">Le contrat définitif Pixelium sera généré après votre accord. La référence commerciale ci-dessus est conservée sur l'ensemble du dossier.</p><p>Bien à vous,<br><strong>Pixelium</strong></p></div></div>`,
  };
}

function backoffMs(attempts) {
  const delays = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 8 * 60 * 60_000];
  return delays[Math.min(Math.max(attempts - 1, 0), delays.length - 1)];
}

async function addEvent(client, requestId, eventType, details = {}) {
  await client.query(
    'insert into pixelium_quote_events(request_id,event_type,details) values($1,$2,$3::jsonb)',
    [requestId, eventType, JSON.stringify(details)]
  );
}

async function createRequest(input) {
  await ensureReady();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('begin');

    const duplicate = await client.query('select * from pixelium_quote_requests where external_id=$1 limit 1', [input.externalId]);
    if (duplicate.rowCount) {
      await client.query('commit');
      return duplicate.rows[0];
    }

    const commercialResult = await client.query(
      'select * from pixelium_commercials where code=$1 and active=true limit 1',
      [input.commercialCode]
    );
    const commercial = commercialResult.rows[0];
    if (!commercial) throw new Error('Code commercial Pixelium inconnu ou inactif');

    const quoteAt = new Date(Date.now() + QUOTE_DELAY_MINUTES * 60_000);
    const inserted = await client.query(
      `insert into pixelium_quote_requests
        (external_id,commercial_id,commercial_code,source,offer_code,billing_mode,first_name,last_name,company,email,phone,message,visual_creation,consent_at,status,commission_rate_bps,quote_send_at,metadata)
       values($1,$2,$3,'pixelium-espace-c',$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),'received',$13,$14,$15::jsonb)
       returning *`,
      [input.externalId, commercial.id, commercial.code, input.offerCode, input.billingMode, input.firstName, input.lastName, input.company, input.email, input.phone, input.message, input.visualCreation, commercial.commission_rate_bps, quoteAt.toISOString(), JSON.stringify(input.metadata)]
    );
    let request = inserted.rows[0];
    const year = new Date(request.created_at).getUTCFullYear();
    const reference = `PIX-${commercial.code}-${year}-${String(request.reference_number).padStart(6, '0')}`;
    request = (await client.query(
      'update pixelium_quote_requests set commercial_reference=$1,updated_at=now() where id=$2 returning *',
      [reference, request.id]
    )).rows[0];

    await client.query(
      `insert into pixelium_commissions(request_id,commercial_id,commercial_code,rate_bps,status)
       values($1,$2,$3,$4,'pending') on conflict(request_id) do nothing`,
      [request.id, commercial.id, commercial.code, commercial.commission_rate_bps]
    );

    await client.query(
      `insert into pixelium_email_jobs(request_id,kind,status,send_at,idempotency_key)
       values($1,'confirmation','pending',now(),$2),($1,'quote','pending',$3,$4)`,
      [request.id, `pixelium-confirm-${request.id}`, quoteAt.toISOString(), `pixelium-quote-${request.id}`]
    );
    await addEvent(client, request.id, 'request_received', { externalId: input.externalId, commercialCode: commercial.code, quoteSendAt: quoteAt.toISOString() });
    await client.query('commit');
    return request;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function claimJobs() {
  await ensureReady();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `update pixelium_email_jobs set status='retry',locked_at=null,updated_at=now(),last_error=coalesce(last_error,'') || ' [reprise après verrou expiré]'
       where status='sending' and locked_at < now() - interval '5 minutes'`
    );
    const result = await client.query(
      `select j.*, r.*,
              j.id as job_id, j.kind as job_kind, j.status as job_status, j.attempts as job_attempts, j.max_attempts as job_max_attempts
       from pixelium_email_jobs j
       join pixelium_quote_requests r on r.id=j.request_id
       where j.status in ('pending','retry','blocked') and j.send_at <= now()
       order by j.send_at asc
       limit 10
       for update of j skip locked`
    );
    const rows = result.rows;
    for (const row of rows) {
      await client.query("update pixelium_email_jobs set status='sending',locked_at=now(),updated_at=now() where id=$1", [row.job_id]);
    }
    await client.query('commit');
    return rows;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function markBlocked(jobId, message) {
  await getPool().query("update pixelium_email_jobs set status='blocked',locked_at=null,last_error=$2,updated_at=now() where id=$1", [jobId, message]);
}

async function markFailure(row, error) {
  const pool = getPool();
  const attempts = Number(row.job_attempts || 0) + 1;
  if (attempts >= Number(row.job_max_attempts || 5)) {
    await pool.query("update pixelium_email_jobs set status='dead_letter',attempts=$2,locked_at=null,last_error=$3,updated_at=now() where id=$1", [row.job_id, attempts, clean(error.message, 1000)]);
    await pool.query("insert into pixelium_quote_events(request_id,event_type,details) values($1,'email_dead_letter',$2::jsonb)", [row.request_id, JSON.stringify({ kind: row.job_kind, error: clean(error.message, 500) })]);
    return;
  }
  const next = new Date(Date.now() + backoffMs(attempts));
  await pool.query("update pixelium_email_jobs set status='retry',attempts=$2,send_at=$3,locked_at=null,last_error=$4,updated_at=now() where id=$1", [row.job_id, attempts, next.toISOString(), clean(error.message, 1000)]);
}

async function sendJob(row) {
  const smtp = smtpConfig();
  if (!smtp.ready) return markBlocked(row.job_id, 'Configuration e-mail Pixelium manquante');

  let content;
  let pricing = null;
  if (row.job_kind === 'confirmation') {
    content = confirmationEmail(row);
  } else {
    if (String(process.env.PIXELIUM_QUOTE_AUTOSEND_ENABLED || '').toLowerCase() !== 'true') {
      return markBlocked(row.job_id, 'Envoi automatique du devis désactivé');
    }
    pricing = priceConfigFor(row);
    if (!pricing.ready) return markBlocked(row.job_id, 'Tarification Pixelium incomplète');
    content = quoteEmail(row, pricing);
  }

  const mailer = getTransport(smtp);
  const result = await mailer.sendMail({
    from: smtp.from,
    to: row.email,
    replyTo: smtp.replyTo || undefined,
    subject: content.subject,
    text: content.text,
    html: content.html,
    headers: { 'X-Pixelium-Reference': row.commercial_reference },
  });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("update pixelium_email_jobs set status='sent',sent_at=now(),locked_at=null,last_error=null,updated_at=now() where id=$1", [row.job_id]);
    if (row.job_kind === 'quote') {
      await client.query(
        "update pixelium_quote_requests set status='quote_sent',price_cents=$2,price_period=$3,tax_mode=$4,quote_sent_at=now(),updated_at=now() where id=$1",
        [row.request_id, pricing.cents, pricing.period, pricing.taxMode]
      );
      await addEvent(client, row.request_id, 'quote_sent', { messageId: result.messageId || null, priceCents: pricing.cents, pricePeriod: pricing.period, taxMode: pricing.taxMode });
    } else {
      await addEvent(client, row.request_id, 'confirmation_sent', { messageId: result.messageId || null });
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

let workerRunning = false;
async function processPixeliumQueue() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const jobs = await claimJobs();
    for (const row of jobs) {
      try {
        await sendJob(row);
      } catch (error) {
        console.error('[pixelium] email job failed:', row.job_id, error.message);
        await markFailure(row, error).catch(() => {});
      }
    }
  } finally {
    workerRunning = false;
  }
}

router.post('/request', requireBridge, async (req, res) => {
  try {
    const input = normalizeRequest(req.body || {});
    const request = await createRequest(input);
    processPixeliumQueue().catch(error => console.error('[pixelium] queue:', error.message));
    return res.status(201).json({
      success: true,
      requestId: request.id,
      reference: request.commercial_reference,
      commercialCode: request.commercial_code,
      quoteSendAt: request.quote_send_at,
      pricingConfigured: priceConfigFor(request).ready,
      emailConfigured: smtpConfig().ready,
    });
  } catch (error) {
    console.error('[pixelium] request:', error.message);
    return res.status(400).json({ error: error.message });
  }
});

router.post('/commercials', requireSession('admin'), async (req, res) => {
  try {
    await ensureReady();
    const code = clean(req.body?.code || '', 20).toUpperCase();
    const displayName = clean(req.body?.displayName || '', 160);
    const commissionRateBps = req.body?.commissionRateBps !== undefined ? Number(req.body.commissionRateBps) : null;

    // Validation du code
    if (!code || !COMMERCIAL_CODE_REGEX.test(code)) {
      return res.status(400).json({ error: 'Code commercial invalide (2-20 caractères majuscules/chiffres/tiret)' });
    }

    // Validation du displayName
    if (!displayName) {
      return res.status(400).json({ error: 'Nom à afficher requis' });
    }

    // Validation du taux de commission si fourni
    if (commissionRateBps !== null && (!Number.isInteger(commissionRateBps) || commissionRateBps < 0 || commissionRateBps > 10000)) {
      return res.status(400).json({ error: 'Taux de commission invalide' });
    }

    const pool = getPool();
    const result = await pool.query(
      `insert into pixelium_commercials(code,display_name,commission_rate_bps,active,metadata,created_at,updated_at)
       values($1,$2,$3,true,$4::jsonb,now(),now())
       on conflict(code) do update set active=pixelium_commercials.active
       returning id,code,display_name,commission_rate_bps,active,metadata`,
      [code, displayName, commissionRateBps || 0, JSON.stringify({ source: 'admin' })]
    );

    if (result.rowCount === 0 || result.rows[0].active === false) {
      // Conflit : le commercial existe déjà (et n'a pas changé car c'est un update without insert)
      return res.status(409).json({ error: 'Code commercial déjà existant' });
    }

    res.status(201).json({ success: true, commercial: result.rows[0] });
  } catch (error) {
    console.error('[pixelium] POST /commercials:', error.message);
    res.status(503).json({ error: error.message });
  }
});

router.get('/requests', requireSession('admin'), async (req, res) => {
  try {
    await ensureReady();
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const rows = await getPool().query(
      `select r.*, c.display_name as commercial_name, cm.status as commission_status, cm.rate_bps as commission_rate_bps_snapshot, cm.amount_cents as commission_amount_cents
       from pixelium_quote_requests r
       join pixelium_commercials c on c.id=r.commercial_id
       left join pixelium_commissions cm on cm.request_id=r.id
       order by r.created_at desc limit $1`,
      [limit]
    );
    res.json({ success: true, requests: rows.rows });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.get('/commercials', requireSession('admin'), async (_req, res) => {
  try {
    await ensureReady();
    const rows = await getPool().query('select id,code,display_name,commission_rate_bps,active,metadata,created_at,updated_at from pixelium_commercials order by code');
    res.json({ success: true, commercials: rows.rows });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.patch('/commercials/:code', requireSession('admin'), async (req, res) => {
  try {
    await ensureReady();
    const code = clean(req.params.code, 20).toUpperCase();
    const rateProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'commissionRateBps');
    const rate = !rateProvided || req.body.commissionRateBps === null ? null : Number(req.body.commissionRateBps);
    if (rateProvided && rate !== null && (!Number.isInteger(rate) || rate < 0 || rate > 10000)) return res.status(400).json({ error: 'Taux de commission invalide' });
    const active = req.body.active === undefined ? null : Boolean(req.body.active);
    const displayName = req.body.displayName === undefined ? null : clean(req.body.displayName, 160);

    // Protection JP : empêcher la désactivation
    if (code === 'JP' && active === false) {
      return res.status(409).json({ error: 'Julien P. est un commercial protégé et ne peut pas être désactivé' });
    }

    // Protection JP : empêcher de changer le displayName vers autre chose que "Julien P."
    if (code === 'JP' && displayName && displayName !== 'Julien P.') {
      return res.status(409).json({ error: 'Le nom "Julien P." ne peut pas être modifié pour ce commercial protégé' });
    }

    const result = rateProvided
      ? await getPool().query(
          `update pixelium_commercials set commission_rate_bps=$2,active=coalesce($3,active),display_name=coalesce(nullif($4,''),display_name),updated_at=now() where code=$1 returning id,code,display_name,commission_rate_bps,active,metadata,updated_at`,
          [code, rate, active, displayName]
        )
      : await getPool().query(
          `update pixelium_commercials set active=coalesce($2,active),display_name=coalesce(nullif($3,''),display_name),updated_at=now() where code=$1 returning id,code,display_name,commission_rate_bps,active,metadata,updated_at`,
          [code, active, displayName]
        );
    if (!result.rowCount) return res.status(404).json({ error: 'Commercial introuvable' });
    res.json({ success: true, commercial: result.rows[0] });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.post('/queue/run', requireSession('admin'), async (_req, res) => {
  try {
    await processPixeliumQueue();
    res.json({ success: true });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

const workerInterval = setInterval(() => {
  processPixeliumQueue().catch(error => console.error('[pixelium] worker:', error.message));
}, WORKER_INTERVAL_MS);
if (workerInterval.unref) workerInterval.unref();

router.processPixeliumQueue = processPixeliumQueue;
router.stopWorker = () => clearInterval(workerInterval);
router.normalizeRequest = normalizeRequest;
router.priceConfigFor = priceConfigFor;
router.smtpConfig = smtpConfig;

module.exports = router;

