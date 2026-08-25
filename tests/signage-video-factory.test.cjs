const test = require('node:test');
const assert = require('node:assert/strict');

test('la fabrique crée trois concepts écran géant distincts de 8 secondes', async () => {
  const factory = await import('../src/lib/signageVideoFactory.js');
  const concepts = factory.createThreeSignageConcepts({
    clientName: 'Rougraff',
    phone: '065 65 22 05',
    services: 'Centrale à béton, transport, voirie',
    brief: 'Présenter les services',
  }, 123456789);

  assert.equal(concepts.length, 3);
  assert.deepEqual(concepts.map((item) => item.direction), ['institutional', 'commercial', 'dynamic']);
  assert.ok(concepts.every((item) => item.seconds === 8));
  assert.ok(concepts.every((item) => item.prompt.includes('065 65 22 05')));
  assert.equal(new Set(concepts.map((item) => item.id)).size, 3);
});

test('un lot local accepte 32 vidéos et refuse la trente-troisième', async () => {
  const factory = await import('../src/lib/signageVideoFactory.js');
  const workflow = { '1': { class_type: 'MiniMaxH3ImageToVideo', inputs: {} } };
  const jobs = Array.from({ length: 32 }, (_, index) => ({ id: `job-${index}`, workflow }));
  assert.equal(factory.normalizeLocalBatchJobs(jobs).length, 32);
  assert.throws(() => factory.normalizeLocalBatchJobs([...jobs, { id: 'job-33', workflow }]), /limité à 32/);
});

test('le suivi et la timeline de validation sont déterministes', async () => {
  const factory = await import('../src/lib/signageVideoFactory.js');
  const jobs = [
    { id: 'a', title: 'A', status: 'completed' },
    { id: 'b', title: 'B', status: 'completed' },
    { id: 'c', title: 'C', status: 'completed' },
  ];
  const summary = factory.summarizeLocalBatch({ jobs });
  const review = factory.buildReviewTimeline(jobs);
  assert.equal(summary.progress, 100);
  assert.equal(summary.done, true);
  assert.equal(review.ready, true);
  assert.equal(review.duration, 35.5);
});
