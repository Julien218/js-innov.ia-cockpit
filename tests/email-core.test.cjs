/**
 * tests/email-core.test.cjs — Tests unitaires Node.js pour server-email-core.cjs
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const nodemailer = require('nodemailer');

// Environnement de test
const TEST_PROXY_KEY = 'test-proxy-key-2026';
process.env.EMAIL_PROXY_KEY = TEST_PROXY_KEY;
process.env.EMAIL_STORE_ADDRESS = 'info@jsinnovia.store';
process.env.EMAIL_PASSWORD_STORE = 'test-password-store';
process.env.EMAIL_ASSURANCES_ADDRESS = 'info@assurances-dour.be';
process.env.EMAIL_PASSWORD_ASSURANCES = 'test-password-assurances';

// Mock Nodemailer
let smtpCallCount = 0;
let lastMailOptions = null;
let smtpShouldFail = false;

nodemailer.createTransport = function(config) {
  return {
    sendMail(options) {
      smtpCallCount++;
      lastMailOptions = options;
      if (smtpShouldFail) {
        const err = new Error('SMTP connection refused');
        err.code = 'ECONNREFUSED';
        return Promise.reject(err);
      }
      return Promise.resolve({
        messageId: 'mock-msg-' + Math.random().toString(36).slice(2, 8),
        response: '250 OK',
      });
    }
  };
};

const emailCore = require('../server-email-core.cjs');

// Serveur HTTP de test Express
let server;
function createMockApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  // Injection automatique de req.user pour simuler requireSession dans les tests HTTP
  app.use((req, res, next) => {
    const role = req.headers['x-test-role'] || 'admin';
    req.user = { id: 'usr-test-123', email: 'admin@jsinnovia.com', role };
    next();
  });
  app.use('/api/emails', emailCore);
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
      method: options.method || 'GET',
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
    if (options.body !== undefined) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

describe('server-email-core — Tests unitaires & métriques', () => {

  beforeEach(async () => {
    smtpCallCount = 0;
    lastMailOptions = null;
    smtpShouldFail = false;
    emailCore.memoryStore.logs.clear();
    emailCore.memoryStore.queue.clear();
    emailCore.memoryStore.templates.clear();
    await startServer();
  });

  afterEach(async () => {
    emailCore.stopQueueWorker();
    await stopServer();
  });

  describe('1. Validation des inputs (sendEmail)', () => {
    test('Champ "to" manquant → rejette une erreur', async () => {
      await assert.rejects(
        async () => {
          await emailCore.sendEmail({ subject: 'Test', brand: 'js-innov-ia' });
        },
        { message: 'Champ to obligatoire' }
      );
    });

    test('Champ "subject" manquant → rejette une erreur', async () => {
      await assert.rejects(
        async () => {
          await emailCore.sendEmail({ to: 'user@example.com', brand: 'js-innov-ia' });
        },
        { message: 'Champ subject obligatoire' }
      );
    });

    test('Marque inexistante → rejette une erreur', async () => {
      await assert.rejects(
        async () => {
          await emailCore.sendEmail({
            to: 'user@example.com',
            subject: 'Test',
            brand: 'marque-inconnue-xyz',
          });
        },
        (err) => {
          assert.ok(err.message.includes('Marque inconnue'));
          return true;
        }
      );
    });
  });

  describe('2. Config SMTP & Multi-marques (getSmtpConfig)', () => {
    test('Marque par défaut (js-innov-ia) utilise EMAIL_STORE_ADDRESS', () => {
      const cfg = emailCore.getSmtpConfig('js-innov-ia');
      assert.strictEqual(cfg.host, 'smtp.ionos.fr');
      assert.strictEqual(cfg.port, 465);
      assert.strictEqual(cfg.user, 'info@jsinnovia.store');
    });

    test('Marque assurances-dour utilise EMAIL_ASSURANCES_ADDRESS', () => {
      const cfg = emailCore.getSmtpConfig('assurances-dour');
      assert.strictEqual(cfg.user, 'info@assurances-dour.be');
      assert.strictEqual(cfg.pass, 'test-password-assurances');
    });
  });

  describe('3. Idempotence (checkIdempotency & sendEmail)', () => {
    test('Même idempotencyKey → retourne le résultat en cache sans ré-envoyer d’email', async () => {
      const key = 'idem-key-12345';
      const first = await emailCore.sendEmail({
        to: 'dest@example.com',
        subject: 'Email 1',
        text: 'Hello',
        brand: 'js-innov-ia',
        idempotencyKey: key,
      });

      assert.strictEqual(first.success, true);
      assert.strictEqual(smtpCallCount, 1);

      const second = await emailCore.sendEmail({
        to: 'dest@example.com',
        subject: 'Email 1',
        text: 'Hello',
        brand: 'js-innov-ia',
        idempotencyKey: key,
      });

      assert.strictEqual(second.success, true);
      assert.strictEqual(second.cached, true);
      assert.strictEqual(second.email_log_id, first.email_log_id);
      assert.strictEqual(smtpCallCount, 1);
    });
  });

  describe('4. Transitions d’état de la queue (pending → sending → sent)', () => {
    test('enqueueEmail crée status "pending", processQueue passe par "sending" et conclut à "sent"', async () => {
      const logId = await emailCore.logEmail({
        to: 'test@example.com',
        subject: 'Queue Test',
        text: 'Contenu',
        brand: 'js-innov-ia',
      });

      const queueId = await emailCore.enqueueEmail(logId, 1);
      const queueItem = emailCore.memoryStore.queue.get(queueId);
      assert.strictEqual(queueItem.status, 'pending');

      await emailCore.processQueue();

      const updatedQueueItem = emailCore.memoryStore.queue.get(queueId);
      assert.strictEqual(updatedQueueItem.status, 'sent');

      const updatedLog = emailCore.memoryStore.logs.get(logId);
      assert.strictEqual(updatedLog.status, 'sent');
      assert.ok(updatedLog.sent_at);
      assert.ok(updatedLog.message_id);
    });
  });

  describe('5. Calcul du backoff exponentiel et retries', () => {
    test('Vérification des délais de backoff selon le nombre de tentatives', () => {
      assert.strictEqual(emailCore.calculateBackoffDelay(1), 60 * 1000);
      assert.strictEqual(emailCore.calculateBackoffDelay(2), 5 * 60 * 1000);
      assert.strictEqual(emailCore.calculateBackoffDelay(3), 30 * 60 * 1000);
      assert.strictEqual(emailCore.calculateBackoffDelay(4), 2 * 60 * 60 * 1000);
      assert.strictEqual(emailCore.calculateBackoffDelay(5), 8 * 60 * 60 * 1000);
    });

    test('Si l’envoi échoue, processQueue incrémente attempts et passe en status "retry"', async () => {
      smtpShouldFail = true;

      const logId = await emailCore.logEmail({
        to: 'fail@example.com',
        subject: 'Fail Test',
        brand: 'js-innov-ia',
      });
      const queueId = await emailCore.enqueueEmail(logId, 1);

      await emailCore.processQueue();

      const queueItem = emailCore.memoryStore.queue.get(queueId);
      assert.strictEqual(queueItem.status, 'retry');
      assert.strictEqual(queueItem.attempts, 1);
      assert.ok(queueItem.next_attempt_at);

      const logItem = emailCore.memoryStore.logs.get(logId);
      assert.strictEqual(logItem.status, 'retry');
      assert.strictEqual(logItem.retry_count, 1);
    });

    test('Quand attempts >= max_attempts (5), passe en status "failed" / "dead_letter"', async () => {
      smtpShouldFail = true;

      const logId = await emailCore.logEmail({
        to: 'dead@example.com',
        subject: 'Dead Letter Test',
        brand: 'js-innov-ia',
      });
      const queueId = await emailCore.enqueueEmail(logId, 1);

      const qItem = emailCore.memoryStore.queue.get(queueId);
      qItem.attempts = 4;

      await emailCore.processQueue();

      assert.strictEqual(qItem.status, 'failed');
      assert.strictEqual(qItem.dead_letter, true);
      assert.strictEqual(qItem.attempts, 5);

      const logItem = emailCore.memoryStore.logs.get(logId);
      assert.strictEqual(logItem.status, 'dead_letter');
    });
  });

  describe('6. Routes API Express', () => {
    test('POST /api/emails/send → envoie l’email', async () => {
      const res = await makeRequest('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-role': 'collaborateur' },
        body: {
          to: 'client@example.com',
          subject: 'Sujet Test API',
          text: 'Message texte',
          brand: 'js-innov-ia',
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.status, 'sent');
      assert.ok(res.body.message_id);
    });

    test('GET /api/emails/brands → liste les marques actives', async () => {
      const res = await makeRequest('/api/emails/brands', {
        method: 'GET',
        headers: { 'x-test-role': 'collaborateur' },
      });

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.brands));
      assert.ok(res.body.brands.length >= 7);
    });

    test('GET /api/emails/stats → retourne les statistiques agrégées', async () => {
      await emailCore.sendEmail({
        to: 'stat1@example.com',
        subject: 'Stat 1',
        text: 'hello',
        brand: 'js-innov-ia',
      });

      const res = await makeRequest('/api/emails/stats', {
        method: 'GET',
        headers: { 'x-test-role': 'admin' },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.total, 1);
      assert.ok(res.body.by_status);
      assert.strictEqual(res.body.by_status.sent, 1);
    });

    test('CRUD Templates (POST, GET, PUT, DELETE /api/emails/templates)', async () => {
      // POST Create
      const createRes = await makeRequest('/api/emails/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-role': 'admin' },
        body: {
          name: 'Bienvenue',
          brand: 'js-innov-ia',
          subject: 'Bienvenue {{name}}',
          text_content: 'Bonjour {{name}}',
        },
      });
      assert.strictEqual(createRes.status, 201);
      const templateId = createRes.body.id;
      assert.ok(templateId);

      // GET List
      const listRes = await makeRequest('/api/emails/templates?brand=js-innov-ia', {
        method: 'GET',
        headers: { 'x-test-role': 'admin' },
      });
      assert.strictEqual(listRes.status, 200);
      assert.ok(listRes.body.templates.length >= 1);

      // PUT Update
      const updateRes = await makeRequest(`/api/emails/templates/${templateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-test-role': 'admin' },
        body: { subject: 'Bienvenue Mis à Jour' },
      });
      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateRes.body.subject, 'Bienvenue Mis à Jour');

      // DELETE
      const delRes = await makeRequest(`/api/emails/templates/${templateId}`, {
        method: 'DELETE',
        headers: { 'x-test-role': 'admin' },
      });
      assert.strictEqual(delRes.status, 200);
      assert.strictEqual(delRes.body.success, true);
    });

    test('POST /api/emails/:id/retry et /cancel', async () => {
      const sendRes = await emailCore.sendEmail({
        to: 'user@example.com',
        subject: 'Retry Test',
        brand: 'js-innov-ia',
      });
      const logId = sendRes.email_log_id;

      // Retry
      const retryRes = await makeRequest(`/api/emails/${logId}/retry`, {
        method: 'POST',
        headers: { 'x-test-role': 'admin' },
      });
      assert.strictEqual(retryRes.status, 200);
      assert.strictEqual(retryRes.body.status, 'pending');

      // Cancel
      const cancelRes = await makeRequest(`/api/emails/${logId}/cancel`, {
        method: 'POST',
        headers: { 'x-test-role': 'admin' },
      });
      assert.strictEqual(cancelRes.status, 200);
      assert.strictEqual(cancelRes.body.status, 'cancelled');
    });
  });
});
