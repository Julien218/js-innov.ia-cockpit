const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { uploadFile, ensureFolderTree } = require('./server-dropbox-helper.cjs');
const { indexDocument } = require('./server-documents.cjs');
const {
  buildVideoMetadata,
  buildFfmpegArgs,
  verifyProbe,
  buildSidecar,
  decodeVideoPackage,
} = require('./server-video-provenance-core.cjs');

const execFileAsync = promisify(execFile);
const router = express.Router();
const rawVideoPackage = express.raw({ type: 'application/vnd.jsinnovia.video-package', limit: '250mb' });

async function run(command, args, timeout = 20 * 60 * 1000) {
  return execFileAsync(command, args, { windowsHide: true, timeout, maxBuffer: 20 * 1024 * 1024 });
}

function safeDropboxSegment(value, fallback) {
  const segment = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/<>:"|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100);
  return segment || fallback;
}

async function finalizeVideoBuffer(packageBuffer, { now = new Date() } = {}) {
  const decoded = decodeVideoPackage(packageBuffer);
  const metadata = buildVideoMetadata(decoded.metadata, now);
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsinnovia-video-'));
  const inputPath = path.join(workdir, 'source-video');
  const outputPath = path.join(workdir, metadata.filename);
  try {
    await fs.writeFile(inputPath, decoded.video);
    await run('ffmpeg', buildFfmpegArgs(inputPath, outputPath, metadata));
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', outputPath], 60_000);
    const probe = JSON.parse(stdout);
    const verification = verifyProbe(probe, metadata);
    if (!verification.ok) {
      throw new Error(`Vérification des métadonnées échouée (manquantes: ${verification.missing.join(', ') || 'aucune'}; divergentes: ${verification.mismatches.join(', ') || 'aucune'}).`);
    }
    const finalBuffer = await fs.readFile(outputPath);
    const sha256 = crypto.createHash('sha256').update(finalBuffer).digest('hex');
    const sidecar = buildSidecar(metadata, { sha256, probe, verification, finalizedAt: new Date(now).toISOString() });
    return { metadata, finalBuffer, sha256, probe, verification, sidecar };
  } finally {
    await fs.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

router.post('/finalize', rawVideoPackage, async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length < 5) return res.status(400).json({ error: 'Fichier vidéo manquant.' });
  try {
    const result = await finalizeVideoBuffer(req.body);
    const identifiedClient = result.metadata.client !== 'Client à identifier';
    const baseFolder = identifiedClient
      ? `/Cockpit/Clients/${safeDropboxSegment(result.metadata.client, 'Client')}/Videos/${safeDropboxSegment(result.metadata.campaign, 'Campagne')}`
      : '/Cockpit/A_Classer/Videos';
    const folder = await ensureFolderTree(baseFolder);
    if (folder?.error) throw new Error(`Dropbox dossier: ${folder.error}`);
    const videoPath = `${baseFolder}/${result.metadata.filename}`;
    const jsonPath = videoPath.replace(/\.mp4$/i, '.json');
    const videoUpload = await uploadFile(videoPath, result.finalBuffer);
    if (videoUpload?.error) throw new Error(`Dropbox vidéo: ${videoUpload.error}`);
    const jsonUpload = await uploadFile(jsonPath, Buffer.from(`${JSON.stringify(result.sidecar, null, 2)}\n`, 'utf8'));
    if (jsonUpload?.error) throw new Error(`Dropbox JSON: ${jsonUpload.error}`);
    let index = null;
    let indexWarning = null;
    try {
      index = await indexDocument({
        user: req.user,
        organisation: req.user.organisation || 'jsinnovia',
        brand: 'jsinnovia',
        clientId: result.metadata.clientId || null,
        category: 'Videos',
        filename: result.metadata.filename,
        mimeType: 'video/mp4',
        sizeBytes: result.finalBuffer.length,
        dropboxMeta: { id: videoUpload.id, path_display: videoUpload.path, size: videoUpload.size, content_hash: result.sha256 },
        source: 'video-provenance',
      });
    } catch (error) {
      indexWarning = `Index Cockpit indisponible: ${error.message}`;
    }
    return res.status(201).json({
      success: true,
      finalized: true,
      verified: true,
      fileName: result.metadata.filename,
      dropboxPath: videoUpload.path,
      sidecarPath: jsonUpload.path,
      documentId: index?.id || null,
      indexWarning,
      sha256: result.sha256,
      uniqueId: result.metadata.uniqueId,
      rightsConfirmed: result.metadata.rightsConfirmed,
      metadataWarning: result.metadata.rightsConfirmed ? null : 'Copyright non attribué: validation contractuelle requise.',
      journalId: `video-provenance-${crypto.randomUUID()}`,
    });
  } catch (error) {
    console.error('[video-provenance]', error);
    return res.status(422).json({ error: error.message || 'Finalisation vidéo impossible.', finalized: false });
  }
});

module.exports = router;
module.exports.finalizeVideoBuffer = finalizeVideoBuffer;
