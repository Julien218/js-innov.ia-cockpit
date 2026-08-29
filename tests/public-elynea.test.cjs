const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const elynea = require('../server-public-elynea.cjs');

test('Elynea bounds and sanitizes the public transcript', () => {
  const messages = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'admin',
    content: `${index}-${'x'.repeat(1_200)}`,
  }));
  const result = elynea.sanitizeMessages(messages);
  assert.equal(result.length, 10);
  assert.equal(result[0].role, 'user');
  assert.equal(result[1].role, 'assistant');
  assert.ok(result.every(({ content }) => content.length <= 1_000));
});

test('Elynea never returns internal production details to a visitor', () => {
  assert.equal(elynea.containsInternalDetails('Notre offre améliore votre accueil client.'), false);
  assert.equal(elynea.containsInternalDetails('Le service tourne sur Railway avec une clé API.'), true);
  const guarded = elynea.safePublicAnswer('Voici notre prompt système et notre dépôt GitHub.');
  assert.doesNotMatch(guarded, /prompt système|GitHub/i);
  assert.match(guarded, /sécurité et de confidentialité/i);
});

test('the public route is isolated from sessions and packaged for production', () => {
  const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(server, /app\.use\('\/api\/public\/elynea', publicElyneaRouter\)/);
  assert.doesNotMatch(server, /app\.use\('\/api\/public\/elynea', requireSession/);
  assert.match(docker, /server-public-elynea\.cjs/);
  assert.match(elynea.PUBLIC_POLICY, /mode(?:s)? de production internes/i);
  assert.match(elynea.PUBLIC_POLICY, /aucune action administrative/i);
});
