const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { cleanTenant, resolveTenant } = require('./server-tenant.cjs');
const { hasPermission } = require('./server-permission-policy.cjs');
const { invoiceScope, readClientInvoices } = require('./server-client-invoices.cjs');
const { normalizeDemandeWrite } = require('./server-demande-status.cjs');
const { analyzeDomain, MANAGED_DOMAINS } = require('./server-domain-ops.cjs');
const projectData = require('./server-project-data.cjs');

const ROLE_LEVEL = { client: 1, collaborateur: 2, admin: 3, superadmin: 4 };
const TENANT_TABLES = new Set(['Client', 'Projet', 'Tache', 'Devis', 'Facture', 'Demande']);
const CLIENT_READ_TABLES = new Set(['Projet', 'Devis', 'Facture', 'Demande']);
const ADMIN_TABLES = new Set(['LogAction', 'Validation', 'Commission']);
const TABLE_PERMISSIONS = Object.freeze({
  Client: 'clients', Projet: 'projects', Tache: 'tasks', Devis: 'quotes', Facture: 'invoices', Demande: 'requests',
  LogAction: 'logs', Validation: 'validations', Commission: 'commissions',
});
const AGENT_PROXY_URL = process.env.JSINNOVIA_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_PROXY_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';

const CLIENT_VISIBLE_FIELDS = {
  Projet: new Set(['id', 'nom', 'description', 'statut', 'date_debut', 'date_fin_prevue', 'progression', 'priorite', 'client_nom', 'created_at', 'updated_at']),
  Devis: new Set(['id', 'numero', 'objet', 'client_nom', 'projet_id', 'lignes', 'montant_ht', 'tva', 'montant_ttc', 'statut', 'date_validite', 'created_at', 'updated_at']),
  Facture: new Set(['id', 'numero', 'objet', 'client_nom', 'devis_id', 'lignes', 'montant_ht', 'tva', 'montant_ttc', 'statut', 'date_echeance', 'date_paiement', 'mode_paiement', 'created_at', 'updated_at']),
  Demande: new Set(['id', 'nom', 'email', 'telephone', 'entreprise', 'message', 'type', 'statut', 'created_at', 'updated_at']),
};

const NOTIFICATION_RETENTION_MS = Math.max(
  24 * 60 * 60 * 1000,
  Number(process.env.CLIENT_NOTIFICATION_RETENTION_DAYS || 14) * 24 * 60 * 60 * 1000,
);
const DEFAULT_DOMAIN_OWNERS = Object.freeze({
  'jsinnovia.com': 'jsinnovia',
  'cockpit.jsinnovia.com': 'jsinnovia',
  'jsinnovia.store': 'jsinnovia',
  'missetmisterdour.be': 'starlight-asbl',
  'letourdedour.com': 'starlight-asbl',
  'synergiedour.be': 'synergie-dour-asbl',
  'fashionistartdour.be': 'fashionist-art',
  'assurances-dour.be': 'olivier-trevis-consulting-srl',
});
const OUTAGE_CODES = new Set(['apex_http_down', 'apex_dns_missing', 'tls_invalid']);
const notificationState = {
  domains: new Map(),
  events: [],
  delivered: new Set(),
  running: false,
  timer: null,
};

function parseObjectEnv(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn(`[notifications] ${name} JSON invalide:`, error.message);
    return {};
  }
}

function domainOwnerMap() {
  const configured = parseObjectEnv('CLIENT_DOMAIN_OWNERS_JSON');
  return Object.fromEntries(
    Object.entries({ ...DEFAULT_DOMAIN_OWNERS, ...configured })
      .map(([domain, tenant]) => [String(domain || '').trim().toLowerCase(), cleanTenant(tenant)])
      .filter(([domain, tenant]) => domain && tenant && MANAGED_DOMAINS[domain]),
  );
}

function normalizePhone(value) {
  const phone = String(value || '').trim().replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : '';
}

