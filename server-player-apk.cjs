const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const RELEASE_APK_NAME = 'Pixelium-Player-Olivier-0.5.0-pilot.apk';
const LEGACY_APK_NAME = 'Pixelium-Player-Olivier-0.3.0-pilot.apk';
const RELEASE_APK_PATH = path.join(__dirname, 'assets', RELEASE_APK_NAME);
const LEGACY_APK_PATH = path.join(__dirname, 'assets', LEGACY_APK_NAME);
const RELEASE_METADATA_PATH = path.join(__dirname, 'assets', 'pixelium-player-release.json');

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
    sourceCommit: metadata?.sourceCommit || null
  });
});

module.exports = router;
