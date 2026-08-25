const crypto = require('node:crypto');

const DEFAULTS = Object.freeze({
  creator: 'JS-Innov.IA®',
  encodedBy: 'JS-Innov.IA® — Signage Studio',
  description: 'Vidéo publicitaire créée pour diffusion sur écran LED géant',
  distributionPlace: 'Espace C — Dour, Belgique',
  distributionFormat: 'Écran LED extérieur 4 × 2 mètres',
  creatorSite: 'https://jsinnovia.com',
  creatorContact: 'info@jsinnovia.com',
  source: 'JS-Innov.IA® Signage Campaign',
});

function clean(value, fallback = '', max = 2000) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, max);
}

function slug(value, fallback = 'non-identifie') {
  return clean(value, fallback, 160).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || fallback;
}

function normalizeVersion(value) {
  const match = clean(value, 'v01', 20).match(/(\d{1,4})/);
  return `v${String(Number(match?.[1] || 1)).padStart(2, '0')}`;
}

function normalizeSources(value) {
  return (Array.isArray(value) ? value : []).map((item) => clean(item, '', 1000)).filter(Boolean).slice(0, 100);
}

function normalizeKeywords(value, client, sector) {
  const supplied = Array.isArray(value) ? value : String(value || '').split(',');
  const candidates = ['publicité locale', 'écran LED', 'Espace C', 'Dour', 'JS-Innov.IA®', sector, client, ...supplied];
  const seen = new Set();
  return candidates.map((item) => clean(item, '', 80)).filter((item) => {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildVideoMetadata(input = {}, now = new Date()) {
  const createdAt = /^\d{4}-\d{2}-\d{2}$/.test(String(input.creationDate || ''))
    ? String(input.creationDate)
    : new Date(now).toISOString().slice(0, 10);
  const client = clean(input.client, 'Client à identifier', 180);
  const campaign = clean(input.campaign, 'Campagne à identifier', 180);
  const durationSeconds = Math.max(0.001, Number(input.durationSeconds) || 8);
  const version = normalizeVersion(input.version);
  const uniqueId = clean(input.uniqueId, crypto.randomUUID(), 100);
  const rightsConfirmed = input.rightsConfirmed === true;
  const copyright = rightsConfirmed
    ? clean(input.copyright, `© ${createdAt.slice(0, 4)} JS-Innov.IA® — Création publicitaire`, 300)
    : 'Droits contractuels à vérifier — aucune propriété attribuée';
  const rights = clean(
    input.usageRights,
    'Utilisation limitée à la campagne et aux supports validés par le client; toute extension requiert une validation.',
    1000,
  );
  const sector = clean(input.sector, 'activité locale', 120);
  const width = Math.max(1, Math.round(Number(input.width) || 1920));
  const height = Math.max(1, Math.round(Number(input.height) || 1080));
  const resolutionLabel = clean(input.resolutionLabel, '1080p', 30);
  const metadata = {
    schemaVersion: 1,
    title: `${client} — ${campaign}`,
    artist: DEFAULTS.creator,
    author: DEFAULTS.creator,
    creator: DEFAULTS.creator,
    encodedBy: DEFAULTS.encodedBy,
    copyright,
    clientId: clean(input.clientId, '', 180) || null,
    client,
    campaign,
    description: clean(input.description, DEFAULTS.description, 1000),
    distributionPlace: clean(input.distributionPlace, DEFAULTS.distributionPlace, 300),
    distributionFormat: clean(input.distributionFormat, DEFAULTS.distributionFormat, 300),
    durationSeconds,
    creationDate: createdAt,
    validationDate: clean(input.validationDate, '', 40) || null,
    version,
    uniqueId,
    creatorSite: clean(input.creatorSite, DEFAULTS.creatorSite, 300),
    usageRights: rights,
    rightsConfirmed,
    creatorContact: clean(input.creatorContact, DEFAULTS.creatorContact, 300),
    source: clean(input.source, DEFAULTS.source, 300),
    keywords: normalizeKeywords(input.keywords, client, sector),
    sector,
    prompt: clean(input.prompt, '', 20_000),
    sourceMedia: normalizeSources(input.sourceMedia),
    exportParameters: {
      ...(input.exportParameters && typeof input.exportParameters === 'object' ? input.exportParameters : {}),
      container: 'MP4',
      width,
      height,
      resolutionLabel,
    },
    campaignId: clean(input.campaignId, uniqueId, 180),
  };
  metadata.filename = buildFinalFilename(metadata);
  return metadata;
}

function buildFinalFilename(metadata = {}) {
  const seconds = Math.max(1, Math.round(Number(metadata.durationSeconds) || 8));
  const resolution = slug(metadata.exportParameters?.resolutionLabel || '1080p', '1080p');
  return `${slug(metadata.client, 'client')}_${slug(metadata.campaign, 'campagne')}_${clean(metadata.creationDate, new Date().toISOString().slice(0, 10), 10)}_${normalizeVersion(metadata.version)}_${seconds}s_${resolution}.mp4`;
}

function ffmpegMetadataArgs(metadata = {}) {
  const tags = {
    title: metadata.title,
    artist: metadata.artist,
    author: metadata.author,
    creator: metadata.creator,
    encoded_by: metadata.encodedBy,
    copyright: metadata.copyright,
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
    keywords: (metadata.keywords || []).join(', '),
  };
  return Object.entries(tags).flatMap(([key, value]) => ['-metadata', `${key}=${clean(value, '', 20_000)}`]);
}

function buildFfmpegArgs(inputPath, outputPath, metadata) {
  return [
    '-y', '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart+use_metadata_tags',
    ...ffmpegMetadataArgs(metadata),
    outputPath,
  ];
}

const REQUIRED_TAGS = Object.freeze([
  'title', 'artist', 'creator', 'encoded_by', 'client', 'campaign', 'description',
  'distribution_place', 'distribution_format', 'duration', 'date', 'version',
  'unique_id', 'creator_site', 'usage_rights', 'creator_contact', 'source', 'keywords',
]);

function verifyProbe(probe = {}, expected = {}) {
  const rawTags = probe?.format?.tags || {};
  const tags = Object.fromEntries(Object.entries(rawTags).map(([key, value]) => [String(key).toLowerCase(), String(value)]));
  const missing = REQUIRED_TAGS.filter((key) => !clean(tags[key]));
  const mismatches = [];
  if (clean(tags.title) !== clean(expected.title)) mismatches.push('title');
  if (clean(tags.client) !== clean(expected.client)) mismatches.push('client');
  if (clean(tags.campaign) !== clean(expected.campaign)) mismatches.push('campaign');
  if (clean(tags.unique_id) !== clean(expected.uniqueId)) mismatches.push('unique_id');
  const formatDurationSeconds = Number(probe?.format?.duration || 0) || null;
  if (!formatDurationSeconds || Math.abs(formatDurationSeconds - Number(expected.durationSeconds || 0)) > 0.5) mismatches.push('duration_seconds');
  const videoStream = probe?.streams?.find((stream) => stream.codec_type === 'video');
  if (Number(videoStream?.width || 0) !== Number(expected.exportParameters?.width || 0)) mismatches.push('width');
  if (Number(videoStream?.height || 0) !== Number(expected.exportParameters?.height || 0)) mismatches.push('height');
  return { ok: missing.length === 0 && mismatches.length === 0, missing, mismatches, tags, formatDurationSeconds };
}

function buildSidecar(metadata, { sha256, probe, verification, finalizedAt = new Date().toISOString() } = {}) {
  return {
    ...metadata,
    finalFilename: metadata.filename,
    finalizedAt,
    validationDate: metadata.validationDate,
    integrity: { algorithm: 'SHA-256', hash: clean(sha256, '', 128) },
    technicalVerification: {
      metadataPresent: verification?.ok === true,
      missingTags: verification?.missing || [],
      mismatchedTags: verification?.mismatches || [],
      durationSeconds: verification?.formatDurationSeconds || null,
      formatName: probe?.format?.format_name || null,
      codec: probe?.streams?.find((stream) => stream.codec_type === 'video')?.codec_name || null,
      width: probe?.streams?.find((stream) => stream.codec_type === 'video')?.width || null,
      height: probe?.streams?.find((stream) => stream.codec_type === 'video')?.height || null,
    },
    notice: 'Les métadonnées sont invisibles dans la publicité et peuvent être supprimées par certaines plateformes. Aucun filigrane visible n’a été ajouté.',
  };
}

function encodeVideoPackage(metadata, videoBuffer) {
  const json = Buffer.from(JSON.stringify(metadata), 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(json.length, 0);
  return Buffer.concat([header, json, Buffer.from(videoBuffer)]);
}

function decodeVideoPackage(buffer) {
  const input = Buffer.from(buffer || []);
  if (input.length < 5) throw new Error('Paquet vidéo incomplet.');
  const jsonLength = input.readUInt32BE(0);
  if (jsonLength < 2 || jsonLength > 256 * 1024 || input.length <= 4 + jsonLength) throw new Error('En-tête de traçabilité vidéo invalide.');
  let metadata;
  try { metadata = JSON.parse(input.subarray(4, 4 + jsonLength).toString('utf8')); } catch (_) { throw new Error('Métadonnées vidéo JSON invalides.'); }
  return { metadata, video: input.subarray(4 + jsonLength) };
}

module.exports = {
  DEFAULTS,
  REQUIRED_TAGS,
  buildVideoMetadata,
  buildFinalFilename,
  buildFfmpegArgs,
  ffmpegMetadataArgs,
  verifyProbe,
  buildSidecar,
  encodeVideoPackage,
  decodeVideoPackage,
  slug,
};
