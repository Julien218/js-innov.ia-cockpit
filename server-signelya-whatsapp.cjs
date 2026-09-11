const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const webpush = require('web-push');
const { ensureReady, getPool } = require('./server-postgres.cjs');
const { requireSession } = require('./server-security.cjs');

const router = express.Router();
const NOTIFICATIONS_ENABLED = process.env.SIGNELYA_NOTIFICATIONS_ENABLED === 'true';
const GRAPH_VERSION = String(process.env.WHATSAPP_GRAPH_VERSION || 'v23.0');
const PHONE_NUMBER_ID = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '');
const ACCESS_TOKEN = String(process.env.WHATSAPP_ACCESS_TOKEN || '');
const APP_SECRET = String(process.env.WHATSAPP_APP_SECRET || '');
const VERIFY_TOKEN = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '');
const LANGUAGE_CODE = String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'fr');
const OFFLINE_SECONDS = Math.max(180, Number(process.env.SIGNELYA_OFFLINE_CONFIRM_SECONDS || 300));
const OFFLINE_TEMPLATE = String(process.env.WHATSAPP_TEMPLATE_SCREEN_OFFLINE || 'signelya_screen_offline_confirmed');
const VIDEOS_ONLINE_TEMPLATE = String(process.env.WHATSAPP_TEMPLATE_VIDEOS_ONLINE || 'signelya_client_videos_online');
const SUPERADMIN_EMAIL = String(process.env.SIGNELYA_SUPERADMIN_ALERT_EMAIL || 'info@jsinnovia.store').trim().toLowerCase();
const SMTP_EMAIL = String(process.env.EMAIL_STORE_ADDRESS || 'info@jsinnovia.store');
const SMTP_PASSWORD = String(process.env.EMAIL_PASSWORD_STORE || '');
const SMTP_HOST = String(process.env.SMTP_HOST_STORE || 'smtp.ionos.fr');
const SMTP_PORT = Number(process.env.SMTP_PORT_STORE || 465);
const VAPID_PUBLIC_KEY = String(process.env.SIGNELYA_VAPID_PUBLIC_KEY || '');
const VAPID_PRIVATE_KEY = String(process.env.SIGNELYA_VAPID_PRIVATE_KEY || '');
const VAPID_SUBJECT = String(process.env.SIGNELYA_VAPID_SUBJECT || `mailto:${SUPERADMIN_EMAIL}`);
const pushConfigured = () => Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushConfigured()) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
let mailTransport = null;

let monitorTimer = null;
let monitorBusy = false;

const normalizeEmail = value => String(value || '').trim().toLowerCase();
const normalizePhone = value => {
  const raw = String(value || '').trim().replace(/[\s().-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(raw)) throw new Error('Numéro WhatsApp invalide');
  return raw.slice(1);
};
const configured = () => Boolean(PHONE_NUMBER_ID && ACCESS_TOKEN);

async function insertEvent(client, { dedupeKey, ownerEmail, eventType, audience, payload }) {
  const result = await client.query(
    `insert into signelya_notification_events
      (dedupe_key, owner_email, event_type, audience, payload)
     values ($1,$2,$3,$4,$5::jsonb)
     on conflict (dedupe_key) do nothing
     returning *`,
    [dedupeKey, normalizeEmail(ownerEmail) || null, eventType, audience, JSON.stringify(payload || {})]
  );
  return result.rows[0] || null;
}

async function sendTemplate(client, event, contact, templateName, parameters) {
  const to = normalizePhone(contact.phone_e164);
  const delivery = await client.query(
    `insert into signelya_whatsapp_deliveries
      (event_id, recipient_email, recipient_phone, recipient_role, template_name, status)
     values ($1,$2,$3,$4,$5,'queued') returning id`,
    [event.id, normalizeEmail(contact.email), '+' + to, contact.role, templateName]
  );
  const deliveryId = delivery.rows[0].id;
  try {
    if (!configured()) throw new Error('WhatsApp Cloud API non configurée');
    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: LANGUAGE_CODE },
          components: [{
            type: 'body',
            parameters: parameters.map(text => ({ type: 'text', text: String(text || '-') }))
          }]
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `Meta HTTP ${response.status}`);
    const messageId = data?.messages?.[0]?.id || null;
    await client.query(
      "update signelya_whatsapp_deliveries set status='sent', meta_message_id=$2, updated_at=now() where id=$1",
      [deliveryId, messageId]
    );
    return { sent: true, messageId };
  } catch (error) {
    await client.query(
      "update signelya_whatsapp_deliveries set status='failed', error=$2, updated_at=now() where id=$1",
      [deliveryId, String(error.message || error).slice(0, 1000)]
    );
    console.error('[signelya][whatsapp]', error.message);
    return { sent: false, error: error.message };
  }
}

