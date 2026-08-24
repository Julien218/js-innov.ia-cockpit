const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const batchSource = fs.readFileSync(path.join(root, 'server-assistant-batch.cjs'), 'utf8');
const taskBatchSource = fs.readFileSync(path.join(root, 'server-task-batch.cjs'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

const { batchSignals, explicitExecutionAuthorization } = require(path.join(root, 'server-assistant-batch.cjs'));
const { sanitizeTaskBatchPayload } = require(path.join(root, 'server-task-batch.cjs'));

test('les demandes multi-tâches et d’exécution sont reconnues sans intercepter un chat banal', () => {
  assert.equal(batchSignals('Crée les 6 tâches et délègue-les aux agents spécialisés'), true);
  assert.equal(batchSignals('effectue toutes les tâches merci'), true);
  assert.equal(batchSignals('continue les tâches en cours'), true);
  assert.equal(batchSignals('bonjour'), false);
  assert.equal(batchSignals('analyse MiniMax H3'), false);
});

test('une demande explicite d’exécution autorise le lot sans seconde confirmation', () => {
  assert.equal(explicitExecutionAuthorization('effectue toutes les tâches merci'), true);
  assert.equal(explicitExecutionAuthorization('exécute les actions nécessaires'), true);
  assert.equal(explicitExecutionAuthorization('ok, continue les tâches'), true);
  assert.equal(explicitExecutionAuthorization('analyse les tâches en cours'), false);
  assert.equal(explicitExecutionAuthorization('quelles tâches restent à faire ?'), false);
  assert.match(batchSource, /require_confirmation_for_actions:\s*!userAlreadyAuthorizedExecution/);
  assert.match(batchSource, /if \(userAlreadyAuthorizedExecution\)/);
  assert.match(batchSource, /confirmation:\s*null/);
});

test('un batch exige des tâches avec un titre non vide', () => {
  assert.equal(sanitizeTaskBatchPayload({ tasks: [] }), null);
  assert.equal(sanitizeTaskBatchPayload({ tasks: [{ description: 'sans titre' }] }), null);
  const valid = sanitizeTaskBatchPayload({ tasks: [{
    titre: 'Audit MiniMax H3',
    description: 'Diagnostiquer le workflow local',
    agent_name: 'Agent Vidéo',
    agent_role: 'video_engineer',
    provider: 'base44',
    provider_agent_id: 'agent-123',
    read_only: true,
  }] });
  assert.equal(valid.tasks.length, 1);
  assert.equal(valid.tasks[0].record.titre, 'Audit MiniMax H3');
  assert.equal(valid.tasks[0].agent.read_only, true);
});

test('l’assignation agent est stockée dans notes et jamais dans une colonne inexistante', () => {
  assert.doesNotMatch(taskBatchSource, /record\s*=\s*\{[\s\S]*assigne_a\s*:/);
  assert.match(taskBatchSource, /Agent métier:/);
  assert.match(taskBatchSource, /Rôle métier:/);
});

test('chaque tâche créée reçoit un agent_run relié et un idempotency key', () => {
  assert.match(taskBatchSource, /task_id:\s*String\(task\.id\)/);
  assert.match(taskBatchSource, /idempotency_key:\s*runKey/);
  assert.match(taskBatchSource, /execution_mode:\s*item\.agent\.read_only \? 'prepare_only' : 'direct_execution'/);
});

test('une tâche d’écriture déléguée démarre réellement au lieu d’attendre une nouvelle validation', () => {
  assert.match(taskBatchSource, /status:\s*'running'/);
  assert.match(taskBatchSource, /execution_mode:\s*item\.agent\.read_only \? 'prepare_only' : 'direct_execution'/);
  assert.match(taskBatchSource, /statut:\s*'en_cours'/);
  assert.doesNotMatch(taskBatchSource, /status:\s*item\.agent\.read_only \? 'running' : 'awaiting_approval'/);
});

test('une délégation lecture seule clôt la tâche uniquement après un résultat réel', () => {
  const reportIndex = taskBatchSource.indexOf('report = await');
  const completeIndex = taskBatchSource.indexOf("statut: 'terminee'");
  assert.ok(reportIndex >= 0);
  assert.ok(completeIndex > reportIndex);
  assert.match(taskBatchSource, /status:\s*'completed'/);
});

test('un échec partiel n’annule pas les branches déjà exécutées', () => {
  assert.match(batchSource, /res\.status\(executionResult\.success \? 200 : 207\)/);
  assert.match(batchSource, /return res\.status\(207\)\.json/);
  assert.match(batchSource, /Les branches bloquées restent identifiées sans arrêter les autres/);
  assert.match(taskBatchSource, /results\.push\(\{ index, success: false/);
});

test('le middleware batch est monté avant le Companion historique', () => {
  const batchIndex = serverSource.indexOf("require('./server-assistant-batch.cjs')");
  const legacyIndex = serverSource.indexOf("require('./server-assistant.cjs')");
  assert.ok(batchIndex >= 0);
  assert.ok(legacyIndex > batchIndex);
});

test('la confirmation batch reste à usage unique lorsque la demande n’autorise pas déjà l’exécution', () => {
  assert.match(batchSource, /pendingBatches\.delete\(token\)/);
  assert.match(batchSource, /pendingBatches\.set\(token, batchContext\)/);
  assert.match(batchSource, /confirmation = \{ token, type: 'create_task_batch'/);
  assert.match(batchSource, /Ne dis jamais que les tâches sont créées/);
});

test('les modules batch sont présents dans l’image de production', () => {
  assert.match(dockerfile, /server-assistant-batch\.cjs/);
  assert.match(dockerfile, /server-task-batch\.cjs/);
  assert.match(dockerfile, /node --check \/app\/server-assistant-batch\.cjs/);
  assert.match(dockerfile, /node --check \/app\/server-task-batch\.cjs/);
});