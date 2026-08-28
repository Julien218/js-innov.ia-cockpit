const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executeVideoTask,
  resolveNovaExecutor,
  sourceDocumentIdsFromTask,
  videoClientForTask,
  videoPromptForTask,
} = require('../server-nova-executors.cjs');
const { buildProviderRequest, validateJobInput } = require('../server-video-generation-core.cjs');

const START_ID = '6f94f340-2de0-4304-9e35-e021547cea2e';
const END_ID = '528b3a52-ac9f-4829-b02f-a903f6c7f40d';

test('NOVA extrait les deux Index Cockpit dans leur ordre', () => {
  const ids = sourceDocumentIdsFromTask({
    description: `Image 1\nIndex Cockpit: ${START_ID}\nImage 2\nIndex Cockpit: ${END_ID}`,
  });
  assert.deepEqual(ids, [START_ID, END_ID]);
});

test('une demande image 1 vers image 2 est routée vers la production vidéo', () => {
  const executor = resolveNovaExecutor({
    title: 'Transformation finale',
    description: `Image 1 doit finir à image 2 en vidéo avec Grok.\nIndex Cockpit: ${START_ID}\nIndex Cockpit: ${END_ID}`,
  });
  assert.equal(executor.kind, 'video');
  assert.equal(executor.id, 'nova-video-production');
});

test('le client interne JS-Innov.IA sert de fallback quand aucun client externe n’est identifié', () => {
  const internal = { id: 'internal-client', nom: 'JS-Innov.IA — interne', type_client: 'interne_jsinnovia' };
  assert.equal(videoClientForTask({ description: 'Créer la vidéo du canari' }, [internal])?.id, 'internal-client');
});

test('le prompt à deux images explicite départ et cible sans promettre une frame exacte', () => {
  const prompt = videoPromptForTask({ description: 'Créer une transformation cinématographique.' }, [START_ID, END_ID]);
  assert.match(prompt, /<IMAGE_0>/);
  assert.match(prompt, /<IMAGE_1>/);
  assert.match(prompt, /does not guarantee an exact last frame/i);
});

test('Grok multi-références utilise reference_images en 720p', () => {
  const req = buildProviderRequest('xai', 'Transform the first image toward the second.', {
    referenceImageDataUris: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
  });
  assert.equal(req.body.resolution, '720p');
  assert.equal(req.body.reference_images.length, 2);
  assert.equal(req.body.image, undefined);
});

test('validateJobInput conserve les références ordonnées et la cible finale', () => {
  const input = validateJobInput({
    client_id: 'internal-client',
    client_name: 'JS-Innov.IA',
    campaign_name: 'Tour de Dour',
    prompt: 'Créer une transformation cinématographique cohérente entre les deux références.',
    source_document_id: START_ID,
    end_source_document_id: END_ID,
    reference_document_ids: [START_ID, END_ID],
  });
  assert.deepEqual(input.referenceDocumentIds, [START_ID, END_ID]);
  assert.equal(input.endSourceDocumentId, END_ID);
});

test('executeVideoTask lance un seul job réel sans repasser en awaiting_review', async () => {
  const internal = { id: 'internal-client', denomination_legale: 'JS-Innov.IA', type_client: 'interne_jsinnovia' };
  let captured = null;
  const agentRequest = async (path) => {
    if (path.startsWith('/data/Client')) return [internal];
    throw new Error(`unexpected ${path}`);
  };
  const createJob = async (body) => {
    captured = body;
    return { job: { id: 'job-1', status: 'queued' }, journal_id: 'video-generation-job-1' };
  };

  const result = await executeVideoTask({
    id: 'task-1',
    title: 'Vidéo canari',
    description: `Image 1 doit finir à image 2.\nIndex Cockpit: ${START_ID}\nIndex Cockpit: ${END_ID}\nCréer une transformation cinématographique.`,
  }, agentRequest, createJob, { taskId: 'task-1', runId: 'run-1', organisation: 'jsinnovia' });

  assert.equal(result.awaiting_review, false);
  assert.equal(result.in_progress, true);
  assert.equal(result.result.video_job_id, 'job-1');
  assert.equal(result.result.internal_client_fallback, true);
  assert.equal(captured.provider, 'xai');
  assert.deepEqual(captured.reference_document_ids, [START_ID, END_ID]);
  assert.equal(captured.source_document_id, START_ID);
  assert.equal(captured.end_source_document_id, END_ID);
});
