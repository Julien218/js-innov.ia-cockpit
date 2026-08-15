const express = require('express');
const path = require('path');

const router = express.Router();
const APK_NAME = 'Pixelium-Player-Olivier-0.3.0-pilot.apk';
const APK_PATH = path.join(__dirname, 'assets', APK_NAME);

router.get('/android', (req, res) => {
  res.set({
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${APK_NAME}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.sendFile(APK_PATH, error => {
    if (error && !res.headersSent) res.status(503).json({ error: 'APK Player momentanément indisponible' });
  });
});

module.exports = router;
