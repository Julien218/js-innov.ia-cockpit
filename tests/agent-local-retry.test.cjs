const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Agent.jsx'), 'utf8');

test('Companion retries local-agent detection after Electron startup', () => {
  assert.match(source, /window\.setInterval\(checkAgent, 10000\)/);
  assert.match(source, /window\.clearInterval\(localAgentRetry\)/);
});

