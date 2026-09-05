const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { getAccessToken, dropboxApiArg } = require('./server-dropbox-helper.cjs');
const { authorizeUsage, recordUsage } = require('./server-ai-cost.cjs');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const DEFAULT_TEXT_MODEL = process.env.PUBLISYA_TEXT_MODEL || 'gpt-5.6-luna';
const TRANSCRIBE_MODEL = process.env.PUBLISYA_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const MAX_TRANSCRIPTION_SECONDS = 10 * 60;

const CURRENT_TEXT_PRICING_USD_PER_MTOK = Object.freeze({
  'gpt-5.6-sol': { input: 4, output: 20 },
  'gpt-5.6': { input: 4, output: 20 },
  'gpt-5.6-terra': { input: 2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
});

const TRANSCRIBE_PRICING_USD_PER_MTOK = Object.freeze({
  'gpt-4o-mini-transcribe': { input: 1.25, output: 5 },
  'gpt-4o-transcribe': { input: 2.5, output: 10 },
});

const VARIANT_SCHEMAS = {
  facebook: {
    type: 'object', additionalProperties: false,
    required: ['caption', 'hashtags', 'cta', 'alt_text'],
    properties: {
      caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } },
      cta: { type: 'string' }, alt_text: { type: 'string' },
    },
  },
  instagram: {
    type: 'object', additionalProperties: false,
    required: ['caption', 'hashtags', 'cta', 'alt_text', 'cover_text'],
    properties: {
      caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } },
      cta: { type: 'string' }, alt_text: { type: 'string' }, cover_text: { type: 'string' },
    },
  },
  tiktok: {
    type: 'object', additionalProperties: false,
    required: ['caption', 'hashtags', 'hook', 'cover_text'],
    properties: {
      caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } },
      hook: { type: 'string' }, cover_text: { type: 'string' },
    },
  },
  linkedin: {
    type: 'object', additionalProperties: false,
    required: ['caption', 'hashtags', 'cta'],
    properties: {
      caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, cta: { type: 'string' },
    },
  },
  youtube: {
    type: 'object', additionalProperties: false,
    required: ['title', 'description', 'tags', 'thumbnail_text'],
    properties: {
      title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, thumbnail_text: { type: 'string' },
    },
  },
};

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['analysis', 'variants'],
  properties: {
    analysis: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'language', 'content_type', 'audience', 'detected_text', 'facts', 'risk_flags', 'suggested_cta', 'visual_notes'],
      properties: {
        summary: { type: 'string' },
        language: { type: 'string' },
        content_type: { type: 'string' },
        audience: { type: 'string' },
        detected_text: { type: 'array', items: { type: 'string' } },
        facts: { type: 'array', items: { type: 'string' } },
        risk_flags: { type: 'array', items: { type: 'string' } },
        suggested_cta: { type: 'string' },
        visual_notes: { type: 'array', items: { type: 'string' } },
      },
    },
    variants: {
      type: 'object',
      additionalProperties: false,
      required: ['facebook', 'instagram', 'tiktok', 'linkedin', 'youtube'],
      properties: VARIANT_SCHEMAS,
    },
  },
};

function isConfigured() {
  return Boolean(OPENAI_API_KEY);
}

function modelPricing(model) {
  const id = String(model || '').toLowerCase();
  if (CURRENT_TEXT_PRICING_USD_PER_MTOK[id]) return CURRENT_TEXT_PRICING_USD_PER_MTOK[id];
  const key = Object.keys(CURRENT_TEXT_PRICING_USD_PER_MTOK).find((candidate) => id.startsWith(`${candidate}-`));
  return key ? CURRENT_TEXT_PRICING_USD_PER_MTOK[key] : null;
}

function transcriptionPricing(model) {
  const id = String(model || '').toLowerCase();
  if (TRANSCRIBE_PRICING_USD_PER_MTOK[id]) return TRANSCRIBE_PRICING_USD_PER_MTOK[id];
  const key = Object.keys(TRANSCRIBE_PRICING_USD_PER_MTOK).find((candidate) => id.startsWith(`${candidate}-`));
  return key ? TRANSCRIBE_PRICING_USD_PER_MTOK[key] : null;
}

function explicitTokenCost(model, usage, pricingResolver) {
  const pricing = pricingResolver(model);
  if (!pricing) return null;
  const input = Number(usage?.input_tokens || usage?.prompt_tokens || 0);
  const output = Number(usage?.output_tokens || usage?.completion_tokens || 0);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return Number((((input * pricing.input) + (output * pricing.output)) / 1_000_000).toFixed(8));
}

async function run(command, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} a dépassé le délai autorisé.`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > 200_000) stderr = stderr.slice(-200_000); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} a échoué (${code}) : ${stderr.slice(-800)}`));
    });
  });
}

