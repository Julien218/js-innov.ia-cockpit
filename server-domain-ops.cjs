const express = require('express');
const dns = require('node:dns').promises;
const tls = require('node:tls');
const crypto = require('node:crypto');
const { SITE_AGENT_REGISTRY } = require('./server-agent-orchestrator.cjs');

const router = express.Router();
const JS_AGENT_URL = String(process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app').replace(/\/$/, '');
const JS_AGENT_KEY = String(process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '').trim();
const BASE44_API_KEY = String(process.env.BASE44_API_KEY || process.env.BASE44_SERVER_API_KEY || '').trim();
const BASE44_AGENT_URL = String(process.env.BASE44_AGENT_URL || 'https://app.base44.com/api/agents').replace(/\/$/, '');
const pendingDomainActions = new Map();

const MANAGED_DOMAINS = Object.freeze({
  'jsinnovia.com': { app: 'JS-INNOV.IA', agent_hint: 'JsInnov-Agent' },
  'cockpit.jsinnovia.com': { app: 'cockpit-v3', agent_hint: 'JsInnov-Agent' },
  'jsinnovia.store': { app: 'JS-INNOV.IA', agent_hint: 'JsInnov-Agent' },
  'assurances-dour.be': { app: 'assurances-dour.be', agent_hint: 'Agent Assurances-Dour.be' },
  'letourdedour.com': { app: 'Multi site', agent_hint: 'Site Olivier landing Page' },
  'oliviertrevis.be': { app: 'Multi site', agent_hint: 'Site Olivier landing Page' },
  'synergiedour.be': { app: 'SynergieDour.be', agent_hint: 'Synergie Dour Assistant' },
  'missetmisterdour.be': { app: 'Miss DOUR', agent_hint: 'Agent Miss & Mister Dour' },
  'fashionistartdour.be': { app: "Fashionist'ART", agent_hint: 'Agent Fashionistart' },
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

function base44ErrorMessage(payload, status, operation = 'agent') {
  const detail = payload?.error ?? payload?.message ?? payload?.detail ?? payload?.details;
  let text = '';
  if (typeof detail === 'string') text = detail;
  else if (detail && typeof detail === 'object') {
    try { text = JSON.stringify(detail); }
    catch { text = String(detail); }
  }
  text = text.replace(/\s+/g, ' ').trim().slice(0, 800);
  return `Base44 ${operation} HTTP ${status}${text ? `: ${text}` : ''}`;
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
      provider_name: agent ? 'base44' : 'unavailable',
      status,
      execution_mode: 'confirmed_write',
      input: { domain, kind },
      result: result ? { summary: String(result).slice(0, 4000), conversation_id: conversationId || null } : null,
      error: error ? String(error).slice(0, 500) : null,
      requested_by: 'cockpit-domaines',
      base44_agent_id: agent?.provider_agent_id || null,
      base44_conv_id: conversationId || null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }),
  }).catch(() => null);
}

