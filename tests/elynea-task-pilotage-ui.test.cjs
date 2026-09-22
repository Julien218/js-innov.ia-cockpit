const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tasksPage = fs.readFileSync(path.join(root, 'src', 'pages', 'Taches.jsx'), 'utf8');
const taskStatus = fs.readFileSync(path.join(root, 'src', 'lib', 'taskStatus.js'), 'utf8');
const { resolveNovaExecutor } = require(path.join(root, 'server-nova-executors.cjs'));

test('task pilotage is presented under the Elynea identity', () => {
  assert.match(tasksPage, /Pilotage Elynea/);
  assert.doesNotMatch(tasksPage, /Pilotage NOVA/);
  assert.match(tasksPage, /Autoriser Elynea à exécuter les tâches supportées/);
});

test('known blocker codes are translated for the operator', () => {
  assert.match(taskStatus, /aucun_executeur_reel_enregistre_pour_ce_type_de_tache/);
  assert.match(taskStatus, /media_source_absente_ou_non_exploitable/);
  assert.match(taskStatus, /diagnostic_application_camera_non_raccorde/);
  assert.match(taskStatus, /diagnostic_frontend_cockpit_non_raccorde/);
  assert.match(taskStatus, /maintenance_doublons_taches_non_raccordee/);
});

test('known cockpit maintenance tasks get precise blocker reasons', () => {
  assert.equal(
    resolveNovaExecutor({ titre: 'Effacer les doublons dans les tâches en cours' }).reason,
    'maintenance_doublons_taches_non_raccordee',
  );
  assert.equal(
    resolveNovaExecutor({ titre: "Analyse front-end ciblée pour le problème d'affichage du bouton dans l'onglet tâches" }).reason,
    'diagnostic_frontend_cockpit_non_raccorde',
  );
  assert.equal(
    resolveNovaExecutor({ titre: "Analyser l'application liée aux caméras d'Olivier" }).reason,
    'diagnostic_application_camera_non_raccorde',
  );
});
