const express = require('express');
const fs = require('fs');
const path = require('path');
const { getAccessToken } = require('./server-dropbox-helper.cjs');

const router = express.Router();
const RELEASE_APK_NAME = 'Pixelium-Player-Olivier-0.5.0-pilot.apk';
const LEGACY_APK_NAME = 'Pixelium-Player-Olivier-0.3.0-pilot.apk';
const RELEASE_APK_PATH = path.join(__dirname, 'assets', RELEASE_APK_NAME);
const LEGACY_APK_PATH = path.join(__dirname, 'assets', LEGACY_APK_NAME);
const RELEASE_METADATA_PATH = path.join(__dirname, 'assets', 'pixelium-player-release.json');
const DROPBOX_ROOT_PATH = process.env.DROPBOX_ROOT_PATH || '/Cockpit';
const DROPBOX_PLAYER_DIR = process.env.PIXELIUM_DROPBOX_PLAYER_DIR || `${DROPBOX_ROOT_PATH}/Olivier-Trevis/Players/MXQ`;

function resolveApk() {
  if (fs.existsSync(RELEASE_APK_PATH)) {
    return { name: RELEASE_APK_NAME, path: RELEASE_APK_PATH, version: '0.5.0-pilot', release: true };
  }
  if (fs.existsSync(LEGACY_APK_PATH)) {
    return { name: LEGACY_APK_NAME, path: LEGACY_APK_PATH, version: '0.3.0-pilot', release: false };
  }
  return null;
}

function readReleaseMetadata() {
  try {
    return JSON.parse(fs.readFileSync(RELEASE_METADATA_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function uploadDropboxFile(dropboxPath, buffer) {
  const token = await getAccessToken();
  if (!token) throw new Error('Dropbox non configuré');

  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
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
  const apk = resolveApk();
  if (!apk?.release) {
    console.log('[player-dropbox] sync ignorée: release signée absente');
    return;
  }

  const metadataBuffer = fs.existsSync(RELEASE_METADATA_PATH)
    ? fs.readFileSync(RELEASE_METADATA_PATH)
    : null;
  const apkBuffer = fs.readFileSync(apk.path);

  const apkResult = await uploadDropboxFile(`${DROPBOX_PLAYER_DIR}/${RELEASE_APK_NAME}`, apkBuffer);
  if (metadataBuffer) {
    await uploadDropboxFile(`${DROPBOX_PLAYER_DIR}/release.json`, metadataBuffer);
  }

  console.log(`[player-dropbox] release ${apk.version} synchronisée: ${apkResult.path_display || DROPBOX_PLAYER_DIR}`);
}

function downloadPlayer(req, res) {
  const apk = resolveApk();
  if (!apk) return res.status(503).json({ error: 'APK Player momentanément indisponible' });

  res.set({
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${apk.name}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Pixelium-Player-Version': apk.version,
    'X-Pixelium-Release': apk.release ? 'signed-release' : 'legacy-fallback'
  });
  res.sendFile(apk.path, error => {
    if (error && !res.headersSent) res.status(503).json({ error: 'APK Player momentanément indisponible' });
  });
}

router.get('/android', downloadPlayer);
router.get('/latest', downloadPlayer);
router.get('/status', (req, res) => {
  const apk = resolveApk();
  const metadata = readReleaseMetadata();
  res.set('Cache-Control', 'no-store');
  res.json({
    available: Boolean(apk),
    version: apk?.version || null,
    channel: apk?.release ? 'release' : apk ? 'legacy-fallback' : 'unavailable',
    certificateSha256: metadata?.certificateSha256 || null,
    apkSha256: metadata?.apkSha256 || null,
    sourceCommit: metadata?.sourceCommit || null,
    dropboxSyncTarget: apk?.release ? DROPBOX_PLAYER_DIR : null
  });
});

const initialSync = setTimeout(() => {
  syncSignedReleaseToDropbox().catch(error => {
    console.warn('[player-dropbox] synchronisation échouée:', error.message);
  });
}, 1500);
initialSync.unref?.();

module.exports = router;
