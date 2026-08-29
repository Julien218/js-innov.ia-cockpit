const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  sanitizeTaskBatchPayload,
  executeTaskBatch,
} = require('../server-task-batch.cjs');
const {
  inferMissionDomains,
  evaluateNovaRequest,
  buildRoutingContext,
} = require('../server-nova-routing.cjs');
const {
  extractReferenceIds,
  recentMediaRequested,
} = require('../server-nova-video-direct.cjs');
const documents = require('../server-documents.cjs');

const START_ID = '6f94f340-2de0-4304-9e35-e021547cea2e';

test('un batch de plus de 20 tâches valides ne devient plus null', () => {
  const payload = sanitizeTaskBatchPayload({
    tasks: Array.from({ length: 25 }, (_, index) => ({
      titre: `Tâche ouverte ${index + 1}`,
      description: 'Tâche existante à traiter par NOVA.',
    })),
  });
  assert.ok(payload);
  assert.equal(payload.tasks.length, 25);
});

test('une entrée sans titre ne fait plus tomber tout le batch', () => {
  const payload = sanitizeTaskBatchPayload({
    tasks: [
      { description: 'entrée invalide sans titre' },
      { titre: 'Tâche réellement exécutable' },
    ],
  });
  assert.ok(payload);
  assert.equal(payload.tasks.length, 1);
  assert.equal(payload.tasks[0].record.titre, 'Tâche réellement exécutable');
});

test('executeTaskBatch refuse proprement un payload null sans lire payload.tasks', async () => {
  const result = await executeTaskBatch({
    payload: null,
    token: 'regression-null-batch',
    user: { id: 'test', role: 'admin' },
    tenant: 'jsinnovia',
    agentFetch: async () => { throw new Error('ne doit pas être appelé'); },
  });
  assert.equal(result.success, false);
  assert.equal(result.requested, 0);
  assert.deepEqual(result.results, []);
});

test('une demande texte-vers-vidéo ne récupère pas un média récent non mentionné', () => {
  const recent = { documentId: START_ID };
  assert.equal(recentMediaRequested('Lance une génération de vidéos afin de promouvoir nos services'), false);
  assert.deepEqual(extractReferenceIds('Lance une génération de vidéos afin de promouvoir nos services', recent), []);
});

test('une demande qui cite une image récupère le média récent et un UUID explicite reste prioritaire', () => {
  const recent = { documentId: START_ID };
  assert.equal(recentMediaRequested('Lance la vidéo avec cette image comme référence'), true);
  assert.deepEqual(extractReferenceIds('Lance la vidéo avec cette image comme référence', recent), [START_ID]);
  assert.deepEqual(extractReferenceIds(`Lance Grok avec ${START_ID}`, null), [START_ID]);
});

test('STARLIGHT ASBL — Mascottes est routé comme mission créative avec contexte client', () => {
  const domains = inferMissionDomains('revoir STARLIGHT ASBL — Mascottes');
  assert.ok(domains.includes('creative'));
  assert.ok(domains.includes('crm'));
  const decision = evaluateNovaRequest('revoir STARLIGHT ASBL — Mascottes');
  const context = buildRoutingContext(decision, { client_key: 'internal:jsinnovia', project_key: 'internal:cockpit-nova', attribution_source: 'internal_default' });
  assert.match(context, /CONTEXTE CRÉATIF \+ CLIENT/);
  assert.match(context, /mission principale/);
});

test('un audit SEO standard indique explicitement que les concurrents sont facultatifs', () => {
  const decision = evaluateNovaRequest('seo www.jsinnovia.com');
  const context = buildRoutingContext(decision, { client_key: 'internal:jsinnovia', project_key: 'internal:cockpit-nova', attribution_source: 'internal_default' });
  assert.ok(decision.mission_domains.includes('seo'));
  assert.match(context, /URLs concurrentes sont facultatives/);
  assert.match(context, /Ne bloque jamais un audit SEO standard/);
});

test('le plafond documentaire permet les images Grok jusqu’à 20 MiB', () => {
  assert.equal(documents.MAX_FILE_BYTES, 20 * 1024 * 1024);
});

test('le runtime Docker embarque réellement la politique d’exécution immédiate', () => {
  const docker = fs.readFileSync('Dockerfile', 'utf8');
  assert.match(docker, /COPY --from=builder \/app\/server-immediate-execution-policy\.cjs/);
  assert.match(docker, /node --check \/app\/server-immediate-execution-policy\.cjs/);
});

test('la route vidéo directe n’impose plus une référence média pour le text-to-video', () => {
  const source = fs.readFileSync('server-nova-video-direct.cjs', 'utf8');
  assert.doesNotMatch(source, /missing_video_reference/);
  assert.match(source, /source_document_id: referenceIds\[0\] \|\| undefined/);
});