async function streamDropboxToFile(dropboxPath, destination) {
  const token = await getAccessToken();
  if (!token) throw new Error('Dropbox non configuré.');
  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': dropboxApiArg({ path: dropboxPath }),
    },
  });
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '');
    throw new Error(`Téléchargement média impossible (${response.status}) ${body.slice(0, 180)}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

async function probe(inputPath) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json',
    inputPath,
  ], { timeoutMs: 30_000 });
  try {
    return JSON.parse(stdout || '{}');
  } catch {
    return {};
  }
}

async function prepareImage(inputPath, workDir) {
  const output = path.join(workDir, 'visual-1.jpg');
  await run('ffmpeg', [
    '-y', '-i', inputPath,
    '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease',
    '-frames:v', '1', '-q:v', '4', output,
  ]);
  return [output];
}

async function prepareVideo(inputPath, workDir) {
  const metadata = await probe(inputPath).catch(() => ({}));
  const duration = Math.max(0, Number(metadata?.format?.duration || 0));
  const fractions = [0.12, 0.5, 0.88];
  const frames = [];
  for (let index = 0; index < fractions.length; index += 1) {
    const second = duration > 0 ? Math.max(0, Math.min(duration - 0.05, duration * fractions[index])) : index * 2;
    const output = path.join(workDir, `visual-${index + 1}.jpg`);
    try {
      await run('ffmpeg', [
        '-y', '-ss', second.toFixed(3), '-i', inputPath,
        '-frames:v', '1', '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease',
        '-q:v', '5', output,
      ]);
      frames.push(output);
    } catch {
      // Une vidéo sans image exploitable reste analysable via sa transcription et son contexte.
    }
  }

  const audioPath = path.join(workDir, 'audio.m4a');
  try {
    await run('ffmpeg', [
      '-y', '-i', inputPath, '-t', String(MAX_TRANSCRIPTION_SECONDS),
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audioPath,
    ], { timeoutMs: 180_000 });
  } catch {
    return { frames, audioPath: null, metadata };
  }
  return { frames, audioPath, metadata };
}

async function transcribe(audioPath, accountingContext) {
  if (!audioPath) return { text: '', usage: null, requestId: null };
  const audio = await fsp.readFile(audioPath);
  if (audio.length === 0) return { text: '', usage: null, requestId: null };

  const form = new FormData();
  form.append('model', TRANSCRIBE_MODEL);
  form.append('file', new Blob([audio], { type: 'audio/mp4' }), 'publisya-audio.m4a');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Transcription OpenAI impossible (${response.status}) : ${String(data.error?.message || '').slice(0, 240)}`);

  const requestId = response.headers.get('x-request-id') || null;
  const explicitCost = explicitTokenCost(TRANSCRIBE_MODEL, data.usage, transcriptionPricing);
  await recordUsage({
    provider: 'openai',
    model: TRANSCRIBE_MODEL,
    input_tokens: data.usage?.input_tokens || 0,
    output_tokens: data.usage?.output_tokens || 0,
    ...(explicitCost == null ? {} : { cost_usd: explicitCost }),
    project_key: accountingContext.projectKey,
    project_name: accountingContext.projectName,
    client_key: accountingContext.clientKey,
    client_name: accountingContext.clientName,
    source: 'publisya.transcription',
    request_id: requestId,
    metadata: { campaign_id: accountingContext.campaignId },
  }, accountingContext.actor).catch((error) => console.warn('[publisya-ai] coût transcription non enregistré:', error.message));

  return { text: String(data.text || '').slice(0, 24_000), usage: data.usage || null, requestId };
}

async function visualInputItems(framePaths) {
  const items = [];
  for (const framePath of framePaths.slice(0, 3)) {
    const buffer = await fsp.readFile(framePath);
    if (!buffer.length) continue;
    items.push({
      type: 'input_image',
      image_url: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      detail: 'low',
    });
  }
  return items;
}

