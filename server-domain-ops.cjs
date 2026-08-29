const express = require('express');
const dns = require('node:dns').promises;
const tls = require('node:tls');
const crypto = require('node:crypto');
const { SITE_AGENT_REGISTRY } = require('./server-agent-orchestrator.cjs');
const ionosDns = require('./server-ionos-dns.cjs');

const router = express.Router();
const JS_AGENT_URL = String(process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app').replace(/\/$/, '');
const JS_AGENT_KEY = String(process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '').trim();
const pendingDomainActions = new Map();
const pendingDnsActions = new Map();

const MANAGED_DOMAINS = Object.freeze({
  'jsinnovia.com': {
    app: 'js-innovia-site',
    agent_hint: 'JsInnov-Agent',
    hosting: 'Railway',
    primary_url: 'https://www.jsinnovia.com',
    repository: 'Julien218/jsinnovia',
  },
  'cockpit.jsinnovia.com': { app: 'cockpit-v3', agent_hint: 'NOVA Sites JS-Innov.IA', hosting: 'Railway', repository: 'Julien218/js-innov.ia-cockpit' },
  'jsinnovia.store': { app: 'JS-INNOV.IA', agent_hint: 'NOVA Sites JS-Innov.IA', hosting: 'Railway', repository: 'Julien218/jsinnovia' },
  'assurances-dour.be': { app: 'assurances-dour.be', agent_hint: 'NOVA Site Assurances-Dour.be', hosting: 'Railway', repository: 'Julien218/PV_Agence_de_Dour' },
  'letourdedour.com': { app: 'letourdedour-site', agent_hint: 'NOVA Site Olivier Trévis', hosting: 'Railway', repository: 'Julien218/letourdedour-site' },
  'oliviertrevis.be': { app: 'oliviertrevis-site', agent_hint: 'NOVA Site Olivier Trévis', hosting: 'Railway', repository: 'Julien218/oliviertrevis-site' },
  'synergiedour.be': { app: 'SynergieDour.be', agent_hint: 'NOVA Site Synergie Dour', hosting: 'Railway', repository: 'Julien218/synergie-dour' },
  'missetmisterdour.be': { app: 'Miss DOUR', agent_hint: 'NOVA Site Miss & Mister Dour', hosting: 'Railway', repository: 'Julien218/miss-mister-dour-web' },
  'fashionistartdour.be': { app: "fashionist-art", agent_hint: "NOVA Site Fashionist'art", hosting: 'Railway', repository: 'Julien218/fashionist-art' },
});

function safeDomain(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!Object.prototype.hasOwnProperty.call(MANAGED_DOMAINS, domain)) return null;
  return domain;
}

async function settleDns(domain) {
  const result = { a: [], aaaa: [], cname: [], mx: [], errors: [] };
  const jobs = [
    ['a', () => dns.resolve4(domain)],
    ['aaaa', () => dns.resolve6(domain)],
    ['cname', () => dns.resolveCname(domain)],
    ['mx', () => dns.resolveMx(domain)],
  ];
  await Promise.all(jobs.map(async ([key, fn]) => {
    try { result[key] = await fn(); }
    catch (error) {
      if (!['ENODATA', 'ENOTFOUND', 'ENODOMAIN'].includes(error?.code)) result.errors.push(`${key}:${error?.code || error?.message}`);
    }
  }));
  return result;
}

function tlsCertificate(domain) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const socket = tls.connect({ host: domain, port: 443, servername: domain, rejectUnauthorized: true, timeout: 7000 }, () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert?.valid_to || null;
      const expiresAt = validTo ? new Date(validTo).toISOString() : null;
      const daysRemaining = expiresAt ? Math.floor((Date.parse(expiresAt) - Date.now()) / 86400000) : null;
      finish({ ok: true, authorized: socket.authorized, expires_at: expiresAt, days_remaining: daysRemaining, issuer: cert?.issuer?.O || cert?.issuer?.CN || null });
      socket.end();
    });
    socket.on('timeout', () => { socket.destroy(); finish({ ok: false, error: 'timeout' }); });
    socket.on('error', (error) => finish({ ok: false, error: error.code || error.message }));
  });
}

