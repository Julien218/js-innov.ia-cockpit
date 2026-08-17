const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const compat = fs.readFileSync(path.join(root, 'server-signage-schedule-compat.cjs'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const legacyAndroid = fs.readFileSync(path.join(root, 'player-android', 'app', 'src', 'main', 'java', 'ia', 'jsinnov', 'pixeliumplayer', 'MainActivity.java'), 'utf8');

test('legacy installed Player receives a black publication outside allowed hours without token changes', () => {
  assert.match(compat, /schedule-black\.png/);
  assert.match(compat, /blackoutPublication/);
  assert.match(compat, /if \(!decision\.adsAllowed\) outgoing\.publication = blackoutPublication/);
  assert.match(compat, /restoreCurrentPublicationIfNeeded/);
  assert.match(compat, /current_publication_id/);
  // Reading token_hash is required to authenticate the already-provisioned Player.
  // The compatibility layer must never rotate, return or overwrite that token.
  assert.match(compat, /token_hash=eq\.\$\{hash\(bearer\)\}/);
  assert.doesNotMatch(compat, /rotate-token|enrollmentToken|token_hash\s*:\s*hash|update\s+signage_players[\s\S]*token_hash/i);
});

test('compatibility middleware is mounted before the schedule guard and legacy runtime', () => {
  const compatIndex = server.indexOf("app.use('/api/signage', signageScheduleCompat)");
  const scheduleIndex = server.indexOf("app.use('/api/signage', signageScheduleRouter)");
  const legacyIndex = server.indexOf("app.use('/api/signage', signageRouter)");
  assert.ok(compatIndex >= 0);
  assert.ok(scheduleIndex > compatIndex);
  assert.ok(legacyIndex > scheduleIndex);
});

test('legacy Player 0.3 can download and display the compatibility image', () => {
  assert.match(legacyAndroid, /download\(url, temporary\)/);
  assert.match(legacyAndroid, /mimeType\.startsWith\("image\/"\)/);
  assert.match(legacyAndroid, /BitmapFactory\.decodeFile/);
});

test('schedule audit is edge-triggered instead of written every heartbeat', () => {
  assert.match(compat, /sameDecision/);
  assert.match(compat, /if \(sameDecision\(previousDecision, decision\)\) return/);
});