async function executeBase44Agent(agent, domain, kind, before) {
  if (!agent?.provider_agent_id) throw new Error('Aucun agent Base44 métier associé à ce domaine.');
  if (!BASE44_API_KEY) throw new Error('BASE44_API_KEY serveur non configurée.');
  const headers = { api_key: BASE44_API_KEY, 'Content-Type': 'application/json' };
  const convResponse = await fetch(`${BASE44_AGENT_URL}/${encodeURIComponent(agent.provider_agent_id)}/conversations`, {
    method: 'POST', headers, body: JSON.stringify({}), signal: AbortSignal.timeout(15000),
  });
  const conv = await convResponse.json().catch(() => ({}));
  if (!convResponse.ok || !conv?.id) throw new Error(base44ErrorMessage(conv, convResponse.status, 'conversation'));

  const issues = (before.issues || []).map((item) => `- ${item.code}: ${item.label}`).join('\n') || '- optimisation proactive';
  const seo = (before.seo?.recommendations || []).map((item) => `- ${item}`).join('\n') || '- aucune recommandation SEO';
  const prompt = [
    `Tu es l’agent métier responsable du site ${domain}.`,
    'Cette intervention a reçu la confirmation explicite de l’administrateur JS-Innov.IA.',
    `Mission: ${kind === 'seo' ? 'appliquer les corrections SEO techniques sûres et vérifiables' : 'corriger les incidents techniques du site que tes outils permettent réellement de modifier'}.`,
    'Ne modifie aucun autre site, domaine, client ou projet.',
    'Ne supprime aucune donnée métier. Ne change pas de facturation.',
    'Si une correction nécessite DNS/registrar ou un accès que tu ne possèdes pas, ne simule pas la réussite: indique précisément le blocage.',
    '',
    'Incidents mesurés avant intervention:',
    issues,
    '',
    'SEO mesuré avant intervention:',
    seo,
    '',
    'Applique uniquement les corrections que tu peux réellement exécuter, puis retourne un compte rendu précis des changements effectués et des blocages restants.',
  ].join('\n').slice(0, 7000);

  const answerResponse = await fetch(`${BASE44_AGENT_URL}/${encodeURIComponent(agent.provider_agent_id)}/conversations/${encodeURIComponent(conv.id)}/messages`, {
    method: 'POST', headers, body: JSON.stringify({ role: 'user', content: prompt }), signal: AbortSignal.timeout(120000),
  });
  const answer = await answerResponse.json().catch(() => ({}));
  if (!answerResponse.ok) throw new Error(base44ErrorMessage(answer, answerResponse.status, 'agent'));
  return { conversationId: conv.id, content: String(answer?.content || answer?.response || answer?.message || '').trim() };
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
  let execution = null;
  try {
    task = await createRepairTask(domain, kind, before);
    agent = agentForDomain(domain);

    if (!agent) {
      await patchTask(task?.id, { statut: 'bloquee', notes: 'Aucun agent métier compatible associé au domaine.' });
      await recordRun({ task, agent, domain, kind, status: 'blocked', error: 'agent_missing' });
      return res.status(409).json({ success: false, verified: false, domain, task, before, error: 'Aucun agent métier compatible associé au domaine.' });
    }

    execution = await executeBase44Agent(agent, domain, kind, before);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const after = await analyzeDomain(domain);
    const verified = verifiedImprovement(kind, before, after);

    await patchTask(task?.id, {
      statut: verified ? 'terminee' : 'bloquee',
      notes: verified
        ? `Correction vérifiée automatiquement. Agent: ${agent.name}.`
        : `Intervention agent reçue mais aucune amélioration mesurable. Vérification manuelle/provider requise. Agent: ${agent.name}.`,
    });
    await recordRun({
      task,
      agent,
      domain,
      kind,
      status: verified ? 'completed' : 'blocked',
      result: execution.content,
      conversationId: execution.conversationId,
      error: verified ? null : 'no_verified_improvement',
    });

    return res.status(verified ? 200 : 409).json({
      success: verified,
      verified,
      domain,
      kind,
      task,
      agent: { name: agent.name, role: agent.role, provider_agent_id: agent.provider_agent_id },
      execution: { summary: execution.content.slice(0, 5000), conversation_id: execution.conversationId },
      before,
      after,
    });
  } catch (error) {
    if (task?.id) await patchTask(task.id, { statut: 'bloquee', notes: `Réparation automatique bloquée: ${String(error.message || error).slice(0, 400)}` });
    await recordRun({ task, agent, domain, kind, status: 'failed', error: error.message, result: execution?.content, conversationId: execution?.conversationId });
    res.status(500).json({ success: false, verified: false, domain, task, error: error.message });
  }
});

module.exports = router;
module.exports.analyzeDomain = analyzeDomain;
module.exports.safeDomain = safeDomain;
module.exports.MANAGED_DOMAINS = MANAGED_DOMAINS;
module.exports.verifiedImprovement = verifiedImprovement;
module.exports.agentForDomain = agentForDomain;
module.exports.executeBase44Agent = executeBase44Agent;
module.exports.base44ErrorMessage = base44ErrorMessage;