async function clientName(client, ownerEmail) {
  const assignment = await client.query(
    'select client_name from signelya_client_commercial_assignments where lower(client_email)=lower($1)',
    [ownerEmail]
  );
  if (assignment.rows[0]?.client_name) return assignment.rows[0].client_name;
  const order = await client.query(
    'select company from commerce_orders where lower(email)=lower($1) order by created_at desc limit 1',
    [ownerEmail]
  );
  return order.rows[0]?.company || ownerEmail;
}

function getMailTransport() {
  if (!SMTP_PASSWORD) return null;
  if (!mailTransport) {
    mailTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_EMAIL, pass: SMTP_PASSWORD },
      tls: { rejectUnauthorized: process.env.SMTP_ALLOW_INVALID_CERT !== 'true' },
    });
  }
  return mailTransport;
}

async function sendSuperadminOfflineEmail(client, event, { playerName, clientName, minutes, lastSeenAt }) {
  const delivery = await client.query(
    `insert into signelya_email_deliveries
      (event_id,recipient_email,status)
     values ($1,$2,'queued') returning id`,
    [event.id, SUPERADMIN_EMAIL]
  );
  const deliveryId = delivery.rows[0].id;
  try {
    const transport = getMailTransport();
    if (!transport) throw new Error('SMTP JS-Innov.IA non configuré');
    await transport.sendMail({
      from: `"SIGNELYA Assistance" <${SMTP_EMAIL}>`,
      to: SUPERADMIN_EMAIL,
      subject: `[SIGNELYA] Écran hors ligne confirmé — ${clientName}`,
      text: [
        'Écran hors ligne confirmé.',
        `Client : ${clientName}`,
        `Écran : ${playerName}`,
        `Durée sans heartbeat : ${minutes} minutes`,
        `Dernier signal : ${lastSeenAt}`,
        '',
        "Vérifiez l'alimentation électrique et la connexion Internet."
      ].join('\n')
    });
    await client.query(
      "update signelya_email_deliveries set status='sent',updated_at=now() where id=$1",
      [deliveryId]
    );
    return { sent: true };
  } catch (error) {
    await client.query(
      "update signelya_email_deliveries set status='failed',error=$2,updated_at=now() where id=$1",
      [deliveryId, String(error.message || error).slice(0,1000)]
    );
    console.error('[signelya][email]', error.message);
    return { sent: false, error: error.message };
  }
}

async function sendSuperadminOnlineEmail(client, event, { playerName, clientName, restoredAt }) {
  const delivery = await client.query(
    `insert into signelya_email_deliveries
      (event_id,recipient_email,status)
     values ($1,$2,'queued') returning id`,
    [event.id, SUPERADMIN_EMAIL]
  );
  const deliveryId = delivery.rows[0].id;
  try {
    const transport = getMailTransport();
    if (!transport) throw new Error('SMTP JS-Innov.IA non configuré');
    await transport.sendMail({
      from: `"SIGNELYA Assistance" <${SMTP_EMAIL}>`,
      to: SUPERADMIN_EMAIL,
      subject: `[SIGNELYA] Écran de nouveau en ligne — ${clientName}`,
      text: [
        'Connexion de l’écran rétablie.',
        `Client : ${clientName}`,
        `Écran : ${playerName}`,
        `Nouveau signal : ${restoredAt}`,
        '',
        'La surveillance SIGNELYA a automatiquement confirmé le retour du Player.'
      ].join('\n')
    });
    await client.query(
      "update signelya_email_deliveries set status='sent',updated_at=now() where id=$1",
      [deliveryId]
    );
    return { sent: true };
  } catch (error) {
    await client.query(
      "update signelya_email_deliveries set status='failed',error=$2,updated_at=now() where id=$1",
      [deliveryId, String(error.message || error).slice(0,1000)]
    );
    console.error('[signelya][email]', error.message);
    return { sent: false, error: error.message };
  }
}

