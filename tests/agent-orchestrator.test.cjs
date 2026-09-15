const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const orchestrator = require(path.join(root, 'server-agent-orchestrator.cjs'));
const registry = require(path.join(root, 'server-agent-registry.cjs'));

const {
  resolveAgentPlan,
  inferVirtualRole,
  buildAgentRoutingContext,
  shouldAutoDelegate,
  buildDelegationContext,
  hasOperationalEvidence,
  ELYNEA_AGENT,
  SKILL_REGISTRY,
} = orchestrator;

test('route Synergie Dour vers la compétence Elynea dédiée', () => {
  const plan = resolveAgentPlan('Analyse le site synergiedour.be et ses événements');
  assert.ok(plan.length > 0);
  assert.equal(plan[0].agent.key, 'synergie-dour');
  assert.equal(plan[0].agent.kind, 'skill');
  assert.equal(plan[0].agent.name, 'Synergie Dour');
});

test('route Assurances-Dour vers la compétence Elynea adéquate', () => {
  const plan = resolveAgentPlan('Contrôle le DNS, le TLS et le SEO de assurances-dour.be');
  assert.ok(plan.length >= 1);
  assert.equal(plan[0].agent.key, 'assurances-dour');
  assert.equal(plan[0].agent.kind, 'skill');
});

test('MiniMax local sélectionne la compétence vidéo sans créer un autre agent', () => {
  const plan = resolveAgentPlan('Continue Video Studio et vérifie MiniMax H3 dans ComfyUI');
  assert.ok(plan.some(item => item.agent.key === 'generatvideopro'));
  assert.ok(plan.every(item => item.agent.kind === 'skill'));
  assert.equal(ELYNEA_AGENT.key, 'elynea');
});

test('route DNS TLS SEO vers la compétence Sites JS-Innov.IA', () => {
  const plan = resolveAgentPlan('Diagnostique réellement le DNS, HTTPS, TLS et SEO de jsinnovia.com');
  assert.equal(plan[0].agent.key, 'jsinnov-agent');
  assert.equal(plan[0].agent.kind, 'skill');
});

test('distingue DourConnect et VilleConnect', () => {
  assert.equal(resolveAgentPlan('Analyse dourconnect.be')[0].agent.key, 'dourconnect');
  assert.equal(resolveAgentPlan('Analyse villeconnect.be')[0].agent.key, 'villeconnect');
});

test('le Cockpit active une compétence interne mais garde Elynea comme identité', () => {
  const plan = resolveAgentPlan('Elynea analyse le CRM et le portfolio du Cockpit');
  assert.ok(plan.some(item => item.agent.key === 'nova'));
  assert.equal(ELYNEA_AGENT.name, 'Elynea');
  assert.equal(registry.AGENT_REGISTRY.length, 1);
});

test('un domaine précis sélectionne sa compétence métier', () => {
  const plan = resolveAgentPlan('Prépare une vidéo pour missetmisterdour.be avec une campagne de vote');
  assert.ok(plan.some(item => item.agent.role === 'site_pageant_dour'));
  assert.ok(plan.every(item => item.agent.kind === 'skill'));
});

test('crée une compétence virtuelle pertinente si aucune compétence enregistrée ne correspond', () => {
  assert.equal(inferVirtualRole('Optimise la facturation, les coûts et les marges Stripe'), 'finops_billing');
  assert.equal(inferVirtualRole('Corrige le responsive mobile de ce nouveau site'), 'web_product_engineer');
  assert.equal(inferVirtualRole('Projet inconnu à planifier de bout en bout'), 'project_delivery_manager');
});

test('la consultation automatique ne se déclenche pas sur une simple salutation', () => {
  assert.equal(shouldAutoDelegate('Bonjour merci'), false);
  assert.equal(shouldAutoDelegate('Analyse le projet VilleConnect'), true);
  assert.equal(shouldAutoDelegate('Contrôle DNS, TLS et HTTPS'), true);
});

test('le résultat Elynea conserve une preuve de consultation', () => {
  const context = buildDelegationContext([{ ok: true, provider: 'jsinnovia-agent', session_id: 'elynea-123', agent: ELYNEA_AGENT, skills: [SKILL_REGISTRY[0]], content: 'DNS observé.' }]);
  assert.match(context, /consultation=elynea-123/);
  assert.match(context, /preuve_diagnostic=non fournie/);
  assert.match(context, /DNS observé/);
  assert.match(context, /Elynea/);
});

test('une URL documentaire ne peut jamais servir de journal d’exécution', () => {
  const fake = 'Outil utilisé : diagnostic\nHeure : maintenant\nRésultat brut : domaine inactif\nIdentifiant du journal : https://en.wikipedia.org/wiki/Test';
  assert.equal(hasOperationalEvidence(fake), false);
  const context = buildDelegationContext([{ ok: true, provider: 'jsinnovia-agent', session_id: 'elynea-fake', agent: ELYNEA_AGENT, skills: [SKILL_REGISTRY[0]], content: fake }]);
  assert.match(context, /preuve_diagnostic=non fournie/);
  assert.match(context, /rapport non vérifié/i);
});

test('un diagnostic complet avec journal non URL est reconnu comme prouvé', () => {
  const proven = 'Outil réellement utilisé : dns_probe\nHeure d’exécution : 2026-08-24T18:35:15Z\nCible : jsinnovia.com\nSortie brute : A 217.160.0.193\nIdentifiant du journal : run-dns-123456';
  assert.equal(hasOperationalEvidence(proven), true);
  const context = buildDelegationContext([{ ok: true, provider: 'jsinnovia-agent', session_id: 'elynea-real', agent: ELYNEA_AGENT, skills: [SKILL_REGISTRY[0]], content: proven }]);
  assert.match(context, /preuve_diagnostic=présente/);
});

test('le contexte de routage annonce une seule Elynea et retire Base44 du chemin actif', () => {
  const ctx = buildAgentRoutingContext('Analyse Fashionistart').context;
  assert.match(ctx, /Agent IA unique: Elynea/i);
  assert.match(ctx, /aucune délégation vers une autre personnalité IA/i);
  assert.match(ctx, /Base44 est retiré du chemin actif/i);
  const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.doesNotMatch(env, /BASE44_API_KEY=/);
  assert.match(env, /Aucune clé Base44 n'est requise/);
});

test('la mémoire owner intègre routage, consultation Elynea et journal agent_runs', () => {
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

test('le registre contient exactement un agent IA et des compétences séparées', () => {
  assert.equal(registry.AGENT_REGISTRY.length, 1);
  assert.equal(registry.AGENT_REGISTRY[0].key, 'elynea');
  assert.equal(registry.AGENT_REGISTRY[0].provider, 'jsinnovia-agent');
  assert.equal(registry.AGENT_REGISTRY[0].architecture, 'single-agent-multi-skill');
  assert.ok(registry.SKILL_REGISTRY.length >= 10);
  assert.ok(registry.SKILL_REGISTRY.every(skill => skill.kind === 'skill'));
  assert.ok(orchestrator.SITE_AGENT_REGISTRY.every(skill => skill.domains.length > 0));
});

test('runReadOnlyDelegations est conçu pour une seule exécution Elynea', () => {
  const source = fs.readFileSync(path.join(root, 'server-agent-orchestrator.cjs'), 'utf8');
  assert.match(source, /Une seule exécution IA/);
  assert.match(source, /return \[await delegateElyneaReadOnly\(skills, message\)\]/);
  assert.doesNotMatch(source, /for \(const agent of selectedAgents/);
});
