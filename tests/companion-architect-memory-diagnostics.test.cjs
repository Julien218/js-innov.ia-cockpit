const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const memory = require('../server-companion-memory.cjs');

test('memory snapshot selector prefers the newest Analyse Cockpit folder', () => {
  const picked = memory.pickLatestMemoryFolder([
    { '.tag': 'folder', name: 'Analyse Cockpit 2026-08-14', path_display: '/ChatGPT Données sauve garde/Analyse Cockpit 2026-08-14' },
    { '.tag': 'file', name: 'manifest.json' },
    { '.tag': 'folder', name: 'Analyse Cockpit 2026-08-21', path_display: '/ChatGPT Données sauve garde/Analyse Cockpit 2026-08-21' },
    { '.tag': 'folder', name: 'Autre dossier' },
  ]);
  assert.equal(picked.name, 'Analyse Cockpit 2026-08-21');
});

test('owner architect contract delegates reads and gates real effects behind one confirmation', () => {
  const contract = memory.architectContract();
  assert.match(contract, /architecte\/orchestratrice/i);
  assert.match(contract, /Lecture seule/i);
  assert.match(contract, /Délégation/i);
  assert.match(contract, /UNE confirmation explicite/i);
  assert.match(contract, /ne jamais prétendre avoir vérifié/i);
});

test('diagnostic formatter exposes only read-only operational facts', async () => {
  const modulePath = pathToFileURL(path.join(__dirname, '..', 'src', 'lib', 'assistantDiagnosticBridge.js')).href;
  const diagnostics = await import(modulePath);
  const text = diagnostics.formatDiagnosticContext({
    measured_at: '2026-08-21T11:00:00.000Z',
    current_route: '/video-studio/new',
    desktop_app: true,
    local_agent: { online: true, model: 'qwen3.5:4b', ollama_online: true },
    video: {
      video_mode: 'local',
      desktop_bridge: true,
      comfyui_online: true,
      comfyui_version: '0.33.0',
      ffmpeg_online: true,
      h3_workflow_ready: true,
    },
  });

  assert.match(text, /Route actuelle: \/video-studio\/new/);
  assert.match(text, /Agent Local 8787: en ligne/);
  assert.match(text, /ComfyUI 8188: en ligne/);
  assert.match(text, /Workflow MiniMax H3 local mémorisé: oui/);
  assert.match(text, /aucune autorisation d’écriture/i);
});
