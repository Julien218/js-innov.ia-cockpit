const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const batchSource = fs.readFileSync(path.join(root, 'server-assistant-batch.cjs'), 'utf8');
const taskBatchSource = fs.readFileSync(path.join(root, 'server-task-batch.cjs'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

const { batchSignals, explicitExecutionAuthorization, removeStaleConfirmationLanguage, executionProof, directAutopilotSignal, autopilotMessage, directEntityMutationSignal, executionProhibited, directInspectionSignal, targetedInspectionSignal, idAfterLabel, scopedTaskExecutionAuthorization } = require(path.join(root, 'server-assistant-batch.cjs'));
const { canonicalTaskTitle, latestActiveRun, sanitizeTaskBatchPayload } = require(path.join(root, 'server-task-batch.cjs'));

test('les demandes multi-tâches et d’exécution sont reconnues sans intercepter un chat banal', () => {
  assert.equal(batchSignals('Crée les 6 tâches et délègue-les aux agents spécialisés'), true);
  assert.equal(batchSignals('effectue toutes les tâches merci'), true);
  assert.equal(batchSignals('continue les tâches en cours'), true);
  assert.equal(batchSignals('bonjour'), false);
  assert.equal(batchSignals('analyse MiniMax H3'), false);
  assert.equal(batchSignals('Analyse les trois actions puis délègue chaque diagnostic à l’agent responsable'), true);
});

test('une modification de fiche projet passe au CRUD réel et jamais au batch de tâches', () => {
  assert.equal(directEntityMutationSignal('Complète la fiche projet VilleConnectOs'), true);
  assert.equal(directEntityMutationSignal('Mets à jour le projet VilleConnectOs avec ces informations'), true);
  assert.equal(directEntityMutationSignal('Mets à jour tous les projets'), false);
  assert.match(batchSource, /if \(directEntityMutationSignal\(message\)\) return false/);
});

test('une demande explicite d’exécution autorise le lot sans seconde confirmation', () => {
  assert.equal(explicitExecutionAuthorization('effectue toutes les tâches merci'), true);
  assert.equal(explicitExecutionAuthorization('exécute les actions nécessaires'), true);
  assert.equal(explicitExecutionAuthorization('ok, continue les tâches'), true);
  assert.equal(explicitExecutionAuthorization('Je confirme explicitement l’exécution. Analyse réellement le DNS, HTTPS, TLS et le SEO de assurances-dour.be, puis délègue uniquement les actions exécutables à l’agent Base44 responsable du site.'), true);
  assert.equal(explicitExecutionAuthorization('J’autorise explicitement NOVA à déléguer les diagnostics'), true);
  assert.equal(explicitExecutionAuthorization('analyse les tâches en cours'), false);
  assert.equal(explicitExecutionAuthorization('quelles tâches restent à faire ?'), false);
  assert.match(batchSource, /require_confirmation_for_actions:\s*!userAlreadyAuthorizedExecution/);
  assert.match(batchSource, /if \(userAlreadyAuthorizedExecution\)/);
  assert.match(batchSource, /confirmation:\s*null/);
});

test('une interdiction explicite d’écrire ne peut jamais devenir une autorisation par sous-chaîne', () => {
  const request = 'Analyse toutes les tâches non terminées et leurs preuves. N’exécute aucune écriture, modification, génération ni dépense. Rapport uniquement.';
  assert.equal(executionProhibited(request), true);
  assert.equal(explicitExecutionAuthorization(request), false);
  assert.equal(directAutopilotSignal(request), false);
  assert.equal(directInspectionSignal(request), true);
  assert.equal(executionProhibited('Effectue toutes les tâches non terminées'), false);
  assert.equal(explicitExecutionAuthorization('Effectue toutes les tâches non terminées'), true);
  assert.match(batchSource, /runAutopilot\(\{ inspectOnly: true/);
});

test('une inspection ciblée de projet ne déclenche jamais l’inventaire global des tâches', () => {
  const request = 'Effectue un contrôle strictement en lecture seule de l’action update_project exécutée sur le projet 4e2424fc-5e4c-4b60-b5cc-54166d59d85a. Affiche le lien avec la tâche bdcb55aa-e09a-45e3-9132-848400bf1c5d. N’effectue aucune nouvelle écriture.';
  assert.equal(targetedInspectionSignal(request), true);
  assert.equal(directInspectionSignal(request), false);
  assert.equal(idAfterLabel(request, ['projet']), '4e2424fc-5e4c-4b60-b5cc-54166d59d85a');
  assert.equal(idAfterLabel(request, ['tâche', 'tache']), 'bdcb55aa-e09a-45e3-9132-848400bf1c5d');
  assert.match(batchSource, /inspectTargetedProject\(message\)/);
  assert.match(batchSource, /Inspection ciblée sans effet terminée/);
  assert.match(batchSource, /\/data\/LogAction\?limit=250/);
});

test('une autorisation limitée à un task_id reste exécutable malgré les interdictions hors périmètre', () => {
  const request = 'J’autorise explicitement NOVA à reprendre et exécuter uniquement la tâche existante bdcb55aa-e09a-45e3-9132-848400bf1c5d. Ne crée aucune nouvelle tâche et ne modifie aucun autre projet.';
  assert.equal(scopedTaskExecutionAuthorization(request), true);
  assert.equal(explicitExecutionAuthorization(request), true);
  assert.equal(targetedInspectionSignal(request), false);
  assert.equal(directInspectionSignal(request), false);
  assert.equal(batchSignals(request), true);
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
  assert.equal(valid.tasks[0].read_only, true);
});

test('un même titre ne peut apparaître deux fois dans un lot', () => {
  const payload = sanitizeTaskBatchPayload({ tasks: [
    { titre: 'Mettre à jour la documentation' },
    { titre: '  Mettre à jour — la documentation ' },
  ] });
  assert.equal(payload.tasks.length, 1);
});

test('l’assignation proposée par le modèle reste une métadonnée non fiable', () => {
  assert.doesNotMatch(taskBatchSource, /record\s*=\s*\{[\s\S]*assigne_a\s*:/);
  assert.match(taskBatchSource, /requested_agent/);
  assert.match(taskBatchSource, /resolveNovaExecutor\(item\.record\)/);
});

test('chaque tâche créée reçoit un agent_run relié et un idempotency key', () => {
  assert.match(taskBatchSource, /task_id:\s*String\(task\.id\)/);
  assert.match(taskBatchSource, /idempotency_key:/);
  assert.match(taskBatchSource, /execution_mode:\s*executor\.execution_mode \|\| 'autonomous'/);
});

test('une tâche d’écriture déléguée démarre réellement au lieu d’attendre une nouvelle validation', () => {
  assert.match(taskBatchSource, /createRun\(agentFetch, task, item, executor, token, index, organisation, requestedBy, 'running'\)/);
  assert.match(taskBatchSource, /await handlers\.site|await handlers\.business/);
  assert.match(taskBatchSource, /statut:\s*'en_cours'/);
  assert.doesNotMatch(taskBatchSource, /status:\s*item\.agent\.read_only \? 'running' : 'awaiting_approval'/);
});

test('une délégation clôt la tâche uniquement après un résultat réel', () => {
  const reportIndex = taskBatchSource.indexOf('const outcome =');
  const completeIndex = taskBatchSource.indexOf("statut: 'terminee'");
  assert.ok(reportIndex >= 0);
  assert.ok(completeIndex > reportIndex);
  assert.match(taskBatchSource, /status:\s*'completed'/);
});

test('un échec partiel n’annule pas les branches déjà exécutées', () => {
  assert.match(batchSource, /res\.status\(executionResult\.success \? 200 : 207\)/);
  assert.match(batchSource, /return res\.status\(207\)\.json/);
  assert.match(batchSource, /Prise en charge réelle/);
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
  assert.match(dockerfile, /server-nova-executors\.cjs/);
  assert.match(dockerfile, /node --check \/app\/server-assistant-batch\.cjs/);
  assert.match(dockerfile, /node --check \/app\/server-task-batch\.cjs/);
});

test('le texte d’un batch déjà autorisé ne redemande jamais une confirmation', () => {
  const cleaned = removeStaleConfirmationLanguage('Deux tâches sont prêtes à être confirmées. Ce lot nécessite votre confirmation. Veuillez confirmer maintenant. Souhaitez-vous que je les envoie ? Veux-tu que je confirme et lance immédiatement l’exécution de ces tâches ?');
  assert.doesNotMatch(cleaned, /confirm[eé]|Souhaitez-vous/i);
  assert.match(batchSource, /removeStaleConfirmationLanguage\(data\.response/);
});

test('les identifiants réels du lot sont rendus visibles dans la réponse', () => {
  const proof = executionProof({ results: [{ success: true, task_id: 'task-1', run_id: 'run-1', status: 'running' }] });
  assert.match(proof, /task_id=task-1/);
  assert.match(proof, /run_id=run-1/);
  assert.match(proof, /statut=running/);
  assert.match(batchSource, /executionProof\(executionResult\)/);
});

test('le batch rapproche les tâches existantes par titre canonique', () => {
  assert.equal(canonicalTaskTitle('  Mise à jour — Documentation  '), 'mise a jour documentation');
  assert.match(taskBatchSource, /\/data\/Tache\?limit=250/);
  assert.match(taskBatchSource, /status: 'already_running'/);
  assert.match(taskBatchSource, /reused: true/);
});

test('already_running exige un agent_run actif et expose son identifiant', () => {
  assert.equal(latestActiveRun({ data: [{ id: 'old', task_id: 'task-1', status: 'completed' }] }, 'task-1'), null);
  assert.equal(latestActiveRun({ data: [
    { id: 'wrong-run', task_id: 'task-2', status: 'running', updated_at: '2026-08-25T02:00:00Z' },
    { id: 'run-1', task_id: 'task-1', status: 'running', updated_at: '2026-08-25T01:00:00Z' },
  ] }, 'task-1', Date.parse('2026-08-25T01:10:00Z')).id, 'run-1');
  assert.match(taskBatchSource, /agent-runs\?task_id=/);
  assert.match(taskBatchSource, /run_id: active\.id/);
  assert.match(taskBatchSource, /STALE_RUNNING_MS/);
});

test('une confirmation formulée en phrase complète est consommée par le pont UI', () => {
  const bridge = fs.readFileSync(path.join(root, 'src', 'lib', 'assistantConfirmationBridge.js'), 'utf8');
  assert.match(bridge, /function isAffirmativeIntent/);
  assert.match(bridge, /je confirme\|confirme/);
  assert.match(bridge, /isAffirmativeIntent\(intent\)/);
  assert.match(bridge, /Preuves du lot/);
});

test('effectue toutes les tâches déclenche directement l’autopilote sans réponse LLM', () => {
  assert.equal(directAutopilotSignal('Effectue toutes les tâches non terminées'), true);
  assert.equal(directAutopilotSignal('liste les tâches'), false);
  const message = autopilotMessage({ run_id: 'auto-1', unique: 2, executed: [{ task_id: 't1', run_id: 'r1', status: 'completed' }], blocked: [{ task_id: 't2', reason: 'accès manquant' }] });
  assert.match(message, /run_id=auto-1/);
  assert.match(message, /task_id=t1 · run_id=r1/);
  assert.match(message, /task_id=t2 .* statut=bloquee/);
  assert.match(batchSource, /if \(userAlreadyAuthorizedExecution && directAutopilotSignal\(message\)\)/);
});

test('le rapport autopilote identifie chaque tâche, exécuteur et preuve', () => {
  const message = autopilotMessage({
    run_id: 'auto-proof',
    unique: 3,
    executed: [{ task_id: 't1', title: 'Audit factures', executor: 'nova-business-data', run_id: 'r1', tool_run_id: 'journal-1', status: 'completed' }],
    ready: [{ task_id: 't2', title: 'Audit vidéo', executor: 'nova-video-production' }],
    awaiting_authorization: [{ task_id: 't3', title: 'Modifier client', executor: 'nova-business-data', reason: 'autorisation_explicite_requise' }],
    inspection_only: true,
  });
  assert.match(message, /Inspection déterministe sans effet/);
  assert.match(message, /Audit factures · task_id=t1/);
  assert.match(message, /exécuteur=nova-business-data/);
  assert.match(message, /preuve=journal-1/);
  assert.match(message, /Audit vidéo · task_id=t2/);
  assert.match(message, /Modifier client · task_id=t3/);
});
