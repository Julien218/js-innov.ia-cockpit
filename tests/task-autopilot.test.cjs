const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const autopilot = require(path.join(root, 'server-task-autopilot.cjs'));

test('l’autopilote regroupe les titres dupliqués', () => {
  assert.equal(autopilot.canonicalTaskTitle('SEO automatique — jsinnovia.com (duplicata)'), autopilot.canonicalTaskTitle('SEO automatique — jsinnovia.com'));
});

test('les diagnostics de domaine sont exécutables sans effet métier', () => {
  const item = autopilot.classifyTask({ titre: 'Contrôler DNS et TLS — jsinnovia.com' });
  assert.equal(item.kind, 'domain_diagnostic');
  assert.equal(item.domain, 'jsinnovia.com');
  assert.equal(item.executable, true);
});

test('les réparations DNS et SEO ne sont jamais lancées sans connecteur d’écriture', () => {
  for (const title of ['Réparation IA — jsinnovia.com', 'SEO automatique — jsinnovia.com']) {
    const item = autopilot.classifyTask({ titre: title });
    assert.equal(item.kind, 'sensitive_domain_write');
    assert.equal(item.executable, false);
  }
});

test('les tâches locales et métier restent bloquées avec une cause exacte', () => {
  assert.equal(autopilot.classifyTask({ titre: 'Vérifier workflow MiniMax H3 local' }).reason, 'agent_windows_local_requis');
  assert.equal(autopilot.classifyTask({ titre: 'Compléter les données TVA du client' }).reason, 'donnees_metier_ou_validation_humaine_requises');
});

test('le serveur et Docker embarquent l’autopilote permanent', () => {
  const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(server, /startTaskAutopilotScheduler/);
  assert.match(server, /\/api\/task-autopilot/);
  assert.match(docker, /server-task-autopilot\.cjs/);
  assert.match(docker, /node --check \/app\/server-task-autopilot\.cjs/);
});
