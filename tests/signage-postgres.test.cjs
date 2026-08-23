const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adapter = fs.readFileSync(path.join(root, 'server-postgres.cjs'), 'utf8');
const commerce = fs.readFileSync(path.join(root, 'server-commerce.cjs'), 'utf8');
const signage = fs.readFileSync(path.join(root, 'server-signage.cjs'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'server-signage-runtime.cjs'), 'utf8');
const signagePage = fs.readFileSync(path.join(root, 'src', 'pages', 'DigitalSignage.jsx'), 'utf8');
const androidPlayer = fs.readFileSync(path.join(root, 'player-android', 'app', 'src', 'main', 'java', 'ia', 'jsinnov', 'pixeliumplayer', 'MainActivity.java'), 'utf8');
const scheduledPlayer = fs.readFileSync(path.join(root, 'player-android', 'app', 'src', 'main', 'java', 'ia', 'jsinnov', 'pixeliumplayer', 'ScheduledMainActivity.java'), 'utf8');
const guardian = fs.readFileSync(path.join(root, 'player-android', 'app', 'src', 'main', 'java', 'ia', 'jsinnov', 'pixeliumplayer', 'PixeliumGuardianService.java'), 'utf8');
const apkRoute = fs.readFileSync(path.join(root, 'server-player-apk.cjs'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

test('PostgreSQL staging uses DATABASE_URL and an advisory migration lock', () => {
  assert.match(adapter, /process\.env\.DATABASE_URL/);
  assert.match(adapter, /pg_advisory_lock/);
  assert.match(adapter, /pilot_schema_migrations/);
  assert.match(adapter, /004_pilot_sponsorship\.sql/);
  assert.match(adapter, /008_signage_player_runtime_health\.sql/);
  assert.match(adapter, /PILOT_GRANT_EMAIL/);
  assert.match(adapter, /PILOT_USAGE_BILLING_ACCOUNT/);
});

test('pilot grants are free while usage is assigned to a billing account', () => {
  assert.match(commerce, /router\.post\('\/pilot-grant'/);
  assert.match(commerce, /grant_reason: 'pilot_gift'/);
  assert.match(commerce, /recurring_fee_cents: 0/);
  assert.match(commerce, /usage_billing_enabled: true/);
});

test('only pilot tables are accepted by the REST compatibility adapter', () => {
  assert.match(adapter, /ALLOWED_TABLES/);
  assert.match(adapter, /Table non autorisee/);
  assert.match(adapter, /PATCH sans filtre refuse/);
});

test('PostgreSQL adapter serializes every Signage JSONB column explicitly', () => {
  assert.match(adapter, /const JSON_COLUMNS = new Map/);
  for (const column of ['diagnostics', 'runtime_diagnostics', 'rendition', 'items', 'manifest']) {
    assert.match(adapter, new RegExp(`['"]${column}['"]`));
  }
  assert.match(adapter, /JSON\.stringify\(value\)/);
  assert.match(adapter, /postgresValue\(table,c,row\[c\]\)/);
  assert.match(adapter, /postgresValue\(table,k,v\)/);
});

test('commerce and signage prefer Railway PostgreSQL when configured', () => {
  assert.match(commerce, /if \(process\.env\.DATABASE_URL\) return postgresRest/);
  assert.match(signage, /if \(process\.env\.DATABASE_URL\) return postgresRest/);
});

test('production image contains the SQL migrations used at startup', () => {
  assert.match(dockerfile, /COPY --from=builder \/app\/migrations \.\/migrations/);
});

test('production converts videos to a deterministic MXQ-compatible rendition', () => {
  assert.match(dockerfile, /apk add --no-cache nginx ffmpeg/);
  assert.match(signage, /spawn\('ffmpeg'/);
  assert.match(signage, /libx264/);
  assert.match(signage, /1920:1080/);
  assert.match(signage, /yuv420p/);
  assert.match(signage, /preparePlayerMedia\(req\.body,name,sourceMimeType\)/);
  assert.match(signage, /status:'ready'/);
  assert.match(signage, /state: 'ready'/);
  assert.match(signage, /Le media doit etre converti pour le Player avant sa diffusion/);
});

test('signage uses the configured Dropbox root and temporary Player links', () => {
  assert.match(signage, /DROPBOX_ROOT_PATH/);
  assert.match(signage, /get_temporary_upload_link/);
  assert.match(signage, /get_temporary_link/);
  assert.match(signage, /expiresIn:14400/);
  assert.match(signage, /DROPBOX_REFRESH_TOKEN/);
  assert.match(signage, /grant_type: 'refresh_token'/);
  assert.match(signage, /dropboxTokenCache/);
});

test('offline players can rotate to an easy-to-enter secure token', () => {
  assert.match(signage, /randomBytes\(12\).*toString\('hex'\).*toUpperCase/);
  assert.match(signage, /\/manage\/players\/:id\/rotate-token/);
  assert.match(signagePage, /Générer un nouveau jeton/);
});

test('Android validates a token before persisting it or opening the player', () => {
  assert.match(signage, /\/player\/verify/);
  assert.match(androidPlayer, /\/api\/signage\/player\/verify/);
  assert.match(androidPlayer, /Vérifier et associer ce Player/);
  assert.match(androidPlayer, /HTTP 401/);
});

test('Android only acknowledges after decoding and restores cached playback after restart', () => {
  assert.match(androidPlayer, /playCached\(\);\s*heartbeat\(\);/);
  assert.match(androidPlayer, /setOnPreparedListener\(this::onVideoPrepared\)/);
  assert.match(androidPlayer, /if \(preparingCandidate\) activateCandidate\(\)/);
  assert.match(androidPlayer, /acknowledge\(publicationId, "active", ""\)/);
  assert.match(androidPlayer, /acknowledge\(publicationId, "failed", reason\)/);
  assert.match(androidPlayer, /ImageView/);
  assert.match(androidPlayer, /checksum_sha256/);
  assert.match(scheduledPlayer, /0\.6\.0-pilot/);
});

test('guardian remains visible to the server even when playback activity is stopped', () => {
  assert.match(guardian, /\/api\/signage\/player\/runtime-heartbeat/);
  assert.match(guardian, /START_STICKY/);
  assert.match(guardian, /NetworkCallback/);
  assert.match(runtime, /runtime_last_seen_at/);
  assert.match(runtime, /launchRequested/);
  assert.doesNotMatch(runtime, /token_hash\s*:/);
});

test('cockpit serves the signed metadata-selected Player and keeps legacy explicit only', () => {
  assert.match(apkRoute, /pixelium-player-release\.json/);
  assert.match(apkRoute, /`Pixelium-Player-Olivier-\$\{version\}\.apk`/);
  assert.match(apkRoute, /Pixelium-Player-Olivier-0\.3\.0-pilot\.apk/);
  assert.match(apkRoute, /res\.sendFile\(apk\.path/);
  assert.match(apkRoute, /Cache-Control': 'no-store'/);
  assert.match(apkRoute, /signed-release/);
  assert.match(apkRoute, /legacy-explicit/);
  assert.match(apkRoute, /router\.get\('\/latest', downloadSignedPlayer\)/);
  assert.doesNotMatch(apkRoute, /downloadSignedPlayer[\s\S]*resolveLegacyApk\(\)/);
  assert.doesNotMatch(apkRoute, /Buffer\.from/);
  assert.match(signagePage, /href="\/api\/player-download\/android"/);
  assert.match(signagePage, /Générer un nouveau jeton d’association/);
});

test('signage page reports non-JSON responses without exposing parser errors', () => {
  assert.match(signagePage, /content-type/);
  assert.match(signagePage, /Le service du cockpit est momentanément indisponible/);
  assert.doesNotMatch(signagePage, /await response\.json\(\)/);
});

test('Dropbox media upload handles non-JSON failures and proxies binary through the cockpit', () => {
  assert.match(signage, /async function dropboxJson/);
  assert.match(signage, /const raw = await response\.text\(\)/);
  assert.match(signage, /réponse non JSON/);
  assert.match(signage, /La connexion Dropbox du cockpit doit être renouvelée/);
  assert.match(signage, /api\.dropboxapi\.com\/2\/files\/get_temporary_upload_link/);
  assert.doesNotMatch(signage, /content\.dropboxapi\.com\/2\/files\/get_temporary_upload_link/);
  assert.match(signage, /content\.dropboxapi\.com\/2\/files\/upload/);
  assert.match(signage, /express\.raw\(\{type:'application\/octet-stream',limit:MAX_MEDIA_BYTES\}\)/);
  assert.match(signage, /Le média dépasse la limite de 150 Mo/);
  assert.match(signagePage, /\/manage\/media\/upload\?name=/);
  assert.doesNotMatch(signagePage, /session\.uploadUrl/);
  assert.match(signagePage, /setRequestHeader\("Content-Type", "application\/octet-stream"\)/);
  assert.doesNotMatch(signagePage, /Dropbox-API-Arg/);
  assert.match(dockerfile, /client_max_body_size 150m/);
});

test('signage cockpit exposes upload progress and a durable completion state', () => {
  assert.match(signagePage, /new XMLHttpRequest\(\)/);
  assert.match(signagePage, /xhr\.upload\.onprogress/);
  assert.match(signagePage, /role="progressbar"/);
  assert.match(signagePage, /Conversion vidéo compatible MXQ/);
  assert.match(signagePage, /Conversion terminée\. Le média est prêt pour le Player/);
  assert.match(signagePage, /aria-valuenow=\{transfer\.percent\}/);
});

test('publications always target the most recently connected playback Player', () => {
  assert.match(signage, /Date\.now\(\)-new Date\(player\.last_seen_at\)\.getTime\(\)<120000/);
  assert.match(signage, /const targetPlayer=recentPlayers\[0\]\|\|requestedPlayer/);
  assert.match(signage, /player_id:targetPlayer\.id/);
  assert.match(signagePage, /new Date\(b\.last_seen_at \|\| 0\).*new Date\(a\.last_seen_at \|\| 0\)/);
  assert.doesNotMatch(signagePage, /const player = players\[0\]/);
});
