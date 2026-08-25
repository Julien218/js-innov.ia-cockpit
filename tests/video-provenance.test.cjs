const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  REQUIRED_TAGS,
  buildVideoMetadata,
  buildFfmpegArgs,
  buildSignageMasterArgs,
  buildSidecar,
  encodeVideoPackage,
  decodeVideoPackage,
  parseComfyHistoryState,
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

test('ComfyUI history exposes verifiable runtime and output evidence', () => {
  const result = parseComfyHistoryState({
    prompt123: {
      outputs: { node9: { videos: [{ filename: 'final.mp4', subfolder: 'client' }] } },
      status: {
        status_str: 'success',
        completed: true,
        messages: [
          ['execution_start', { timestamp: 1_700_000_000_000 }],
          ['execution_success', { timestamp: 1_700_000_012_500 }],
        ],
      },
    },
  }, 'prompt123');
  assert.equal(result.completed, true);
  assert.equal(result.failed, false);
  assert.equal(result.runtimeSeconds, 12.5);
  assert.equal(result.files[0].filename, 'final.mp4');
});

test('ComfyUI errors and output-less completions never become false successes', () => {
  const failed = parseComfyHistoryState({
    p1: { status: { status_str: 'error', completed: false, messages: [['execution_error', { exception_message: 'CUDA out of memory', timestamp: 1_700_000_001_000 }]] } },
  }, 'p1');
  const empty = parseComfyHistoryState({ p2: { outputs: {}, status: { status_str: 'success', completed: true } } }, 'p2');
  assert.equal(failed.failed, true);
  assert.match(failed.error, /CUDA out of memory/);
  assert.equal(empty.failed, true);
  assert.match(empty.error, /sans produire/);
});

test('FFmpeg produit réellement un master écran géant de 8 secondes avec ses tags', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jsinnovia-signage-test-'));
  try {
    const source = path.join(folder, 'source.mp4');
    const output = path.join(folder, 'master.mp4');
    const sourceRun = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=25', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { encoding: 'utf8' });
    assert.equal(sourceRun.status, 0, sourceRun.stderr);
    const metadata = buildVideoMetadata({ client: 'Rougraff', campaign: 'Services', durationSeconds: 8, width: 1920, height: 1080 });
    const render = spawnSync('ffmpeg', buildSignageMasterArgs({ sourcePath: source, outputPath: output, metadata, clientLabel: 'Rougraff', phoneLabel: '065 65 22 05' }), { encoding: 'utf8', timeout: 120_000 });
    assert.equal(render.status, 0, render.stderr);
    const probeRun = spawnSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output], { encoding: 'utf8' });
    assert.equal(probeRun.status, 0, probeRun.stderr);
    const verification = verifyProbe(JSON.parse(probeRun.stdout), metadata);
    assert.equal(verification.ok, true, JSON.stringify(verification));
    const logoOutput = path.join(folder, 'master-logo.mp4');
    const logo = path.join(__dirname, '..', 'electron', 'icon.png');
    const logoRender = spawnSync('ffmpeg', buildSignageMasterArgs({ sourcePath: source, logoPath: logo, outputPath: logoOutput, metadata, clientLabel: 'Rougraff', phoneLabel: '065 65 22 05' }), { encoding: 'utf8', timeout: 120_000 });
    assert.equal(logoRender.status, 0, logoRender.stderr);
    const logoProbe = spawnSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', logoOutput], { encoding: 'utf8' });
    assert.equal(logoProbe.status, 0, logoProbe.stderr);
    assert.equal(verifyProbe(JSON.parse(logoProbe.stdout), metadata).ok, true);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
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
