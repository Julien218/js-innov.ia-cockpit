const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const memory = require('../server-companion-memory.cjs');

test('NOVA reconnaît les demandes de diagnostic sur un domaine géré', () => {
  assert.deepEqual(memory.managedDomainsInMessage('Contrôle DNS et TLS de jsinnovia.com'), ['jsinnovia.com']);
  assert.equal(memory.requestsLiveDomainDiagnostic('Contrôle DNS et TLS de jsinnovia.com'), true);
  assert.equal(memory.requestsLiveDomainDiagnostic('Bonjour jsinnovia.com'), false);
});

test('memory snapshot selector prefers the newest Analyse Cockpit folder', () => {
  const picked = memory.pickLatestMemoryFolder([
    { '.tag': 'folder', name: 'Analyse Cockpit 2026-08-14', path_display: '/ChatGPT Données sauve garde/Analyse Cockpit 2026-08-14' },
    { '.tag': 'file', name: 'manifest.json' },
    { '.tag': 'folder', name: 'Analyse Cockpit 2026-08-21', path_display: '/ChatGPT Données sauve garde/Analyse Cockpit 2026-08-21' },
    { '.tag': 'folder', name: 'Autre dossier' },
  ]);
  assert.equal(picked.name, 'Analyse Cockpit 2026-08-21');
});

test('NOVA reconnaît une demande de vue d’ensemble des projets', () => {
  assert.equal(memory.requestsProjectOverview('Donne-moi une vue d’ensemble de tous mes projets'), true);
  assert.equal(memory.requestsProjectOverview('Que sais-tu du projet Assurances Dour ?'), false);
});

test('la vue projets place les éléments classés avant Non classé et conserve les preuves utiles', () => {
  const overview = memory.buildProjectOverview([
    { name: 'Non classé', conversation_count: 12 },
    { name: 'Cockpit', conversation_count: 4, task_count: 3, decision_count: 2, clients: ['JS-Innov.IA'], recent_conversations: [{ id: 'c1', title: 'Mémoire', updated_at: '2026-08-25' }] },
  ]);
  assert.equal(overview[0].name, 'Cockpit');
  assert.equal(overview[0].clients[0], 'JS-Innov.IA');
  assert.equal(overview[1].name, 'Non classé');
});

test('NOVA signale un snapshot Dropbox vieux de plus de sept jours', () => {
  const now = Date.parse('2026-08-25T12:00:00.000Z');
  assert.equal(memory.memoryFreshness({ generated_at: '2026-08-24T12:00:00.000Z' }, now).stale, false);
  const stale = memory.memoryFreshness({ generated_at: '2026-08-14T12:00:00.000Z' }, now);
  assert.equal(stale.stale, true);
  assert.equal(stale.age_days, 11);
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
