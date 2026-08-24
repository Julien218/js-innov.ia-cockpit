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
  buildDelegationContext,
  hasOperationalEvidence,
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

test('route DNS, TLS et SEO vers JsInnov-Agent', () => {
  const plan = resolveAgentPlan('Diagnostique réellement le DNS, HTTPS, TLS et SEO de jsinnovia.com');
  assert.equal(plan[0].agent.provider_agent_id, '6a1845e17cc526d1e44965bc');
});

test('distingue DourConnect et VilleConnect', () => {
  assert.equal(resolveAgentPlan('Analyse dourconnect.be')[0].agent.provider_agent_id, '6a22f0c096ce009a943f4a05');
  assert.equal(resolveAgentPlan('Analyse villeconnect.be')[0].agent.provider_agent_id, '6a11d1493754e75ce76ee0de');
});

test('route le CRM Cockpit vers NOVA Base44', () => {
  const plan = resolveAgentPlan('NOVA analyse le CRM et le portfolio du Cockpit');
  assert.equal(plan[0].agent.provider_agent_id, '69ff4dc771a2cdab275f8a00');
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
  assert.equal(shouldAutoDelegate('Contrôle DNS, TLS et HTTPS'), true);
});

test('les résultats délégués conservent une preuve de conversation', () => {
  const context = buildDelegationContext([{ ok: true, provider: 'base44', conversation_id: 'conv-123', agent: { name: 'JsInnov-Agent', role: 'architecture_devops' }, content: 'DNS observé.' }]);
  assert.match(context, /consultation=conv-123/);
  assert.match(context, /preuve_diagnostic=non fournie/);
  assert.match(context, /DNS observé/);
});

test('une URL documentaire ne peut jamais servir de journal d’exécution', () => {
  const fake = 'Outil utilisé : Base44\nHeure : maintenant\nRésultat brut : domaine inactif\nIdentifiant du journal : https://en.wikipedia.org/wiki/Base44';
  assert.equal(hasOperationalEvidence(fake), false);
  const context = buildDelegationContext([{ ok: true, provider: 'base44', conversation_id: 'conv-fake', agent: { name: 'JsInnov-Agent', role: 'architecture_devops' }, content: fake }]);
  assert.match(context, /rapport agent non vérifié/i);
  assert.match(context, /Une URL externe n’est jamais un journal/i);
});

test('un diagnostic complet avec journal non-URL est reconnu comme rapport prouvé', () => {
  const proven = 'Outil réellement utilisé : dns_probe\nHeure d’exécution : 2026-08-24T18:35:15Z\nCible : jsinnovia.com\nSortie brute : A 217.160.0.193\nIdentifiant du journal : run-dns-123456';
  assert.equal(hasOperationalEvidence(proven), true);
  const context = buildDelegationContext([{ ok: true, provider: 'base44', conversation_id: 'conv-real', agent: { name: 'JsInnov-Agent', role: 'architecture_devops' }, content: proven }]);
  assert.match(context, /preuve_diagnostic=présente/);
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
  assert.match(docker, /server-agent-registry\.cjs/);
  assert.match(docker, /server-agent-run-log\.cjs/);
});

test('le proxy et NOVA utilisent un registre Base44 unique', () => {
  const registry = require(path.join(root, 'server-agent-registry.cjs')).AGENT_REGISTRY;
  const active = registry.filter((agent) => agent.status === 'active');
  assert.equal(active.length, 10);
  assert.equal(new Set(active.map((agent) => agent.provider_agent_id)).size, 10);
  assert.deepEqual(orchestrator.SITE_AGENT_REGISTRY, active);
});
