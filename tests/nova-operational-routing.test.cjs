const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  evaluateNovaRequest,
  resolveCostAttribution,
  buildRoutingContext,
  INTERNAL_CLIENT_KEY,
  INTERNAL_PROJECT_KEY,
} = require(path.join(root, 'server-nova-routing.cjs'));

test('NOVA classe une demande d architecture et de coûts comme complexe', () => {
  const result = evaluateNovaRequest('Implémente une architecture multi API avec calcul des coûts LLM par client et projet.');
  assert.equal(result.complexity, 'complex');
  assert.equal(result.confidentiality, 'high');
  assert.equal(result.preferred_execution, 'cloud_orchestrator');
});

test('les travaux owner sans client explicite sont attribués à JS-Innov.IA interne', () => {
  const attribution = resolveCostAttribution({ audience: { mode: 'owner' }, user: { organisation: 'JS-Innov.IA' } });
  assert.equal(attribution.client_key, INTERNAL_CLIENT_KEY);
  assert.equal(attribution.project_key, INTERNAL_PROJECT_KEY);
  assert.equal(attribution.attribution_source, 'internal_default');
});

test('un client authentifié conserve son attribution réelle', () => {
  const attribution = resolveCostAttribution({
    audience: { mode: 'client', client_id: 'client-42', client_name: 'Client Démo' },
    body: {},
  });
  assert.equal(attribution.client_key, 'client-42');
  assert.equal(attribution.client_name, 'Client Démo');
  assert.equal(attribution.attribution_source, 'authenticated_client');
});

test('le contexte de routage interdit le questionnaire générique', () => {
  const context = buildRoutingContext(
    evaluateNovaRequest('architecture multi API'),
    resolveCostAttribution({ audience: { mode: 'owner' } }),
    { allowed: true, recommended_model: 'modele-complexe' },
  );
  assert.match(context, /Ne transforme pas ce flux en questionnaire générique/);
  assert.match(context, /client=internal:jsinnovia/);
  assert.match(context, /projet=internal:cockpit-nova/);
});

test('la page assistant expose uniquement l identité Elynea', () => {
  const source = fs.readFileSync(path.join(root, 'src/pages/Agent.jsx'), 'utf8');
  assert.match(source, /Je suis Elynea/);
  assert.match(source, /shouldUseLocalFirst/);
  assert.doesNotMatch(source, /Je suis NOVA/);
});

test('le routage UI réserve le local aux demandes locales ou très simples', async () => {
  const { shouldUseLocalFirst } = await import('../src/lib/nova-routing.js');
  assert.equal(shouldUseLocalFirst('Vérifie ComfyUI en local sur Windows', true), true);
  assert.equal(shouldUseLocalFirst('Implémente le calcul des coûts LLM par client', true), false);
  assert.equal(shouldUseLocalFirst('Bonjour', true), true);
  assert.equal(shouldUseLocalFirst('Bonjour', false), false);
});

test('la voix NOVA préfère le français belge et respecte le choix utilisateur', async () => {
  const { chooseNovaVoice } = await import('../src/lib/nova-voice.js');
  const voices = [
    { name: 'Voix Canada', lang: 'fr-CA' },
    { name: 'Microsoft Denise Online Natural', lang: 'fr-FR' },
    { name: 'Microsoft Charline Online Natural', lang: 'fr-BE' },
  ];
  assert.equal(chooseNovaVoice(voices).lang, 'fr-BE');
  assert.equal(chooseNovaVoice(voices, 'Microsoft Denise Online Natural').lang, 'fr-FR');
});
