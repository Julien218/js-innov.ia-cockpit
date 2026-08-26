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

test('route Synergie Dour vers son spécialiste NOVA dédié', () => {
  const plan = resolveAgentPlan('Analyse le site synergiedour.be et ses événements');
  assert.ok(plan.length > 0);
  assert.equal(plan[0].agent.name, 'NOVA Site Synergie Dour');
  assert.equal(plan[0].agent.provider, 'jsinnovia-agent');
});

test('route Assurances-Dour vers son spécialiste NOVA exclusif', () => {
  const plan = resolveAgentPlan('Contrôle le DNS, le TLS et le SEO de assurances-dour.be');
  assert.equal(plan.length, 1);
  assert.equal(plan[0].agent.name, 'NOVA Site Assurances-Dour.be');
  assert.equal(plan[0].agent.provider, 'jsinnovia-agent');
});

test('MiniMax local reste sous NOVA sans appel Base44 générique', () => {
  const plan = resolveAgentPlan('Continue Video Studio et vérifie MiniMax H3 dans ComfyUI');
  assert.equal(plan.length, 0);
  const sitePlan = resolveAgentPlan('Contrôle le site video-studio.jsinnovia.com');
  assert.equal(sitePlan[0].agent.provider, 'jsinnovia-agent');
});

test('route DNS, TLS et SEO vers JsInnov-Agent', () => {
  const plan = resolveAgentPlan('Diagnostique réellement le DNS, HTTPS, TLS et SEO de jsinnovia.com');
  assert.equal(plan[0].agent.key, 'jsinnov-agent');
  assert.equal(plan[0].agent.provider, 'jsinnovia-agent');
});

test('distingue DourConnect et VilleConnect', () => {
  assert.equal(resolveAgentPlan('Analyse dourconnect.be')[0].agent.key, 'dourconnect');
  assert.equal(resolveAgentPlan('Analyse villeconnect.be')[0].agent.key, 'villeconnect');
});

test('le CRM Cockpit reste sous NOVA sans appel au doublon Base44', () => {
  const plan = resolveAgentPlan('NOVA analyse le CRM et le portfolio du Cockpit');
  assert.equal(plan.length, 0);
});

test('un agent site ne reçoit pas une tâche transverse sans domaine propre', () => {
  const plan = resolveAgentPlan('Prépare une vidéo pour missetmisterdour.be avec une campagne de vote');
  assert.ok(plan.some((item) => item.agent.role === 'site_pageant_dour'));
  assert.equal(plan.length, 1);
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

test('le contexte de routage retire Base44 du chemin actif', () => {
  const ctx = buildAgentRoutingContext('Analyse Fashionistart').context;
  assert.match(ctx, /Base44 est retiré du chemin d’exécution/i);
  const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.doesNotMatch(env, /BASE44_API_KEY=/);
  assert.match(env, /Aucune clé Base44 n'est requise/);
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

test('NOVA utilise un registre interne unique sans identifiant Base44 actif', () => {
  const registry = require(path.join(root, 'server-agent-registry.cjs')).AGENT_REGISTRY;
  const active = registry.filter((agent) => agent.status === 'active');
  assert.equal(active.length, 11);
  assert.ok(active.every((agent) => agent.provider === 'jsinnovia-agent'));
  assert.ok(active.every((agent) => agent.provider_agent_id === null));
  assert.ok(active.every((agent) => agent.legacy_base44_agent_id));
  assert.ok(orchestrator.SITE_AGENT_REGISTRY.length < active.length);
  assert.ok(orchestrator.SITE_AGENT_REGISTRY.every((agent) => agent.domains.length > 0));
  assert.ok(orchestrator.SITE_AGENT_REGISTRY.every((agent) => !['nova', 'creative-director'].includes(agent.key)));
});
