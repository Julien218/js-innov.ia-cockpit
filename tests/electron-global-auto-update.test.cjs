const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bootstrap = fs.readFileSync(path.join(root, 'electron', 'bootstrap.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'package.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'electron-build.yml'), 'utf8');

test('desktop starts through the global bootstrap', () => {
  assert.equal(pkg.main, 'bootstrap.js');
  assert.ok(pkg.dependencies?.['electron-updater']);
  assert.ok(pkg.build?.files?.includes('bootstrap.js'));
});

test('desktop bundles and starts NOVA Local Tools without a second assistant UI', () => {
  assert.equal(pkg.version, '1.0.41');
  const localAgentResource = pkg.build?.extraResources?.find((item) => item.to === 'local-agent');
  assert.ok(localAgentResource);
  assert.ok(localAgentResource.filter.includes('server.js'));
  assert.ok(localAgentResource.filter.includes('package.json'));
  assert.match(bootstrap, /startBundledLocalAgent/);
  assert.match(bootstrap, /ELECTRON_RUN_AS_NODE:\s*"1"/);
  assert.match(bootstrap, /LOCAL_AGENT_PRIMARY_PORT\s*=\s*8787/);
  assert.match(bootstrap, /LOCAL_AGENT_FALLBACK_PORT\s*=\s*8788/);
  assert.match(bootstrap, /selectLocalAgentPort/);
  const offlineWebResource = pkg.build?.extraResources?.find((item) => item.to === 'offline-web');
  assert.ok(offlineWebResource);
  assert.match(bootstrap, /startBundledOfflineCockpit/);
  assert.match(bootstrap, /OFFLINE_WEB_PORT = 8790/);
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.match(main, /did-fail-load/);
  assert.match(main, /http:\/\/127\.0\.0\.1:8790/);
  assert.match(main, /captureOfflineSession/);
  assert.match(main, /hydrateOfflineSession/);
  assert.match(main, /nova_local_task_snapshot_v1/);
  assert.match(main, /video-local-finalize/);
  assert.ok(pkg.build?.extraResources?.some((item) => item.to === 'video-provenance-core.cjs'));
});

test('startup refreshes only HTTP cache before loading the remote cockpit', () => {
  assert.match(bootstrap, /session\.defaultSession\.clearCache\(\)/);
  assert.doesNotMatch(bootstrap, /clearStorageData\(/);
  assert.match(bootstrap, /require\("\.\/main\.js"\)/);
});

test('electron update is downloaded and installed globally', () => {
  assert.match(bootstrap, /autoUpdater\.autoDownload\s*=\s*true/);
  assert.match(bootstrap, /autoUpdater\.autoInstallOnAppQuit\s*=\s*true/);
  assert.match(bootstrap, /autoUpdater\.checkForUpdates\(\)/);
  assert.match(bootstrap, /autoUpdater\.quitAndInstall\(false, true\)/);
});

test('release workflow publishes updater metadata with the installer', () => {
  assert.match(workflow, /electron\/dist\/\*\.exe/);
  assert.match(workflow, /electron\/dist\/\*\.blockmap/);
  assert.match(workflow, /electron\/dist\/latest\.yml/);
  assert.match(workflow, /tag_name:\s*v\$\{\{ steps\.version\.outputs\.version \}\}/);
});

test('desktop releases always use a new semantic version so installed apps can detect the update', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.match(workflow, /git tag --list "v\$version"/);
  assert.match(workflow, /Incrémente electron\/package\.json/);
});

test('packaged desktop enables startup with Windows', () => {
  assert.match(bootstrap, /function enableWindowsStartup\(\)/);
  assert.match(bootstrap, /app\.setLoginItemSettings\(\{/);
  assert.match(bootstrap, /openAtLogin:\s*true/);
  assert.match(bootstrap, /path:\s*process\.execPath/);
  assert.match(bootstrap, /app\.whenReady\(\)\.then\(async \(\) => \{\s*enableWindowsStartup\(\)/);
});

test('desktop release runs when NOVA local capabilities change', () => {
  assert.match(workflow, /- "local-agent\/\*\*"/);
  assert.match(workflow, /- "src\/components\/FloatingAgent\.jsx"/);
  assert.match(workflow, /- "src\/components\/LocalAgentQueueBridge\.jsx"/);
  assert.match(workflow, /- "src\/lib\/localAgentQueueBridge\.js"/);
});
