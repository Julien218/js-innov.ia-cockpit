const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('SIGNELYA applique le routage métier validé', () => {
  const source = fs.readFileSync(path.join(root, 'server-signelya-whatsapp.cjs'), 'utf8');
  assert.match(source, /audience: \['client', 'superadmin'\]/);
  assert.match(source, /audience: \['commercial'\]/);
  assert.match(source, /c\.role='collaborateur'/);
  assert.match(source, /role='client' and lower\(email\)=lower\(\$1\)/);
  assert.match(source, /whatsapp_opt_in_at is not null/);
  assert.match(source, /SIGNELYA_SUPERADMIN_ALERT_EMAIL \|\| 'info@jsinnovia\.store'/);
});

test('Aucun envoi réel ne part avant activation explicite', () => {
  const source = fs.readFileSync(path.join(root, 'server-signelya-whatsapp.cjs'), 'utf8');
  assert.match(source, /SIGNELYA_NOTIFICATIONS_ENABLED === 'true'/);
  assert.match(source, /if \(!NOTIFICATIONS_ENABLED\) return \{ disabled: true \}/);
  assert.match(source, /if \(!NOTIFICATIONS_ENABLED \|\| monitorBusy\) return/);
});

test('Une panne exige une transition connue de en ligne vers hors ligne', () => {
  const source = fs.readFileSync(path.join(root, 'server-signelya-whatsapp.cjs'), 'utf8');
  assert.match(source, /SIGNELYA_OFFLINE_CONFIRM_SECONDS \|\| 300/);
  assert.match(source, /if \(offline && previousState === 'online'\)/);
});

test('Une notification vidéos en ligne part seulement après ACK actif', () => {
  const source = fs.readFileSync(path.join(root, 'server-signage.cjs'), 'utf8');
  const ackRoute = source.indexOf("router.post('/player/publications/:id/ack'");
  const notification = source.indexOf('notifyVideosOnline({publicationId:publication.id', ackRoute);
  assert.ok(ackRoute >= 0);
  assert.ok(notification > ackRoute);
  assert.match(source.slice(ackRoute, notification), /if\(ok\)/);
});

test('Le webhook WhatsApp exige la signature Meta', () => {
  const source = fs.readFileSync(path.join(root, 'server-signelya-whatsapp.cjs'), 'utf8');
  assert.match(source, /x-hub-signature-256/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /if \(!verifySignature\(req\)\) return res\.sendStatus\(401\)/);
});

test('Le push mobile est limité au Super Admin et signé par VAPID', () => {
  const source = fs.readFileSync(path.join(root, 'server-signelya-whatsapp.cjs'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'public', 'signelya-sw.js'), 'utf8');
  assert.match(source, /webpush\.setVapidDetails/);
  assert.match(source, /where enabled=true and role='superadmin'/);
  assert.match(source, /router\.post\('\/push\/subscriptions', requireSession\('superadmin'\)/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /notificationclick/);
});
