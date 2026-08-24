// server.cjs — API uniquement (nginx gère le SPA statique)
// Écoute sur :3001, accessible via nginx proxy /api/
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.API_PORT || 3001;
const { requireSession, requireSameOrigin, ROLE_LEVEL } = require('./server-security.cjs');
let taskAutopilotState = null;

// Trust proxy — nécessaire pour détecter HTTPS (X-Forwarded-Proto) et l'IP réelle
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

// ── Vérification légale clients via la BCE officielle ──────
try {
  const bceRouter = require('./server-bce.cjs');
  app.use('/api/bce', requireSession('admin'), bceRouter.router);
  console.log('✅ Route /api/bce activée (recherche officielle + validation humaine)');
} catch (e) {
  console.warn('⚠️ Route BCE indisponible:', e.message);
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
try {
  const { router: aiCostRouter } = require('./server-ai-cost.cjs');
  app.use('/api/ai-cost', aiCostRouter);
  // Doit être installé avant le require de server-assistant.cjs : ce dernier
  // récupère alors la fonction recordUsage enrichie avec le Client.id canonique.
  require('./server-ai-cost-attribution.cjs').installAICostAttribution();
  console.log('✅ Route /api/ai-cost activée (usage, budgets, routage, attribution client)');
} catch (e) {
  console.warn('⚠️ Route AI Cost Control indisponible:', e.message);
}

// ── Ledger coûts client / refacturation ─────────────────────
try {
  const adminGuard = requireSession('admin');
  // Route prioritaire : les micro-coûts LLM sont agrégés au mois par modèle
  // avant l'arrondi au centime. Le détail requête reste dans ai_cost_usage.
  const { router: aiCostLedgerAggregateRouter } = require('./server-ai-cost-ledger-aggregate.cjs');
  app.use('/api/client-costs', adminGuard, aiCostLedgerAggregateRouter);

  const { router: clientCostsRouter } = require('./server-client-costs.cjs');
  app.use('/api/client-costs', adminGuard, clientCostsRouter);
  console.log('✅ Route /api/client-costs activée (client_id canonique, agrégation IA précise, coûts réels, marge, refacturation)');
} catch (e) {
  console.warn('⚠️ Route client-costs indisponible:', e.message);
}

// ── Diagnostic live des domaines + audit SEO ───────────────
try {
  const domainOpsRouter = require('./server-domain-ops.cjs');
  app.use('/api/domain-ops', requireSession('admin'), domainOpsRouter);
  console.log('✅ Route /api/domain-ops activée (DNS, HTTP, TLS, SEO lecture seule)');
} catch (e) {
  console.warn('⚠️ Route domain-ops indisponible:', e.message);
}

// ── Companion batch : création multi-tâches + délégation ───
try {
  const taskAutopilot = require('./server-task-autopilot.cjs');
  taskAutopilotState = taskAutopilot.state;
  app.use('/api/task-autopilot', requireSession('admin'), taskAutopilot.router);
  const autopilot = taskAutopilot.startTaskAutopilotScheduler();
  console.log(`✅ Autopilote tâches ${autopilot.started ? 'activé' : 'inactif'} (${autopilot.reason || `${autopilot.interval_ms} ms`})`);
} catch (e) {
  console.warn('⚠️ Autopilote tâches indisponible:', e.message);
}

// ── Companion batch : création multi-tâches + délégation ───
try {
  const assistantBatchRouter = require('./server-assistant-batch.cjs');
  // Monté AVANT le Companion historique. Il intercepte uniquement les demandes
  // multi-tâches et laisse toutes les autres routes continuer vers le routeur legacy.
  app.use('/api/assistant', requireSession('client'), assistantBatchRouter);
  console.log('✅ Companion batch activé (confirmation unique + tâches + agent_runs)');
} catch (e) {
  console.warn('⚠️ Companion batch indisponible:', e.message);
}

// ── Companion adaptatif : owner / équipe / client ──────────
try {
  const assistantRouter = require('./server-assistant.cjs');
  // La route accepte les clients, mais server-assistant.cjs impose ensuite
  // la politique et les outils correspondant au rôle de la session.
  app.use('/api/assistant', requireSession('client'), assistantRouter);
  console.log('✅ Companion adaptatif activé (owner/staff/client cloisonnés)');
} catch (e) {
  console.warn('⚠️ Route assistant indisponible:', e.message);
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

// ── Base44 Agents Proxy (sécurisé, sans clé frontend) ─────
try {
  const base44AgentsRouter = require('./server-base44-agents.cjs');
  app.use('/api/base44-agents', requireSession('collaborateur'), base44AgentsRouter.router);
  console.log('✅ Route /api/base44-agents activée (proxy sécurisé vers Base44 Agents API)');
} catch (e) {
  console.warn('⚠️ Route base44-agents indisponible:', e.message);
}


// ── Push Notifications & Géolocalisation ───────────────────
try {
  const pushRouter = require('./server-push.cjs');
  app.use('/api/push', requireSession('collaborateur'), pushRouter.router);
  console.log('✅ Route /api/push activée (notifications push + géolocalisation)');
} catch (e) {
  console.warn('⚠️ Route push indisponible:', e.message);
}

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  service: 'cockpit-api',
  task_autopilot: taskAutopilotState ? {
    running: taskAutopilotState.running,
    last_started_at: taskAutopilotState.last_started_at,
    last_finished_at: taskAutopilotState.last_finished_at,
    last_error: taskAutopilotState.last_error,
    examined: taskAutopilotState.last_result?.examined ?? null,
    unique: taskAutopilotState.last_result?.unique ?? null,
    executed: taskAutopilotState.last_result?.executed?.length ?? null,
    blocked: taskAutopilotState.last_result?.blocked?.length ?? null,
    duplicate_groups: taskAutopilotState.last_result?.duplicates?.length ?? null,
  } : { available: false },
}));

app.listen(PORT, () => {
  console.log(`✅ JS-Innov.IA Cockpit API — port ${PORT}`);
  console.log(`   Proxy /api/data → ${(process.env.JSINNOVIA_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app')}/data`);
});
