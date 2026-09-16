const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  buildMediaReference,
  classifyDocument,
  isSupportedMedia,
  normalizeMediaMetadata,
  safeUploadFilename,
  isExistingFolderConflict,
  dropboxApiArg,
} = require('../server-dropbox-helper.cjs');

test('les chemins Dropbox Unicode sont encodés dans un en-tête ASCII valide', () => {
  const header = dropboxApiArg({ path: '/Cockpit/Identité JS-Innov.IA — Test Grok/été.mp4' });
  assert.equal([...header].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) <= 126), true);
  assert.deepEqual(JSON.parse(header), { path: '/Cockpit/Identité JS-Innov.IA — Test Grok/été.mp4' });
  assert.match(header, /\\u2014/);
});

test('NOVA classe une vidéo dans le client et le projet indiqués', async () => {
  const clients = [{ id: 'client-1', denomination_legale: 'Synergie Dour ASBL' }];
  const projects = [{ id: 'project-1', nom: 'Campagne Été 2026', client_id: 'client-1' }];
  const result = await classifyDocument(
    'spot-final.mp4',
    'video/mp4',
    1024,
    clients,
    'Pour Synergie Dour ASBL, projet Campagne Été 2026',
    projects,
  );
  assert.equal(result.docType, 'Videos');
  assert.equal(result.matchedClient.id, 'client-1');
  assert.equal(result.matchedProject.id, 'project-1');
  assert.match(result.folderPath, /\/Clients\/Synergie Dour ASBL\/Projets\/Campagne Ete 2026\/Videos$/);
  assert.match(result.suggestedPath, /spot-final\.mp4$/);
});

test('une image sans contexte explicite reste dans A_Classer', async () => {
  const result = await classifyDocument('photo.png', 'image/png', 512, [], '', []);
  assert.equal(result.docType, 'Images');
  assert.equal(result.matchedClient, null);
  assert.equal(result.matchedProject, null);
  assert.match(result.folderPath, /\/A_Classer\/Images$/);
});

test('Elynea accepte les pièces jointes de tout type et neutralise les chemins de fichier', () => {
  assert.equal(isSupportedMedia('clip.mov', 'application/octet-stream'), true);
  assert.equal(isSupportedMedia('facture.pdf', 'application/pdf'), true);
  assert.equal(isSupportedMedia('archive.zip', 'application/zip'), true);
  assert.equal(isSupportedMedia('programme.exe', 'application/octet-stream'), true);
  assert.equal(isSupportedMedia('', 'application/octet-stream'), false);
  assert.equal(safeUploadFilename('../secret/video.mp4'), 'video.mp4');
});

test('NOVA renomme un média avec le client, le projet, le sujet et une empreinte stable', async () => {
  const clients = [{ id: 'client-1', denomination_legale: 'Synergie Dour ASBL' }];
  const projects = [{ id: 'project-1', nom: 'Campagne Été 2026', client_id: 'client-1' }];
  const classification = await classifyDocument(
    'grok-video-f91b7580-50ad-4076-a9a2-65474a886ea8 (1).mp4',
    'video/mp4',
    2048,
    clients,
    'Spot de rentrée pour Synergie Dour ASBL, projet Campagne Été 2026',
    projects,
  );
  const reference = buildMediaReference({
    fileName: 'grok-video-f91b7580-50ad-4076-a9a2-65474a886ea8 (1).mp4',
    mimeType: 'video/mp4',
    message: 'Spot de rentrée pour Synergie Dour ASBL, projet Campagne Été 2026',
    classification,
    metadata: { width: 1080, height: 1920, durationSeconds: 12.5, source: 'browser-media-metadata' },
    contentHash: 'abcdef1234567890',
    now: new Date('2026-08-25T12:00:00Z'),
  });

  assert.match(reference.archivedFilename, /^Synergie Dour ASBL - Campagne Ete 2026 - Spot rentree - portrait - 2026-08-25 - abcdef1234\.mp4$/);
  assert.equal(reference.originalFilename, 'grok-video-f91b7580-50ad-4076-a9a2-65474a886ea8 (1).mp4');
  assert.equal(reference.provider, 'grok');
  assert.equal(reference.orientation, 'portrait');
  assert.equal(reference.technicalMetadata.durationSeconds, 12.5);
  assert.ok(reference.keywords.includes('synergie'));
  assert.ok(reference.referenceFilename.endsWith('.reference.json'));
});

test('les métadonnées média invalides ne sont jamais présentées comme vérifiées', () => {
  assert.deepEqual(normalizeMediaMetadata({ width: -1, height: 'inconnue', durationSeconds: Infinity, source: 'invented' }), {
    width: null,
    height: null,
    durationSeconds: null,
    source: 'unavailable',
  });
});

test('un dossier Dropbox déjà existant est un succès idempotent', () => {
  assert.equal(isExistingFolderConflict({
    error_summary: 'path/conflict/folder/..',
    error: {
      '.tag': 'path',
      path: { '.tag': 'conflict', conflict: { '.tag': 'folder' } },
    },
  }), true);
  assert.equal(isExistingFolderConflict({
    error_summary: 'path/conflict/file/..',
    error: {
      '.tag': 'path',
      path: { '.tag': 'conflict', conflict: { '.tag': 'file' } },
    },
  }), false);
});

test('le Companion expose un dépôt binaire sécurisé, générique et indexé', () => {
  const server = fs.readFileSync(path.join(root, 'server-assistant.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src/components/FloatingAgent.jsx'), 'utf8');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(server, /router\.post\('\/upload-media', express\.raw/);
  assert.match(server, /MAX_NOVA_MEDIA_BYTES = 100 \* 1024 \* 1024/);
  assert.match(server, /indexDocument\(/);
  assert.match(server, /crypto\.createHash\('sha256'\)/);
  assert.match(server, /referenceManifest/);
  assert.match(server, /reference\.referenceFilename/);
  assert.match(server, /appendSessionMessages\(req/);
  assert.match(server, /journalId: `dropbox-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(ui, /\/api\/assistant\/upload-media/);
  assert.match(ui, /inspectMediaFile\(file\)/);
  assert.match(ui, /nova_recent_media_v1/);
  assert.match(ui, /recent_media: recentMedia/);
  assert.match(ui, /upload-media\?conversation_id=/);
  assert.match(ui, /Fichier archivé, classé et référencé dans Dropbox/);
  assert.match(ui, /type="file"/);
  assert.match(ui, /multiple/);
  assert.doesNotMatch(ui, /accept="image\/jpeg,image\/png,image\/webp,video\/mp4,video\/webm,video\/quicktime"/);
  assert.match(ui, /n’importe quel fichier/);
  assert.match(docker, /client_max_body_size 260m/);
  assert.match(docker, /proxy_request_buffering off/);
});
