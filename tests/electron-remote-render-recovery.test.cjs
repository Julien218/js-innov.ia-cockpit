const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'electron', 'bootstrap.js'), 'utf8');

test('desktop keeps the canonical remote cockpit URL and local offline fallback', () => {
  assert.match(main, /const REMOTE_COCKPIT_URL = "https:\/\/cockpit\.jsinnovia\.com"/);
  assert.match(main, /const OFFLINE_COCKPIT_URL = "http:\/\/127\.0\.0\.1:8790"/);
  assert.match(main, /mainWindow\.loadURL\(REMOTE_COCKPIT_URL\)/);
});

test('desktop validates that React rendered before showing the remote cockpit', () => {
  assert.match(main, /inspectRemoteCockpitDocument/);
  assert.match(main, /document\.querySelector\('#root'\)/);
  assert.match(main, /rootChildCount/);
  assert.match(main, /raw_source_rendered/);
  assert.match(main, /unexpected_content_type/);
});

test('desktop repairs only renderer caches and preserves authentication storage', () => {
  assert.match(bootstrap, /clearCache\(\)/);
  assert.match(bootstrap, /storages:\s*\["serviceworkers", "cachestorage"\]/);
  assert.doesNotMatch(bootstrap, /storages:\s*\[[^\]]*"cookies"/);
  assert.doesNotMatch(bootstrap, /storages:\s*\[[^\]]*"localstorage"/);
  assert.match(main, /reloadIgnoringCache\(\)/);
});

test('desktop falls back offline after one invalid remote render retry', () => {
  assert.match(main, /remoteRenderRecoveryAttempts < 1/);
  assert.match(main, /remoteRenderRecoveryAttempts \+= 1/);
  assert.match(main, /win\.loadURL\(OFFLINE_COCKPIT_URL\)/);
});
