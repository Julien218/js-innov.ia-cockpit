const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeAction } = require('../server-assistant.cjs');

const root = path.resolve(__dirname, '..');
const owner = { role: 'superadmin', organisation: 'jsinnovia' };
const admin = { role: 'admin', organisation: 'jsinnovia' };

test('NOVA prépare la redirection IONOS uniquement pour un domaine géré et sa cible www', () => {
  const action = sanitizeAction({
    type: 'execute_authenticated_web_task',
    payload: {
      provider: 'ionos',
      task_type: 'domain_redirect',
      domain: 'letourdedour.com',
      destination: 'https://www.letourdedour.com',
      preserve_path: true,
    },
  }, owner);
  assert.equal(action.definition.clientActionKind, 'electron_web_task');
  assert.equal(action.payload.domain, 'letourdedour.com');
  assert.equal(action.payload.destination, 'https://www.letourdedour.com');
});

test('la tâche web authentifiée est refusée aux autres rôles et aux destinations externes', () => {
  const validPayload = {
    provider: 'ionos', task_type: 'domain_redirect', domain: 'letourdedour.com',
    destination: 'https://www.letourdedour.com', preserve_path: true,
  };
  assert.equal(sanitizeAction({ type: 'execute_authenticated_web_task', payload: validPayload }, admin), null);
  assert.equal(sanitizeAction({
    type: 'execute_authenticated_web_task', payload: { ...validPayload, destination: 'https://example.com' },
  }, owner), null);
});

test('le desktop embarque un relais web persistant, restreint à IONOS et vérifié avant succès', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'package.json'), 'utf8'));
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  const runner = fs.readFileSync(path.join(root, 'electron', 'web-assistant.cjs'), 'utf8');
  assert.ok(pkg.build.files.includes('web-assistant.cjs'));
  assert.match(main, /nova-web-assistant-execute/);
  assert.match(preload, /webAssistant/);
  assert.match(runner, /persist:nova-web-ionos/);
  assert.match(runner, /ALLOWED_IONOS_HOST/);
  assert.match(runner, /MANAGED_IONOS_DOMAINS/);
  assert.match(runner, /status: 'verified'/);
  assert.match(runner, /capturePage/);
  assert.match(main, /Appel refusé hors du Cockpit JS-Innov\.IA/);
});
