const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');

test('desktop cockpit starts the local AI agent without blocking the window', () => {
  assert.match(main, /http:\/\/127\.0\.0\.1:8787\/health/);
  assert.match(main, /function startLocalAgent\(\)/);
  assert.match(main, /startLocalAgent\(\)\.catch/);
  assert.match(main, /const splash = createSplash\(\)/);
  assert.match(main, /spawn\(resolveNodeExecutable\(\)/);
  assert.match(main, /windowsHide: true/);
  assert.match(main, /detached: true/);
  assert.match(main, /child\.unref\(\)/);
});

test('local AI startup is idempotent and reports a safe fallback state', () => {
  assert.match(main, /if \(localAgentStartPromise\) return localAgentStartPromise/);
  assert.match(main, /if \(await isLocalAgentReady\(\)\)/);
  assert.match(main, /JSINNOVIA_LOCAL_AGENT_FILE/);
  assert.match(main, /le Cockpit reste accessible en ligne/);
  assert.match(preload, /onLocalAgentStatus/);
  assert.match(preload, /local-agent-status/);
});

