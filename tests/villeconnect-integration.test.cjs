const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(path.join(root, 'src', 'pages', 'VilleConnect.jsx'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'src', 'components', 'layout', 'Sidebar.jsx'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const dockerSource = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'permission-catalog.json'), 'utf8'));

async function loadRoles() {
  return import(pathToFileURL(path.join(root, 'src', 'lib', 'roles.js')).href);
}

test('VilleConnectOS is an individually assignable admin module', async () => {
  const permission = catalog.find(item => item.code === 'villeconnect');
  assert.deepEqual(permission.roles, ['admin']);
  assert.deepEqual(permission.routes, ['/villeconnect']);
  const { hasRouteAccess } = await loadRoles();
  assert.equal(hasRouteAccess('superadmin', '/villeconnect'), true);
  assert.equal(hasRouteAccess('admin', '/villeconnect'), true);
  assert.equal(hasRouteAccess('collaborateur', '/villeconnect'), false);
  assert.match(appSource, /path="\/villeconnect"/);
  assert.match(sidebarSource, /label: "VilleConnectOS"/);
});

test('the backend route is session and permission protected and packaged', () => {
  assert.match(serverSource, /app\.use\('\/api\/villeconnect', requireSession\('admin'\), requirePermission\('villeconnect', 'admin'\), villeConnectRouter\.router\)/);
  assert.match(dockerSource, /COPY --from=builder \/app\/server-villeconnect\.cjs \.\/server-villeconnect\.cjs/);
  assert.match(dockerSource, /node --check \/app\/server-villeconnect\.cjs/);
});

test('the page links the public site, web application, GitHub and Railway', () => {
  assert.match(pageSource, /https:\/\/villeconnectos\.com\//);
  assert.match(pageSource, /https:\/\/app\.villeconnectos\.com\//);
  assert.match(pageSource, /https:\/\/github\.com\/Julien218\/villeconnect/);
  assert.match(pageSource, /railway\.com\/project\/12d50906-8d50-40fd-902d-76c37bd651eb/);
  assert.match(pageSource, /\/api\/villeconnect\/status/);
});

test('the live probe reports measured availability and waitlist count', async () => {
  const { probeVilleConnect } = require('../server-villeconnect.cjs');
  const result = await probeVilleConnect(async url => {
    if (url.endsWith('/health')) return { ok: true, status: 200, json: async () => ({ ok: true, service: 'VilleConnect API', version: '2.3.0' }) };
    if (url.includes('waitlist.count')) return { ok: true, status: 200, json: async () => ({ result: { data: { count: 10 } } }) };
    if (url.includes('app.villeconnectos.com')) return { ok: true, status: 200, text: async () => '<title>Ma Commune</title>' };
    return { ok: true, status: 200, text: async () => '<h1>VilleConnect OS</h1>' };
  });
  assert.equal(result.healthy, true);
  assert.equal(result.api.version, '2.3.0');
  assert.equal(result.waitlist.count, 10);
});

test('the live probe never invents health after failures', async () => {
  const { probeVilleConnect } = require('../server-villeconnect.cjs');
  const result = await probeVilleConnect(async () => {
    const error = new Error('offline');
    error.code = 'ECONNREFUSED';
    throw error;
  });
  assert.equal(result.healthy, false);
  assert.equal(result.site.healthy, false);
  assert.equal(result.application.healthy, false);
  assert.equal(result.api.healthy, false);
  assert.equal(result.waitlist.healthy, false);
});
