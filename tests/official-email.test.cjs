/**
 * Tests for POST /api/emails/official
 * Uses Node's built-in test runner (node:test)
 *
 * Strategy:
 * - Monkey-patch nodemailer.createTransport to return a mock transport
 * - No real SMTP connection, no network access
 * - SMTP call counter to verify idempotence
 * - Controllable SMTP promise for concurrent request tests
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

// ── Test environment ──
const TEST_API_KEY = 'test-official-key-1234567890';
process.env.AGENT_API_KEY = TEST_API_KEY;
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

// Replace createTransport with a mock that returns a controllable transport
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
  app.use(express.json({ limit: '1mb' }));
  const emailRouter = require('../server-email.cjs');
  app.use('/api/emails', emailRouter);
  return app;
}

async function startServer() {
  return new Promise((resolve, reject) => {
    const app = createMockApp();
    server = http.createServer(app);
    server.listen(0, (err) => {
      if (err) reject(err);
      resolve();
    });
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
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function validHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'x-agent-key': TEST_API_KEY,
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
describe('POST /api/emails/official — Authentification', () => {
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
    const res = await makeRequest('/api/emails/official?key=' + TEST_API_KEY, {
      headers: { 'Content-Type': 'application/json', 'idempotency-key': 'test-key-003' },
      body: validBody(),
    });
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes('query string'));
  });

  test('4. AGENT_API_KEY serveur absente → 503', async () => {
    const savedKey = process.env.AGENT_API_KEY;
    delete process.env.AGENT_API_KEY;
    const res = await makeRequest('/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'x-agent-key': 'any-key', 'idempotency-key': 'test-key-004' },
      body: validBody(),
    });
    assert.strictEqual(res.status, 503);
    assert.ok(res.body.error.includes('AGENT_API_KEY'));
    process.env.AGENT_API_KEY = savedKey;
  });
});

// ============================================================
describe('POST /api/emails/official — Idempotency-Key obligatoire', () => {
  beforeEach(async () => { resetMockState(); await startServer(); });
  afterEach(async () => { await stopServer(); });

  test('5. Idempotency-Key absent → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'x-agent-key': TEST_API_KEY },
      body: validBody(),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Idempotency-Key'));
  });

  test('6. Idempotency-Key format invalide → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'x-agent-key': TEST_API_KEY, 'idempotency-key': 'short' },
      body: validBody(),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('8-128'));
  });
});

// ============================================================
describe('POST /api/emails/official — Validation du payload', () => {
  beforeEach(async () => { resetMockState(); await startServer(); });
  afterEach(async () => { await stopServer(); });

  test('7. sans subject → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('subject'));
  });

  test('8. sans to → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { subject: 'Test', text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('to'));
  });

  test('9. sans text ni html → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', subject: 'Test' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('text') || res.body.error.includes('html'));
  });

  test('10. subject trim vide → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', subject: '   ', text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('empty'));
  });

  test('11. text non-string → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', subject: 'Test', text: 123 },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('text'));
  });

  test('12. html non-string → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', subject: 'Test', html: ['<p>'] },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('html'));
  });

  test('13. from fourni → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody({ from: 'hacker@evil.com' }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('from'));
  });

  test('14. mailbox fournie → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody({ mailbox: 'jsinnovia' }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('mailbox'));
  });

  test('15. email invalide dans to → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'not-an-email', subject: 'Test', text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Invalid'));
  });

  test('16. trop de destinataires → 400', async () => {
    const toList = Array(22).fill('test@example.com');
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: toList, subject: 'Test', text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('recipients'));
  });

  test('17. subject trop long → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', subject: 'A'.repeat(250), text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Subject'));
  });

  test('18. text trop grand → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: { to: 'test@example.com', subject: 'Test', text: 'X'.repeat(600_000) },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('size'));
  });

  test('19. metadata non-object → 400', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody({ metadata: 'invalid' }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('metadata'));
  });

  test('20. metadata trop de champs → 400', async () => {
    const meta = {};
    for (let i = 0; i < 7; i++) meta['field' + i] = 'val';
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody({ metadata: meta }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('metadata'));
  });

  test('21. replyTo invalide → 400', async () => {
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

  test('22. succès SMTP mocké → 200', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody(),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.status, 'sent');
  });

  test('23. messageId mocké correctement retourné', async () => {
    const res = await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody(),
    });
    assert.strictEqual(res.body.messageId, 'mock-message-id-123');
  });

  test('24. mailbox réellement forcée à store (from contient info@jsinnovia.store)', async () => {
    await makeRequest('/api/emails/official', {
      headers: validHeaders(), body: validBody(),
    });
    assert.ok(lastMailOptions, 'sendMail should have been called');
    assert.ok(lastMailOptions.from.includes('info@jsinnovia.store'),
      `Expected from to contain info@jsinnovia.store, got: ${lastMailOptions.from}`);
  });

  test('25. replyTo transmis à Nodemailer', async () => {
    await makeRequest('/api/emails/official', {
      headers: validHeaders(),
      body: validBody({ replyTo: 'reply@jsinnovia.com' }),
    });
    assert.ok(lastMailOptions, 'sendMail should have been called');
    assert.strictEqual(lastMailOptions.replyTo, 'reply@jsinnovia.com');
  });

  test('26. erreur SMTP mockée → 502 (pas 500)', async () => {
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

  test('27. premier succès avec Idempotency-Key → un appel SMTP', async () => {
    const idemKey = 'idem-success-001';
    const res = await makeRequest('/api/emails/official', {
      headers: { ...validHeaders(), 'idempotency-key': idemKey },
      body: validBody(),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(smtpCallCount, 1, 'Should have exactly 1 SMTP call');
  });

  test('28. deuxième requête identique → réponse mise en cache (200)', async () => {
    const idemKey = 'idem-replay-001';
    const headers = { ...validHeaders(), 'idempotency-key': idemKey };
    const body = validBody();

    const res1 = await makeRequest('/api/emails/official', { headers, body });
    assert.strictEqual(res1.status, 200);

    const res2 = await makeRequest('/api/emails/official', { headers, body });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.messageId, 'mock-message-id-123');
  });

  test('29. compteur SMTP toujours égal à 1 après replay', async () => {
    const idemKey = 'idem-counter-001';
    const headers = { ...validHeaders(), 'idempotency-key': idemKey };
    const body = validBody();

    await makeRequest('/api/emails/official', { headers, body });
    await makeRequest('/api/emails/official', { headers, body });
    await makeRequest('/api/emails/official', { headers, body });

    assert.strictEqual(smtpCallCount, 1, 'SMTP call count should be 1 after 3 identical requests');
  });

  test('30. même clé avec payload différent → 409', async () => {
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

  test('31. deux requêtes concurrentes avec la même clé → un seul envoi', async () => {
    const idemKey = 'idem-concurrent-001';
    const headers = { ...validHeaders(), 'idempotency-key': idemKey };
    const body = validBody();

    // Block the SMTP call so request 1 doesn't complete before request 2 arrives
    let smtpResolve;
    smtpBlockPromise = new Promise(r => { smtpResolve = r; });

    // Send both requests concurrently
    const req1Promise = makeRequest('/api/emails/official', { headers, body });
    // Small delay to let request 1 reserve the key first
    await new Promise(r => setTimeout(r, 50));
    const req2Promise = makeRequest('/api/emails/official', { headers, body });

    // Request 2 should get 409 immediately (key is pending)
    const res2 = await req2Promise;
    assert.strictEqual(res2.status, 409);
    assert.ok(res2.body.error.includes('Concurrent'));

    // Unblock SMTP — request 1 should now complete
    smtpResolve();
    const res1 = await req1Promise;
    assert.strictEqual(res1.status, 200);

    // Only 1 SMTP call
    assert.strictEqual(smtpCallCount, 1, 'Should have exactly 1 SMTP call for concurrent requests');
  });
});

// ============================================================
describe('POST /api/emails/official — Rate limit', () => {
  beforeEach(async () => { resetMockState(); await startServer(); });
  afterEach(async () => { await stopServer(); });

  test('32. rate limit dépasse → 429', async () => {
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