async function sendSuperadminPush(client, event, { playerName, clientName, minutes, title, body, tag }) {
  if (!pushConfigured()) return { configured: false, sent: 0 };
  const subscriptions = await client.query(
    `select id,subscription from signelya_push_subscriptions
     where enabled=true and role='superadmin'`
  );
  let sent = 0;
  for (const row of subscriptions.rows) {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({
        title: title || 'SIGNELYA — Écran hors ligne',
        body: body || `${clientName} · ${playerName} est hors ligne depuis ${minutes} minutes.`,
        url: '/ecran-geant',
        tag: tag || `signelya-offline-${event.id}`
      }));
      sent += 1;
      await client.query(
        `insert into signelya_push_deliveries (event_id,subscription_id,status)
         values ($1,$2,'sent')`, [event.id, row.id]
      );
    } catch (error) {
      const statusCode = Number(error.statusCode || 0);
      if ([404,410].includes(statusCode)) {
        await client.query('update signelya_push_subscriptions set enabled=false,updated_at=now() where id=$1', [row.id]);
      }
      await client.query(
        `insert into signelya_push_deliveries (event_id,subscription_id,status,error)
         values ($1,$2,'failed',$3)`, [event.id, row.id, String(error.message || error).slice(0,1000)]
      );
    }
  }
  return { configured: true, sent };
}

async function notifyBackOnline(player) {
  if (!NOTIFICATIONS_ENABLED) return { disabled: true };
  await ensureReady();
  const pool = getPool();
  const client = await pool.connect();
  try {
    const ownerEmail = normalizeEmail(player.owner_email);
    const name = await clientName(client, ownerEmail);
    const restoredAt = new Date(player.last_seen_at || Date.now()).toISOString();
    const playerName = player.name || 'Écran SIGNELYA';
    const event = await insertEvent(client, {
      dedupeKey: `player:${player.id}:online:${restoredAt}`,
      ownerEmail,
      eventType: 'screen.online_restored',
      audience: ['client', 'superadmin'],
      payload: { playerId: player.id, playerName, clientName: name, restoredAt }
    });
    if (!event) return { duplicate: true };
    const emailResult = await sendSuperadminOnlineEmail(client, event, { playerName, clientName: name, restoredAt });
    const pushResult = await sendSuperadminPush(client, event, {
      playerName,
      clientName: name,
      title: 'SIGNELYA — Écran de nouveau en ligne',
      body: `${name} · ${playerName} transmet à nouveau correctement.`,
      tag: `signelya-online-${event.id}`
    });
    return { eventId: event.id, superadminEmail: emailResult, superadminPush: pushResult };
  } finally {
    client.release();
  }
}

async function notifyConfirmedOffline(player) {
  if (!NOTIFICATIONS_ENABLED) return { disabled: true };
  await ensureReady();
  const pool = getPool();
  const client = await pool.connect();
  try {
    const ownerEmail = normalizeEmail(player.owner_email);
    const name = await clientName(client, ownerEmail);
    const lastSeen = new Date(player.last_seen_at);
    const minutes = Math.max(5, Math.floor((Date.now() - lastSeen.getTime()) / 60000));
    const event = await insertEvent(client, {
      dedupeKey: `player:${player.id}:offline:${lastSeen.toISOString()}`,
      ownerEmail,
      eventType: 'screen.offline_confirmed',
      audience: ['client', 'superadmin'],
      payload: { playerId: player.id, playerName: player.name, clientName: name, lastSeenAt: lastSeen.toISOString(), minutes }
    });
    if (!event) return { duplicate: true };
    const contacts = await client.query(
      `select email,phone_e164,role from signelya_notification_contacts
       where enabled=true and whatsapp_opt_in_at is not null
         and role='client' and lower(email)=lower($1)`,
      [ownerEmail]
    );
    const results = [];
    for (const contact of contacts.rows) {
      results.push(await sendTemplate(client, event, contact, OFFLINE_TEMPLATE, [
        player.name || 'Écran SIGNELYA', name, String(minutes)
      ]));
    }
    const emailResult = await sendSuperadminOfflineEmail(client, event, {
      playerName: player.name || 'Écran SIGNELYA', clientName: name,
      minutes, lastSeenAt: lastSeen.toISOString()
    });
    const pushResult = await sendSuperadminPush(client, event, {
      playerName: player.name || 'Écran SIGNELYA', clientName: name, minutes
    });
    return { eventId: event.id, recipients: contacts.rowCount, results, superadminEmail: emailResult, superadminPush: pushResult };
  } finally {
    client.release();
  }
}