async function fetchPage(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'JS-Innov.IA-Cockpit-Monitor/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    const contentType = response.headers.get('content-type') || '';
    let html = '';
    if (/text\/html/i.test(contentType)) html = (await response.text()).slice(0, 2_000_000);
    return {
      ok: response.ok,
      status: response.status,
      final_url: response.url,
      response_ms: Date.now() - started,
      headers: {
        content_type: contentType,
        hsts: response.headers.get('strict-transport-security'),
        csp: response.headers.get('content-security-policy'),
        x_content_type_options: response.headers.get('x-content-type-options'),
        cache_control: response.headers.get('cache-control'),
      },
      html,
    };
  } catch (error) {
    return { ok: false, status: 0, final_url: url, response_ms: Date.now() - started, error: error.name === 'TimeoutError' ? 'timeout' : (error.code || error.message), headers: {}, html: '' };
  }
}

function one(html, regex) {
  return String(html || '').match(regex)?.[1]?.trim() || '';
}

function count(html, regex) {
  return (String(html || '').match(regex) || []).length;
}

function auditSeo(html, domain, finalUrl) {
  const title = one(html, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s+/g, ' ');
  const description = one(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    || one(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
  const canonical = one(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i)
    || one(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i);
  const robots = one(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    || one(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']robots["'][^>]*>/i);
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const h1 = count(html, /<h1\b/gi);
  const ogTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
  const ogDescription = /<meta[^>]+property=["']og:description["']/i.test(html);
  const jsonLd = count(html, /<script[^>]+type=["']application\/ld\+json["']/gi);
  const lang = one(html, /<html[^>]+lang=["']([^"']+)["']/i);
  const recommendations = [];
  let score = 100;

  if (!title) { score -= 20; recommendations.push('Ajouter une balise <title> descriptive.'); }
  else if (title.length < 30 || title.length > 65) { score -= 6; recommendations.push(`Ajuster la longueur du title (${title.length} caractères).`); }
  if (!description) { score -= 15; recommendations.push('Ajouter une meta description.'); }
  else if (description.length < 100 || description.length > 170) { score -= 5; recommendations.push(`Ajuster la meta description (${description.length} caractères).`); }
  if (!canonical) { score -= 10; recommendations.push('Ajouter une URL canonique.'); }
  if (h1 !== 1) { score -= 10; recommendations.push(`Prévoir exactement un H1 principal (actuellement ${h1}).`); }
  if (!viewport) { score -= 10; recommendations.push('Ajouter la meta viewport pour le mobile.'); }
  if (!ogTitle || !ogDescription) { score -= 8; recommendations.push('Compléter les métadonnées Open Graph.'); }
  if (!jsonLd) { score -= 7; recommendations.push('Ajouter des données structurées JSON-LD adaptées au site.'); }
  if (!lang) { score -= 5; recommendations.push('Définir la langue du document HTML.'); }
  if (/noindex/i.test(robots)) { score -= 20; recommendations.push('Vérifier la directive noindex : elle empêche l’indexation.'); }
  if (canonical && !canonical.includes(domain)) { score -= 8; recommendations.push('Vérifier que la canonique pointe vers le domaine attendu.'); }
  if (finalUrl && !/^https:\/\//i.test(finalUrl)) { score -= 10; recommendations.push('Forcer HTTPS.'); }

  return {
    score: Math.max(0, score),
    title,
    title_length: title.length,
    description,
    description_length: description.length,
    canonical,
    robots,
    viewport,
    h1_count: h1,
    open_graph: { title: ogTitle, description: ogDescription },
    json_ld_count: jsonLd,
    lang,
    recommendations,
  };
}

async function analyzeDomain(domain) {
  const meta = MANAGED_DOMAINS[domain];
  const [dnsApex, dnsWww, httpsApex, httpsWww, tlsInfo] = await Promise.all([
    settleDns(domain),
    settleDns(`www.${domain}`),
    fetchPage(`https://${domain}/`),
    fetchPage(`https://www.${domain}/`),
    tlsCertificate(domain),
  ]);
  const seo = auditSeo(httpsApex.html, domain, httpsApex.final_url);
  delete httpsApex.html;
  delete httpsWww.html;

  const issues = [];
  if (!httpsApex.ok) issues.push({ severity: 'critical', code: 'apex_http_down', label: `HTTPS apex indisponible (${httpsApex.status || httpsApex.error || 'erreur'}).` });
  if (!dnsApex.a.length && !dnsApex.aaaa.length && !dnsApex.cname.length) issues.push({ severity: 'critical', code: 'apex_dns_missing', label: 'Aucun A/AAAA/CNAME détecté sur le domaine apex.' });
  if (!httpsWww.ok && (dnsWww.a.length || dnsWww.aaaa.length || dnsWww.cname.length)) issues.push({ severity: 'warning', code: 'www_http_down', label: 'www résout mais ne répond pas correctement en HTTPS.' });
  if (!tlsInfo.ok) issues.push({ severity: 'critical', code: 'tls_invalid', label: `TLS invalide ou indisponible (${tlsInfo.error || 'erreur'}).` });
  else if (Number.isFinite(tlsInfo.days_remaining) && tlsInfo.days_remaining < 30) issues.push({ severity: 'warning', code: 'tls_expiring', label: `Certificat TLS expire dans ${tlsInfo.days_remaining} jours.` });
  if (httpsApex.ok && seo.score < 85) issues.push({ severity: seo.score < 60 ? 'critical' : 'warning', code: 'seo_score', label: `SEO technique à améliorer (score ${seo.score}/100).` });
  if (httpsApex.ok && httpsApex.response_ms > 2500) issues.push({ severity: 'warning', code: 'slow_response', label: `Temps de réponse élevé (${httpsApex.response_ms} ms).` });

  return {
    tool: 'cockpit_domain_probe',
    run_id: `domain-${crypto.randomUUID()}`,
    domain,
    app: meta.app,
    agent_hint: meta.agent_hint,
    hosting: meta.hosting || null,
    primary_url: meta.primary_url || `https://${domain}`,
    repository: meta.repository || null,
    checked_at: new Date().toISOString(),
    healthy: issues.every((item) => item.severity !== 'critical'),
    dns: { apex: dnsApex, www: dnsWww },
    http: { apex: httpsApex, www: httpsWww },
    tls: tlsInfo,
    seo,
    issues,
  };
}

function agentForDomain(domain) {
  const meta = MANAGED_DOMAINS[domain];
  return SITE_AGENT_REGISTRY.find((agent) => agent.name === meta?.agent_hint)
    || SITE_AGENT_REGISTRY.find((agent) => (agent.domains || []).includes(domain))
    || null;
}

async function jsAgentRequest(path, options = {}) {
  if (!JS_AGENT_KEY) throw new Error('JSINNOVIA_AGENT_KEY non configurée.');
  const response = await fetch(`${JS_AGENT_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': JS_AGENT_KEY,
      'x-organisation-id': 'jsinnovia',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Agent HTTP ${response.status}`);
  return data;
}

async function createRepairTask(domain, kind, before) {
  const issueText = (before.issues || []).map((item) => `- ${item.label}`).join('\n') || '- Aucun incident critique; optimisation demandée.';
  return jsAgentRequest('/data/Tache', {
    method: 'POST',
    body: JSON.stringify({
      titre: `${kind === 'seo' ? 'SEO automatique' : 'Réparation IA'} — ${domain}`,
      description: [
        `Domaine: ${domain}`,
        `Application: ${before.app}`,
        `Agent métier recommandé: ${before.agent_hint}`,
        `Type: ${kind}`,
        '',
        'Diagnostic avant intervention:',
        issueText,
        '',
        `Score SEO avant: ${before.seo?.score ?? 'n/a'}/100`,
        `HTTP avant: ${before.http?.apex?.status || 0}`,
      ].join('\n').slice(0, 5000),
      statut: 'en_cours',
      priorite: before.issues?.some((item) => item.severity === 'critical') ? 'urgente' : 'haute',
      notes: 'Créée automatiquement par Domaines / Companion après confirmation utilisateur.',
    }),
  });
}

async function patchTask(taskId, payload) {
  if (!taskId) return null;
  return jsAgentRequest(`/data/Tache/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }).catch(() => null);
}

async function recordRun({ task, agent, domain, kind, status, result, error, conversationId }) {
  if (!JS_AGENT_KEY) return null;
  return jsAgentRequest('/agent-runs', {
    method: 'POST',
    body: JSON.stringify({
      task_id: task?.id ? String(task.id) : null,
      agent_id: String(agent?.key || agent?.provider_agent_id || 'domain-agent'),
      functional_role: String(agent?.role || 'domain_ops'),
      provider_agent_id: agent?.provider_agent_id || null,
      provider_name: agent ? 'cockpit-server' : 'unavailable',
      status,
      execution_mode: 'confirmed_write',
      input: { domain, kind },
      result: result ? { summary: String(result).slice(0, 4000), conversation_id: conversationId || null } : null,
      error: error ? String(error).slice(0, 500) : null,
      requested_by: 'cockpit-domaines',
      base44_agent_id: null,
      base44_conv_id: null,
      started_at: new Date().toISOString(),
      completed_at: ['completed', 'failed', 'blocked'].includes(status) ? new Date().toISOString() : null,
    }),
  }).catch(() => null);
}

function verifiedImprovement(kind, before, after) {
  const beforeCritical = (before.issues || []).filter((item) => item.severity === 'critical').length;
  const afterCritical = (after.issues || []).filter((item) => item.severity === 'critical').length;
  if (kind === 'seo') {
    return Boolean(after.http?.apex?.ok) && Number(after.seo?.score || 0) > Number(before.seo?.score || 0);
  }
  if (!before.http?.apex?.ok && after.http?.apex?.ok) return true;
  if (afterCritical < beforeCritical) return true;
  return beforeCritical === 0 && afterCritical === 0 && (after.issues || []).length < (before.issues || []).length;
}

function pendingFor(req, token) {
  const item = pendingDomainActions.get(String(token || ''));
  if (!item) return { error: 'Confirmation de domaine absente ou déjà consommée.', status: 400 };
  if (item.expiresAt < Date.now()) {
    pendingDomainActions.delete(String(token));
    return { error: 'Confirmation expirée. Relance la préparation.', status: 410 };
  }
  if (item.userId !== req.user?.id) return { error: 'Cette confirmation appartient à une autre session.', status: 403 };
  return { item };
}

router.get('/domains', (_req, res) => {
  res.json(Object.entries(MANAGED_DOMAINS).map(([domain, meta]) => ({ domain, ...meta })));
});

router.get('/ionos/status', (_req, res) => {
  res.json({
    provider: 'IONOS DNS',
    configured: ionosDns.isConfigured(),
    server_side_only: true,
    writable_types: [...ionosDns.WRITABLE_TYPES],
    managed_domains: Object.keys(MANAGED_DOMAINS),
  });
});

// Lecture IONOS limitée aux domaines déclarés dans l'inventaire Cockpit.
router.post('/ionos/records', async (req, res) => {
  const domain = safeDomain(req.body?.domain);
  if (!domain) return res.status(400).json({ error: 'Domaine non géré par le Cockpit.' });
  try {
    const result = await ionosDns.listRecords(domain);
    res.json({ domain, records: result.records.map((record) => ({
      id: record.id,
      name: record.name,
      type: record.type,
      content: record.content,
      ttl: record.ttl,
      disabled: Boolean(record.disabled),
    })) });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// Prépare un plan DNS exact, sans effet réel. Le jeton expire et appartient à la session admin.
router.post('/ionos/prepare-change', async (req, res) => {
  try {
    const prepared = await ionosDns.prepareChangeSet(req.body?.domain, req.body?.changes, MANAGED_DOMAINS);
    const token = crypto.randomBytes(24).toString('hex');
    pendingDnsActions.set(token, {
      userId: req.user?.id,
      prepared,
      expiresAt: Date.now() + 5 * 60_000,
    });
    res.json({
      confirmation: {
        token,
        expires_in: 300,
        summary: `${prepared.plan.length} changement(s) DNS IONOS pour ${prepared.domain}`,
      },
      domain: prepared.domain,
      plan: prepared.plan.map(({ action, before, after }) => ({ action, before, after })),
    });
  } catch (error) {
    res.status(/non configurée/i.test(error.message) ? 503 : 400).json({ error: error.message });
  }
});

// Consomme la confirmation avant l'écriture, puis relit IONOS pour vérifier le résultat.
router.post('/ionos/apply-change', async (req, res) => {
  const token = String(req.body?.token || '');
  const item = pendingDnsActions.get(token);
  if (!item) return res.status(400).json({ error: 'Confirmation DNS absente ou déjà consommée.' });
  if (item.expiresAt < Date.now()) {
    pendingDnsActions.delete(token);
    return res.status(410).json({ error: 'Confirmation DNS expirée. Relance la préparation.' });
  }
  if (item.userId !== req.user?.id) return res.status(403).json({ error: 'Cette confirmation DNS appartient à une autre session.' });
  pendingDnsActions.delete(token);
  try {
    const result = await ionosDns.applyPreparedChangeSet(item.prepared);
    res.status(result.verified ? 200 : 502).json(result);
  } catch (error) {
    res.status(502).json({ success: false, verified: false, domain: item.prepared.domain, error: error.message });
  }
});

router.post('/analyze', async (req, res) => {
  const domain = safeDomain(req.body?.domain);
  if (!domain) return res.status(400).json({ error: 'Domaine non géré par le Cockpit.' });
  try { res.json(await analyzeDomain(domain)); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/seo', async (req, res) => {
  const domain = safeDomain(req.body?.domain);
  if (!domain) return res.status(400).json({ error: 'Domaine non géré par le Cockpit.' });
  try {
    const result = await analyzeDomain(domain);
    res.json({ domain, checked_at: result.checked_at, http: result.http.apex, seo: result.seo, agent_hint: result.agent_hint });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Prépare l'intervention et émet un jeton à usage unique. Aucun effet réel ici.
router.post('/prepare-repair', async (req, res) => {
  const domain = safeDomain(req.body?.domain);
  const kind = req.body?.kind === 'seo' ? 'seo' : 'repair';
  if (!domain) return res.status(400).json({ error: 'Domaine non géré par le Cockpit.' });
  try {
    const before = await analyzeDomain(domain);
    const agent = agentForDomain(domain);
    const token = crypto.randomBytes(24).toString('hex');
    pendingDomainActions.set(token, {
      userId: req.user?.id,
      domain,
      kind,
      before,
      agentName: agent?.name || null,
      expiresAt: Date.now() + 5 * 60_000,
    });
    res.json({
      confirmation: {
        token,
        expires_in: 300,
        summary: `${kind === 'seo' ? 'SEO automatique' : 'Réparation IA'} de ${domain} via ${agent?.name || 'agent non disponible'}`,
      },
      domain,
      kind,
      before,
      agent: agent ? { name: agent.name, role: agent.role, provider_agent_id: agent.provider_agent_id } : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Effet réel : exige le jeton préparé et le consomme avant exécution pour empêcher tout double-run.
router.post('/repair', async (req, res) => {
  const token = String(req.body?.token || '');
  const resolved = pendingFor(req, token);
  if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
  pendingDomainActions.delete(token);

  const { domain, kind, before } = resolved.item;
  let task = null;
  let agent = null;
  try {
    task = await createRepairTask(domain, kind, before);
    agent = agentForDomain(domain);

    if (!agent) {
      await patchTask(task?.id, { statut: 'bloquee', notes: 'Aucun agent métier compatible associé au domaine.' });
      await recordRun({ task, agent, domain, kind, status: 'blocked', error: 'agent_missing' });
      return res.status(409).json({ success: false, verified: false, domain, task, before, error: 'Aucun agent métier compatible associé au domaine.' });
    }

    const repository = MANAGED_DOMAINS[domain]?.repository || null;
    const result = { domain, kind, repository, hosting: MANAGED_DOMAINS[domain]?.hosting || null, before, queued_at: new Date().toISOString() };
    await patchTask(task?.id, { statut: 'en_cours', notes: `Prise en charge interne par NOVA Site Ops${repository ? ` sur ${repository}` : ''}. Base44 n’est pas utilisé.` });
    await recordRun({
      task,
      agent,
      domain,
      kind,
      status: 'pending',
      result: JSON.stringify(result),
      error: repository ? null : 'repository_missing',
    });
    return res.status(202).json({
      success: true,
      verified: false,
      status: 'queued_internal',
      domain,
      kind,
      task,
      agent: { name: agent.name, role: agent.role, provider_agent_id: agent.provider_agent_id },
      execution: result,
      before,
    });
  } catch (error) {
    if (task?.id) await patchTask(task.id, { statut: 'bloquee', notes: `Réparation automatique bloquée: ${String(error.message || error).slice(0, 400)}` });
    await recordRun({ task, agent, domain, kind, status: 'failed', error: error.message });
    res.status(500).json({ success: false, verified: false, domain, task, error: error.message });
  }
});

module.exports = router;
module.exports.analyzeDomain = analyzeDomain;
module.exports.safeDomain = safeDomain;
module.exports.MANAGED_DOMAINS = MANAGED_DOMAINS;
module.exports.verifiedImprovement = verifiedImprovement;
module.exports.agentForDomain = agentForDomain;
