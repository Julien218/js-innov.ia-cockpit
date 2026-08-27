const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { AGENT_REGISTRY } = require('../server-agent-registry.cjs');
const {
  LED_AD_DIRECTOR_PROMPT,
  isLedAdvertisingRequest,
  hasLedCreativeApproval,
  buildLedAdvertisingContext,
} = require('../server-led-ad-director.cjs');
const { evaluateNovaRequest, buildRoutingContext } = require('../server-nova-routing.cjs');
const { buildVideoMetadata } = require('../server-video-provenance-core.cjs');
const { buildManagedFfmpegArgs, verifyManagedOutput } = require('../server-video-provenance.cjs');

test('le spécialiste Directeur Artistique LED est enregistré dans NOVA avec sa bible métier', () => {
  const agent = AGENT_REGISTRY.find((item) => item.key === 'led-ad-director');
  assert.ok(agent);
  assert.equal(agent.status, 'active');
  assert.equal(agent.role, 'led_outdoor_ad_creative_direction');
  assert.equal(agent.system_prompt, LED_AD_DIRECTOR_PROMPT);
  assert.match(agent.system_prompt, /écran géant de 4 × 2 mètres situé à l’Espace C à Dour/);
  assert.match(agent.system_prompt, /ne jamais modifier, redessiner ou réinterpréter le logo/);
  assert.match(agent.system_prompt, /durée exacte de 8 secondes/);
  assert.match(agent.system_prompt, /Maintiens cet écran parfaitement stable pendant les trois dernières secondes/);
  assert.match(agent.system_prompt, /profil couleur : Rec\.709/);
  assert.match(agent.system_prompt, /sans son, sauf demande explicite/);
});

test('NOVA route automatiquement une publicité écran géant vers led-ad-director', () => {
  const message = 'Créer une vidéo publicitaire pour l’écran géant LED de l’Espace C à Dour.';
  assert.equal(isLedAdvertisingRequest(message), true);
  assert.equal(isLedAdvertisingRequest('Vérifie une facture client.'), false);
  const decision = evaluateNovaRequest(message);
  assert.equal(decision.specialist_agent, 'led-ad-director');
  const context = buildRoutingContext(decision, { client_key: 'client-1', project_key: 'project-1', attribution_source: 'test' }, { allowed: true });
  assert.match(context, /Spécialiste imposé: led-ad-director/);
  assert.match(context, /Une seule validation groupée doit couvrir le scénario, les textes et les coordonnées/);
  assert.match(context, /propose create_video_generation/);
});

test('le contexte LED impose scénario puis validation unique avant génération', () => {
  const context = buildLedAdvertisingContext('Prépare une campagne vidéo pour écran LED extérieur à l’Espace C.');
  assert.match(context, /0–2 s \/ 2–5 s \/ 5–8 s/);
  assert.match(context, /confirmation Cockpit attachée à create_video_generation constitue l’unique validation groupée/);
  assert.match(context, /tâche automatique ou un batch ne doit jamais contourner la validation créative LED/);
});

test('une validation créative LED doit couvrir textes, coordonnées et découpage', () => {
  assert.equal(hasLedCreativeApproval('Créer la vidéo écran géant maintenant.'), false);
  assert.equal(hasLedCreativeApproval('Validation créative LED: validée'), true);
  assert.equal(hasLedCreativeApproval('Textes confirmés. Coordonnées validées. Scénario approuvé.'), true);
  assert.equal(hasLedCreativeApproval('Textes confirmés. Scénario approuvé.'), false);
});

test('le master final est H.264/yuv420p, CFR 25, Rec.709 et silencieux par défaut', () => {
  const metadata = buildVideoMetadata({
    client: 'Client Test',
    campaign: 'Espace C',
    durationSeconds: 8,
    width: 1920,
    height: 1080,
    exportParameters: { fps: 25 },
  });
  const args = buildManagedFfmpegArgs('source.mp4', 'final.mp4', metadata);
  const command = args.join(' ');
  assert.match(command, /-c:v libx264/);
  assert.match(command, /-pix_fmt yuv420p/);
  assert.match(command, /fps=25/);
  assert.match(command, /-fps_mode cfr/);
  assert.match(command, /-color_primaries bt709/);
  assert.match(command, /-color_trc bt709/);
  assert.match(command, /-colorspace bt709/);
  assert.match(command, /-an/);
  assert.doesNotMatch(command, /0:a\?/);
});

test('la vérification finale refuse un flux audio ou un profil couleur non Rec.709', () => {
  const metadata = buildVideoMetadata({ client: 'Client Test', campaign: 'Espace C', exportParameters: { fps: 25 } });
  const cleanProbe = {
    streams: [{ codec_type: 'video', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709' }],
  };
  const valid = verifyManagedOutput(cleanProbe, metadata, { ok: true, missing: [], mismatches: [] });
  assert.equal(valid.ok, true);
  const invalid = verifyManagedOutput({
    streams: [
      { codec_type: 'video', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  }, metadata, { ok: true, missing: [], mismatches: [] });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.mismatches.includes('audio_stream'));
});

test('la route de conversation transmet réellement le prompt propre au spécialiste', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server-base44-agents.cjs'), 'utf8');
  assert.match(source, /agent\.system_prompt/);
  assert.match(source, /DIRECTIVES SPÉCIALISTE/);
});
