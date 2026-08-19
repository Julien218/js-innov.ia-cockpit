const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const route = read('server-player-apk.cjs');
const dockerfile = read('Dockerfile');
const releaseWorkflow = read('.github/workflows/pixelium-release-recovery.yml');
const ciWorkflow = read('.github/workflows/signage-pilot-ci.yml');
const gradle = read('player-android/app/build.gradle');
const metadata = JSON.parse(read('assets/pixelium-player-release.json'));

test('TVBOX receives the metadata-selected signed release through stable endpoints', () => {
  assert.match(route, /pixelium-player-release\.json/);
  assert.match(route, /`Pixelium-Player-Olivier-\$\{version\}\.apk`/);
  assert.match(route, /Pixelium-Player-Olivier-0\.3\.0-pilot\.apk/);
  assert.match(route, /release_apk_missing/);
  assert.match(route, /release_checksum_mismatch/);
  assert.match(route, /signed-release/);
  assert.match(route, /legacy-explicit/);
  assert.match(route, /router\.get\('\/latest', downloadSignedPlayer\)/);
  assert.match(route, /router\.get\('\/legacy', downloadLegacyPlayer\)/);
  assert.match(route, /res\.sendFile\(apk\.path/);
  assert.match(dockerfile, /location = \/player/);
  assert.match(dockerfile, /return 302 \/api\/player-download\/android/);
});

test('release signing uses repository secrets without committing private material', () => {
  assert.match(gradle, /versionName '0\.5\.3-pilot'/);
  assert.match(gradle, /PIXELIUM_KEYSTORE_PATH/);
  assert.match(gradle, /PIXELIUM_KEYSTORE_PASSWORD/);
  assert.match(gradle, /pixelium-release/);
  assert.match(releaseWorkflow, /secrets\.PIXELIUM_KEYSTORE_B64/);
  assert.match(releaseWorkflow, /secrets\.PIXELIUM_KEYSTORE_PASSWORD/);
  assert.match(releaseWorkflow, /EXPECTED_CERT/);
  assert.match(releaseWorkflow, /8fed74014024629caa1d253264e894e627dc1b96ce1add75d4ee8dad87f89cf9/);
  assert.doesNotMatch(releaseWorkflow, /BEGIN (RSA )?PRIVATE KEY/);
});

test('verified 0.5.3 APK and non-secret metadata are published once for Railway', () => {
  assert.equal(metadata.version, '0.5.3-pilot');
  assert.match(metadata.apkSha256, /^[0-9a-f]{64}$/);
  assert.equal(metadata.certificateSha256.replaceAll(':', '').toLowerCase(), '8fed74014024629caa1d253264e894e627dc1b96ce1add75d4ee8dad87f89cf9');
  assert.match(releaseWorkflow, /assets\/Pixelium-Player-Olivier-0\.5\.3-pilot\.apk/);
  assert.match(releaseWorkflow, /assets\/pixelium-player-release\.json/);
  assert.match(releaseWorkflow, /apksigner.*verify --print-certs/s);
  assert.match(releaseWorkflow, /sha256sum/);
  assert.match(releaseWorkflow, /git push origin/);
  assert.doesNotMatch(ciWorkflow, /release-android:/);
  assert.match(ciWorkflow, /publication signée est volontairement centralisée/i);
  assert.match(route, /certificateSha256/);
  assert.match(route, /apkSha256/);
});
