const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('la CSP du Cockpit autorise les services locaux NOVA et Avatar Factory', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /connect-src[^\n]*http:\/\/127\.0\.0\.1:8787/);
  assert.match(dockerfile, /connect-src[^\n]*http:\/\/localhost:8787/);
  assert.match(dockerfile, /connect-src[^\n]*http:\/\/127\.0\.0\.1:8791/);
  assert.match(dockerfile, /connect-src[^\n]*http:\/\/127\.0\.0\.1:8792/);
  assert.match(dockerfile, /connect-src[^\n]*http:\/\/127\.0\.0\.1:8793/);
  assert.match(dockerfile, /connect-src[^\n]*http:\/\/127\.0\.0\.1:8788/);
});

test('le Local Agent autorise explicitement le domaine Cockpit en CORS', () => {
  const localAgent = read('local-agent/server.js');
  assert.match(localAgent, /https:\/\/cockpit\.jsinnovia\.com/);
  assert.match(localAgent, /Access-Control-Allow-Origin/);
  assert.match(localAgent, /Access-Control-Allow-Private-Network/);
  assert.doesNotMatch(localAgent, /Access-Control-Allow-Origin'\s*,\s*'\*'/);
});

test('le frontend cible Elynea Local Tools sur 8788 avec fallback 8787', () => {
  const agentPage = read('src/pages/Agent.jsx');
  assert.match(agentPage, /LOCAL_AGENT_URLS\s*=\s*\["http:\/\/127\.0\.0\.1:8788",\s*"http:\/\/127\.0\.0\.1:8787"\]/);
  assert.match(agentPage, /fetch\(`\$\{baseUrl\}\/health`/);
});
