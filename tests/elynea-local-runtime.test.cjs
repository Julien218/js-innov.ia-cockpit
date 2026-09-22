const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { resolveNovaExecutor } = require(path.join(root, 'server-nova-executors.cjs'));

test('Elynea utilise le runtime local pour une analyse front-end générale en lecture seule', () => {
  const executor = resolveNovaExecutor({
    titre: "Analyse front-end ciblée pour le problème d'affichage du bouton dans l'onglet tâches",
  });
  assert.equal(executor.kind, 'local');
  assert.equal(executor.id, 'nova-general-local');
  assert.match(executor.name, /Elynea/);
  assert.deepEqual(executor.capabilities, ['workspace_task_analysis']);
});

test('une action générique d’écriture ne tombe pas dans le fallback local autonome', () => {
  const executor = resolveNovaExecutor({
    titre: "Corriger puis modifier le bouton dans l'onglet tâches",
  });
  assert.equal(executor.kind, 'unsupported');
});

test('une tâche caméra sans source exploitable conserve son blocage métier', () => {
  const executor = resolveNovaExecutor({
    titre: "Analyser l'application liée aux caméras d'Olivier",
  });
  assert.equal(executor.kind, 'unsupported');
  assert.equal(executor.reason, 'media_source_absente_ou_non_exploitable');
});

test('le runtime local Elynea expose l’analyse d’espace de travail en lecture seule', () => {
  const source = fs.readFileSync(path.join(root, 'local-agent', 'server.js'), 'utf8');
  assert.match(source, /const VERSION = '1\.6\.0'/);
  assert.match(source, /workspace_task_analysis/);
  assert.match(source, /workspaceTaskAnalysis/);
  assert.match(source, /read_only:\s*true/);
  assert.match(source, /ALLOWED_ROOTS/);
});

test('le pilotage visible est Elynea tandis que les identifiants NOVA restent compatibles en interne', () => {
  const tasksPage = fs.readFileSync(path.join(root, 'src', 'pages', 'Taches.jsx'), 'utf8');
  const floating = fs.readFileSync(path.join(root, 'src', 'components', 'FloatingAgent.jsx'), 'utf8');
  const registry = fs.readFileSync(path.join(root, 'server-agent-registry.cjs'), 'utf8');

  assert.match(tasksPage, /Pilotage Elynea/);
  assert.doesNotMatch(tasksPage, /Pilotage NOVA/);
  assert.match(floating, /Voix d’Elynea/);
  assert.match(registry, /il n'existe qu'un seul agent IA public et logique,\s*\n \* Elynea/);
  assert.match(registry, /aliases: \['elynea', 'nova'/);
});
