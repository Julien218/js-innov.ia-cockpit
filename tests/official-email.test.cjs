/**
 * Tests for POST /api/emails/official
 * Uses Node's built-in test runner (node:test)
 *
 * Strategy:
 * - Monkey-patch nodemailer.createTransport to return a mock transport
 * - Zéro accès réseau externe et zéro connexion SMTP/IMAP réelle ;
 *   HTTP local uniquement pour les tests.
 * - SMTP call counter to verify idempotence
 * - Controllable SMTP promise for concurrent request tests
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

// ── Test environment ──
const TEST_PROXY_KEY = 'test-proxy-key-2026';
const TEST_AGENT_KEY = 'test-agent-key-2026';
process.env.EMAIL_PROXY_KEY = TEST_PROXY_KEY;
process.env.AGENT_API_KEY = TEST_AGENT_KEY;
process.env.EMAIL_STORE_ADDRESS = 'info@jsinnovia.store';
process.env.EMAIL_PASSWORD_STORE = 'test-password-store';

// ── Mock Nodemailer ──
const nodemailer = require('nodemailer');

let smtpCallCount = 0;
let lastMailOptions = null;
let smtpShouldFail = false;
let smtpFailError = null;
let smtpBlockPromise = null;

function resetMockState() {
  smtpCallCount = 0;
  lastMailOptions = null;
  smtpShouldFail = false;
  smtpFailError = null;
  smtpBlockPromise = null;
}

nodemailer.createTransport = function(config) {
  return {
    sendMail(options) {
      smtpCallCount++;
      lastMailOptions = options;
      if (smtpShouldFail) {
        const err = smtpFailError || new Error('Invalid login: 535 Authentication credentials invalid');
        err.code = err.code || 'EAUTH';
        return Promise.reject(err);
      }
      if (smtpBlockPromise) {
        return smtpBlockPromise.then(() => ({
          messageId: 'mock-message-id-123',
          response: '250 OK',
          envelope: { from: 'info@jsinnovia.store', to: 'test@example.com' },
        }));
      }
      return Promise.resolve({
        messageId: 'mock-message-id-123',
        response: '250 OK',
        envelope: { from: 'info@jsinnovia.store', to: 'test@example.com' },
      });
    },
  };
};

// ── Server helpers ──
let server;

function createMockApp() {
  delete require.cache[require.resolve('../server-email.cjs')];
  const app = express();
  app.use(express.json({ limit: '1mb', strict: false }));
  const emailRouter = require('../server-email.cjs');
  app.use('/api/emails', emailRouter);
  return app;
}

async function startServer() {
  return new Promise((resolve, reject) => {
    const app = createMockApp();
    server = http.createServer(app);
    server.listen(0, (err) => { if (err) reject(err); resolve(); });
  });
}

async function stopServer() {
  return new Promise((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
}

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://localhost:${server.address().port}`);
    const req = http.request(url, {
      method: options.method || 'POST',
      headers: options.headers || { 'Content-Type': 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    if (options.rawBody !== undefined) {
      req.write(options.rawBody);
    } else if (options.body !== undefined) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

function validHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'x-agent-key': TEST_PROXY_KEY,
    'idempotency-key': 'test-key-' + Math.random().toString(36).slice(2, 12),
    ...extra,
  };
}

function validBody(extra = {}) {
  return {
    to: 'destinataire@example.com',
    subject: 'Test officiel',
    text: 'Version texte',
    ...extra,
  };
}

// ============================================================
describe('POST /api/emails/official — Secret séparé (EMAIL_PROXY_KEY)', () => {
  beforeEach(async () => { resetMockState(); await startServer(); });
  afterEach(async () => { await stopServer(); });

  test('1. clé absente → 401', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'idempotency-key': 'test-key-001' },
      body: validBody(),
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'Unauthorized');
  });

  test('2. clé invalide → 401', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'x-agent-key': 'wrong-key', 'idempotency-key': 'test-key-002' },
      body: validBody(),
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'Unauthorized');
  });

  test('3. clé dans query string → 401', async () => {
    const res = await makeRequest('/api/emails/official?key=' + TEST_PROXY_KEY, {
      headers: { 'Content-Type': 'application/json', 'idempotency-key': 'test-key-003' },
      body: validBody(),
    });
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes('query string'));
  });

  test('4. EMAIL_PROXY_KEY serveur absente → 503', async () => {
    const savedProxy = process.env.EMAIL_PROXY_KEY;
    delete process.env.EMAIL_PROXY_KEY;
    const res = await makeRequest('/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'x-agent-key': 'any-key', 'idempotency-key': 'test-key-004' },
      body: validBody(),
    });
    assert.strictEqual(res.status, 503);
    assert.ok(res.body.error.includes('EMAIL_PROXY_KEY'));
    process.env.EMAIL_PROXY_KEY = savedProxy;
  });

  test('5. AGENT_API_KEY correcte mais EMAIL_PROXY_KEY différente → 401', async () => {
    // AGENT_API_KEY is TEST_AGENT_KEY, EMAIL_PROXY_KEY is TEST_PROXY_KEY
    // Sending AGENT_API_KEY in header should fail because official route checks EMAIL_PROXY_KEY
    const res = await makeRequest('/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'x-agent-key': TEST_AGENT_KEY, 'idempotency-key': 'test-key-005' },
      body: validBody(),
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'Unauthorized');
  });

  test('6. EMAIL_PROXY_KEY correcte → 200 avec SMTP mocké', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders({ 'idempotency-key': 'test-key-006' }),
      body: validBody(),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.status, 'sent');
    assert.strictEqual(res.body.messageId, 'mock-message-id-123');
    assert.strictEqual(smtpCallCount, 1);
  });
});

// ============================================================
describe('POST /api/emails/official — Validation req.body', () => {
  beforeEach(async () => { resetMockState(); await startServer(); });
  afterEach(async () => { await stopServer(); });

  test('7. aucun corps → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'x-agent-key': TEST_PROXY_KEY, 'idempotency-key': 'test-key-007' },
      rawBody: '',
    });
    assert.strictEqual(res.status, 400);
  });

  test('8. corps null → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'x-agent-key': TEST_PROXY_KEY, 'idempotency-key': 'test-key-008' },
      rawBody: 'null',
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('body'));
  });

  test('9. corps tableau → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'x-agent-key': TEST_PROXY_KEY, 'idempotency-key': 'test-key-009' },
      rawBody: '[1, 2, 3]',
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('body'));
  });
});

// ============================================================
describe('POST /api/emails/official — Idempotency-Key obligatoire', () => {
  beforeEach(async () => { resetMockState(); await startServer(); });
  afterEach(async () => { await stopServer(); });

  test('10. Idempotency-Key absent → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'x-agent-key': TEST_PROXY_KEY },
      body: validBody(),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Idempotency-Key'));
  });

  test('11. Idempotency-Key format invalide → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'x-agent-key': TEST_PROXY_KEY, 'idempotency-key': 'short' },
      body: validBody(),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('8-128'));
  });
});

// ============================================================
describe('POST /api/emails/official — Refus from et mailbox par présence', () => {
  beforeEach(async () => { resetMockState(); await startServer(); });
  afterEach(async () => { await stopServer(); });

  test('12. from="" (chaîne vide) → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(),
      body: validBody({ from: '' }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('from'));
  });

  test('13. from=null → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(),
      body: validBody({ from: null }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('from'));
  });

  test('14. from=false → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(),
      body: validBody({ from: false }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('from'));
  });

  test('15. mailbox="" (chaîne vide) → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(),
      body: validBody({ mailbox: '' }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('mailbox'));
  });

  test('16. mailbox=null → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(),
      body: validBody({ mailbox: null }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('mailbox'));
  });

  test('17. mailbox=false → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(),
      body: validBody({ mailbox: false }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('mailbox'));
  });
});

// ============================================================
describe('POST /api/emails/official — Validation du payload', () => {
  beforeEach(async () => { resetMockState(); await startServer(); });
  afterEach(async () => { await stopServer(); });

  test('18. sans subject → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('subject'));
  });

  test('19. sans to → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { subject: 'Test', text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('to'));
  });

  test('20. sans text ni html → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', subject: 'Test' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('text') || res.body.error.includes('html'));
  });

  test('21. subject trim vide → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', subject: '   ', text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('empty'));
  });

  test('22. text non-string → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', subject: 'Test', text: 123 },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('text'));
  });

  test('23. html non-string → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', subject: 'Test', html: ['<p>'] },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('html'));
  });

  test('24. email invalide dans to → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'not-an-email', subject: 'Test', text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Invalid'));
  });

  test('25. trop de destinataires → 400', async () => {
    const toList = Array(22).fill('test@example.com');
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: toList, subject: 'Test', text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('recipients'));
  });

  test('26. subject trop long → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', subject: 'A'.repeat(250), text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Subject'));
  });

  test('27. text trop grand → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', subject: 'Test', text: 'X'.repeat(600_000) },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('size'));
  });

  test('28. metadata non-object → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody({ metadata: 'invalid' }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('metadata'));
  });

  test('29. replyTo invalide → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody({ replyTo: 'not-an-email' }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('replyTo'));
  });
});

// ============================================================
describe('POST /api/emails/official — Envoi SMTP mocké', () => {
  beforeEach(async () => { resetMockState(); await startServer(); });
  afterEach(async () => { await stopServer(); });

  test('30. succès SMTP mocké → 200', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody(),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.status, 'sent');
  });

  test('31. messageId mocké correctement retourné', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody(),
    });
    assert.strictEqual(res.body.messageId, 'mock-message-id-123');
  });

  test('32. identité réellement forcée à JS-Innov.IA (from contient info@jsinnovia.com)', async () => {
    await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody(),
    });
    assert.ok(lastMailOptions, 'sendMail should have been called');
    assert.ok(lastMailOptions.from.includes('info@jsinnovia.com'),
      `Expected from to contain info@jsinnovia.com, got: ${lastMailOptions.from}`);
    assert.ok((lastMailOptions.html || '').includes('data-jsinnovia-signature="js-innov-ia"') || (lastMailOptions.text || '').includes('JS-Innov.IA'));
  });

  test('33. replyTo transmis à Nodemailer', async () => {
    await makeRequest('/api/emails/official', {
      headers: validHeaders(),
      body: validBody({ replyTo: 'reply@jsinnovia.com' }),
    });
    assert.ok(lastMailOptions, 'sendMail should have been called');
    assert.strictEqual(lastMailOptions.replyTo, 'reply@jsinnovia.com');
  });

  test('34. erreur SMTP mockée → 502 (pas 500)', async () => {
    smtpShouldFail = true;
    smtpFailError = new Error('Connection refused');
    smtpFailError.code = 'ECONNECTION';
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody(),
    });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error, 'SMTP delivery failed');
    assert.strictEqual(res.body.messageId, null);
    assert.strictEqual(res.body.status, 'failed');
    assert.notStrictEqual(res.status, 500);
  });
});

// ============================================================
describe('POST /api/emails/official — Idempotence réelle', () => {
  beforeEach(async () => { resetMockState(); await startServer(); });
  afterEach(async () => { await stopServer(); });

  test('35. premier succès avec Idempotency-Key → un appel SMTP', async () => {
    const idemKey = 'idem-success-001';
    const res = await makeRequest('/api/emails/official', {
      headers: { ...validHeaders(), 'idempotency-key': idemKey },
      body: validBody(),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(smtpCallCount, 1);
  });

  test('36. deuxième requête identique → réponse mise en cache (200)', async () => {
    const idemKey = 'idem-replay-001';
    const headers = { ...validHeaders(), 'idempotency-key': idemKey };
    const body = validBody();
    const res1 = await makeRequest('/api/emails/official', { headers, body });
    assert.strictEqual(res1.status, 200);
    const res2 = await makeRequest('/api/emails/official', { headers, body });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.messageId, 'mock-message-id-123');
  });

  test('37. compteur SMTP toujours égal à 1 après replay', async () => {
    const idemKey = 'idem-counter-001';
    const headers = { ...validHeaders(), 'idempotency-key': idemKey };
    const body = validBody();
    await makeRequest('/api/emails/official', { headers, body });
    await makeRequest('/api/emails/official', { headers, body });
    await makeRequest('/api/emails/official', { headers, body });
    assert.strictEqual(smtpCallCount, 1);
  });

  test('38. même clé avec payload différent → 409', async () => {
    const idemKey = 'idem-conflict-001';
    const headers = { ...validHeaders(), 'idempotency-key': idemKey };
    const res1 = await makeRequest('/api/emails/official', {
      headers, body: validBody({ subject: 'Subject A' }),
    });
    assert.strictEqual(res1.status, 200);
    const res2 = await makeRequest('/api/emails/official', {
      headers, body: validBody({ subject: 'Subject B' }),
    });
    assert.strictEqual(res2.status, 409);
    assert.ok(res2.body.error.includes('different payload'));
  });

  test('39. deux requêtes concurrentes avec la même clé → un seul envoi', async () => {
    const idemKey = 'idem-concurrent-001';
    const headers = { ...validHeaders(), 'idempotency-key': idemKey };
    const body = validBody();
    let smtpResolve;
    smtpBlockPromise = new Promise(r => { smtpResolve = r; });
    const req1Promise = makeRequest('/api/emails/official', { headers, body });
    await new Promise(r => setTimeout(r, 50));
    const req2Promise = makeRequest('/api/emails/official', { headers, body });
    const res2 = await req2Promise;
    assert.strictEqual(res2.status, 409);
    assert.ok(res2.body.error.includes('Concurrent'));
    smtpResolve();
    const res1 = await req1Promise;
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(smtpCallCount, 1);
  });
});

// ============================================================
describe('POST /api/emails/official — Rate limit', () => {
  beforeEach(async () => { resetMockState(); await startServer(); });
  afterEach(async () => { await stopServer(); });

  test('40. rate limit dépasse → 429', async () => {
    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await makeRequest('/api/emails/official', {
        headers: validHeaders(),
        body: validBody({ subject: `Test rate ${i}` }),
      });
      if (res.status === 429) {
        got429 = true;
        assert.ok(res.body.error.includes('Rate limit'));
        break;
      }
    }
    assert.ok(got429, 'Should have been rate limited after 10 requests');
  });
});