function contactConfig(tenant) {
  const all = parseObjectEnv('CLIENT_ALERT_CONTACTS_JSON');
  const raw = all[tenant] || Object.entries(all).find(([key]) => cleanTenant(key) === tenant)?.[1] || {};
  const toArray = value => Array.isArray(value) ? value : value ? [value] : [];
  const sms = toArray(raw.sms || raw.sms_numbers).map(item => normalizePhone(typeof item === 'string' ? item : item?.phone)).filter(Boolean);
  const whatsapp = toArray(raw.whatsapp || raw.whatsapp_numbers).map(item => {
    if (typeof item === 'string') return { phone: normalizePhone(item), optedIn: Boolean(raw.whatsapp_opt_in) };
    return {
      phone: normalizePhone(item?.phone || item?.phone_e164),
      optedIn: Boolean(item?.opt_in || item?.opted_in || item?.whatsapp_opt_in),
    };
  }).filter(item => item.phone && item.optedIn);
  return {
    name: String(raw.name || raw.organisation || tenant).trim().slice(0, 120),
    sms: [...new Set(sms)],
    whatsapp: [...new Map(whatsapp.map(item => [item.phone, item])).values()],
  };
}

function eventId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function withinRetention(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && Date.now() - time <= NOTIFICATION_RETENTION_MS;
}

