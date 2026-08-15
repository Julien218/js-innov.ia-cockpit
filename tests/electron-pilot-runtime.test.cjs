const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'package.json'), 'utf8'));
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

test('Windows pilot opens the Olivier staging cockpit', () => {
  assert.equal(pkg.version, '1.1.1');
  assert.match(main, /olivier-signage-cockpit-production\.up\.railway\.app/);
  assert.match(main, /mainWindow\.loadURL\(COCKPIT_URL\)/);
});

test('staging CSP permits only the local agent HTTP endpoints', () => {
  assert.match(dockerfile, /connect-src[^;]*http:\/\/127\.0\.0\.1:8787/);
  assert.match(dockerfile, /connect-src[^;]*http:\/\/localhost:8787/);
});

