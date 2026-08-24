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
  assert.equal(pkg.version, '1.0.20');
  const localAgentResource = pkg.build?.extraResources?.find((item) => item.to === 'local-agent');
  assert.ok(localAgentResource);
  assert.ok(localAgentResource.filter.includes('server.js'));
  assert.ok(localAgentResource.filter.includes('package.json'));
  assert.match(bootstrap, /startBundledLocalAgent/);
  assert.match(bootstrap, /ELECTRON_RUN_AS_NODE:\s*"1"/);
  assert.match(bootstrap, /legacyOnline \? 8788 : 8787/);
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
