const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const memory = fs.readFileSync(path.join(root, 'server-companion-memory.cjs'), 'utf8');
const batch = fs.readFileSync(path.join(root, 'server-assistant-batch.cjs'), 'utf8');
const assistant = fs.readFileSync(path.join(root, 'server-assistant.cjs'), 'utf8');

test('le Cockpit déclare jsinnovia-agent comme source unique de doctrine NOVA', () => {
  assert.match(memory, /POLITIQUE NOVA — SOURCE UNIQUE/);
  assert.ok(memory.includes('jsinnovia-agent/src/lib/companion-policy.js'));
  assert.doesNotMatch(memory, /\[CONTRAT ARCHITECTE JS-INNOV\.IA — OWNER\]/);
});

test('le middleware batch ne redéfinit plus la personnalité de NOVA', () => {
  assert.match(batch, /MODE BATCH TÂCHES COCKPIT — CONTRAT TECHNIQUE/);
  assert.match(batch, /ne redéfinit pas la personnalité ni les permissions de NOVA/i);
  assert.doesNotMatch(batch, /Tu es l’orchestrateur du Cockpit/i);
  assert.doesNotMatch(batch, /Ne demande pas de confirmation supplémentaire/i);
  assert.doesNotMatch(batch, /Si une branche de travail est bloquée, continue les branches indépendantes/i);
});

test('le serveur principal injecte des faits organisationnels et non une deuxième identité', () => {
  assert.match(assistant, /CONTEXTE ORGANISATIONNEL COCKPIT — faits serveur/);
  assert.match(assistant, /ne redéfinit ni l’identité, ni la mission, ni la politique de confirmation de NOVA/i);
  assert.doesNotMatch(assistant, /IDENTITÉ OPÉRATIONNELLE NOVA — obligatoire/);
  assert.doesNotMatch(assistant, /Tu es NOVA, architecte et assistante opérationnelle/);
});

test('les preuves et capacités restent des contextes dynamiques légitimes', () => {
  assert.match(assistant, /CONTRAT DE CAPACITÉS NOVA — état courant du serveur/);
  assert.match(assistant, /Actions Cockpit autorisées pour cette session/);
  assert.match(batch, /task_id\/run_id\/statut/);
});
