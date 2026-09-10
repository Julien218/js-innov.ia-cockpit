const test = require('node:test');
const assert = require('node:assert/strict');

const { latestActiveRun } = require('../server-task-batch.cjs');
const {
  bareConfirmationSignal,
  ambiguousMessageSignal,
  dispatchVerificationSignal,
  summarizeTaskDispatches,
  dispatchReportMessage,
} = require('../server-assistant-intent.cjs');

test('awaiting_approval reste un run actif et empêche une redélégation automatique', () => {
  const run = latestActiveRun({ data: [{
    id: 'run-review',
    task_id: 'task-1',
    status: 'awaiting_approval',
    updated_at: '2026-08-24T10:00:00.000Z',
  }] }, 'task-1', Date.parse('2026-09-02T20:00:00.000Z'));
  assert.equal(run?.id, 'run-review');
});

test('une exécution ancienne conserve sa réservation tant que son arrêt n’est pas prouvé', () => {
  const run = latestActiveRun({ data: [{
    id: 'run-stale',
    task_id: 'task-1',
    status: 'running',
    updated_at: '2026-09-02T18:00:00.000Z',
  }] }, 'task-1', Date.parse('2026-09-02T20:00:00.000Z'));
  assert.equal(run?.id, 'run-stale');
});

test('la question de Julien est reconnue comme contrôle en lecture seule', () => {
  assert.equal(dispatchVerificationSignal('as dispatcher au agent respectif chaques taches qui sont en cours?'), true);
  assert.equal(dispatchVerificationSignal('Vérifie si chaque tâche a bien été déléguée au bon agent'), true);
  assert.equal(dispatchVerificationSignal('Vérifie puis délègue toutes les tâches maintenant'), false);
});

test('les confirmations seules et les messages ambigus sont distingués', () => {
  assert.equal(bareConfirmationSignal('Je confirme'), true);
  assert.equal(bareConfirmationSignal('Je confirme la délégation de la tâche 123'), false);
  assert.equal(ambiguousMessageSignal('?'), true);
  assert.equal(ambiguousMessageSignal('où en sont les tâches ?'), false);
});

test('le rapport se fonde sur les agent_runs et regroupe les doublons', () => {
  const now = Date.parse('2026-09-02T20:00:00.000Z');
  const report = summarizeTaskDispatches({ data: [
    { id: 'task-a', titre: 'Réparation IA — jsinnovia.com', statut: 'en_cours', created_at: '2026-08-20T10:00:00Z' },
    { id: 'task-a-copy', titre: 'Réparation IA — jsinnovia.com', statut: 'bloquee', created_at: '2026-08-21T10:00:00Z' },
    { id: 'task-b', titre: 'Mettre à jour Starlight ASBL', statut: 'en_cours', created_at: '2026-08-24T10:00:00Z' },
    { id: 'task-c', titre: 'Tâche sans run', statut: 'a_faire', created_at: '2026-09-01T10:00:00Z' },
  ] }, { data: [
    { id: 'run-a-old', task_id: 'task-a', status: 'failed', agent_id: 'jsinnov-agent', updated_at: '2026-08-25T10:00:00Z' },
    { id: 'run-a-review', task_id: 'task-a-copy', status: 'awaiting_approval', agent_id: 'nova-site-ops', updated_at: '2026-09-02T19:00:00Z' },
    { id: 'run-b', task_id: 'task-b', status: 'running', agent_id: 'nova-business-data', updated_at: '2026-09-01T10:00:00Z' },
  ] }, now);

  assert.equal(report.task_rows, 4);
  assert.equal(report.unique_tasks, 3);
  assert.equal(report.duplicate_task_rows, 1);
  assert.equal(report.duplicate_runs, 1);
  assert.equal(report.awaiting_validation, 1);
  assert.equal(report.stale, 1);
  assert.equal(report.non_dispatched, 1);
  assert.match(dispatchReportMessage(report), /seuls les agent_runs/i);
});
