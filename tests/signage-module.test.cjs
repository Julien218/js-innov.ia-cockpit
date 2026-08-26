const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(path.join(root, 'src', 'pages', 'DigitalSignage.jsx'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'src', 'components', 'layout', 'Sidebar.jsx'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const dockerSource = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

async function loadRoles() {
  return import(pathToFileURL(path.join(root, 'src', 'lib', 'roles.js')).href);
}

test('the signage module is visible only to admin roles', async () => {
  const { hasRouteAccess } = await loadRoles();
  assert.equal(hasRouteAccess('superadmin', '/ecran-geant'), true);
  assert.equal(hasRouteAccess('admin', '/ecran-geant'), true);
  assert.equal(hasRouteAccess('collaborateur', '/ecran-geant'), false);
  assert.equal(hasRouteAccess('client', '/ecran-geant'), false);
  assert.match(appSource, /path="\/ecran-geant"/);
  assert.match(sidebarSource, /label: "Écran géant"/);
});

test('the client cockpit opens securely outside the main cockpit frame', () => {
  assert.match(pageSource, /olivier-signage-cockpit-production\.up\.railway\.app\/ecran-geant/);
  assert.match(pageSource, /target="_blank"/);
  assert.match(pageSource, /rel="noopener noreferrer"/);
  assert.doesNotMatch(pageSource, /<iframe/i);
});

test('the signage health route is protected by an admin session', () => {
  assert.match(serverSource, /app\.use\('\/api\/signage', requireSession\('admin'\), requirePermission\('signage', 'admin'\), signageRouter\.router\)/);
  assert.match(dockerSource, /COPY --from=builder \/app\/server-signage\.cjs \.\/server-signage\.cjs/);
  assert.match(dockerSource, /node --check \/app\/server-signage\.cjs/);
});

test('the signage probe reports a verifiable healthy service', async () => {
  const { probeSignage, SIGNAGE_HEALTH_URL, SIGNAGE_MANAGER_URL } = require('../server-signage.cjs');
  let requestedUrl = '';
  const result = await probeSignage(async (url) => {
    requestedUrl = url;
    return { ok: true, status: 200, json: async () => ({ status: 'ok', service: 'cockpit-api' }) };
  });

  assert.equal(requestedUrl, SIGNAGE_HEALTH_URL);
  assert.equal(result.healthy, true);
  assert.equal(result.status, 200);
  assert.equal(result.manager_url, SIGNAGE_MANAGER_URL);
});

test('the signage probe never invents availability after a network failure', async () => {
  const { probeSignage } = require('../server-signage.cjs');
  const result = await probeSignage(async () => {
    const error = new Error('offline');
    error.code = 'ECONNREFUSED';
    throw error;
  });

  assert.equal(result.healthy, false);
  assert.equal(result.status, null);
  assert.equal(result.error, 'ECONNREFUSED');
});
