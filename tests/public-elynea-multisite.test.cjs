const test = require('node:test');
const assert = require('node:assert/strict');

const { requireSameOrigin, elyneaPublicOrigins } = require('../server-security.cjs');
const { findSkill } = require('../server-agent-registry.cjs');

function runOriginGuard({ method = 'POST', url = '/api/public/elynea/chat', origin }) {
  let nextCalls = 0;
  let statusCode = 200;
  let jsonBody = null;
  let ended = false;
  const headers = {};
  const req = {
    method,
    originalUrl: url,
    url,
    headers: origin ? { origin } : {},
  };
  const res = {
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    status(code) { statusCode = code; return this; },
    json(body) { jsonBody = body; ended = true; return this; },
    end() { ended = true; return this; },
  };
  requireSameOrigin(req, res, () => { nextCalls += 1; });
  return { nextCalls, statusCode, jsonBody, headers, ended };
}

test('Elynea publique accepte uniquement les sites JS-Innov.IA prévus', () => {
  const expected = [
    'https://missetmisterdour.be',
    'https://miss-mister-dour-web-production.up.railway.app',
    'https://fashionistartdour.be',
    'https://signelya.jsinnovia.com',
    'https://app.signelya.jsinnovia.com',
    'https://signage.jsinnovia.com',
  ];
  const origins = elyneaPublicOrigins();
  for (const origin of expected) assert.equal(origins.has(origin), true, `${origin} doit être autorisée`);
  assert.equal(origins.has('https://example.org'), false);
  assert.equal(origins.has('*'), false);
});

test('le chat public Elynea renvoie les bons en-têtes CORS pour FashionistART', () => {
  const result = runOriginGuard({ origin: 'https://fashionistartdour.be' });
  assert.equal(result.nextCalls, 1);
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['access-control-allow-origin'], 'https://fashionistartdour.be');
  assert.match(result.headers['access-control-allow-methods'], /POST/);
  assert.match(result.headers['access-control-allow-headers'], /Content-Type/);
  assert.match(result.headers['access-control-allow-headers'], /X-Elynea-Site-Key/);
});

test('le preflight du chat public Miss & Mister Dour est traité avant le routeur', () => {
  const result = runOriginGuard({
    method: 'OPTIONS',
    origin: 'https://miss-mister-dour-web-production.up.railway.app',
  });
  assert.equal(result.nextCalls, 0);
  assert.equal(result.statusCode, 204);
  assert.equal(result.ended, true);
  assert.equal(result.headers['access-control-allow-origin'], 'https://miss-mister-dour-web-production.up.railway.app');
});

test('une origine inconnue reste refusée et les autres mutations restent same-origin', () => {
  const publicRejected = runOriginGuard({ origin: 'https://evil.example' });
  assert.equal(publicRejected.nextCalls, 0);
  assert.equal(publicRejected.statusCode, 403);
  assert.match(publicRejected.jsonBody.error, /Elynea/);

  const authRejected = runOriginGuard({
    url: '/api/auth/login',
    origin: 'https://fashionistartdour.be',
  });
  assert.equal(authRejected.nextCalls, 0);
  assert.equal(authRejected.statusCode, 403);
  assert.match(authRejected.jsonBody.error, /Origine non autorisée/);
});

test('Miss & Mister Dour, FashionistART et Signelya sont des compétences actives d’Elynea', () => {
  for (const key of ['miss-mister-dour', 'fashionistart', 'signelya', 'signage', 'selynea']) {
    const skill = findSkill(key);
    assert.ok(skill, `${key} doit résoudre une compétence`);
    assert.equal(skill.status, 'active');
  }
  assert.equal(findSkill('signage').key, 'signelya');
});
