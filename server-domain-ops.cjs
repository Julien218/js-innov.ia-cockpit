const express = require('express');
const dns = require('node:dns').promises;
const tls = require('node:tls');

const router = express.Router();

const MANAGED_DOMAINS = Object.freeze({
  'jsinnovia.com': { app: 'JS-INNOV.IA', agent_hint: 'JsInnov-Agent' },
  'cockpit.jsinnovia.com': { app: 'cockpit-v3', agent_hint: 'JsInnov-Agent' },
  'jsinnovia.store': { app: 'JS-INNOV.IA', agent_hint: 'JsInnov-Agent' },
  'assurances-dour.be': { app: 'assurances-dour.be', agent_hint: 'JsInnov-Agent' },
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

module.exports = router;
module.exports.analyzeDomain = analyzeDomain;
module.exports.safeDomain = safeDomain;
module.exports.MANAGED_DOMAINS = MANAGED_DOMAINS;
