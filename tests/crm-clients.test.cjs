const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const commerce = fs.readFileSync(path.join(root, 'server-commerce.cjs'), 'utf8');
const clientsPage = fs.readFileSync(path.join(root, 'src', 'pages', 'Clients.jsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src', 'pages', 'Dashboard.jsx'), 'utf8');
const crmClient = fs.readFileSync(path.join(root, 'src', 'api', 'crmClient.js'), 'utf8');
const crmServer = require('../server-crm.cjs');

test('CRM clients is mounted behind collaborator authentication', () => {
  assert.match(server, /app\.use\('\/api\/crm', requireSession\('collaborateur'\), crmRouter\)/);
});

test('general cockpit clients and dashboard use the Supabase CRM endpoint', () => {
  assert.match(clientsPage, /crmClient\.list\(\)/);
  assert.doesNotMatch(clientsPage, /base44\.entities\.Client/);
  assert.match(dashboard, /crmClient\.list\(\)/);
  assert.match(crmClient, /\/api\/crm/);
});

test('paid orders and pilot grants synchronize a CRM client', () => {
  assert.match(commerce, /async function provisionPaidOrder[\s\S]*ensureCrmClient\(order\)/);
  assert.match(commerce, /router\.post\('\/pilot-grant'[\s\S]*ensureCrmClient\(/);
});

test('CRM payload validation accepts known statuses and rejects invalid email', () => {
  const payload = crmServer.normalizeClientPayload({ nom: 'Trevis', email: 'OLIVIER.TREVIS@OUTLOOK.BE', statut: 'actif' });
  assert.equal(payload.email, 'olivier.trevis@outlook.be');
  assert.equal(payload.statut, 'actif');
  assert.throws(() => crmServer.normalizeClientPayload({ nom: 'Test', email: 'invalid', statut: 'actif' }), /Email client invalide/);
  assert.throws(() => crmServer.normalizeClientPayload({ nom: 'Test', email: 'test@example.com', statut: 'client' }), /Statut client invalide/);
});

test('contact names are split for automatic provisioning', () => {
  assert.deepEqual(crmServer.splitContactName('Olivier Trevis'), { prenom: 'Olivier', nom: 'Trevis' });
});