function outputText(responseData) {
  if (typeof responseData?.output_text === 'string') return responseData.output_text;
  for (const item of responseData?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

async function generateStructuredContent({ campaign, tenantId, transcriptText, framePaths, mediaMetadata, actor }) {
  const budget = await authorizeUsage({
    complexity: 'simple',
    estimated_cost_usd: 0.05,
    project_key: `publisya:${campaign.id}`,
    client_key: tenantId,
  });
  if (!budget.allowed) {
    const error = new Error(`Analyse IA bloquée par AI Cost Control (${budget.reason || 'budget'}).`);
    error.status = 402;
    throw error;
  }

  const recommended = String(budget.recommended_model || '');
  const model = process.env.PUBLISYA_TEXT_MODEL || (modelPricing(recommended) ? recommended : DEFAULT_TEXT_MODEL);
  const visuals = await visualInputItems(framePaths);
  const targetPlatforms = Array.isArray(campaign.target_platforms) ? campaign.target_platforms.join(', ') : '';

  const userText = [
    `Organisation : ${tenantId}`,
    `Campagne : ${campaign.title || ''}`,
    `Objectif : ${campaign.objective || 'non précisé'}`,
    `Réseaux demandés : ${targetPlatforms || 'non précisés'}`,
    `Consignes validées : ${campaign.instructions || 'aucune'}`,
    `Transcription du média : ${transcriptText || 'aucune parole détectée'}`,
    `Métadonnées techniques : ${JSON.stringify(mediaMetadata || {})}`,
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 5000,
      input: [
        {
          role: 'developer',
          content: [{
            type: 'input_text',
            text: [
              'Tu es le moteur éditorial de Publisya by JS-Innov.IA.',
              'Analyse uniquement les faits présents dans le média, la transcription et les consignes fournies.',
              'N’invente jamais de prix, promotion, garantie, adresse, téléphone, résultat, disponibilité ou caractéristique.',
              'Si une information importante est incertaine, ajoute-la à risk_flags au lieu de la présenter comme un fait.',
              'Adapte réellement chaque publication à son réseau. Évite le même texte copié-collé.',
              'Les hashtags doivent être pertinents, peu nombreux et sans spam.',
              'Le texte doit rester naturel et prêt à être relu par un humain avant toute publication.',
            ].join('\n'),
          }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: userText }, ...visuals],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'publisya_social_campaign',
          strict: true,
          schema: OUTPUT_SCHEMA,
        },
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Analyse OpenAI impossible (${response.status}) : ${String(data.error?.message || '').slice(0, 240)}`);
  const text = outputText(data);
  if (!text) throw new Error('Réponse IA vide.');

  let structured;
  try {
    structured = JSON.parse(text);
  } catch {
    throw new Error('Réponse IA structurée illisible.');
  }

  const requestId = response.headers.get('x-request-id') || data.id || null;
  const explicitCost = explicitTokenCost(model, data.usage, modelPricing);
  await recordUsage({
    provider: 'openai',
    model,
    input_tokens: data.usage?.input_tokens || 0,
    cached_input_tokens: data.usage?.input_tokens_details?.cached_tokens || 0,
    output_tokens: data.usage?.output_tokens || 0,
    ...(explicitCost == null ? {} : { cost_usd: explicitCost }),
    project_key: `publisya:${campaign.id}`,
    project_name: campaign.title,
    client_key: tenantId,
    client_name: tenantId,
    source: 'publisya.social_generation',
    request_id: requestId,
    metadata: { campaign_id: campaign.id, store: false },
  }, actor).catch((error) => console.warn('[publisya-ai] coût génération non enregistré:', error.message));

  return { structured, model, requestId, usage: data.usage || null };
}

async function analyzeCampaignMedia({ campaign, media, tenantId, actor }) {
  if (!isConfigured()) {
    const error = new Error('OPENAI_API_KEY non configurée pour Publisya.');
    error.status = 503;
    throw error;
  }
  if (!campaign?.id || !media?.storage_key) throw new Error('Campagne ou média source invalide.');

  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'publisya-'));
  const sourceExt = path.extname(String(media.storage_key || '')).replace(/[^.a-z0-9]/gi, '').slice(0, 8) || '.bin';
  const sourcePath = path.join(workDir, `source${sourceExt}`);
  const accountingContext = {
    campaignId: campaign.id,
    projectKey: `publisya:${campaign.id}`,
    projectName: campaign.title,
    clientKey: tenantId,
    clientName: tenantId,
    actor,
  };

  try {
    await streamDropboxToFile(media.storage_key, sourcePath);
    let framePaths = [];
    let audioPath = null;
    let mediaMetadata = {};

    if (/^video\//i.test(String(media.mime_type || ''))) {
      const prepared = await prepareVideo(sourcePath, workDir);
      framePaths = prepared.frames;
      audioPath = prepared.audioPath;
      mediaMetadata = prepared.metadata;
    } else {
      framePaths = await prepareImage(sourcePath, workDir);
      mediaMetadata = await probe(sourcePath).catch(() => ({}));
    }

    const transcript = await transcribe(audioPath, accountingContext);
    const generated = await generateStructuredContent({
      campaign,
      tenantId,
      transcriptText: transcript.text,
      framePaths,
      mediaMetadata,
      actor,
    });

    return {
      analysis: generated.structured.analysis,
      variants: generated.structured.variants,
      transcript: transcript.text,
      model: generated.model,
      request_id: generated.requestId,
      usage: generated.usage,
    };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  isConfigured,
  analyzeCampaignMedia,
  explicitTokenCost,
  CURRENT_TEXT_PRICING_USD_PER_MTOK,
  TRANSCRIBE_PRICING_USD_PER_MTOK,
};
