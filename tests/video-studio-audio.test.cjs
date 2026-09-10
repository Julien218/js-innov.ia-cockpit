const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('le pipeline vidéo passe par la route Cockpit protégée et garde les deux clés média', () => {
  const server = read('server.cjs');
  const route = read('server-video-studio.cjs');
  const client = read('src/lib/supabaseVideoClient.js');
  assert.match(server, /\/api\/video-studio/);
  assert.match(server, /requireSession\('admin'\)/);
  assert.match(server, /requirePermission\('production', 'admin'\)/);
  assert.match(route, /\/projects/);
  assert.match(route, /\/exports/);
  assert.match(route, /\/upload/);
  assert.match(client, /VIDEO_API_BASE = '\/api\/video-studio'/);
  assert.match(client, /file_url: uploaded\.file_url \|\| uploaded\.url/);
});

test('l’import audio ne perd plus l’URL et expose un vrai téléchargement', () => {
  const sidebar = read('src/components/studio/StudioSidebar.jsx');
  const motion = read('src/pages/MusicMotionStudio.jsx');
  assert.match(sidebar, /uploaded\?\.(?:file_url|url)/);
  assert.match(sidebar, /downloadRemoteFile/);
  assert.match(sidebar, /setUploading\(false\)/);
  assert.match(motion, /downloadBlob\(audioFile/);
  assert.match(motion, /Télécharger la source/);
});

test('l’aperçu utilise la durée et l’horloge de l’audio quand ils existent', () => {
  const studio = read('src/pages/VideoStudio.jsx');
  const preview = read('src/components/studio/VideoPreview.jsx');
  assert.match(studio, /audioUrl=\{currentVp\.audio_url\}/);
  assert.match(studio, /audioDuration=\{currentVp\.audio_duration_seconds\}/);
  assert.match(preview, /addEventListener\("timeupdate"/);
  assert.match(preview, /audio\.play\(\)/);
  assert.match(preview, /audio\.currentTime = bounded/);
});

test('la migration crée les tables et le stockage nécessaires sans ouvrir l’accès public SQL', () => {
  const migration = read('supabase/migrations/20260910120000_video_studio_assets.sql');
  assert.match(migration, /create table if not exists public\."VideoProject"/);
  assert.match(migration, /create table if not exists public\."VideoExport"/);
  assert.match(migration, /insert into storage\.buckets/);
  assert.match(migration, /revoke all on table public\."VideoProject", public\."VideoExport" from anon, authenticated/);
  assert.match(migration, /grant all on table public\."VideoProject", public\."VideoExport" to service_role/);
});

test('la nouvelle route serveur est syntaxiquement valide', () => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, 'server-video-studio.cjs')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
