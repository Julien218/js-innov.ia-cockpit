const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const bootstrap = fs.readFileSync(path.join(root, 'electron', 'bootstrap.js'), 'utf8');
const electronPackage = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'package.json'), 'utf8'));
const bridge = fs.readFileSync(path.join(root, 'src', 'lib', 'localAgentQueueBridge.js'), 'utf8');

test('le binaire Windows redémarre Elynea locale après sortie ou perte de santé', () => {
  assert.match(bootstrap, /LOCAL_AGENT_WATCHDOG_MS\s*=\s*15_000/);
  assert.match(bootstrap, /child\.once\("exit"/);
  assert.match(bootstrap, /child\.once\("error"/);
  assert.match(bootstrap, /scheduleLocalAgentRestart\("process_exit"\)/);
  assert.match(bootstrap, /scheduleLocalAgentRestart\("watchdog_incompatible_or_unresponsive"/);
  assert.match(bootstrap, /startLocalAgentWatchdog\(\)/);
  assert.match(bootstrap, /LOCAL_AGENT_MAX_MISSES\s*=\s*3/);
});

test('le runtime courant sur 8788 est préféré au service historique sur 8787', () => {
  const primary = bridge.indexOf('http://127.0.0.1:8788');
  const legacy = bridge.indexOf('http://127.0.0.1:8787');
  assert.ok(primary >= 0 && legacy >= 0 && primary < legacy);
  assert.match(bootstrap, /historique/i);
  assert.match(bootstrap, /LOCAL_AGENT_PRIMARY_PORT\s*=\s*8788/);
  assert.match(bootstrap, /LOCAL_AGENT_FALLBACK_PORT\s*=\s*8787/);
});

test('la nouvelle version Electron est publiable par l’auto-update', () => {
  assert.equal(electronPackage.version, '1.0.43');
  assert.equal(electronPackage.main, 'bootstrap.js');
  assert.ok(electronPackage.dependencies?.['electron-updater']);
});
