const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const orchestrator = require(path.join(root, 'server-agent-orchestrator.cjs'));

const {
  resolveAgentPlan,
  inferVirtualRole,
  buildAgentRoutingContext,
  shouldAutoDelegate,
} = orchestrator;

test('route Synergie Dour vers son agent Base44 dédié', () => {
  const plan = resolveAgentPlan('Analyse le site synergiedour.be et ses événements');
  assert.ok(plan.length > 0);
  assert.equal(plan[0].agent.name, 'Synergie Dour Assistant');
  assert.equal(plan[0].agent.provider_agent_id, '6a0208edd1e235b62b4bda38');
});

test('route MiniMax H3 / Video Studio vers Agent GeneratVideoPro', () => {
  const plan = resolveAgentPlan('Continue Video Studio et vérifie MiniMax H3 dans ComfyUI');
  assert.ok(plan.some((item) => item.agent.role === 'video_production'));
  assert.ok(plan.some((item) => item.agent.provider_agent_id === '69e467a9d6329bb2ead81fa3'));
});

test('peut combiner un agent site et un spécialiste transverse', () => {
  const plan = resolveAgentPlan('Prépare une vidéo pour missetmisterdour.be avec une campagne de vote');
  assert.ok(plan.some((item) => item.agent.role === 'site_pageant_dour'));
  assert.ok(plan.some((item) => item.agent.role === 'video_dour_campaigns' || item.agent.role === 'video_production'));
});

test('crée un rôle métier virtuel pertinent quand aucun agent historique ne correspond', () => {
  assert.equal(inferVirtualRole('Optimise la facturation, les coûts et les marges Stripe'), 'finops_billing');
  assert.equal(inferVirtualRole('Corrige le responsive mobile de ce nouveau site'), 'web_product_engineer');
  assert.equal(inferVirtualRole('Projet inconnu à planifier de bout en bout'), 'project_delivery_manager');
});

test('la délégation automatique ne se déclenche pas sur une simple salutation', () => {
  assert.equal(shouldAutoDelegate('Bonjour merci'), false);
  assert.equal(shouldAutoDelegate('Analyse le projet VilleConnect'), true);
});

test('le contexte de routage interdit les clés Base44 côté frontend', () => {
  const ctx = buildAgentRoutingContext('Analyse Fashionistart').context;
  assert.match(ctx, /réutiliser un agent existant lié au site\/projet/i);
  const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(env, /BASE44_API_KEY=/);
  assert.match(env, /Ne jamais remplacer par une variable VITE_\*/);
});

test('la mémoire owner intègre routage, délégation et journal agent_runs', () => {
  const memory = fs.readFileSync(path.join(root, 'server-companion-memory.cjs'), 'utf8');
  const logger = fs.readFileSync(path.join(root, 'server-agent-run-log.cjs'), 'utf8');
  assert.match(memory, /runReadOnlyDelegations\(message\)/);
  assert.match(memory, /logDelegationResults\(message, delegationResults\)/);
  assert.match(logger, /\/agent-runs/);
  assert.match(logger, /execution_mode:\s*'read_only'/);
});

test('Docker embarque les modules d’orchestration', () => {
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(docker, /server-agent-orchestrator\.cjs/);
  assert.match(docker, /server-agent-run-log\.cjs/);
});
