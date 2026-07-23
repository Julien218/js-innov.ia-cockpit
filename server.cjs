// server.cjs — API uniquement (nginx gère le SPA statique)
// Écoute sur :3001, accessible via nginx proxy /api/
const express = require('express');
const path = require('path');
const app = express();
// Port 3001 — nginx proxifie /api/ ici ; ne pas changer sauf Railway variable
const PORT = process.env.API_PORT || 3001;

app.use(express.json({ limit: '10mb' }));

// ── API Emails IMAP ──────────────────────────────────────────
try {
  const emailRouter = require('./server-email.cjs');
  app.use('/api/emails', emailRouter);
  console.log('✅ Route /api/emails activée (IMAP IONOS — multi-mailbox)');
  console.log('   Mailboxes: jsinnovia, assurances');
} catch (e) {
  console.warn('⚠️ Route emails indisponible:', e.message);
}

// Health check API
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'cockpit-api' }));

app.listen(PORT, () => {
  console.log(`✅ JS-Innov.IA Cockpit API — port ${PORT}`);
});
