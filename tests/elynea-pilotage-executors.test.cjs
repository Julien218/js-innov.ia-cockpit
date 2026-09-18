const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { resolveNovaExecutor } = require('../server-nova-executors.cjs');

test('Elynea route un MP3 référencé vers le téléchargement document', () => {
  const executor = resolveNovaExecutor({
    titre: 'Télécharger le média Les Mots en Retrait.mp3',
    description: 'source_document_id: document-12345678',
  });
  assert.equal(executor.kind, 'document');
  assert.equal(executor.name, 'Elynea · Téléchargement document');
});

test('Elynea route la vérification des inscriptions Miss & Mister Dour vers un audit réel', () => {
  const executor = resolveNovaExecutor({
    titre: 'Vérification des données d’inscription pour Miss et Mister Dour',
  });
  assert.equal(executor.kind, 'registration');
  assert.equal(executor.name, 'Elynea · Inscriptions Miss & Mister Dour');
});

test('Elynea route le nettoyage des doublons vers la maintenance des tâches', () => {
  const executor = resolveNovaExecutor({
    titre: 'Effacer les doublons dans les tâches en cours',
  });
  assert.equal(executor.kind, 'task_maintenance');
  assert.equal(executor.name, 'Elynea · Maintenance des tâches');
});

test('le pilotage visible ne présente plus NOVA comme assistant', () => {
  const tasks = fs.readFileSync(path.join(root, 'src/pages/Taches.jsx'), 'utf8');
  const floating = fs.readFileSync(path.join(root, 'src/components/FloatingAgent.jsx'), 'utf8');
  assert.match(tasks, /Pilotage Elynea/);
  assert.doesNotMatch(tasks, /Pilotage NOVA/);
  assert.match(floating, />Elynea</);
  assert.match(floating, /Tu es Elynea/);
});

test('une attente utilisateur n’est pas comptée comme blocage réel', () => {
  const status = fs.readFileSync(path.join(root, 'src/lib/taskStatus.js'), 'utf8');
  assert.match(status, /\["NO_EXECUTOR", "TECHNICAL_ERROR", "FAILED"\]/);
  assert.doesNotMatch(status, /\["NO_EXECUTOR", "TECHNICAL_ERROR", "FAILED", "WAITING_INPUT"\]/);
});

test('le moteur batch raccorde les nouveaux exécuteurs Elynea', () => {
  const batch = fs.readFileSync(path.join(root, 'server-task-batch.cjs'), 'utf8');
  assert.match(batch, /handlers\.registration/);
  assert.match(batch, /handlers\.document/);
  assert.match(batch, /handlers\.taskMaintenance/);
  assert.match(batch, /statut: taskStatus/);
});

test('la page tâches propose un vrai téléchargement pour un document référencé', () => {
  const tasks = fs.readFileSync(path.join(root, 'src/pages/Taches.jsx'), 'utf8');
  assert.match(tasks, /taskDocumentId/);
  assert.match(tasks, /\/api\/documents\/\$\{encodeURIComponent\(documentId\)\}\/download/);
  assert.match(tasks, />\s*Télécharger\s*</);
});