function clip(value, max = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function pushSystemEvent(event) {
  if (!event?.id || notificationState.events.some(item => item.id === event.id)) return;
  notificationState.events.unshift(event);
  const cutoff = Date.now() - NOTIFICATION_RETENTION_MS;
  notificationState.events = notificationState.events
    .filter(item => new Date(item.created_at).getTime() >= cutoff)
    .slice(0, 250);
}

async function agentRequest(path, { method = 'GET', body, tenant, signal, redirect } = {}) {
  if (!AGENT_PROXY_KEY) {
    const error = new Error('Clé du service jsinnovia-agent non configurée.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${AGENT_PROXY_URL}${path}`, {
    method,
    ...(signal ? { signal } : {}),
    ...(redirect ? { redirect } : {}),
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

function parseRows(raw) {
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.items)) return data.items;
    return data && typeof data === 'object' && !data.error ? [data] : [];
  } catch {
    return [];
  }
}

function rowBelongsToTenant(row, tenant) {
  const value = row?.organisation_id || row?.client_organisation || row?.organisation || row?.tenant_id;
  return !value || cleanTenant(value) === tenant;
}

async function tenantRows(table, tenant) {
  try {
    const target = new URL(`/data/${table}`, AGENT_PROXY_URL);
    target.searchParams.set('organisation_id', tenant);
    const result = await agentRequest(`${target.pathname}${target.search}`, { tenant });
    if (!result.response.ok) return [];
    return parseRows(result.raw).filter(row => rowBelongsToTenant(row, tenant));
  } catch (error) {
    console.warn(`[notifications] ${table}:`, error.message);
    return [];
  }
}

function recordNotification(table, row, tenant) {
  const createdAt = safeDate(row.created_at || row.createdAt || row.updated_at || row.updatedAt);
  if (!createdAt || !withinRetention(createdAt)) return null;
  const stable = row.id || row.numero || `${table}:${createdAt}:${row.nom || row.objet || row.email || ''}`;
  if (table === 'Demande') {
    return {
      id: eventId(`request:${tenant}:${stable}`),
      event_type: 'request.received',
      severity: 'info',
      title: 'Nouvelle demande reçue',
      body: clip(row.entreprise || row.nom || row.type || row.message || 'Une nouvelle demande concerne votre organisation.'),
      created_at: createdAt,
      url: '/demandes',
      source: 'cockpit',
    };
  }
  if (table === 'Projet') {
    return {
      id: eventId(`project:${tenant}:${stable}:${row.updated_at || row.created_at || ''}`),
      event_type: 'project.updated',
      severity: 'info',
      title: 'Projet mis à jour',
      body: clip(`${row.nom || 'Projet'}${row.statut ? ` · ${row.statut}` : ''}`),
      created_at: createdAt,
      url: '/mes-projets',
      source: 'cockpit',
    };
  }
  if (table === 'Devis') {
    return {
      id: eventId(`quote:${tenant}:${stable}:${row.updated_at || row.created_at || ''}`),
      event_type: 'quote.updated',
      severity: 'info',
      title: 'Devis disponible',
      body: clip(`${row.numero || row.objet || 'Devis'}${row.statut ? ` · ${row.statut}` : ''}`),
      created_at: createdAt,
      url: '/mes-devis',
      source: 'cockpit',
    };
  }
  if (table === 'Facture') {
    return {
      id: eventId(`invoice:${tenant}:${stable}:${row.updated_at || row.created_at || ''}`),
      event_type: 'invoice.updated',
      severity: row.statut === 'en_retard' ? 'warning' : 'info',
      title: 'Facture mise à jour',
      body: clip(`${row.numero || row.objet || 'Facture'}${row.statut ? ` · ${row.statut}` : ''}`),
      created_at: createdAt,
      url: '/mes-factures',
      source: 'cockpit',
    };
  }
  return null;
}

async function projectNotifications(tenant) {
  const events = [];
  const collections = (projectData.COLLECTIONS || []).filter(collection => cleanTenant(collection.client) === tenant);
  for (const collection of collections) {
    try {
      const records = await projectData.listRecords(collection);
      for (const row of (records || []).slice(0, 100)) {
        const createdAt = safeDate(row.created_at || row.updated_at);
        if (!createdAt || !withinRetention(createdAt)) continue;
        if (collection.kind === 'registrations') {
          const name = clip([row.first_name, row.last_name].filter(Boolean).join(' '), 100);
          events.push({
            id: eventId(`project-registration:${collection.key}:${row.id}`),
            event_type: 'registration.new',
            severity: 'info',
            title: 'Nouvel inscrit',
            body: clip(`${name || 'Nouvelle candidature'} · ${collection.project}`),
            created_at: createdAt,
            url: '/donnees-projets',
            source: collection.key,
          });
        } else {
          events.push({
            id: eventId(`project-data:${collection.key}:${row.id || createdAt}`),
            event_type: 'project_data.received',
            severity: 'info',
            title: 'Nouvelle donnée reçue',
            body: clip(`${collection.project} · ${row.suggested_name || row.display_name || collection.label}`),
            created_at: createdAt,
            url: '/donnees-projets',
            source: collection.key,
          });
        }
      }
    } catch (error) {
      console.warn(`[notifications] projet ${collection.key}:`, error.message);
    }
  }
  return events;
}

async function sendTwilioSms(to, body) {
  const sid = String(process.env.TWILIO_ACCOUNT_SID || '');
  const token = String(process.env.TWILIO_AUTH_TOKEN || '');
  if (!sid.startsWith('AC') || !token) return { configured: false, sent: false };
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  let from = normalizePhone(process.env.TWILIO_PHONE_NUMBER);
  if (!from) {
    const numbersResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=20`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10000),
    });
    const numbers = await numbersResponse.json().catch(() => ({}));
    if (!numbersResponse.ok) throw new Error(numbers.message || `Twilio numéros HTTP ${numbersResponse.status}`);
    const candidate = (numbers.incoming_phone_numbers || []).find(item => item?.capabilities?.sms !== false);
    from = normalizePhone(candidate?.phone_number);
    if (!from) return { configured: true, sent: false, error: 'Aucun numéro SMS Twilio disponible' };
  }
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Twilio HTTP ${response.status}`);
  return { configured: true, sent: true, id: data.sid || null };
}

async function sendMetaWhatsApp(to, { organisation, title, body }) {
  const version = String(process.env.WHATSAPP_GRAPH_VERSION || 'v23.0');
  const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '');
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '');
  const template = String(process.env.WHATSAPP_TEMPLATE_CRITICAL_ALERT || '');
  const language = String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'fr');
  if (!phoneId || !accessToken || !template) return { configured: false, sent: false };
  const normalized = normalizePhone(to).replace(/^\+/, '');
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalized,
      type: 'template',
      template: {
        name: template,
        language: { code: language },
        components: [{
          type: 'body',
          parameters: [organisation, title, body].map(text => ({ type: 'text', text: clip(text, 180) || '-' })),
        }],
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `WhatsApp HTTP ${response.status}`);
  return { configured: true, sent: true, id: data?.messages?.[0]?.id || null };
}

async function deliverCriticalEvent(event) {
  if (process.env.CLIENT_ALERTS_ENABLED !== 'true') return { enabled: false, sms: 0, whatsapp: 0 };
  const tenant = cleanTenant(event.tenant);
  const contacts = contactConfig(tenant);
  const message = `JS-Innov.IA — ${contacts.name}: ${event.title}. ${event.body}`;
  let sms = 0;
  let whatsapp = 0;

  for (const phone of contacts.sms) {
    const key = `${event.id}:sms:${phone}`;
    if (notificationState.delivered.has(key)) continue;
    try {
      const result = await sendTwilioSms(phone, message);
      if (result.sent) {
        notificationState.delivered.add(key);
        sms += 1;
      }
    } catch (error) {
      console.error('[notifications][sms]', error.message);
    }
  }

  for (const contact of contacts.whatsapp) {
    const key = `${event.id}:whatsapp:${contact.phone}`;
    if (notificationState.delivered.has(key)) continue;
    try {
      const result = await sendMetaWhatsApp(contact.phone, {
        organisation: contacts.name,
        title: event.title,
        body: event.body,
      });
      if (result.sent) {
        notificationState.delivered.add(key);
        whatsapp += 1;
      }
    } catch (error) {
      console.error('[notifications][whatsapp]', error.message);
    }
  }
  return { enabled: true, sms, whatsapp };
}