async function notifyVideosOnline({ publicationId, ownerEmail, playerName }) {
  if (!NOTIFICATIONS_ENABLED) return { disabled: true };
  await ensureReady();
  const pool = getPool();
  const client = await pool.connect();
  try {
    const email = normalizeEmail(ownerEmail);
    const name = await clientName(client, email);
    const event = await insertEvent(client, {
      dedupeKey: `publication:${publicationId}:videos-online`,
      ownerEmail: email,
      eventType: 'videos.online',
      audience: ['commercial'],
      payload: { publicationId, playerName, clientName: name }
    });
    if (!event) return { duplicate: true };
    const contacts = await client.query(
      `select c.email,c.phone_e164,c.role
       from signelya_client_commercial_assignments a
       join signelya_notification_contacts c on lower(c.email)=lower(a.commercial_email)
       where lower(a.client_email)=lower($1)
         and c.enabled=true and c.whatsapp_opt_in_at is not null
         and c.role='collaborateur'`,
      [email]
    );
    const results = [];
    for (const contact of contacts.rows) {
      results.push(await sendTemplate(client, event, contact, VIDEOS_ONLINE_TEMPLATE, [
        name, playerName || 'Écran SIGNELYA'
      ]));
    }
    return { eventId: event.id, recipients: contacts.rowCount, results };
  } finally {
    client.release();
  }
}

async function pollOfflinePlayers() {
  if (!NOTIFICATIONS_ENABLED || monitorBusy) return;
  monitorBusy = true;
  const pool = getPool();
  if (!pool) { monitorBusy = false; return; }
  const client = await pool.connect();
  let locked = false;
  try {
    await ensureReady();
    const lock = await client.query('select pg_try_advisory_lock($1) as locked', [2182027]);
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return;
    const players = await client.query(
      `select id,name,owner_email,last_seen_at,status
       from signage_players
       where last_seen_at is not null and status <> 'retired'`
    );
    for (const player of players.rows) {
      const ageSeconds = (Date.now() - new Date(player.last_seen_at).getTime()) / 1000;
      const offline = ageSeconds >= OFFLINE_SECONDS;
      const previous = await client.query(
        'select state,last_seen_at from signelya_device_alert_state where player_id=$1',
        [String(player.id)]
      );
      const previousState = previous.rows[0]?.state || 'unknown';
      await client.query(
        `insert into signelya_device_alert_state
          (player_id,owner_email,state,offline_since,last_seen_at,updated_at)
         values ($1,$2,$3,$4,$5,now())
         on conflict (player_id) do update set
           owner_email=excluded.owner_email,state=excluded.state,
           offline_since=case
             when signelya_device_alert_state.state <> 'offline' and excluded.state='offline' then excluded.offline_since
             when excluded.state='online' then null
             else signelya_device_alert_state.offline_since end,
           last_seen_at=excluded.last_seen_at,updated_at=now()`,
        [String(player.id), normalizeEmail(player.owner_email), offline ? 'offline' : 'online',
          offline ? player.last_seen_at : null, player.last_seen_at]
      );
      // Retry the event creation for every confirmed outage. The unique dedupe
      // key makes this idempotent and also records an outage first discovered
      // after a service restart, when no previous in-memory transition exists.
      if (offline) {
        const result = await notifyConfirmedOffline(player);
        if (result?.eventId) {
          await client.query(
            'update signelya_device_alert_state set last_notified_at=now() where player_id=$1',
            [String(player.id)]
          );
        }
      }
      if (!offline && previousState === 'offline') {
        await notifyBackOnline(player);
      }
    }
  } catch (error) {
    console.error('[signelya][offline-monitor]', error.message);
  } finally {
    if (locked) await client.query('select pg_advisory_unlock($1)', [2182027]).catch(() => {});
    client.release();
    monitorBusy = false;
  }
}

