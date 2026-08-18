const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const route = read('server-player-apk.cjs');
const dockerfile = read('Dockerfile');
const workflow = read('.github/workflows/signage-pilot-ci.yml');
const gradle = read('player-android/app/build.gradle');

test('TVBOX receives the verified 0.5 release through a stable short URL', () => {
  assert.match(route, /Pixelium-Player-Olivier-0\.5\.0-pilot\.apk/);
  assert.match(route, /Pixelium-Player-Olivier-0\.3\.0-pilot\.apk/);
  assert.match(route, /fs\.existsSync\(RELEASE_APK_PATH\)/);
  assert.match(route, /signed-release/);
  assert.match(route, /legacy-fallback/);
  assert.match(route, /res\.sendFile\(apk\.path/);
  assert.match(dockerfile, /location = \/player/);
  assert.match(dockerfile, /return 302 \/api\/player-download\/android/);
});

test('release signing uses repository secrets without committing private material', () => {
  assert.match(gradle, /PIXELIUM_KEYSTORE_PATH/);
  assert.match(gradle, /PIXELIUM_KEYSTORE_PASSWORD/);
  assert.match(gradle, /pixelium-release/);
  assert.match(workflow, /secrets\.PIXELIUM_KEYSTORE_B64/);
  assert.match(workflow, /secrets\.PIXELIUM_KEYSTORE_PASSWORD/);
  assert.match(workflow, /EXPECTED_RELEASE_CERT_SHA256/);
  assert.match(workflow, /8fed74014024629caa1d253264e894e627dc1b96ce1add75d4ee8dad87f89cf9/);
  assert.doesNotMatch(workflow, /BEGIN (RSA )?PRIVATE KEY/);
});

test('verified APK and non-secret release metadata are published for Railway', () => {
  assert.match(workflow, /assets\/Pixelium-Player-Olivier-0\.5\.0-pilot\.apk/);
  assert.match(workflow, /assets\/pixelium-player-release\.json/);
  assert.match(workflow, /apksigner.*verify --print-certs/s);
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /git push origin/);
  assert.match(route, /certificateSha256/);
  assert.match(route, /apkSha256/);
});