function operationalCriticalIssues(result) {
  return (result?.issues || []).filter(issue => issue?.severity === 'critical' && OUTAGE_CODES.has(issue.code));
}

async function inspectDomain(domain, tenant) {
  const now = new Date().toISOString();
  const previous = notificationState.domains.get(domain) || {
    failures: 0,
    open: false,
    firstFailureAt: null,
    lastHealthyAt: null,
  };
  try {
    const result = await analyzeDomain(domain);
    const issues = operationalCriticalIssues(result);
    if (issues.length) {
      const firstFailureAt = previous.firstFailureAt || now;
      const failures = previous.failures + 1;
      const confirmFailures = Math.max(2, Number(process.env.CLIENT_NOTIFICATION_CONFIRM_FAILURES || 2));
      let open = previous.open;
      let incidentId = previous.incidentId || null;
      if (!open && failures >= confirmFailures) {
        open = true;
        incidentId = eventId(`site:${domain}:critical:${firstFailureAt}`);
        const event = {
          id: incidentId,
          tenant,
          event_type: 'site.down',
          severity: 'critical',
          title: `Incident critique — ${domain}`,
          body: clip(issues.map(issue => issue.label).join(' · '), 320),
          created_at: firstFailureAt,
          url: '/domaines',
          source: 'domain-monitor',
        };
        pushSystemEvent(event);
        event.delivery = await deliverCriticalEvent(event);
      }
      notificationState.domains.set(domain, {
        failures,
        open,
        incidentId,
        firstFailureAt,
        lastCheckedAt: now,
        lastIssues: issues.map(issue => issue.code),
      });
      return;
    }

    if (previous.open) {
      pushSystemEvent({
        id: eventId(`site:${domain}:restored:${now}`),
        tenant,
        event_type: 'site.restored',
        severity: 'success',
        title: `Service rétabli — ${domain}`,
        body: 'Le site répond de nouveau correctement aux contrôles automatiques.',
        created_at: now,
        url: '/domaines',
        source: 'domain-monitor',
      });
    }
    notificationState.domains.set(domain, {
      failures: 0,
      open: false,
      firstFailureAt: null,
      lastHealthyAt: now,
      lastCheckedAt: now,
      lastIssues: [],
    });
  } catch (error) {
    console.warn(`[notifications][domain] ${domain}:`, error.message);
    notificationState.domains.set(domain, { ...previous, lastCheckedAt: now, monitorError: error.message });
  }
}

async function pollClientDomains() {
  if (notificationState.running || process.env.CLIENT_NOTIFICATION_MONITOR_ENABLED === 'false') return;
  notificationState.running = true;
  try {
    const owners = domainOwnerMap();
    await Promise.all(Object.entries(owners).map(([domain, tenant]) => inspectDomain(domain, tenant)));
  } finally {
    notificationState.running = false;
  }
}

function startNotificationMonitor() {
  if (notificationState.timer || process.env.CLIENT_NOTIFICATION_MONITOR_ENABLED === 'false') return;
  const interval = Math.max(60_000, Number(process.env.CLIENT_NOTIFICATION_MONITOR_INTERVAL_MS || 60_000));
  const first = setTimeout(() => pollClientDomains().catch(error => console.warn('[notifications] monitor:', error.message)), 10_000);
  first.unref?.();
  notificationState.timer = setInterval(
    () => pollClientDomains().catch(error => console.warn('[notifications] monitor:', error.message)),
    interval,
  );
  notificationState.timer.unref?.();
}