function verifySignature(req) {
  if (!APP_SECRET) return false;
  const signature = String(req.headers['x-hub-signature-256'] || '');
  const raw = req.rawBody;
  if (!signature.startsWith('sha256=') || !Buffer.isBuffer(raw)) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

router.get('/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  if (mode === 'subscribe' && VERIFY_TOKEN && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

router.post('/webhook', async (req, res) => {
  if (!verifySignature(req)) return res.sendStatus(401);
  res.sendStatus(200);
  const statuses = [];
  for (const entry of req.body?.entry || []) {
    for (const change of entry.changes || []) {
      for (const status of change.value?.statuses || []) statuses.push(status);
    }
  }
  if (!statuses.length || !getPool()) return;
  const client = await getPool().connect();
  try {
    for (const status of statuses) {
      await client.query(
        `update signelya_whatsapp_deliveries
         set status=$2, error=coalesce($3,error), updated_at=now()
         where meta_message_id=$1`,
        [status.id, status.status || 'unknown', status.errors?.[0]?.title || null]
      );
    }
  } finally {
    client.release();
  }
});

router.get('/push/public-key', requireSession('superadmin'), (req, res) => {
  if (!pushConfigured()) return res.status(503).json({ error: 'Notifications mobiles non configurées' });
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

router.post('/push/subscriptions', requireSession('superadmin'), async (req, res) => {
  try {
    await ensureReady();
    const subscription = req.body?.subscription;
    const endpoint = String(subscription?.endpoint || '');
    if (!endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'Abonnement mobile invalide' });
    }
    const result = await getPool().query(
      `insert into signelya_push_subscriptions
        (user_email,role,endpoint,subscription,user_agent,enabled,updated_at)
       values ($1,'superadmin',$2,$3::jsonb,$4,true,now())
       on conflict (endpoint) do update set
         user_email=excluded.user_email,role='superadmin',subscription=excluded.subscription,
         user_agent=excluded.user_agent,enabled=true,updated_at=now()
       returning id,user_email,role,enabled`,
      [normalizeEmail(req.user.email), endpoint, JSON.stringify(subscription), String(req.headers['user-agent'] || '').slice(0,500)]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/push/subscriptions', requireSession('superadmin'), async (req, res) => {
  try {
    await ensureReady();
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint) return res.status(400).json({ error: 'Endpoint requis' });
    await getPool().query(
      `update signelya_push_subscriptions set enabled=false,updated_at=now()
       where endpoint=$1 and lower(user_email)=lower($2)`,
      [endpoint, normalizeEmail(req.user.email)]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function notificationVisibility(role) {
  if (['admin', 'superadmin'].includes(role)) return '($2::text is not null)';
  if (role === 'collaborateur') {
    return `(
      ('commercial' = any(e.audience) or 'collaborateur' = any(e.audience))
      and exists (
        select 1 from signelya_client_commercial_assignments a
        where lower(a.client_email)=lower(e.owner_email)
          and lower(a.commercial_email)=lower($2)
      )
    )`;
  }
  return "lower(e.owner_email)=lower($2) and 'client'=any(e.audience)";
}

router.get('/notifications', requireSession('client'), async (req, res) => {
  try {
    await ensureReady();
    const email = normalizeEmail(req.user.email);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const visibility = notificationVisibility(req.user.role);
    const result = await getPool().query(
      `select e.id,e.event_type,e.owner_email,e.audience,e.payload,e.created_at,
              (r.event_id is not null) as read,
              count(*) filter (where r.event_id is null) over()::int as unread_count
       from signelya_notification_events e
       left join signelya_notification_reads r
         on r.event_id=e.id and lower(r.user_email)=lower($1)
       where ${visibility}
       order by e.created_at desc
       limit $3`,
      [email, email, limit]
    );
    const unreadCount = Number(result.rows[0]?.unread_count || 0);
    const events = result.rows.map(({ unread_count, ...event }) => event);
    res.json({ events, unreadCount });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.post('/notifications/read-all', requireSession('client'), async (req, res) => {
  try {
    await ensureReady();
    const email = normalizeEmail(req.user.email);
    const visibility = notificationVisibility(req.user.role);
    await getPool().query(
      `insert into signelya_notification_reads (event_id,user_email)
       select e.id,$1 from signelya_notification_events e
       where ${visibility}
       on conflict (event_id,user_email) do nothing`,
      [email, email]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.post('/notifications/:id/read', requireSession('client'), async (req, res) => {
  try {
    await ensureReady();
    const email = normalizeEmail(req.user.email);
    const eventId = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return res.status(400).json({ error: 'Notification invalide' });
    const visibility = notificationVisibility(req.user.role);
    const result = await getPool().query(
      `insert into signelya_notification_reads (event_id,user_email)
       select e.id,$1 from signelya_notification_events e
       where e.id=$3 and ${visibility}
       on conflict (event_id,user_email) do nothing
       returning event_id`,
      [email, email, eventId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Notification introuvable' });
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.get('/status', requireSession('superadmin'), async (req, res) => {
  try {
    await ensureReady();
    const pool = getPool();
    const [contacts, assignments, deliveries, pushSubscriptions] = await Promise.all([
      pool.query('select email,phone_e164,role,enabled,whatsapp_opt_in_at from signelya_notification_contacts order by role,email'),
      pool.query('select * from signelya_client_commercial_assignments order by client_email'),
      pool.query('select recipient_email,recipient_role,template_name,status,error,created_at from signelya_whatsapp_deliveries order by created_at desc limit 30'),
      pool.query("select count(*)::int as count from signelya_push_subscriptions where enabled=true and role='superadmin'")
    ]);
    res.json({
      enabled: NOTIFICATIONS_ENABLED,
      configured: configured(),
      phoneNumberIdConfigured: Boolean(PHONE_NUMBER_ID),
      accessTokenConfigured: Boolean(ACCESS_TOKEN),
      appSecretConfigured: Boolean(APP_SECRET),
      webhookVerifyTokenConfigured: Boolean(VERIFY_TOKEN),
      offlineConfirmSeconds: OFFLINE_SECONDS,
      contacts: contacts.rows,
      assignments: assignments.rows,
      deliveries: deliveries.rows,
      superadminAlertEmail: SUPERADMIN_EMAIL,
      superadminEmailConfigured: Boolean(SMTP_PASSWORD),
      mobilePushConfigured: pushConfigured(),
      mobilePushSubscriptions: pushSubscriptions.rows[0]?.count || 0
    });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.put('/contacts/:email', requireSession('superadmin'), async (req, res) => {
  try {
    await ensureReady();
    const email = normalizeEmail(req.params.email);
    const role = String(req.body.role || '');
    if (!['client','collaborateur','superadmin'].includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
    const phone = '+' + normalizePhone(req.body.phone);
    const optIn = req.body.whatsappOptIn === true ? new Date().toISOString() : null;
    const result = await getPool().query(
      `insert into signelya_notification_contacts
        (email,phone_e164,role,enabled,whatsapp_opt_in_at,updated_at)
       values ($1,$2,$3,$4,$5,now())
       on conflict (email) do update set
         phone_e164=excluded.phone_e164,role=excluded.role,enabled=excluded.enabled,
         whatsapp_opt_in_at=excluded.whatsapp_opt_in_at,updated_at=now()
       returning email,phone_e164,role,enabled,whatsapp_opt_in_at`,
      [email, phone, role, req.body.enabled !== false, optIn]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/assignments/:clientEmail', requireSession('superadmin'), async (req, res) => {
  try {
    await ensureReady();
    const clientEmail = normalizeEmail(req.params.clientEmail);
    const commercialEmail = normalizeEmail(req.body.commercialEmail);
    if (!clientEmail || !commercialEmail) return res.status(400).json({ error: 'Client et commercial requis' });
    const result = await getPool().query(
      `insert into signelya_client_commercial_assignments
        (client_email,client_name,commercial_email,updated_at)
       values ($1,$2,$3,now())
       on conflict (client_email) do update set
         client_name=excluded.client_name,commercial_email=excluded.commercial_email,updated_at=now()
       returning *`,
      [clientEmail, String(req.body.clientName || '').trim() || null, commercialEmail]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/test', requireSession('superadmin'), async (req, res) => {
  res.status(400).json({
    error: 'Test réel volontairement désactivé. Utiliser un événement contrôlé après validation des modèles Meta.'
  });
});

function startMonitor() {
  if (monitorTimer) return;
  const intervalMs = Math.max(30000, Number(process.env.SIGNELYA_OFFLINE_MONITOR_INTERVAL_MS || 60000));
  monitorTimer = setInterval(() => pollOfflinePlayers(), intervalMs);
  monitorTimer.unref?.();
  setTimeout(() => pollOfflinePlayers(), 15000).unref?.();
}

module.exports = { router, startMonitor, notifyVideosOnline, notifyConfirmedOffline, notifyBackOnline };
