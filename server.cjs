// server.cjs — API uniquement (nginx gère le SPA statique)
// Écoute sur :3001, accessible via nginx proxy /api/
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.API_PORT || 3001;
const { requireSession, requirePermission, requireSameOrigin, ROLE_LEVEL } = require('./server-security.cjs');
let authorizeImmediateExecutionMessage;
try {
  ({ authorizeImmediateExecutionMessage } = require('./server-immediate-execution-policy.cjs'));
} catch (_) {
  // Le runtime Docker historique copie les modules serveur explicitement. Ce fallback
  // conserve la politique d'exécution immédiate même si le helper n'est pas encore
  // présent dans une ancienne image, sans désactiver les garde-fous sensibles.
  const normalizeImmediate = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const stripInjectedImmediateContext = (value) => String(value || '')
    .replace(/\n?\[(?:DIAGNOSTIC LOCAL LECTURE SEULE|AUTORISATION COCKPIT|VERROU PREUVE VID[ÉE]O)[^\]]*\][\s\S]*?\[\/(?:DIAGNOSTIC LOCAL LECTURE SEULE|AUTORISATION COCKPIT|VERROU PREUVE VID[ÉE]O)\]/gi, '')
    .trim();
  const isSensitiveImmediate = (message) => /\b(?:supprime|supprimer|efface|effacer|delete|drop|truncate|dns|nameserver|cname|mx|txt|secret|token|cle api|api key|publie en production|publication production|deploy production|deploie en production|envoie email|envoyer email|paiement|virement)\b/.test(normalizeImmediate(stripInjectedImmediateContext(message)));
  authorizeImmediateExecutionMessage = (message) => {
    const original = String(message || '').trim();
    const text = normalizeImmediate(stripInjectedImmediateContext(original));
    if (!text || isSensitiveImmediate(text)) return original;
    const actionVerb = /\b(?:cree|creer|genere|generer|produis|produire|realise|realiser|lance|lancer|execute|executer|effectue|effectuer|fais|faire|corrige|corriger|modifie|modifier)\b/;
    const supportedTarget = /\b(?:video|videos|image|images|visuel|visuels|page|site|seo|application|app|mobile|workflow|comfyui|ecran geant|tache|taches|action|actions|code|landing|frontend|backend)\b/;
    const immediate = /\b(?:immediatement|de suite|tout de suite|sans redemander|pas besoin de confirmer|pas besoins de confirmer)\b/;
    if (!((actionVerb.test(text) && supportedTarget.test(text)) || (immediate.test(text) && supportedTarget.test(text)))) return original;
    return [
      original,
      '',
      '[AUTORISATION COCKPIT — ACTION NON SENSIBLE]',
      "Je confirme explicitement l'exécution immédiate de cette action non sensible.",
      'Exécute-la maintenant, en un seul lot si plusieurs éléments sont demandés.',
      'Ne redemande pas de confirmation et ne recrée pas des tâches en doublon.',
      "Si la demande concerne la Fabrique vidéo écran géant / ComfyUI local, conserve ce mode d'exécution local et lance le flux réel plutôt qu'une simple proposition.",
      '[/AUTORISATION COCKPIT]',
    ].join('\n');
  };
}
let taskAutopilotState = null;

// Trust proxy — nécessaire pour détecter HTTPS (X-Forwarded-Proto) et l'IP réelle
app.set('trust proxy', 1);

app.use(express.json({ limit: '25mb' }));
app.use(requireSameOrigin);

// ── Elynea : guide commercial public, sans accès au Cockpit ─
try {
  const publicElyneaRouter = require('./server-public-elynea.cjs');
  app.use('/api/public/elynea', publicElyneaRouter);
  console.log('✅ Elynea publique connectée à NOVA (conseil commercial cloisonné)');
} catch (e) {
  console.warn('⚠️ Elynea publique indisponible:', e.message);
}

// ── API Auth (backend, service_role) ────────────────────────
try {
  const authRouter = require('./server-auth.cjs');
  app.use('/api/auth', authRouter);
  console.log('✅ Route /api/auth activée (login, session, logout)');
} catch (e) {
  console.warn('⚠️ Route auth indisponible:', e.message);
}

// ── Utilisateurs, invitations et rôles ─────────────────────
try {
  const userAccessRouter = require('./server-user-access.cjs');
  app.use('/api/user-access', requireSession('superadmin'), userAccessRouter);
  console.log('✅ Gestion des rôles Cockpit activée');
} catch (e) {
  console.warn('⚠️ Gestion des rôles indisponible:', e.message);
}

