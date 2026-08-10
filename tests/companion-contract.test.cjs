const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const agentPage = fs.readFileSync(path.join(root, 'src/pages/Agent.jsx'), 'utf8');
const assistantServer = fs.readFileSync(path.join(root, 'server-assistant.cjs'), 'utf8');

test('Companion restaure et efface une mémoire serveur persistante', () => {
  assert.match(agentPage, /\/api\/assistant\/history\?conversation_id=/);
  assert.match(agentPage, /method:\s*'DELETE'/);
  assert.match(assistantServer, /router\.get\('\/history'/);
  assert.match(assistantServer, /router\.post\('\/history\/append'/);
  assert.match(assistantServer, /router\.delete\('\/history'/);
});

test('le mode Companion automatique ne bloque pas si 8787 est hors ligne', () => {
  assert.match(agentPage, /provider === "auto"/);
  assert.match(agentPage, /Cloud actif/);
  assert.match(agentPage, /return sendToCloud\(msg\)/);
});

test('les réponses locales sont synchronisées dans la mémoire cloud', () => {
  assert.match(agentPage, /persistMessages\(\[\{ role: 'user', content: msg \}, \{ role: 'assistant', content: result\.response \}\]\)/);
  assert.match(assistantServer, /\/chat\/session\/\$\{encodeURIComponent\(sessionId\)\}\/messages/);
});

test('les écritures restent soumises à confirmation avant exécution', () => {
  assert.match(assistantServer, /require_confirmation_for_actions:\s*true/);
  assert.match(assistantServer, /pending\.set\(token/);
  assert.match(agentPage, /Confirmation obligatoire/);
  assert.match(agentPage, /Action réellement exécutée/);
});

test('le même session_id est réutilisé pour la conversation principale', () => {
  assert.match(assistantServer, /conversationId === 'main' \? `cockpit:\$\{req\.user\.id\}`/);
  assert.match(assistantServer, /session_id:\s*sessionId/);
});
