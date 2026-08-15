const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'package.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'electron-build.yml'), 'utf8');

test('desktop cockpit remains a secure shell around the hosted cockpit', () => {
  assert.match(main, /loadURL\("https:\/\/cockpit\.jsinnovia\.com"\)/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
});

test('desktop updates download automatically and install safely on exit', () => {
  assert.equal(pkg.version, '1.1.0');
  assert.ok(pkg.dependencies['electron-updater']);
  assert.equal(pkg.build.publish[0].provider, 'github');
  assert.equal(pkg.build.publish[0].owner, 'Julien218');
  assert.equal(pkg.build.publish[0].repo, 'js-innov.ia-cockpit');
  assert.match(main, /autoUpdater\.autoDownload = true/);
  assert.match(main, /autoUpdater\.autoInstallOnAppQuit = true/);
  assert.match(main, /autoUpdater\.on\("update-downloaded"/);
  assert.match(main, /autoUpdater\.quitAndInstall\(false, true\)/);
  assert.match(main, /if \(!app\.isPackaged\)/);
  assert.match(preload, /onUpdateProgress/);
  assert.match(preload, /onUpdateDownloaded/);
});

test('GitHub release contains metadata required by electron-updater', () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /electron\/dist\/latest\.yml/);
  assert.match(workflow, /electron\/dist\/\*\.blockmap/);
});
