// server.cjs — API uniquement (nginx gère le SPA statique)
// Écoute sur :3001, accessible via nginx proxy /api/
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.API_PORT || 3001;
const { requireSession, requireSameOrigin, ROLE_LEVEL } = require('./server-security.cjs');

// Trust proxy — nécessaire pour détecter HTTPS (X-Forwarded-Proto) et l'IP réelle (X-Real-IP)
// nginx reverse proxy est le premier hop
app.set('trust proxy', 1);

app.use(express.json({ limit: '25mb' }));
app.use(requireSameOrigin);

// ── API Auth (backend, service_role) ────────────────────────
try {
  const authRouter = require('./server-auth.cjs');
  app.use('/api/auth', authRouter);
  console.log('✅ Route /api/auth activée (login, session, logout)');
} catch (e) {
  console.warn('⚠️ Route auth indisponible:', e.message);
}

// ── API Emails IMAP ──────────────────────────────────────────
try {
  const emailRouter = require('./server-email.cjs');
  const emailSessionGuard = requireSession('admin');
  app.use('/api/emails', (req, res, next) => {
    // HainoFlow utilise sa clé serveur dédiée sur cette unique route.
    // Toutes les autres routes email restent protégées par la session admin.
    if (req.path === '/official') return next();
    return emailSessionGuard(req, res, next);
  }, emailRouter);
  console.log('✅ Route /api/emails activée (IMAP IONOS — multi-mailbox)');
  console.log('   Mailboxes: jsinnovia, assurances');
} catch (e) {
  console.warn('⚠️ Route emails indisponible:', e.message);
}

// ── Coffre documentaire Dropbox + index Supabase ───────────
try {
  const documentsRouter = require('./server-documents.cjs');
  app.use('/api/documents', requireSession('collaborateur'), documentsRouter);
  console.log('✅ Route /api/documents activée (Dropbox + index Supabase)');
} catch (e) {
  console.warn('⚠️ Route documents indisponible:', e.message);
}

// ── Composition email avec pièces jointes / Dropbox ─────────
try {
  const emailComposeRouter = require('./server-email-compose.cjs');
  app.use('/api/email-compose', requireSession('admin'), emailComposeRouter);
  console.log('✅ Route /api/email-compose activée (pièces jointes + Dropbox)');
} catch (e) {
  console.warn('⚠️ Route email-compose indisponible:', e.message);
}

// ── API Billing (PDF + envoi devis/factures) ─────────────────
try {
  const billingRouter = require('./server-billing.cjs');
  app.use('/api/billing', requireSession('admin'), billingRouter);
  console.log('✅ Route /api/billing activée (PDF + email devis/factures)');
} catch (e) {
  console.warn('⚠️ Route billing indisponible:', e.message);
}

// ── Assurances-Dour : suivi partagé Julien / Olivier ─────────
try {
  const insuranceRouter = require('./server-insurance.cjs');
  app.use('/api/insurance', requireSession('client'), insuranceRouter);
  insuranceRouter.startInsuranceEmailSyncScheduler?.();
  console.log('✅ Route /api/insurance activée (Julien + Olivier uniquement)');
} catch (e) {
  console.warn('⚠️ Route assurances indisponible:', e.message);
}

// ── Proxy de données multi-tenant HainoFlow ─────────────────
try {
  const dataProxyRouter = require('./server-data-proxy.cjs');
  app.use('/api/data', requireSession('client'), dataProxyRouter);
  console.log('✅ Route /api/data activée (cloisonnement HainoFlow par organisation)');
} catch (e) {
  console.warn('⚠️ Route data multi-tenant indisponible:', e.message);
}

// ── Centre HainoFlow by JS-Innov.IA ────────────────────────
try {
  const hainoFlowRouter = require('./server-hainoflow.cjs');
  app.use('/api/hainoflow', requireSession('client'), hainoFlowRouter);
  console.log('✅ Route /api/hainoflow activée (résumé et état des modules)');
} catch (e) {
  console.warn('⚠️ Route HainoFlow indisponible:', e.message);
}

// ── AI Cost Control ─────────────────────────────────────────
// Lecture/configuration : session admin. Ingestion inter-services : clé serveur dédiée.
try {
  const { router: aiCostRouter } = require('./server-ai-cost.cjs');
  app.use('/api/ai-cost', aiCostRouter);
  console.log('✅ Route /api/ai-cost activée (usage, budgets, routage, hard limits)');
} catch (e) {
  console.warn('⚠️ Route AI Cost Control indisponible:', e.message);
}

try {
  const assistantRouter = require('./server-assistant.cjs');
  app.use('/api/assistant', requireSession('collaborateur'), assistantRouter);
  console.log('Assistant personnel sécurisé activé');
} catch (e) {
  console.warn('Route assistant indisponible:', e.message);
}

// ── Email Core Framework (queue + send + API) ──────────────
try {
  const emailCoreRouter = require('./server-email-core.cjs');
  app.use('/api/emails', emailCoreRouter);
  console.log('✅ Route /api/emails (core framework) activée');
} catch (e) {
  console.warn('⚠️ Route email-core indisponible:', e.message);
}

// ── Data Governance & RGPD ─────────────────────────────────
try {
  const governanceRouter = require('./server-governance.cjs');
  app.use('/api/governance', governanceRouter);
  console.log('✅ Route /api/governance activée (audit, RGPD, consentements, politiques)');
} catch (e) {
  console.warn('⚠️ Route governance indisponible:', e.message);
}

// Health check API
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'cockpit-api' }));

app.listen(PORT, () => {
  console.log(`✅ JS-Innov.IA Cockpit API — port ${PORT}`);
  console.log(`   Proxy /api/data → ${(process.env.JSINNOVIA_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app')}/data`);
});