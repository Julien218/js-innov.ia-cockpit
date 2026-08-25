const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const floatingAgent = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'FloatingAgent.jsx'), 'utf8');
const localAgentSource = fs.readFileSync(path.join(__dirname, '..', 'local-agent', 'server.js'), 'utf8');

test('NOVA locale reconnaît uniquement les intentions d’outils autorisées', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-tools-'));
  const previous = {
    noListen: process.env.LOCAL_AGENT_NO_LISTEN,
    roots: process.env.LOCAL_AGENT_ALLOWED_ROOTS,
    logDir: process.env.LOCAL_AGENT_LOG_DIR,
  };
  process.env.LOCAL_AGENT_NO_LISTEN = '1';
  process.env.LOCAL_AGENT_ALLOWED_ROOTS = root;
  process.env.LOCAL_AGENT_LOG_DIR = root;
  try {
    const module = await import(`../local-agent/server.js?test=${Date.now()}`);
    assert.deepEqual(module.requestedTool('lance ffmpeg -version'), { tool: 'ffmpeg_version', args: {} });
    assert.deepEqual(module.requestedTool('contrôle l’état de ComfyUI sur le port 8188'), { tool: 'comfyui_health', args: {} });
    assert.deepEqual(module.requestedTool('recherche les workflows MiniMax H3 locaux'), { tool: 'find_local_workflows', args: {} });
    assert.deepEqual(module.requestedTool('vérifie le diagnostic HTTPS du domaine jsinnovia.com'), { tool: 'http_diagnose', args: { url: 'https://jsinnovia.com' } });
    assert.deepEqual(module.requestedTools('contrôle ComfyUI puis recherche les workflows MiniMax H3 locaux'), [
      { tool: 'find_local_workflows', args: {} },
      { tool: 'comfyui_health', args: {} },
    ]);
    assert.equal(module.requestedTool('supprime tous mes fichiers'), null);
    assert.equal(module.pathInsideAllowedRoot(path.join(root, 'video.mp4')), path.resolve(root, 'video.mp4'));
    assert.equal(module.pathInsideAllowedRoot(path.resolve(root, '..', 'secret.txt')), null);
    assert.equal(module.requestsTaskList('quelles tâches sont à effectuer ?'), true);
    assert.equal(module.requestsTaskList('quel sont les taches non effectuees?'), true);
    assert.equal(module.requestsTaskList('quelles sont les tâches non terminées ?'), true);
    assert.match(module.taskSnapshotResponse({ synced_at: '2026-08-24T14:00:00Z', tasks: [
      { titre: 'Audit SEO', statut: 'en_cours', priorite: 'haute' },
      { titre: 'Ancienne tâche', statut: 'terminee' },
    ] }), /Audit SEO.*en_cours.*haute/s);
    assert.doesNotMatch(module.taskSnapshotResponse({ tasks: [
      { titre: 'Ancienne tâche', statut: 'terminee' },
    ] }), /Ancienne tâche/);
    assert.match(module.taskSnapshotResponse(null), /Aucune liste de tâches.*copie locale/);
    assert.equal(module.requestsTaskAnalysis('Analyse ces 11 tâches, regroupe les doublons et classe-les'), true);
    const analysis = module.taskAnalysisResponse({ tasks: [
      { titre: 'Contrôler API vidéo IA', statut: 'a_faire', priorite: 'haute', date_echeance: '2026-08-21' },
      { titre: 'Analyser les factures clients', statut: 'a_faire', priorite: 'haute' },
    ] });
    assert.match(analysis, /Vidéo IA et workflows locaux/);
    assert.match(analysis, /Données clients et facturation/);
    assert.match(analysis, /Exécutions réelles lancées: 0/);
    assert.match(analysis, /Aucun tool_run n’a été créé/);
    const duplicates = module.taskAnalysisResponse({ tasks: [
      { titre: 'Analyser les factures', statut: 'a_faire' },
      { titre: 'Analyser les factures et leur rattachement', statut: 'a_faire' },
      { titre: 'SEO automatique — jsinnovia.com', statut: 'a_faire' },
      { titre: 'SEO automatique — jsinnovia.com', statut: 'a_faire' },
    ] });
    assert.match(duplicates, /4 enregistrement\(s\).*2 tâche\(s\) unique\(s\)/s);
    assert.match(duplicates, /2 occurrences regroupées/);
    assert.deepEqual(module.localTaskPlan({ titre: "Vérifier l'absence de workflow MiniMax H3 local" }), ['find_local_workflows', 'comfyui_health']);
    assert.deepEqual(module.localTaskPlan({ titre: "Contrôler l’état des API vidéo IA" }), ['comfyui_health']);
    assert.deepEqual(module.localTaskPlan({ titre: 'Recenser les fonctionnalités non opérationnelles dans le module vidéo IA' }), ['find_local_workflows', 'comfyui_health', 'ffmpeg_version']);
    assert.deepEqual(module.localTaskPlan({ titre: 'Lancer une campagne de tests sur les fonctionnalités vidéo IA' }), ['video_pipeline_audit']);
    assert.deepEqual(module.localTaskPlan({ titre: 'Mettre à jour la documentation sur les workflows locaux' }), ['workflow_documentation_audit']);
    assert.deepEqual(module.localTaskPlan({ titre: "Achever l'avatar Js-Innov.IA en local" }), ['avatar_factory_status']);
    const autopilot = await module.executeLocalTaskAutopilot({ tasks: [
      { id: 'api-video', titre: "Contrôler l’état des API vidéo IA", statut: 'a_faire' },
      { id: 'workflows', titre: 'Contrôler la persistance des workflows vidéo IA locaux', statut: 'a_faire' },
      { id: 'minimax', titre: "Vérifier l'absence de workflow MiniMax H3 local", statut: 'a_faire' },
    ] });
    assert.equal(autopilot.examined, 3);
    assert.equal(autopilot.executed, 3);
    assert.deepEqual(autopilot.task_results.map((item) => item.task_id), ['api-video', 'workflows', 'minimax']);
  } finally {
    if (previous.noListen === undefined) delete process.env.LOCAL_AGENT_NO_LISTEN; else process.env.LOCAL_AGENT_NO_LISTEN = previous.noListen;
    if (previous.roots === undefined) delete process.env.LOCAL_AGENT_ALLOWED_ROOTS; else process.env.LOCAL_AGENT_ALLOWED_ROOTS = previous.roots;
    if (previous.logDir === undefined) delete process.env.LOCAL_AGENT_LOG_DIR; else process.env.LOCAL_AGENT_LOG_DIR = previous.logDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('le moteur local emploie execFile sans shell ni commande arbitraire', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'local-agent', 'server.js'), 'utf8');
  assert.match(source, /execFileAsync\(command, commandArgs, execOptions\)/);
  assert.doesNotMatch(source, /exec\(|shell:\s*true|child_process[^\n]*exec[^F]/);
  assert.match(source, /tool_not_allowed/);
  assert.match(source, /tool-runs\.jsonl/);
  assert.match(source, /NOVA locale n’a produit aucune réponse exploitable/);
  assert.match(source, /think: false/);
  assert.match(source, /Copie locale des tâches/);
  assert.match(source, /body\.context\.task_snapshot/);
  assert.match(source, /http_target_not_allowed/);
  assert.match(source, /127\.0\.0\.1:8188\/system_stats/);
  assert.match(source, /find_local_workflows/);
  assert.match(source, /video_pipeline_audit/);
  assert.match(source, /workflow_documentation_audit/);
  assert.match(source, /avatar_factory_status/);
  assert.match(source, /delete childEnv\.SSLKEYLOGFILE/);
  assert.match(source, /void ensureComfyUi\(\)/);
  assert.match(source, /const raw = String\(run\.output/);
  assert.match(source, /u0060\\u0060\\u0060text/);
});

test('le Cockpit synchronise et transmet une copie locale des tâches', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'FloatingAgent.jsx'), 'utf8');
  assert.match(source, /nova_local_task_snapshot_v1/);
  assert.match(source, /\/api\/data\/Tache\?limit=100/);
  assert.match(source, /task_snapshot: taskSnapshot/);
  assert.match(source, /\/api\/tasks\/autopilot/);
  assert.match(source, /\/api\/task-autopilot\/local-results/);
  assert.match(source, /setInterval\(\(\) => void syncLocalTasks\(\), 60_000\)/);
  assert.match(source, /description: task\.description/);
});

test('les demandes d outils locaux sont routées vers NOVA Windows même avec Internet', () => {
  assert.match(floatingAgent, /LOCAL_TOOL_REQUEST/);
  assert.match(floatingAgent, /requiresLocalTool \|\| \(typeof navigator/);
  assert.match(floatingAgent, /data = await sendLocal\(\)/);
});

test('NOVA locale reçoit le dernier média actif de la conversation', () => {
  assert.match(floatingAgent, /recent_media: recentMedia/);
  assert.match(localAgentSource, /Média récent actif:/);
  assert.match(localAgentSource, /ne dis pas qu’aucun média n’existe/);
});

test('une synchronisation locale échouée reste relançable', () => {
  const successMarker = floatingAgent.indexOf("localStorage.setItem(LOCAL_AUTOPILOT_LAST_RUN_KEY, String(Date.now()))");
  const localFetch = floatingAgent.indexOf('/api/tasks/autopilot');
  assert.ok(successMarker > localFetch);
  assert.match(floatingAgent, /if \(!syncResponse\.ok\) throw new Error/);
});
