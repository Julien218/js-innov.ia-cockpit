const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('PilotyaSign prospecting is registered as a Cockpit route and navigation item', () => {
  const app = read('src/App.jsx');
  const sidebar = read('src/components/layout/Sidebar.jsx');
  assert.match(app, /path="\/pilotyasign"/);
  assert.match(app, /<PilotyaSign/);
  assert.match(sidebar, /PilotyaSign · Prospection/);
  assert.match(sidebar, /path: "\/pilotyasign"/);
});

test('PilotyaSign prospecting is commercial/admin only and not exposed to clients', () => {
  const roles = read('src/lib/roles.js');
  const catalog = JSON.parse(read('permission-catalog.json'));
  const permission = catalog.find((item) => item.code === 'pilotyasign_prospecting');
  assert.ok(permission);
  assert.deepEqual(permission.roles, ['collaborateur', 'admin']);
  assert.ok(permission.routes.includes('/pilotyasign'));
  assert.match(roles, /collaborateur:[\s\S]*"\/pilotyasign"/);
  const clientRoutes = roles.match(/client:\s*\[([\s\S]*?)\n\s*\],/);
  assert.ok(clientRoutes, 'client route block should exist');
  assert.doesNotMatch(clientRoutes[1], /"\/pilotyasign"/);
});

test('PilotyaSign page reuses Cockpit Leads and a dedicated Espace C Dour marker', () => {
  const page = read('src/pages/PilotyaSign.jsx');
  assert.match(page, /base44\.entities\.Lead/);
  assert.match(page, /PILOTYASIGN:ECRAN_ESPACE_C_DOUR/);
  assert.match(page, /https:\/\/pilotyasign\.jsinnovia\.com\//);
  assert.match(page, /Publicité écran géant Espace C Dour/);
  assert.match(page, /Ouvrir PilotyaSign/);
});
