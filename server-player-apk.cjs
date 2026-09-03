const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getAccessToken } = require('./server-dropbox-helper.cjs');
const { fetchWithPathRoot } = require('./server-signage-dropbox-scope.cjs');

const router = express.Router();
const RELEASE_METADATA_PATH = path.join(__dirname, 'assets', 'pixelium-player-release.json');
const LEGACY_APK_NAME = 'Pixelium-Player-Olivier-0.3.0-pilot.apk';
const LEGACY_APK_PATH = path.join(__dirname, 'assets', LEGACY_APK_NAME);
const PINNED_CERTIFICATE_SHA256 = '8fed74014024629caa1d253264e894e627dc1b96ce1add75d4ee8dad87f89cf9';
const DROPBOX_PLAYER_DIR = String(process.env.PIXELIUM_DROPBOX_PLAYER_DIR || '').trim().replace(/\/$/, '');

function normalizeDigest(value) {
  return String(value || '').replace(/:/g, '').trim().toLowerCase();
}

function readReleaseMetadata() {
  try {
    return JSON.parse(fs.readFileSync(RELEASE_METADATA_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function resolveSignedRelease() {
  const metadata = readReleaseMetadata();
  const version = String(metadata?.version || '').trim();
  if (!/^[0-9A-Za-z._-]+$/.test(version)) {
    return { apk: null, error: 'release_metadata_invalid' };
  }

  const name = `Pixelium-Player-Olivier-${version}.apk`;
  const filePath = path.join(__dirname, 'assets', name);
  if (!fs.existsSync(filePath)) {
    return { apk: null, error: 'release_apk_missing', metadata };
  }

  const expectedApkSha256 = normalizeDigest(metadata.apkSha256);
  const expectedCertificateSha256 = normalizeDigest(metadata.certificateSha256);
  if (expectedApkSha256.length !== 64 || expectedCertificateSha256 !== PINNED_CERTIFICATE_SHA256) {
    return { apk: null, error: 'release_trust_metadata_invalid', metadata };
  }

  const actualApkSha256 = sha256File(filePath);
  if (actualApkSha256 !== expectedApkSha256) {
    return { apk: null, error: 'release_checksum_mismatch', metadata, actualApkSha256 };
  }

  return {
    apk: {
      name,
      path: filePath,
      version,
      apkSha256: actualApkSha256,
      certificateSha256: metadata.certificateSha256,
      sourceCommit: metadata.sourceCommit || null,
      release: true,
    },
    error: null,
    metadata,
  };
}

function resolveLegacyApk() {
  if (!fs.existsSync(LEGACY_APK_PATH)) return null;
  return {
    name: LEGACY_APK_NAME,
    path: LEGACY_APK_PATH,
    version: '0.3.0-pilot',
    apkSha256: sha256File(LEGACY_APK_PATH),
    release: false,
  };
}

async function uploadDropboxFile(dropboxPath, buffer) {
  const token = await getAccessToken();
  if (!token) throw new Error('Dropbox non configuré');

  const response = await fetchWithPathRoot('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path: dropboxPath,
        mode: 'overwrite',
        autorename: false,
        mute: true,
      }),
    },
    body: buffer,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_summary || `Dropbox upload ${response.status}`);
  return data;
}

async function syncSignedReleaseToDropbox() {
  if (!DROPBOX_PLAYER_DIR) {
    console.log('[player-dropbox] sync automatique désactivée: PIXELIUM_DROPBOX_PLAYER_DIR non défini');
    return;
  }

  const { apk, error } = resolveSignedRelease();
  if (!apk) {
    console.log(`[player-dropbox] sync ignorée: release signée invalide (${error || 'unknown'})`);
    return;
  }

  const apkBuffer = fs.readFileSync(apk.path);
  const metadataBuffer = fs.readFileSync(RELEASE_METADATA_PATH);
  const apkResult = await uploadDropboxFile(`${DROPBOX_PLAYER_DIR}/${apk.name}`, apkBuffer);
  await uploadDropboxFile(`${DROPBOX_PLAYER_DIR}/release.json`, metadataBuffer);

  console.log(`[player-dropbox] release ${apk.version} synchronisée: ${apkResult.path_display || DROPBOX_PLAYER_DIR}`);
}

function sendApk(res, apk, channel) {
  res.set({
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${apk.name}"`,
    'Content-Length': fs.statSync(apk.path).size,
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Pixelium-Player-Version': apk.version,
    'X-Pixelium-APK-SHA256': apk.apkSha256,
    'X-Pixelium-Release': channel,
  });
  if (apk.certificateSha256) {
    res.set('X-Pixelium-Certificate-SHA256', apk.certificateSha256);
  }
  res.sendFile(apk.path, error => {
    if (error && !res.headersSent) res.status(503).json({ error: 'APK Player momentanément indisponible' });
  });
}

function downloadSignedPlayer(req, res) {
  const { apk, error } = resolveSignedRelease();
  if (!apk) {
    return res.status(503).set('Cache-Control', 'no-store').json({
      error: 'Release Pixelium signée indisponible',
      code: error || 'signed_release_unavailable',
    });
  }
  return sendApk(res, apk, 'signed-release');
}

function downloadLegacyPlayer(req, res) {
  const apk = resolveLegacyApk();
  if (!apk) return res.status(404).json({ error: 'Ancien Player indisponible' });
  return sendApk(res, apk, 'legacy-explicit');
}

// Mise en service et mises à jour: release signée uniquement, sans retour silencieux au 0.3.
router.get('/android', downloadSignedPlayer);
router.get('/latest', downloadSignedPlayer);
router.get('/commissioning', downloadSignedPlayer);
// Route de récupération explicite uniquement. Elle n'est jamais utilisée par /latest ni par le lien court public.
router.get('/legacy', downloadLegacyPlayer);

router.get('/status', (req, res) => {
  const { apk, error } = resolveSignedRelease();
  res.set('Cache-Control', 'no-store');
  res.status(apk ? 200 : 503).json({
    available: Boolean(apk),
    version: apk?.version || null,
    channel: apk ? 'signed-release' : 'unavailable',
    certificateSha256: apk?.certificateSha256 || null,
    apkSha256: apk?.apkSha256 || null,
    sourceCommit: apk?.sourceCommit || null,
    commissioningPath: '/api/player-download/commissioning',
    error: apk ? null : error || 'signed_release_unavailable',
    dropboxSyncTarget: apk && DROPBOX_PLAYER_DIR ? DROPBOX_PLAYER_DIR : null,
  });
});

const initialSync = setTimeout(() => {
  syncSignedReleaseToDropbox().catch(error => {
    console.warn('[player-dropbox] synchronisation échouée:', error.message);
  });
}, 1500);
initialSync.unref?.();

module.exports = router;
