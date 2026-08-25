const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('la fabrique desktop est séquentielle, traçable et rattachée aux coûts', () => {
  const root = path.resolve(__dirname, '..');
  const electron = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'src', 'pages', 'LocalVideoFactory.jsx'), 'utf8');
  assert.match(electron, /queueNextLocalVideoJob/);
  assert.match(electron, /status: "waiting"/);
  assert.match(electron, /parseComfyHistoryState/);
  assert.match(electron, /core\.buildSignageMasterArgs/);
  assert.match(electron, /core\.verifyProbe\(probe, metadata\)/);
  assert.match(electron, /core\.buildSidecar/);
  assert.match(electron, /runtimeSeconds/);
  assert.match(electron, /loadLocalVideoQualification/);
  assert.match(electron, /doit d’abord réussir un lot réel de trois vidéos/);
  assert.match(page, /\/local-ai/);
  assert.match(page, /cost_center_id/);
  assert.match(page, /MiniMax H3 local n’est pas installé/);
});
