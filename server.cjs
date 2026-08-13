// server.cjs — API uniquement (nginx gère le SPA statique)
// Écoute sur :3001, accessible via nginx proxy /api/
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.API_PORT || 3001;
const { requireSession, requireSameOrigin, ROLE_LEVEL } = require('./server-security.cjs');

app.set('trust proxy', 1);
app.use(express.json({ limit: '25mb' }));
app.use(requireSameOrigin);

try {
  const authRouter = require('./server-auth.cjs');
  app.use('/api/auth', authRouter);
  console.log('✅ Route /api/auth activée (login, session, logout)');
} catch (e) {
  console.warn('⚠️ Route auth indisponible:', e.message);
}

try {
  const emailRouter = require('./server-email.cjs');
  const emailSessionGuard = requireSession('admin');
  app.use('/api/emails', (req, res, next) => {
    if (req.path === '/official') return next();
    return emailSessionGuard(req, res, next);
  }, emailRouter);
  console.log('✅ Route /api/emails activée (IMAP IONOS — multi-mailbox)');
  console.log('   Mailboxes: jsinnovia, assurances');
} catch (e) {
  console.warn('⚠️ Route emails indisponible:', e.message);
}

try {
  const documentsRouter = require('./server-documents.cjs');
  app.use('/api/documents', requireSession('collaborateur'), documentsRouter);
  console.log('✅ Route /api/documents activée (Dropbox + index Supabase)');
} catch (e) {
  console.warn('⚠️ Route documents indisponible:', e.message);
}

try {
  const emailComposeRouter = require('./server-email-compose.cjs');
  app.use('/api/email-compose', requireSession('admin'), emailComposeRouter);
  console.log('✅ Route /api/email-compose activée (pièces jointes + Dropbox)');
} catch (e) {
  console.warn('⚠️ Route email-compose indisponible:', e.message);
}

try {
  const billingRouter = require('./server-billing.cjs');
  app.use('/api/billing', requireSession('admin'), billingRouter);
  console.log('✅ Route /api/billing activée (PDF + email devis/factures)');
} catch (e) {
  console.warn('⚠️ Route billing indisponible:', e.message);
}

try {
  const insuranceRouter = require('./server-insurance.cjs');
  app.use('/api/insurance', requireSession('client'), insuranceRouter);
  insuranceRouter.startInsuranceEmailSyncScheduler?.();
  console.log('✅ Route /api/insurance activée (Julien + Olivier uniquement)');
} catch (e) {
  console.warn('⚠️ Route assurances indisponible:', e.message);
}

// ── Commerce Digital Signage / Vidéosurveillance ────────────
// Les endpoints server-to-server vérifient x-commerce-key dans le routeur.
// Les endpoints /me et /orders appliquent eux-mêmes le contrôle de session.
try {
  const commerceRouter = require('./server-commerce.cjs');
  app.use('/api/commerce', commerceRouter);
  console.log('✅ Route /api/commerce activée (intake, Stripe, provisioning modules)');
} catch (e) {
  console.warn('⚠️ Route commerce indisponible:', e.message);
}

try {
  const signageRouter = require('./server-signage.cjs');
  app.use('/api/signage', signageRouter);
  console.log('Digital Signage runtime active');
} catch (e) {
  console.warn('Signage runtime unavailable:', e.message);
}

const AGENT_PROXY_URL = process.env.JSINNOVIA_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_PROXY_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';

app.use('/api/data', requireSession('client'), async (req, res) => {
  const table = req.path.split('/').filter(Boolean)[0];
  const role = req.user.role;
  const clientReadTables = new Set(['Projet', 'Devis', 'Facture', 'Demande']);
  if (role === 'client' && (req.method !== 'GET' || !clientReadTables.has(table))) {
    return res.status(403).json({ error: 'Cette opération nécessite un collaborateur' });
  }
  const adminTables = new Set(['LogAction', 'Validation', 'Commission']);
  if (adminTables.has(table) && (ROLE_LEVEL[role] || 0) < ROLE_LEVEL.admin) {
    return res.status(403).json({ error: 'Cette ressource nécessite un administrateur' });
  }
  const targetUrl = `${AGENT_PROXY_URL}/data${req.url}`;
  const method = req.method;
  const fetchOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': AGENT_PROXY_KEY,
    },
  };

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && req.body) {
    fetchOptions.body = JSON.stringify(req.body);
  }

  try {
    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || 'application/json';
    const body = await response.text();
    if (response.status === 204 || !body) return res.status(response.status).end();
    res.status(response.status).set('Content-Type', contentType).send(body);
  } catch (err) {
    console.error('[Proxy /api/data] Error:', err.message);
    res.status(502).json({ error: 'Proxy error: ' + err.message });
  }
});

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

try {
  const emailCoreRouter = require('./server-email-core.cjs');
  app.use('/api/emails', emailCoreRouter);
  console.log('✅ Route /api/emails (core framework) activée');
} catch (e) {
  console.warn('⚠️ Route email-core indisponible:', e.message);
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'cockpit-api' }));

app.listen(PORT, () => {
  console.log(`✅ JS-Innov.IA Cockpit API — port ${PORT}`);
  console.log(`   Proxy /api/data → ${AGENT_PROXY_URL}/data`);
});
