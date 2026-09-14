const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const proxySource = fs.readFileSync(path.join(root, 'server-data-proxy.cjs'), 'utf8');
const topBarSource = fs.readFileSync(path.join(root, 'src', 'components', 'layout', 'TopBar.jsx'), 'utf8');
const envSource = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

test('client notification hub is exposed before the generic data proxy guard', () => {
  const routeIndex = proxySource.indexOf("router.get('/Notifications'");
  const genericIndex = proxySource.indexOf('router.use(async (req, res)');
  assert.ok(routeIndex >= 0, 'Notifications route must exist');
  assert.ok(genericIndex >= 0, 'generic proxy guard must exist');
  assert.ok(routeIndex < genericIndex, 'client notification feed must be reachable before generic table restrictions');
  assert.match(proxySource, /resolveTenant\(req\)/);
  assert.match(proxySource, /cleanTenant\(event\.tenant\) === tenant/);
});

test('critical website alerts only use operational outage codes and require confirmation', () => {
  assert.match(proxySource, /OUTAGE_CODES = new Set\(\['apex_http_down', 'apex_dns_missing', 'tls_invalid'\]\)/);
  assert.match(proxySource, /CLIENT_NOTIFICATION_CONFIRM_FAILURES/);
  assert.match(proxySource, /Math\.max\(2,/);
  assert.doesNotMatch(proxySource, /OUTAGE_CODES[^;]+seo_score/);
});

test('outbound SMS and WhatsApp remain explicit, opt-in and server-side', () => {
  assert.match(proxySource, /CLIENT_ALERTS_ENABLED !== 'true'/);
  assert.match(proxySource, /TWILIO_ACCOUNT_SID/);
  assert.match(proxySource, /WHATSAPP_TEMPLATE_CRITICAL_ALERT/);
  assert.match(proxySource, /opt_in|opted_in|whatsapp_opt_in/);
  assert.match(envSource, /CLIENT_ALERTS_ENABLED=false/);
  assert.match(envSource, /CLIENT_ALERT_CONTACTS_JSON=\{\}/);
  assert.match(envSource, /WHATSAPP_ACCESS_TOKEN=/);
});

test('project registrations and client business changes feed the notification center', () => {
  assert.match(proxySource, /event_type: 'registration\.new'/);
  assert.match(proxySource, /title: 'Nouvel inscrit'/);
  assert.match(proxySource, /tenantRows\('Demande', tenant\)/);
  assert.match(proxySource, /tenantRows\('Projet', tenant\)/);
  assert.match(proxySource, /tenantRows\('Devis', tenant\)/);
  assert.match(proxySource, /tenantRows\('Facture', tenant\)/);
});

test('cockpit top bar displays, refreshes and locally acknowledges client notifications', () => {
  assert.match(topBarSource, /\/api\/data\/Notifications\?limit=50/);
  assert.match(topBarSource, /BellRing/);
  assert.match(topBarSource, /window\.localStorage/);
  assert.match(topBarSource, /Tout marquer comme lu/);
  assert.match(topBarSource, /30_000/);
  assert.match(topBarSource, /severity === 'critical'/);
});
