const test = require('node:test');
const assert = require('node:assert/strict');

test('all historical completed task status variants are recognized', async () => {
  const { isTaskCompleted } = await import('../src/lib/taskStatus.js');
  for (const status of ['termine', 'terminee', 'Terminé', 'Terminée ', 'completed', 'DONE', 'clôturée']) {
    assert.equal(isTaskCompleted({ statut: status }), true, status);
  }
  assert.equal(isTaskCompleted({ statut: 'en_cours' }), false);
  assert.equal(isTaskCompleted({ status: 'completed' }), true);
});

test('blocked task status variants are normalized too', async () => {
  const { isTaskBlocked } = await import('../src/lib/taskStatus.js');
  for (const status of ['bloque', 'Bloquée', 'blocked', 'FAILED', 'erreur']) {
    assert.equal(isTaskBlocked(status), true, status);
  }
  assert.equal(isTaskBlocked('terminee'), false);
});



test('les doublons historiques sont identifiés sans être traités comme de vrais blocages', async () => {
  const { isHistoricalDuplicate, isTaskBlocked } = await import('../src/lib/taskStatus.js');
  const duplicate = {
    statut: 'bloquee',
    notes: 'Audit NOVA: doublon bloqué sans suppression; tâche canonique abc (exact_duplicate).',
  };
  assert.equal(isHistoricalDuplicate(duplicate), true);
  assert.equal(isTaskBlocked({ operational_status: 'WAITING_INPUT' }), false);
  assert.equal(isTaskBlocked({ operational_status: 'TECHNICAL_ERROR' }), true);
});

test('un ancien run actif devient Informations requises au lieu de rester artificiellement en cours', async () => {
  const { isStaleActiveRun, runOperationalStatus } = await import('../src/lib/taskStatus.js');
  const run = { status: 'pending', updated_at: '2026-08-26T10:00:00Z' };
  const now = Date.parse('2026-09-19T10:00:00Z');
  assert.equal(isStaleActiveRun(run, now), true);
  assert.equal(runOperationalStatus(run, { now }), 'WAITING_INPUT');
});

test('une génération vidéo sans média source est classée Informations requises', async () => {
  const { taskRequiresInput } = await import('../src/lib/taskStatus.js');
  assert.equal(taskRequiresInput({
    statut: 'en_cours',
    notes: 'Résultat reçu mais non finalisé: generation_video_incomplete:source_document_id',
  }), true);
  assert.equal(taskRequiresInput({
    statut: 'terminee',
    notes: 'generation_video_incomplete:source_document_id ancien',
  }), false);
});
