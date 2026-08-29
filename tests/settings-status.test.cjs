const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { settingsStatus } = require('../server-settings.cjs');

test('le statut paramètres expose uniquement la présence des connecteurs', () => {
  const previous = process.env.IONOS_API_KEY;
  process.env.IONOS_API_KEY = 'secret-qui-ne-doit-jamais-sortir';
  try {
    const status = settingsStatus({ id: 'owner', role: 'superadmin' });
    const serialized = JSON.stringify(status);
    assert.equal(status.integrations.find((item) => item.variable === 'IONOS_API_KEY').configured, true);
    assert.equal(serialized.includes(process.env.IONOS_API_KEY), false);
    assert.equal(status.security.secrets_server_side, true);
    assert.equal(status.builder.inline_editor, false);
  } finally {
    if (previous === undefined) delete process.env.IONOS_API_KEY;
    else process.env.IONOS_API_KEY = previous;
  }
});

test('Paramètres ne contient plus de faux formulaires ni de mentions bientôt disponible', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/Parametres.jsx'), 'utf8');
  assert.match(page, /\/api\/settings\/status/);
  assert.match(page, /Éditeur intégré : non installé/);
  assert.doesNotMatch(page, /bientôt disponible/i);
  assert.doesNotMatch(page, /type="password"/);
});

test('le serveur et Docker embarquent le statut sécurisé des paramètres', () => {
  const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(server, /\/api\/settings/);
  assert.match(server, /requirePermission\('settings', 'admin'\)/);
  assert.match(docker, /server-settings\.cjs/);
});
