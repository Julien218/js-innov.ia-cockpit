const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, 'dist');

app.use(express.json({ limit: '10mb' }));

// ── API Emails IMAP ────────────────────────────────────────────
// Route proxy IMAP pour la boite info@jsinnovia.com
// Auth: x-api-key header ou ?key= query param
try {
  const emailRouter = require('./server-email.cjs');
  app.use('/api/emails', emailRouter);
  console.log('✅ Route /api/emails activée (IMAP IONOS)');
} catch (e) {
  console.warn('⚠️ Route emails indisponible:', e.message);
}

// ── Static + SPA fallback ─────────────────────────────────────
app.use(express.static(DIST, {
  maxAge: '1y',
  immutable: true,
  index: false,
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ JS-Innov.IA Cockpit — port ${PORT}`);
});
