const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { ELYNEA_AGENT, SKILL_REGISTRY, AGENT_REGISTRY, findSkill } = require('../server-agent-registry.cjs');

test('Elynea is the only registered AI agent', () => {
  assert.equal(AGENT_REGISTRY.length, 1);
  assert.equal(AGENT_REGISTRY[0].key, 'elynea');
  assert.equal(AGENT_REGISTRY[0].name, 'Elynea');
  assert.equal(AGENT_REGISTRY[0].architecture, 'single-agent-multi-skill');
});

test('legacy specialist entries are skills, not agents', () => {
  assert.ok(SKILL_REGISTRY.length >= 10);
  for (const skill of SKILL_REGISTRY) {
    assert.equal(skill.kind, 'skill');
    assert.notEqual(skill.key, ELYNEA_AGENT.key);
  }
  assert.equal(findSkill('nova')?.role, 'cockpit_orchestration');
  assert.equal(findSkill('assurances-dour')?.kind, 'skill');
});

test('orchestrator performs one Elynea consultation for multiple skills', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server-agent-orchestrator.cjs'), 'utf8');
  assert.match(source, /une seule exécution IA/i);
  assert.match(source, /return \[await delegateElyneaReadOnly\(skills, message\)\]/);
  assert.doesNotMatch(source, /for \(const agent of selectedAgents/);
});

test('legacy Base44 route exposes one assistant and separate skills', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server-base44-agents.cjs'), 'utf8');
  assert.match(source, /agents:\s*\[assistant\]/);
  assert.match(source, /skills,/);
  assert.match(source, /single-agent-multi-skill/);
  assert.match(source, /Tu es Elynea, l’unique agent IA/);
});

test('Agents UI presents skills instead of multiple agents', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/pages/AgentsIA.jsx'), 'utf8');
  assert.match(source, /Un seul agent IA/);
  assert.match(source, /Compétences d’Elynea/);
  assert.match(source, /Ce ne sont pas des agents séparés/);
  assert.doesNotMatch(source, /agents actifs sur/);
});
