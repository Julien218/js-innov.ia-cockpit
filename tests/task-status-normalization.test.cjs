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

