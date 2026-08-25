const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { classifyDocument, isSupportedMedia, safeUploadFilename } = require('../server-dropbox-helper.cjs');

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

test('NOVA refuse les formats non médias et neutralise les chemins de fichier', () => {
  assert.equal(isSupportedMedia('clip.mov', 'application/octet-stream'), true);
  assert.equal(isSupportedMedia('facture.pdf', 'application/pdf'), false);
  assert.equal(isSupportedMedia('programme.exe', 'image/png'), false);
  assert.equal(safeUploadFilename('../secret/video.mp4'), 'video.mp4');
});

test('le Companion expose un dépôt média binaire sécurisé et indexé', () => {
  const server = fs.readFileSync(path.join(root, 'server-assistant.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src/components/FloatingAgent.jsx'), 'utf8');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(server, /router\.post\('\/upload-media', express\.raw/);
  assert.match(server, /MAX_NOVA_MEDIA_BYTES = 100 \* 1024 \* 1024/);
  assert.match(server, /Le dépôt média interne n’est pas accessible depuis un espace client/);
  assert.match(server, /indexDocument\(/);
  assert.match(server, /journalId: `dropbox-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(ui, /\/api\/assistant\/upload-media/);
  assert.match(ui, /type="file"/);
  assert.match(ui, /image\/jpeg/);
  assert.match(ui, /video\/mp4/);
  assert.match(docker, /client_max_body_size 105m/);
  assert.match(docker, /proxy_request_buffering off/);
});
