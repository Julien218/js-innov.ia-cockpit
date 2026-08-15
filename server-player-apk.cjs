const express = require('express');
const path = require('path');

const router = express.Router();
const apkPath = path.join(__dirname, 'player-android', 'Pixelium-Player-Olivier-pilot.apk');

router.get('/android', (req, res) => {
  res.download(apkPath, 'Pixelium-Player-Olivier-pilot.apk', (error) => {
    if (error && !res.headersSent) {
      res.status(503).json({ error: 'APK Player temporairement indisponible.' });
    }
  });
});

module.exports = router;
