const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chooseProvider, providerAvailability, validateJobInput, buildProviderRequest,
  xaiUsdFromUsage, estimateSoraUsd, publicConfig,
} = require('../server-video-generation-core.cjs');

test('le routage automatique préfère Grok puis Sora sans exposer les clés', () => {
  assert.equal(chooseProvider('auto', { XAI_API_KEY: 'secret-xai', OPENAI_API_KEY: 'secret-openai' }, new Date('2026-08-25')), 'xai');
  assert.equal(chooseProvider('auto', { OPENAI_API_KEY: 'secret-openai' }, new Date('2026-08-25')), 'openai');
  const config = publicConfig({ XAI_API_KEY: 'secret-xai', OPENAI_API_KEY: 'secret-openai' }, new Date('2026-08-25'));
  assert.equal(config.secret_values_exposed, false);
  assert.equal(JSON.stringify(config).includes('secret-'), false);
});

test('Sora est automatiquement désactivé à sa date de fin de service', () => {
  const availability = providerAvailability({ OPENAI_API_KEY: 'configured' }, new Date('2026-09-24T00:00:00Z'));
  assert.equal(availability.openai.configured, true);
  assert.equal(availability.openai.available, false);
  assert.throws(() => chooseProvider('sora', { OPENAI_API_KEY: 'configured' }, new Date('2026-09-24T00:00:00Z')), /arrêtée/);
});

test('les requêtes fournisseurs imposent une vidéo paysage de huit secondes', () => {
  const xai = buildProviderRequest('xai', 'Une publicité JS-Innov.IA premium et élégante');
  const sora = buildProviderRequest('openai', 'Une publicité JS-Innov.IA premium et élégante');
  assert.equal(xai.body.duration, 8);
  assert.equal(xai.body.aspect_ratio, '16:9');
  assert.equal(sora.body.seconds, '8');
  assert.equal(sora.body.size, '1280x720');
});

test('le coût xAI utilise les ticks réels et Sora le tarif officiel estimé', () => {
  assert.equal(xaiUsdFromUsage({ usage: { cost_in_usd_ticks: 2_000_000_000 } }), 0.2);
  assert.equal(estimateSoraUsd({ seconds: 8 }), 0.8);
  assert.equal(xaiUsdFromUsage({}), null);
});

test('une génération ne part jamais sans attribution client et prompt exploitable', () => {
  assert.throws(() => validateJobInput({ campaign_name: 'Test', prompt: 'Prompt suffisamment long pour passer.' }), /client/);
  const normalized = validateJobInput({ client_id: 'client-1', client_name: 'JS-Innov.IA', campaign_name: 'Identité', prompt: 'Animation premium JS-Innov.IA sur fond bleu nuit.' });
  assert.equal(normalized.clientId, 'client-1');
  assert.equal(normalized.campaign, 'Identité');
});

test('la migration protège les exécutions vidéo par RLS service_role', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260825221500_video_generation_jobs.sql'), 'utf8');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all .* anon, authenticated/i);
  assert.match(sql, /to service_role/i);
  assert.match(sql, /cost_event_id/);
});

test('le parcours UI relie fournisseur, coût, Dropbox et preuve SHA-256', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'ApiVideoFactory.jsx'), 'utf8');
  for (const expected of ['Grok Imagine 1.5', 'Sora 2', 'Centre de coût', 'Dropbox', 'SHA-256']) assert.match(ui, new RegExp(expected));
});

test('le backend peut utiliser les clés serveur protégées sans les exposer au frontend', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server-video-generation.cjs'), 'utf8');
  assert.match(server, /SUPABASE_CRM_KEY/);
  assert.match(server, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(server, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'ApiVideoFactory.jsx'), 'utf8'), /SUPABASE_(CRM_KEY|SERVICE_ROLE_KEY|SECRET_KEY)/);
});

test('le relais CRM est authentifié et limité aux tables comptables', () => {
  const proxy = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'crm-server-proxy', 'index.ts'), 'utf8');
  assert.match(proxy, /x-cockpit-proxy-token/);
  assert.match(proxy, /EXPECTED_TOKEN_SHA256/);
  assert.match(proxy, /ALLOWED_TABLES/);
  assert.match(proxy, /video_generation_jobs/);
  assert.doesNotMatch(proxy, /delete/i);
  const server = fs.readFileSync(path.join(__dirname, '..', 'server-video-generation.cjs'), 'utf8');
  assert.match(server, /SUPABASE_CRM_PROXY_URL/);
  assert.match(server, /SUPABASE_CRM_PROXY_TOKEN/);
});
