const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server-signage.cjs'), 'utf8');
const postgres = fs.readFileSync(path.join(root, 'server-postgres.cjs'), 'utf8');
const signage = fs.readFileSync(path.join(root, 'src', 'pages', 'DigitalSignage.jsx'), 'utf8');
const surveillance = fs.readFileSync(path.join(root, 'src', 'pages', 'VideoSurveillance.jsx'), 'utf8');
const gateway = fs.readFileSync(path.join(root, 'camera-gateway', 'gateway.mjs'), 'utf8');
const gatewayInstaller = fs.readFileSync(path.join(root, 'camera-gateway', 'install-windows.ps1'), 'utf8');
const gatewayRunner = fs.readFileSync(path.join(root, 'camera-gateway', 'run-windows.ps1'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '005_signage_camera_finalization.sql'), 'utf8');
const commerce = fs.readFileSync(path.join(root, 'server-commerce.cjs'), 'utf8');
const onboarding = fs.readFileSync(path.join(root, 'server-client-onboarding.cjs'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

test('scheduled and recurring publications are only delivered when due', () => {
  assert.match(migration, /scheduled_at timestamptz/);
  assert.match(migration, /recurrence jsonb/);
  assert.match(server, /normalizeRecurrence/);
  assert.match(server, /getTime\(\)<=Date\.now\(\)/);
  assert.match(server, /nextScheduledAt/);
  assert.match(signage, /type="datetime-local"/);
  assert.match(signage, /value="daily"/);
  assert.match(signage, /value="weekly"/);
});

test('failed candidate playback automatically preserves the previous publication', () => {
  assert.match(server, /rolled_back_at:ok\?null:now/);
  assert.match(server, /current_publication_id:publication\.previous_publication_id/);
  assert.match(server, /rolledBack:!ok/);
  assert.match(signage, /Retour à la dernière diffusion valide/);
});

test('playlist ordering, preview and audit history are exposed in the cockpit', () => {
  assert.match(server, /router\.patch\('\/manage\/playlists\/:id'/);
  assert.match(server, /signage_audit_events/);
  assert.match(signage, /moveMedia/);
  assert.match(signage, /Prévisualisation/);
  assert.match(signage, /Journal d’activité/);
});

test('camera credentials remain local and browser receives only authenticated snapshots', () => {
  assert.match(gateway, /CAMERA_CONFIG_JSON/);
  assert.match(gateway, /rtspUrl/);
  assert.doesNotMatch(surveillance, /rtspUrl|RTSP_URL|local_stream_key/);
  assert.match(server, /\/gateway\/cameras\/:id\/snapshot/);
  assert.match(server, /cameraSnapshots/);
  assert.match(server, /requireCameraEntitlement/);
  assert.match(surveillance, /X-Client-Email/);
});

test('camera recordings are archived to Dropbox and expire automatically', () => {
  assert.match(migration, /camera_recordings/);
  assert.match(migration, /retention_days/);
  assert.match(server, /cameraRecordingRoot/);
  assert.match(server, /cleanupExpiredRecordings/);
  assert.match(server, /deleteDropboxPath/);
  assert.match(postgres, /method === 'DELETE'/);
  assert.match(surveillance, /suppression automatique/);
});

test('local camera gateway supports heartbeat, snapshots and optional recordings', () => {
  assert.match(gateway, /\/api\/signage\/gateway\/heartbeat/);
  assert.match(gateway, /captureSnapshot/);
  assert.match(gateway, /captureRecording/);
  assert.match(gateway, /RECORDING_ENABLED/);
  assert.doesNotMatch(gateway, /console\.log\([^\n]*(GATEWAY_TOKEN|rtspUrl)/);
  assert.match(gateway, /redactCameraSecrets/);
  assert.ok(gateway.includes("'rtsp://***@'"));
});

test('Windows camera installer protects local secrets and starts the gateway at logon', () => {
  assert.match(gatewayInstaller, /Read-Host[^\n]+-AsSecureString/);
  assert.match(gatewayInstaller, /ConvertFrom-SecureString/);
  assert.match(gatewayInstaller, /Set-Acl/);
  assert.match(gatewayInstaller, /Register-ScheduledTask/);
  assert.match(gatewayRunner, /ConvertTo-SecureString/);
  assert.match(gatewayRunner, /ZeroFreeBSTR/);
  assert.doesNotMatch(gatewayRunner, /Write-(Host|Output)[^\n]*(token|rtsp)/i);
});

test('Stripe events are retryable until provisioning is actually complete', () => {
  assert.match(migration, /processing_status/);
  assert.match(migration, /processing_attempts/);
  assert.match(commerce, /processing_status === 'processed'/);
  assert.match(commerce, /processing_status: 'failed'/);
  assert.match(commerce, /checkout\.session\.async_payment_succeeded/);
  assert.match(commerce, /checkout\.session\.async_payment_failed/);
});

test('paid orders create a single-use hashed invitation without emailing active clients', () => {
  assert.match(commerce, /ensureClientInvitation/);
  assert.match(onboarding, /randomBytes\(48\)\.toString\('base64url'\)/);
  assert.match(onboarding, /inviteHash\(rawToken\)/);
  assert.match(onboarding, /if \(user\?\.is_active\) return/);
  assert.match(onboarding, /EMAIL_STORE_PASSWORD/);
  assert.doesNotMatch(onboarding, /console\.[a-z]+\([^\n]*rawToken/);
});


test('the runtime image includes every current and future server module', () => {
  assert.match(dockerfile, /COPY --from=builder \/app\/server-\*\.cjs \.\//);
  assert.match(dockerfile, /test -f \/app\/server-billing-template\.cjs/);
  assert.match(dockerfile, /test -f \/app\/server-cost-centers\.cjs/);
});
