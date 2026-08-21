const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const batchSource = fs.readFileSync(path.join(root, 'server-assistant-batch.cjs'), 'utf8');
const taskBatchSource = fs.readFileSync(path.join(root, 'server-task-batch.cjs'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

const { batchSignals } = require(path.join(root, 'server-assistant-batch.cjs'));
const { sanitizeTaskBatchPayload } = require(path.join(root, 'server-task-batch.cjs'));

test('les demandes multi-tâches sont reconnues sans intercepter un chat banal', () => {
  assert.equal(batchSignals('Crée les 6 tâches et délègue-les aux agents spécialisés'), true);
  assert.equal(batchSignals('bonjour'), false);
  assert.equal(batchSignals('analyse MiniMax H3'), false);
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
  assert.match(taskBatchSource, /execution_mode:\s*item\.agent\.read_only \? 'prepare_only' : 'approval_required'/);
});

test('une délégation lecture seule clôt la tâche uniquement après un résultat réel', () => {
  const reportIndex = taskBatchSource.indexOf('report = await');
  const completeIndex = taskBatchSource.indexOf("statut: 'terminee'");
  assert.ok(reportIndex >= 0);
  assert.ok(completeIndex > reportIndex);
  assert.match(taskBatchSource, /status:\s*'completed'/);
});

test('le middleware batch est monté avant le Companion historique', () => {
  const batchIndex = serverSource.indexOf("require('./server-assistant-batch.cjs')");
  const legacyIndex = serverSource.indexOf("require('./server-assistant.cjs')");
  assert.ok(batchIndex >= 0);
  assert.ok(legacyIndex > batchIndex);
});

test('la confirmation batch est à usage unique et ne transforme pas un échec en succès', () => {
  assert.match(batchSource, /pendingBatches\.delete\(token\)/);
  assert.match(batchSource, /if \(!result\.success\)/);
  assert.match(batchSource, /res\.status\(502\)/);
  assert.match(batchSource, /Ne dis jamais que les tâches sont créées/);
});

test('les modules batch sont présents dans l’image de production', () => {
  assert.match(dockerfile, /server-assistant-batch\.cjs/);
  assert.match(dockerfile, /server-task-batch\.cjs/);
  assert.match(dockerfile, /node --check \/app\/server-assistant-batch\.cjs/);
  assert.match(dockerfile, /node --check \/app\/server-task-batch\.cjs/);
});