async function collectNotifications(req) {
  const tenant = resolveTenant(req);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 40)));
  const [requests, projects, quotes, invoices, projectEvents] = await Promise.all([
    tenantRows('Demande', tenant),
    tenantRows('Projet', tenant),
    tenantRows('Devis', tenant),
    tenantRows('Facture', tenant),
    projectNotifications(tenant),
  ]);
  const events = [
    ...notificationState.events.filter(event => cleanTenant(event.tenant) === tenant),
    ...requests.map(row => recordNotification('Demande', row, tenant)),
    ...projects.map(row => recordNotification('Projet', row, tenant)),
    ...quotes.map(row => recordNotification('Devis', row, tenant)),
    ...invoices.map(row => recordNotification('Facture', row, tenant)),
    ...projectEvents,
  ].filter(Boolean);

  const unique = [...new Map(events.map(event => [event.id, event])).values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);

  const contacts = contactConfig(tenant);
  return {
    events: unique,
    tenant,
    checked_at: new Date().toISOString(),
    critical_delivery: {
      enabled: process.env.CLIENT_ALERTS_ENABLED === 'true',
      contacts_configured: Boolean(contacts.sms.length || contacts.whatsapp.length),
      sms_configured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      whatsapp_configured: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_TEMPLATE_CRITICAL_ALERT),
    },
  };
}

function publicClientRecord(table, record) {
  const allowed = CLIENT_VISIBLE_FIELDS[table];
  if (!allowed || !record || typeof record !== 'object' || Array.isArray(record)) return null;
  return Object.fromEntries(Object.entries(record).filter(([key]) => allowed.has(key)));
}

function minimizeClientResponse(table, raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (Array.isArray(data)) return JSON.stringify(data.map((row) => publicClientRecord(table, row)).filter(Boolean));
  if (data && typeof data === 'object' && !data.error) return JSON.stringify(publicClientRecord(table, data) || {});
  return raw;
}

// Hub de notifications multi-client. Le garde de session client est appliqué par server.cjs.
router.get('/Notifications', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await collectNotifications(req));
  } catch (error) {
    console.error('[notifications] feed:', error.message);
    res.status(error.status || 503).json({ error: 'Notifications momentanément indisponibles.' });
  }
});

router.use(async (req, res) => {
  try {
    const table = req.path.split('/').filter(Boolean)[0];
    const role = req.user?.role || 'client';
    const requiredPermission = TABLE_PERMISSIONS[table];
    if (requiredPermission && !hasPermission(req.user, requiredPermission)) {
      return res.status(403).json({ error: 'Accès à cette ressource non autorisé' });
    }
    if (role === 'client' && (req.method !== 'GET' || !CLIENT_READ_TABLES.has(table))) {
      return res.status(403).json({ error: 'Cette opération nécessite un collaborateur.' });
    }
    if (ADMIN_TABLES.has(table) && (ROLE_LEVEL[role] || 0) < ROLE_LEVEL.admin) {
      return res.status(403).json({ error: 'Cette ressource nécessite un administrateur.' });
    }

    if (role === 'client' && table === 'Facture') {
      const scope = invoiceScope(req.user);
      if (scope) {
        res.setHeader('Cache-Control', 'private, no-store');
        const parts = req.path.split('/').filter(Boolean);
        if (parts.length > 2 || req.headers['x-managed-organisation']) return res.status(403).json({ error: 'Consultation des factures destinataires uniquement.' });
        // Browser-supplied client/organisation/filter parameters cannot widen scope.
        return res.json(await readClientInvoices(scope, agentRequest, parts[1] || null));
      }
    }

    const tenant = TENANT_TABLES.has(table) ? resolveTenant(req) : null;
    const target = new URL(`/data${req.url}`, AGENT_PROXY_URL);
    if (tenant && req.method === 'GET' && req.path.split('/').filter(Boolean).length === 1) {
      target.searchParams.set('organisation_id', tenant);
    }

    let payload = req.body;
    if (table === 'Demande' && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
      payload = normalizeDemandeWrite(payload, req.method);
    }
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

    const body = role === 'client' && req.method === 'GET' && result.response.ok
      ? minimizeClientResponse(table, result.raw)
      : result.raw;
    return res.status(result.response.status).set('Content-Type', result.contentType).send(body);
  } catch (error) {
    console.error('[HainoFlow data proxy]', error.message);
    return res.status(error.status || 502).json({ error: error.message });
  }
});

startNotificationMonitor();

module.exports = router;
module.exports.collectNotifications = collectNotifications;
module.exports.domainOwnerMap = domainOwnerMap;
module.exports.contactConfig = contactConfig;
module.exports.operationalCriticalIssues = operationalCriticalIssues;
module.exports.notificationState = notificationState;
