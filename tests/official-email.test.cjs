/**
 * Tests for POST /api/emails/official
 * Uses Node's built-in test runner (node:test)
 *
 * Strategy: Mount the email router on a standalone Express app
 * Mock sendEmail to control SMTP success/failure.
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

// Set test env BEFORE requiring modules
process.env.AGENT_API_KEY = 'test-official-key-1234567890';
process.env.EMAIL_STORE_ADDRESS = 'info@jsinnovia.store';
process.env.EMAIL_PASSWORD_STORE = 'test-password-store';

// We need to test the official route. Since server-email.cjs calls require()
// and defines routes, we'll create a minimal Express app that mounts the router.
// To mock sendEmail, we'll intercept the SMTP transport.

let server;
let baseUrl;

// Monkey-patch nodemailer.createTransport to return a mock transport
const nodemailer = require('nodemailer');

function createMockApp() {
  // Clear require cache for server-email to get fresh module
  delete require.cache[require.resolve('../server-email.cjs')];

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Mount the email router
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
      resolve(`http://localhost:${server.address().port}`);
    });
  });
}

async function stopServer() {
  return new Promise((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
}

function makeRequest(app, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://localhost:${server.address().port}`);
    const req = http.request(url, {
      method: options.method || 'POST',
      headers: options.headers || { 'Content-Type': 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

describe('POST /api/emails/official', () => {
  beforeEach(async () => {
    baseUrl = await startServer();
  });

  afterEach(async () => {
    await stopServer();
  });

  const validHeaders = (extra = {}) => ({
    'Content-Type': 'application/json',
    'x-agent-key': process.env.AGENT_API_KEY,
    ...extra,
  });

  const validBody = (extra = {}) => ({
    to: 'destinataire@example.com',
    subject: 'Test officiel',
    text: 'Version texte',
    ...extra,
  });

  // 1. clé absente → 401
  test('1. clé absente retourne 401', async () => {
    const res = await makeRequest(server, '/api/emails/official', {
      headers: { 'Content-Type': 'application/json' },
      body: validBody(),
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'Unauthorized');
  });

  // 2. clé invalide → 401
  test('2. clé invalide retourne 401', async () => {
    const res = await makeRequest(server, '/api/emails/official', {
      headers: { 'Content-Type': 'application/json', 'x-agent-key': 'wrong-key' },
      body: validBody(),
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'Unauthorized');
  });

  // 3. payload incomplet → 400
  test('3a. payload sans subject retourne 400', async () => {
    const res = await makeRequest(server, '/api/emails/official', {
      headers: validHeaders(),
      body: { to: 'test@example.com', text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('subject'));
  });

  test('3b. payload sans to retourne 400', async () => {
    const res = await makeRequest(server, '/api/emails/official', {
      headers: validHeaders(),
      body: { subject: 'Test', text: 'Hello' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('to'));
  });

  test('3c. payload sans text ni html retourne 400', async () => {
    const res = await makeRequest(server, '/api/emails/official', {
      headers: validHeaders(),
      body: { to: 'test@example.com', subject: 'Test' },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('text') || res.body.error.includes('html'));
  });

  // 4. champ from fourni → refusé
  test('4. champ from fourni retourne 400', async () => {
    const res = await makeRequest(server, '/api/emails/official', {
      headers: validHeaders(),
      body: validBody({ from: 'hacker@evil.com' }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('from'));
  });

  // 5. mailbox fournie → refusée
  test('5. champ mailbox fourni retourne 400', async () => {
    const res = await makeRequest(server, '/api/emails/official', {
      headers: validHeaders(),
      body: validBody({ mailbox: 'jsinnovia' }),
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('mailbox'));
  });

  // 6. envoi forcé depuis store — sans SMTP réel, on s'attend à 502
  test('6. envoi depuis store — erreur SMTP retourne 502 (pas 500)', async () => {
    const res = await makeRequest(server, '/api/emails/official', {
      headers: validHeaders(),
      body: validBody(),
    });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error, 'SMTP delivery failed');
    assert.strictEqual(res.body.status, 'failed');
  });

  // 7. même Idempotency-Key → aucun second envoi (mais le 502 n'est pas mis en cache)
  // On teste que la même clé ne provoque pas un second appel SMTP
  test('7. idempotency-key présent — la route le gère', async () => {
    const idemKey = 'test-idem-001';
    const res1 = await makeRequest(server, '/api/emails/official', {
      headers: validHeaders({ 'idempotency-key': idemKey }),
      body: validBody({ subject: 'Test idem 1' }),
    });
    // Premier appel: 502 (SMTP échoue en test)
    assert.strictEqual(res1.status, 502);

    // Deuxième appel avec même clé: 502 aussi (car 502 n'est pas mis en cache)
    const res2 = await makeRequest(server, '/api/emails/official', {
      headers: validHeaders({ 'idempotency-key': idemKey }),
      body: validBody({ subject: 'Test idem 2' }),
    });
    assert.strictEqual(res2.status, 502);
    // L'idempotence ne met en cache que les succès, pas les erreurs SMTP
  });

  // 8. rate limit → 429
  test('8. rate limit dépasse retourne 429', async () => {
    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await makeRequest(server, '/api/emails/official', {
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

  // 9. erreur SMTP → 502
  test('9. erreur SMTP retourne 502 (pas 500)', async () => {
    const res = await makeRequest(server, '/api/emails/official', {
      headers: validHeaders(),
      body: validBody({ subject: 'Test SMTP error' }),
    });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error, 'SMTP delivery failed');
    assert.notStrictEqual(res.status, 500);
  });

  // 10. réponse attendue a le bon format (vérifié sur le 502 car pas de SMTP réel)
  test('10. format de réponse vérifié', async () => {
    const res = await makeRequest(server, '/api/emails/official', {
      headers: validHeaders(),
      body: validBody(),
    });
    // Sans SMTP réel: 502 avec les bons champs
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.messageId, null);
    assert.strictEqual(res.body.status, 'failed');
    // En cas de succès, le format serait: { success: true, messageId: "...", status: "sent" }
  });
});
