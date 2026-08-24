const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('src/App.jsx');
const sidebar = read('src/components/layout/Sidebar.jsx');
const audience = read('server-companion-audience.cjs');
const assistant = read('server-assistant.cjs');
const floating = read('src/components/FloatingAgent.jsx');
const { guardUnverifiedCapabilityRefusal } = require(path.join(root, 'server-assistant.cjs'));

test('NOVA est le seul Companion visible et l’ancienne route JulienAI est neutralisée', () => {
  assert.doesNotMatch(sidebar, /label:\s*["']Julien AI["']/);
  assert.doesNotMatch(sidebar, /label:\s*["']Agent Local["'][^\n]*path:\s*["']\/agent["']/);
  assert.doesNotMatch(app, /import Agent from/);
  assert.match(app, /path="\/agent" element=\{<Navigate to="\/" replace \/>\}/);
  assert.match(audience, /assistant_name:\s*'NOVA'/);
  assert.doesNotMatch(audience, /assistant_name:\s*'Julien AI Companion'/);
});

test('la même NOVA bascule automatiquement sur l’IA locale quand Internet est coupé', () => {
  assert.match(floating, /navigator\.onLine === false/);
  assert.match(floating, /LOCAL_NOVA_URL.*127\.0\.0\.1:8787/);
  assert.match(floating, /sendCloud\(\)[\s\S]*catch[\s\S]*sendLocal\(\)/);
  assert.match(floating, /Tu es NOVA, l’unique assistant visible/);
  assert.doesNotMatch(floating, /Julien AI Companion/);
});

test('un ancien refus de capacité est bloqué tant que les capacités réelles ne sont pas vérifiées', () => {
  const guarded = guardUnverifiedCapabilityRefusal("Je suis une IA textuelle et je ne peux pas exécuter directement car l'agent local est hors ligne.");
  assert.doesNotMatch(guarded, /je ne peux pas ex[eé]cuter directement|IA textuelle/i);
  assert.match(guarded, /vérifier les capacités, actions et agents disponibles/i);
  assert.match(assistant, /CONTRAT DE CAPACITÉS NOVA/);
  assert.match(assistant, /L’Agent Local 8787 est une capacité optionnelle/);
});