// ── API Emails IMAP ──────────────────────────────────────────
try {
  const emailRouter = require('./server-email.cjs');
  const emailSessionGuard = requireSession('admin');
  const emailPermissionGuard = requirePermission('emails', 'admin');
  app.use('/api/emails', (req, res, next) => {
    if (req.path === '/official') return next();
    return emailSessionGuard(req, res, () => emailPermissionGuard(req, res, next));
  }, emailRouter);
  console.log('✅ Route /api/emails activée (IMAP IONOS — multi-mailbox)');
  console.log('   Mailboxes: jsinnovia, assurances');
} catch (e) {
  console.warn('⚠️ Route emails indisponible:', e.message);
}

// ── NOVA : tri comptable e-mail + rapport quotidien ────────
try {
  const emailAccounting = require('./server-email-accounting.cjs');
  app.use('/api/email-accounting', requireSession('admin'), requirePermission('email_accounting', 'admin'), emailAccounting.router);
  const worker = emailAccounting.startEmailAccountingScheduler();
  console.log(`✅ NOVA Assistant comptable e-mail activé (${worker.started ? `rapport ${worker.reportHour}h ${worker.timezone}` : worker.reason})`);
} catch (e) {
  console.warn('⚠️ NOVA Assistant comptable e-mail indisponible:', e.message);
}

// ── Google / Gmail : multi-boîtes + tri publicitaire réversible ─
try {
  const googleMail = require('./server-google-mail.cjs');
  app.use('/api/google-mail', requireSession('admin'), requirePermission('emails', 'admin'), googleMail.router);
  const worker = googleMail.startGoogleMailScheduler();
  console.log(`✅ Boîtes Google activées (${worker.started ? `tri toutes les ${worker.interval_minutes} min` : worker.reason})`);
} catch (e) {
  console.warn('⚠️ Boîtes Google indisponibles:', e.message);
}

// ── Coffre documentaire Dropbox + index Supabase ───────────
try {
  const documentsRouter = require('./server-documents.cjs');
  app.use('/api/documents', requireSession('collaborateur'), requirePermission('documents', 'collaborateur'), documentsRouter);
  console.log('✅ Route /api/documents activée (Dropbox + index Supabase)');
} catch (e) {
  console.warn('⚠️ Route documents indisponible:', e.message);
}

// ── Composition email avec pièces jointes / Dropbox ─────────
try {
  const emailComposeRouter = require('./server-email-compose.cjs');
  app.use('/api/email-compose', requireSession('admin'), requirePermission('emails', 'admin'), emailComposeRouter);
  console.log('✅ Route /api/email-compose activée (pièces jointes + Dropbox)');
} catch (e) {
  console.warn('⚠️ Route email-compose indisponible:', e.message);
}

// ── API Billing (PDF + envoi devis/factures) ─────────────────
try {
  const billingRouter = require('./server-billing.cjs');
  app.use('/api/billing', requireSession('admin'), requirePermission('invoices', 'admin'), billingRouter);
  console.log('✅ Route /api/billing activée (PDF + email devis/factures)');
} catch (e) {
  console.warn('⚠️ Route billing indisponible:', e.message);
}

