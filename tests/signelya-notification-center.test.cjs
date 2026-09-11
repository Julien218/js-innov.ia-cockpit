const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const notifications = fs.readFileSync(path.join(root, 'server-signelya-whatsapp.cjs'), 'utf8');
const postgres = fs.readFileSync(path.join(root, 'server-postgres.cjs'), 'utf8');
const topBar = fs.readFileSync(path.join(root, 'src', 'components', 'layout', 'TopBar.jsx'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'public', 'signelya-sw.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '012_signelya_notification_center.sql'), 'utf8');

test('SIGNELYA records offline and restored connectivity events', () => {
  assert.match(notifications, /screen\.offline_confirmed/);
  assert.match(notifications, /screen\.online_restored/);
  assert.match(notifications, /previousState === 'offline'/);
  assert.match(notifications, /notifyBackOnline\(player\)/);
});

test('notification feed is authenticated and scoped by role', () => {
  assert.match(notifications, /router\.get\('\/notifications', requireSession\('client'\)/);
  assert.match(notifications, /notificationVisibility\(req\.user\.role\)/);
  assert.match(notifications, /signelya_client_commercial_assignments/);
  assert.match(notifications, /lower\(e\.owner_email\)=lower\(\$2\)/);
});

test('read state is durable across devices', () => {
  assert.match(migration, /create table if not exists signelya_notification_reads/);
  assert.match(postgres, /012_signelya_notification_center\.sql/);
  assert.match(notifications, /router\.post\('\/notifications\/read-all'/);
  assert.match(notifications, /on conflict \(event_id,user_email\) do nothing/);
});

test('the responsive header exposes a useful alert center', () => {
  assert.match(topBar, /Centre de notifications/);
  assert.match(topBar, /Activer les alertes sur ce téléphone/);
  assert.match(topBar, /Écran de nouveau en ligne/);
  assert.match(topBar, /Nouveaux médias diffusés/);
  assert.match(topBar, /Surveillance active/);
  assert.doesNotMatch(topBar, />Écran en ligne</);
});

test('mobile push uses the approved SIGNELYA icon', () => {
  assert.match(worker, /icon: '\/signelya-icon-192\.png'/);
  assert.match(worker, /badge: '\/signelya-icon-192\.png'/);
});
