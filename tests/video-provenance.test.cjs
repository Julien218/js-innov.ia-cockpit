const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  REQUIRED_TAGS,
  buildVideoMetadata,
  buildFfmpegArgs,
  buildSidecar,
  encodeVideoPackage,
  decodeVideoPackage,
  verifyProbe,
} = require('../server-video-provenance-core.cjs');

test('builds the JS-Innov.IA signage naming convention and complete invisible metadata', () => {
  const metadata = buildVideoMetadata({
    client: 'Rougraff',
    campaign: 'Services',
    creationDate: '2026-08-25',
    version: '1',
    durationSeconds: 8,
    prompt: 'Animate the supplied artwork.',
    sourceMedia: ['Rougraff v3.png'],
    sector: 'services',
    rightsConfirmed: true,
  });
  assert.equal(metadata.filename, 'rougraff_services_2026-08-25_v01_8s_1080p.mp4');
  assert.equal(metadata.title, 'Rougraff — Services');
  assert.equal(metadata.artist, 'JS-Innov.IA®');
  assert.equal(metadata.creator, 'JS-Innov.IA®');
  assert.equal(metadata.encodedBy, 'JS-Innov.IA® — Signage Studio');
  assert.equal(metadata.distributionPlace, 'Espace C — Dour, Belgique');
  assert.equal(metadata.distributionFormat, 'Écran LED extérieur 4 × 2 mètres');
  assert.deepEqual(metadata.sourceMedia, ['Rougraff v3.png']);
  assert.match(metadata.copyright, /^© 2026 JS-Innov\.IA®/);
  assert.ok(metadata.keywords.includes('services'));
});

test('does not claim copyright ownership until contractual rights are confirmed', () => {
  const metadata = buildVideoMetadata({ client: 'Client', campaign: 'Campagne', rightsConfirmed: false });
  assert.equal(metadata.rightsConfirmed, false);
  assert.equal(metadata.copyright, 'Droits contractuels à vérifier — aucune propriété attribuée');
});

test('ffmpeg embeds metadata without adding any visible watermark filter', () => {
  const metadata = buildVideoMetadata({ client: 'Rougraff', campaign: 'Services', rightsConfirmed: true });
  const args = buildFfmpegArgs('source.webm', 'final.mp4', metadata);
  const command = args.join(' ');
  assert.match(command, /use_metadata_tags/);
  assert.match(command, /title=Rougraff — Services/);
  assert.match(command, /encoded_by=JS-Innov\.IA® — Signage Studio/);
  assert.doesNotMatch(command, /drawtext|overlay|watermark/i);
});

test('verifies every required tag and records SHA-256 in the JSON sidecar', () => {
  const metadata = buildVideoMetadata({ client: 'Rougraff', campaign: 'Services' });
  const tags = {
    title: metadata.title,
    artist: metadata.artist,
    creator: metadata.creator,
    encoded_by: metadata.encodedBy,
    client: metadata.client,
    campaign: metadata.campaign,
    description: metadata.description,
    distribution_place: metadata.distributionPlace,
    distribution_format: metadata.distributionFormat,
    duration: `${metadata.durationSeconds} secondes`,
    date: metadata.creationDate,
    version: metadata.version,
    unique_id: metadata.uniqueId,
    creator_site: metadata.creatorSite,
    usage_rights: metadata.usageRights,
    creator_contact: metadata.creatorContact,
    source: metadata.source,
    keywords: metadata.keywords.join(', '),
  };
  assert.equal(Object.keys(tags).length, REQUIRED_TAGS.length);
  const probe = { format: { tags, duration: '8.000', format_name: 'mov,mp4' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }] };
  const verification = verifyProbe(probe, metadata);
  assert.equal(verification.ok, true);
  const sidecar = buildSidecar(metadata, { sha256: 'a'.repeat(64), probe, verification });
  assert.equal(sidecar.integrity.algorithm, 'SHA-256');
  assert.equal(sidecar.integrity.hash, 'a'.repeat(64));
  assert.equal(sidecar.technicalVerification.metadataPresent, true);
  assert.equal(sidecar.prompt, metadata.prompt);
  assert.match(sidecar.notice, /Aucun filigrane visible/);
});

test('binary package preserves UTF-8 metadata and the original video bytes', () => {
  const metadata = { client: 'Établissements Rougraff', prompt: 'Écran géant' };
  const video = Buffer.from([0, 1, 2, 3, 255]);
  const decoded = decodeVideoPackage(encodeVideoPackage(metadata, video));
  assert.deepEqual(decoded.metadata, metadata);
  assert.deepEqual(decoded.video, video);
});

test('verification fails when a required embedded tag is absent', () => {
  const metadata = buildVideoMetadata({ client: 'Rougraff', campaign: 'Services' });
  const result = verifyProbe({ format: { tags: { title: metadata.title } } }, metadata);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('client'));
});

test('verification refuses metadata that lies about duration or resolution', () => {
  const metadata = buildVideoMetadata({ client: 'Rougraff', campaign: 'Services', durationSeconds: 8, width: 1920, height: 1080 });
  const tags = Object.fromEntries(REQUIRED_TAGS.map((key) => [key, 'present']));
  tags.title = metadata.title;
  tags.client = metadata.client;
  tags.campaign = metadata.campaign;
  tags.unique_id = metadata.uniqueId;
  const result = verifyProbe({ format: { tags, duration: '5.000' }, streams: [{ codec_type: 'video', width: 1280, height: 720 }] }, metadata);
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.includes('duration_seconds'));
  assert.ok(result.mismatches.includes('width'));
  assert.ok(result.mismatches.includes('height'));
});

test('cloud, browser and Windows generation paths all use the same finalizer contract', () => {
  const root = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
  const assistant = fs.readFileSync(path.join(root, 'server-assistant.cjs'), 'utf8');
  const browser = fs.readFileSync(path.join(root, 'src', 'lib', 'videoProvenance.js'), 'utf8');
  const electronMain = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'package.json'), 'utf8'));
  assert.match(server, /\/api\/video-provenance/);
  assert.match(assistant, /POLITIQUE VIDÉO JS-INNOV\.IA/);
  assert.match(browser, /videoLocal\?\.finalize/);
  assert.match(electronMain, /video-local-finalize/);
  assert.match(electronMain, /core\.verifyProbe/);
  assert.match(preload, /video-local-finalize/);
  assert.ok(desktopPackage.build.extraResources.some((item) => item.to === 'video-provenance-core.cjs'));
});