// ── Assurances-Dour : suivi partagé Julien / Olivier ─────────
try {
  const insuranceRouter = require('./server-insurance.cjs');
  app.use('/api/insurance', requireSession('client'), requirePermission('insurance', 'admin'), insuranceRouter);
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

// ── Tableaux de données par client et projet ────────────────
try {
  const projectData = require('./server-project-data.cjs');
  app.use('/api/project-data', requireSession('client'), requirePermission('project_data', 'client'), projectData.router);
  const worker = projectData.startProjectDataBackupScheduler();
  console.log(`✅ Données projets activées (${worker.started ? 'sauvegarde Dropbox planifiée' : worker.reason})`);
} catch (e) {
  console.warn('⚠️ Données projets indisponibles:', e.message);
}

// ── Vérification légale clients via la BCE officielle ──────
try {
  const bceRouter = require('./server-bce.cjs');
  app.use('/api/bce', requireSession('admin'), requirePermission('clients', 'admin'), bceRouter.router);
  console.log('✅ Route /api/bce activée (recherche officielle + validation humaine)');
} catch (e) {
  console.warn('⚠️ Route BCE indisponible:', e.message);
}

// ── Centre HainoFlow by JS-Innov.IA ────────────────────────
try {
  const hainoFlowRouter = require('./server-hainoflow.cjs');
  app.use('/api/hainoflow', requireSession('client'), requirePermission('hainoflow', 'client'), hainoFlowRouter);
  console.log('✅ Route /api/hainoflow activée (résumé et état des modules)');
} catch (e) {
  console.warn('⚠️ Route HainoFlow indisponible:', e.message);
}

// ── AI Cost Control ─────────────────────────────────────────
try {
  const { router: aiCostRouter } = require('./server-ai-cost.cjs');
  app.use('/api/ai-cost', requireSession('admin'), requirePermission('ai_cost_control', 'admin'), aiCostRouter);
  require('./server-ai-cost-attribution.cjs').installAICostAttribution();
  console.log('✅ Route /api/ai-cost activée (usage, budgets, routage, attribution client)');
} catch (e) {
  console.warn('⚠️ Route AI Cost Control indisponible:', e.message);
}

// ── Ledger coûts client / refacturation ─────────────────────
// Independent of ledger availability; this router enforces admin + module permission itself.
app.use('/api/client-costs/accounting/openai', require('./server-openai-cost-diagnostic.cjs').createDiagnosticRouter());

try {
  const adminGuard = requireSession('admin');
  const { router: aiCostLedgerAggregateRouter } = require('./server-ai-cost-ledger-aggregate.cjs');
  app.use('/api/client-costs', adminGuard, requirePermission('ai_cost_control', 'admin'), aiCostLedgerAggregateRouter);

  const { router: clientCostsRouter } = require('./server-client-costs.cjs');
  app.use('/api/client-costs', adminGuard, requirePermission('ai_cost_control', 'admin'), clientCostsRouter);
  console.log('✅ Route /api/client-costs activée (client_id canonique, agrégation IA précise, coûts réels, marge, refacturation)');
} catch (e) {
  console.warn('⚠️ Route client-costs indisponible:', e.message);
}

// ── Diagnostic live des domaines + audit SEO ───────────────
try {
  const domainOpsRouter = require('./server-domain-ops.cjs');
  app.use('/api/domain-ops', requireSession('admin'), requirePermission('domains', 'admin'), domainOpsRouter);
  console.log('✅ Route /api/domain-ops activée (diagnostics + connecteur DNS IONOS confirmé)');
} catch (e) {
  console.warn('⚠️ Route domain-ops indisponible:', e.message);
}

// ── État réel de la configuration, sans exposer les secrets ─
try {
  const settingsRouter = require('./server-settings.cjs');
  app.use('/api/settings', requireSession('admin'), requirePermission('settings', 'admin'), settingsRouter);
  console.log('✅ Route /api/settings activée (configuration réelle sans valeurs secrètes)');
} catch (e) {
  console.warn('⚠️ Route settings indisponible:', e.message);
}

// ── Pilotage Signelya ─────────────────────────────────────
try {
  const signageRouter = require('./server-signage.cjs');
  app.use('/api/signage', requireSession('client'), requirePermission('signage', 'client'), signageRouter.router);
  console.log('✅ Application produit Signelya activée');
} catch (e) {
  console.warn('⚠️ Route Écran géant indisponible:', e.message);
}

// ── Supervision VilleConnectOS : site + application + API ─
try {
  const villeConnectRouter = require('./server-villeconnect.cjs');
  app.use('/api/villeconnect', requireSession('admin'), requirePermission('villeconnect', 'admin'), villeConnectRouter.router);
  console.log('✅ Route /api/villeconnect activée (site, application et API Railway)');
} catch (e) {
  console.warn('⚠️ Route VilleConnectOS indisponible:', e.message);
}

// ── Finalisation vidéo : MP4 + métadonnées + JSON + Dropbox ─
try {
  const videoProvenanceRouter = require('./server-video-provenance.cjs');
  app.use('/api/video-provenance', requireSession('admin'), requirePermission('production', 'admin'), videoProvenanceRouter);
  console.log('✅ Finaliseur vidéo activé (FFmpeg/FFprobe + SHA-256 + Dropbox)');
} catch (e) {
  console.warn('⚠️ Finaliseur vidéo indisponible:', e.message);
}

// ── Génération vidéo API : Grok / Sora + coûts + archivage ─
try {
  const videoGeneration = require('./server-video-generation.cjs');
  app.use('/api/video-generation', requireSession('admin'), requirePermission('production', 'admin'), videoGeneration.router);
  const worker = videoGeneration.startVideoGenerationScheduler();
  console.log(`✅ Fabrique vidéo API activée (Grok/Sora, coûts client, worker ${worker.started ? 'actif' : worker.reason})`);
} catch (e) {
  console.warn('⚠️ Fabrique vidéo API indisponible:', e.message);
}

// ── Companion batch : création multi-tâches + délégation ───
try {
  const taskAutopilot = require('./server-task-autopilot.cjs');
  taskAutopilotState = taskAutopilot.state;
  app.use('/api/task-autopilot', requireSession('admin'), requirePermission('tasks', 'admin'), taskAutopilot.router);
  const autopilot = taskAutopilot.startTaskAutopilotScheduler();
  console.log(`✅ Autopilote tâches ${autopilot.started ? 'activé' : 'inactif'} (${autopilot.reason || `${autopilot.interval_ms} ms`})`);
} catch (e) {
  console.warn('⚠️ Autopilote tâches indisponible:', e.message);
}

function immediateExecutionMiddleware(req, _res, next) {
  if (req.method === 'POST' && req.path === '/chat' && typeof req.body?.message === 'string') {
    req.body.message = authorizeImmediateExecutionMessage(req.body.message);
  }
  next();
}

// Toute nouvelle demande invalide les confirmations du tour précédent, même si
// elle est interceptée par un exécuteur direct avant le modèle.
app.use('/api/assistant', requireSession('client'), requirePermission('nova', 'client'), require('./server-assistant-intent.cjs').router);
console.log('✅ NOVA : confirmations liées à la demande courante et préclassement email disponibles');

// Les suppressions unitaires explicites sont résolues avant tout modèle/batch.
try {
  const documentDelete = require('./server-nova-document-delete.cjs');
  app.use('/api/assistant', requireSession('client'), requirePermission('nova', 'client'), documentDelete.router);
  console.log('✅ Suppression Dropbox unitaire NOVA activée (identité + révision + vérification)');
} catch (e) {
  console.warn('⚠️ Suppression Dropbox NOVA indisponible:', e.message);
}

// ── NOVA vidéo directe : ordre explicite → vrai video_job_id ─
try {
  const novaVideoDirectRouter = require('./server-nova-video-direct.cjs');
  app.use('/api/assistant', requireSession('admin'), requirePermission('nova', 'admin'), novaVideoDirectRouter);
  console.log('✅ NOVA vidéo directe activée (ordre explicite → Fabrique vidéo réelle, sans seconde confirmation)');
} catch (e) {
  console.warn('⚠️ NOVA vidéo directe indisponible:', e.message);
}

// ── Companion batch : création multi-tâches + délégation ───
try {
  const assistantBatchRouter = require('./server-assistant-batch.cjs');
  app.use('/api/assistant', requireSession('client'), requirePermission('nova', 'client'), immediateExecutionMiddleware, assistantBatchRouter);
  console.log('✅ Companion batch activé (exécution directe non sensible + confirmation unique sensible)');
} catch (e) {
  console.warn('⚠️ Companion batch indisponible:', e.message);
}

// ── Companion adaptatif : owner / équipe / client ──────────
try {
  const assistantRouter = require('./server-assistant.cjs');
  require('./server-nova-document-upload.cjs').installNovaDocumentRoutes(assistantRouter);
  app.use('/api/assistant', requireSession('client'), requirePermission('nova', 'client'), assistantRouter);
  console.log('✅ Companion adaptatif activé (owner/staff/client cloisonnés + factures PDF)');
} catch (e) {
  console.warn('⚠️ Route assistant indisponible:', e.message);
}

// ── Email Core Framework (queue + send + API) ──────────────
try {
  const emailCoreRouter = require('./server-email-core.cjs');
  app.use('/api/emails', requireSession('admin'), requirePermission('emails', 'admin'), emailCoreRouter);
  console.log('✅ Route /api/emails (core framework) activée');
} catch (e) {
  console.warn('⚠️ Route email-core indisponible:', e.message);
}

// ── Data Governance & RGPD ─────────────────────────────────
try {
  const governanceRouter = require('./server-governance.cjs');
  app.use('/api/governance', governanceRouter.publicRouter);
  app.use('/api/governance', requireSession('admin'), requirePermission('governance', 'admin'), governanceRouter);
  console.log('✅ Route /api/governance activée (audit, RGPD, consentements, politiques)');
} catch (e) {
  console.warn('⚠️ Route governance indisponible:', e.message);
}

// ── Spécialistes internes NOVA (URL historique conservée pour compatibilité UI) ─────
try {
  const base44AgentsRouter = require('./server-base44-agents.cjs');
  app.use('/api/base44-agents', requireSession('collaborateur'), requirePermission('ai_agents', 'collaborateur'), base44AgentsRouter.router);
  console.log('✅ Spécialistes internes NOVA activés (Base44 retiré du chemin actif)');
} catch (e) {
  console.warn('⚠️ Registre des spécialistes NOVA indisponible:', e.message);
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
    queued: taskAutopilotState.last_result?.queued?.length ?? null,
    awaiting_authorization: taskAutopilotState.last_result?.awaiting_authorization?.length ?? null,
    blocked: taskAutopilotState.last_result?.blocked?.length ?? null,
    duplicate_groups: taskAutopilotState.last_result?.duplicates?.length ?? null,
  } : { available: false },
}));

app.listen(PORT, () => {
  console.log(`✅ JS-Innov.IA Cockpit API — port ${PORT}`);
  console.log(`   Proxy /api/data → ${(process.env.JSINNOVIA_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app')}/data`);
});
