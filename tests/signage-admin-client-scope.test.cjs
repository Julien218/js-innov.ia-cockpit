const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server-signage.cjs', 'utf8');
const page = fs.readFileSync('src/pages/DigitalSignage.jsx', 'utf8');

test('admin signage scope accepts only entitled client emails', () => {
  assert.match(server, /x-client-email/);
  assert.match(server, /\['admin', 'superadmin'\]\.includes\(req\.user\.role\)/);
  assert.match(server, /module_code=eq\.digital_signage&enabled=eq\.true/);
  assert.match(server, /Ce client ne possède pas le module Digital Signage/);
  assert.match(server, /req\.signageOwner = requested/);
});

test('client requests remain scoped to the authenticated account', () => {
  assert.match(server, /req\.signageOwner = sessionOwner\(req\)/);
  assert.match(server, /const owner = req => String\(req\.signageOwner \|\| sessionOwner\(req\)\)/);
  assert.match(server, /filterOwner/);
});

test('admin cockpit provides a client selector and scopes every operation', () => {
  assert.match(page, /Client géré/);
  assert.match(page, /queryKey: \["signage-dashboard", managedClient \|\| "self"\]/);
  assert.match(page, /"X-Client-Email": clientEmail/);
  assert.match(page, /uploadMedia\(file,[\s\S]*managedClient\)/);
  assert.match(page, /api\("\/manage\/publications"[\s\S]*managedClient\)/);
  assert.match(page, /preferredManagedClient/);
  assert.match(page, /\.endsWith\("\.invalid"\)/);
  assert.match(page, /localStorage\.setItem\(managedClientKey, email\)/);
});

test('admin player diagnostics expose operational fields only behind admin auth', () => {
  assert.match(server, /router\.get\('\/manage\/player-diagnostics', requireSession\('admin'\)/);
  assert.match(server, /select=id,name,owner_email,status,last_seen_at,app_version,created_at/);
  assert.doesNotMatch(server.match(/router\.get\('\/manage\/player-diagnostics'[\s\S]*?\n\}\);/)?.[0] || '', /token_hash/);
});


