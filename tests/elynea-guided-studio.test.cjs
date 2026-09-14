const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('Elynea est le nom public officiel du companion', () => {
  const audience = read('server-companion-audience.cjs');
  const roleAware = read('src/components/RoleAwareFloatingAgent.jsx');
  assert.match(audience, /OFFICIAL_ASSISTANT_NAME = 'Elynea'/);
  assert.match(roleAware, /ElyneaBrandScope/);
});

test('une confirmation texte peut récupérer le jeton structuré encore valide', () => {
  const intent = read('server-assistant-intent.cjs');
  assert.match(intent, /confirmationCache = new Map/);
  assert.match(intent, /cachedConfirmation\(req\)/);
  assert.match(intent, /req\.url = '\/confirm'/);
  assert.match(intent, /stripUnbackedConfirmationLanguage/);
});

test('les notifications critiques proposent une réparation automatique administrateur', () => {
  const topbar = read('src/components/layout/TopBar.jsx');
  assert.match(topbar, /Réparer automatiquement/);
  assert.match(topbar, /\/api\/domain-ops\/prepare-repair/);
  assert.match(topbar, /\/api\/domain-ops\/repair/);
  assert.match(topbar, /canRepairDomains/);
});

test('le Studio vidéo accepte les gros médias via upload segmenté sans buffer géant', () => {
  const server = read('server-video-studio.cjs');
  const client = read('src/lib/supabaseVideoClient.js');
  assert.match(server, /UPLOAD_CHUNK_BYTES/);
  assert.match(server, /\/upload-session\/\:id\/chunk/);
  assert.match(server, /fs\.createReadStream/);
  assert.match(client, /CHUNKED_UPLOAD_THRESHOLD/);
  assert.match(client, /chunkedUpload/);
  assert.match(client, /file\.slice\(offset, end\)/);
});

test('la timeline ne divise plus par zéro avant le chargement audio', () => {
  const preview = read('src/components/music-motion/TimelinePreview.jsx');
  assert.match(preview, /safeDuration = Math\.max\(1, duration\)/);
  assert.doesNotMatch(preview, /t\s*\/\s*duration\s*\*\s*1000/);
});

test('Music Motion expose le parcours guidé Source vers Rendu', () => {
  const workspace = read('src/pages/MusicMotionWorkspace.jsx');
  const app = read('src/App.jsx');
  for (const label of ['1. Source', '2. Analyse', '3. Direction', '4. Storyboard', '5. Plans', '6. Rendu']) {
    assert.match(workspace, new RegExp(label.replace('.', '\\.')));
  }
  assert.match(app, /MusicMotionWorkspace/);
  assert.match(app, /path="\/music-motion"/);
});

test('un chemin média Windows est routé vers le diagnostic local', () => {
  const transport = read('src/lib/novaChatTransport.js');
  assert.match(transport, /localMediaDiagnosticRequest/);
  assert.match(transport, /windowsMediaPath/);
  assert.match(transport, /needsLocalMediaDiagnostic \|\| requiresLocalTool/);
});
