// ════════════════════════════════════════════════════════════════════════════
// server-dispatch.cjs — Task Dispatch to Agent (v2 — async + idempotence par intention)
// ════════════════════════════════════════════════════════════════════════════
//
// Corrections v2 :
//   1. Sécurité clé : BASE44_API_KEY uniquement, pas de fallback VITE_
//   2. Idempotence : clé par intention (client-side UUID), pas de fenêtre temporelle
//   3. Dispatch asynchrone : HTTP 202 + runId immédiat, traitement découplé
//   4. Mapping agents : rôle fonctionnel affiché, provider réel en données techniques
//
// Endpoints :
//   GET    /agents                        — liste des rôles fonctionnels
//   POST   /tasks/:taskId/dispatch        — créer un run (202 + runId)
//   GET    /tasks/:taskId/runs            — lister les runs d'une tâche
//   GET    /runs/:runId                   — statut détaillé d'un run
//   POST   /runs/:runId/cancel            — annuler un run
//   POST   /runs/:runId/approve           — valider (approval_required)
//   POST   /runs/:runId/reject            — rejeter (approval_required)
//   POST   /tasks/:taskId/dispatch-retry — relance volontaire (nouveau run)
//
// Sécurité :
//   - Session vérifiée via cookie HttpOnly
//   - Rôles admin/superadmin requis pour dispatch
//   - BASE44_API_KEY jamais exposé au frontend (pas de fallback frontend prefix)
//   - Idempotence : clientKey (UUID) fourni par le frontend, contrainte UNIQUE
//   - Aucun secret dans les logs
// ════════════════════════════════════════════════════════════════════════════

var express = require('express');
var crypto = require('crypto');

var router = express.Router();

// ─── Config (runtime only, jamais exposé au frontend) ────────────────────────
// ── Dual Supabase : auth (rzvvwcwyaddzsaattwqt) + data (gfjpryakxzdzwnazlsfz) ──
// Auth : cockpit_sessions, cockpit_users → SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// Data : Tache, agent_runs, agent_approvals → SUPABASE_DATA_URL / SUPABASE_DATA_KEY
// En production/staging : SUPABASE_DATA_URL et SUPABASE_DATA_KEY sont OBLIGATOIRES.
// En développement local : fallback sur SUPABASE_URL si non définis (mono-projet).
var SUPABASE_URL = process.env.SUPABASE_URL || '';
var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
var NODE_ENV = process.env.NODE_ENV || 'development';
var IS_PROD = (NODE_ENV === 'production' || NODE_ENV === 'staging');

// En production : pas de fallback — les variables DATA sont obligatoires
// En dev : fallback sur SUPABASE_URL pour permettre le mono-projet
var SUPABASE_DATA_URL = IS_PROD ? process.env.SUPABASE_DATA_URL : (process.env.SUPABASE_DATA_URL || SUPABASE_URL);
var SUPABASE_DATA_KEY = IS_PROD ? process.env.SUPABASE_DATA_KEY : (process.env.SUPABASE_DATA_KEY || SUPABASE_KEY);
var BASE44_API_URL = 'https://app.base44.com/api/agents';

// ⚠️ BASE44_API_KEY uniquement. Pas de fallback VITE_* (convention frontend, pas serveur).
// VITE_ est une convention Vite pour le frontend — jamais une variable serveur.
// Un test automatisé garantit que process.env.VITE_BASE44_API_KEY n'est jamais lu.
var BASE44_API_KEY = process.env.BASE44_API_KEY || '';

// ─── Validation de configuration au démarrage ───────────────────────────────
var CONFIG_ERRORS = [];

if (!BASE44_API_KEY) {
  CONFIG_ERRORS.push('BASE44_API_KEY non configurée (runtime, sans préfixe VITE_).');
}
// Garde-fou : ne JAMAIS lire VITE_BASE44_API_KEY côté serveur
if (process.env.VITE_BASE44_API_KEY) {
  CONFIG_ERRORS.push('VITE_BASE44_API_KEY détectée côté serveur — utiliser BASE44_API_KEY à la place.');
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  CONFIG_ERRORS.push('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY non configuré (auth).');
}

if (IS_PROD) {
  // En production/staging : SUPABASE_DATA_URL et SUPABASE_DATA_KEY sont obligatoires
  if (!process.env.SUPABASE_DATA_URL) {
    CONFIG_ERRORS.push('SUPABASE_DATA_URL non configuré (obligatoire en production/staging, pas de fallback autorisé).');
  }
  if (!process.env.SUPABASE_DATA_KEY) {
    CONFIG_ERRORS.push('SUPABASE_DATA_KEY non configuré (obligatoire en production/staging, pas de fallback autorisé).');
  }
} else {
  if (!SUPABASE_DATA_URL || !SUPABASE_DATA_KEY) {
    console.warn('⚠️ [dispatch] SUPABASE_DATA_URL ou SUPABASE_DATA_KEY non configuré (dev) — fallback sur SUPABASE_URL.');
  }
}

if (CONFIG_ERRORS.length > 0) {
  for (var i = 0; i < CONFIG_ERRORS.length; i++) {
    console.error('❌ [dispatch] CONFIG ERROR: ' + CONFIG_ERRORS[i]);
  }
  // En production : bloquer le démarrage
  if (IS_PROD) {
    throw new Error('Configuration invalide pour la production. ' + CONFIG_ERRORS.join(' '));
  }
  // En dev : avertir seulement
  console.warn('⚠️ [dispatch] Configuration incomplète (dev) — certaines routes peuvent échouer.');
}

// ─── Mapping agents — rôle fonctionnel → provider Base44 ─────────────────────
// Chaque rôle fonctionnel a un provider Base44 sous-jacent.
// Le frontend affiche le rôle fonctionnel ; le provider réel est stocké en base.
// Migration future : déplacer ce mapping en base ou fichier de config.
var AGENT_MAP = {
  'communication-agent':  { base44_id: '69ff4dc771a2cdab275f8a00', provider_name: 'NOVA JS-Innov.IA',  functional_role: 'Communication',      description: 'Emails, messagerie, newsletters' },
  'social-media-agent':  { base44_id: '69ff4dc771a2cdab275f8a00', provider_name: 'NOVA JS-Innov.IA',  functional_role: 'Réseaux sociaux',   description: 'Publications, contenus sociaux' },
  'developer-agent':     { base44_id: '6a1845e17cc526d1e44965bc', provider_name: 'JsInnov-Agent',     functional_role: 'Développement',     description: 'Code, bugs, CI/CD, déploiement' },
  'billing-agent':       { base44_id: '69ff4dc771a2cdab275f8a00', provider_name: 'NOVA JS-Innov.IA',  functional_role: 'Facturation',       description: 'Devis, factures, relances' },
  'sales-agent':         { base44_id: '69ff4dc771a2cdab275f8a00', provider_name: 'NOVA JS-Innov.IA',  functional_role: 'Commercial',        description: 'Leads, prospects, ventes' },
  'seo-audit-agent':     { base44_id: '6a1845e17cc526d1e44965bc', provider_name: 'JsInnov-Agent',     functional_role: 'SEO & Audit',      description: 'Référencement, audit technique' },
  'creative-agent':      { base44_id: '69ff4dc771a2cdab275f8a00', provider_name: 'NOVA JS-Innov.IA',  functional_role: 'Créatif',          description: 'Design, branding, visuel' },
  'general-agent':       { base44_id: '69ff4dc771a2cdab275f8a00', provider_name: 'NOVA JS-Innov.IA',  functional_role: 'Général',          description: 'Tâches polyvalentes' },
};

// La liste exposée au frontend affiche le RÔLE FONCTIONNEL, pas le provider
var AVAILABLE_AGENTS = Object.keys(AGENT_MAP).map(function (id) {
  var a = AGENT_MAP[id];
  return {
    id: id,
    functionalRole: a.functional_role,   // ce que l'utilisateur voit
    description: a.description,
    // ⚠️ Pas de provider_name ni base44_id exposés au frontend
  };
});

// ─── Actions sensibles (validation humaine obligatoire) ──────────────────────
var SENSITIVE_ACTIONS = [
  'send_email', 'publish_social', 'delete_data', 'modify_production',
  'merge_pr', 'send_invoice', 'contact_client', 'modify_contract', 'spend'
];

// ─── Helpers Supabase (service_role) ─────────────────────────────────────────
async function supabaseSelect(table, select, filter) {
  var url = SUPABASE_URL + '/rest/v1/' + table + '?select=' + (select || '*') + (filter || '');
  var res = await fetch(url, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
  });
  if (!res.ok) throw new Error('Supabase ' + table + ' select failed: ' + res.status);
  return res.json();
}

// Variante DATA : utilise SUPABASE_DATA_URL / SUPABASE_DATA_KEY pour les tables métier
async function supabaseDataSelect(table, select, filter) {
  var url = SUPABASE_DATA_URL + '/rest/v1/' + table + '?select=' + (select || '*') + (filter || '');
  var res = await fetch(url, {
    headers: { 'apikey': SUPABASE_DATA_KEY, 'Authorization': 'Bearer ' + SUPABASE_DATA_KEY },
  });
  if (!res.ok) throw new Error('Supabase DATA ' + table + ' select failed: ' + res.status);
  return res.json();
}

async function supabaseDataInsert(table, data) {
  var res = await fetch(SUPABASE_DATA_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_DATA_KEY, 'Authorization': 'Bearer ' + SUPABASE_DATA_KEY,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Supabase DATA ' + table + ' insert failed: ' + res.status);
  return res.json();
}

async function supabaseDataPatch(table, filter, data) {
  var res = await fetch(SUPABASE_DATA_URL + '/rest/v1/' + table + '?' + filter, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_DATA_KEY, 'Authorization': 'Bearer ' + SUPABASE_DATA_KEY,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Supabase DATA ' + table + ' patch failed: ' + res.status);
  return res.json();
}

async function supabaseInsert(table, data) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    var body = await res.text();
    throw new Error('Supabase ' + table + ' insert failed: ' + res.status + ' ' + body);
  }
  return res.json();
}

async function supabasePatch(table, filter, data) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + filter, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    var body = await res.text();
    throw new Error('Supabase ' + table + ' patch failed: ' + res.status + ' ' + body);
  }
  return res.json();
}

// ─── Session middleware ───────────────────────────────────────────────────────
async function getSessionUser(req) {
  var cookieHeader = req.headers.cookie || '';
  var match = cookieHeader.match(/session=([a-f0-9]+)/);
  if (!match) return null;
  var token = match[1];
  try {
    var rows = await supabaseSelect('cockpit_sessions', 'user_id,expires_at',
      '&token=eq.' + encodeURIComponent(token) + '&limit=1');
    if (!rows || rows.length === 0) return null;
    if (new Date(rows[0].expires_at) < new Date()) return null;
    var users = await supabaseSelect('cockpit_users', 'id,email,full_name,role,is_active,organisation',
      '&id=eq.' + encodeURIComponent(rows[0].user_id) + '&limit=1');
    if (!users || users.length === 0 || !users[0].is_active) return null;
    return users[0];
  } catch (e) {
    console.error('[dispatch] Session check error:', e.message);
    return null;
  }
}

function requireRole(user, minLevel) {
  var levels = { client: 1, collaborateur: 2, admin: 3, superadmin: 4 };
  return (levels[user.role] || 0) >= minLevel;
}

// ─── Proposition automatique d'agent ──────────────────────────────────────────
function suggestAgent(task) {
  var text = ((task.titre || '') + ' ' + (task.description || '') + ' ' + (task.notes || '')).toLowerCase();
  if (/email|newsletter|messenger|message/.test(text)) return 'communication-agent';
  if (/facebook|linkedin|tiktok|post|social|reseau/.test(text)) return 'social-media-agent';
  if (/code|bug|fix|deploi|deploy|ci\/cd|pr|github|docker/.test(text)) return 'developer-agent';
  if (/facture|devis|invoice|quote|billing|paiement/.test(text)) return 'billing-agent';
  if (/lead|prospect|commercial|vente|sale/.test(text)) return 'sales-agent';
  if (/seo|referencement|google|audit.*site/.test(text)) return 'seo-audit-agent';
  if (/design|branding|logo|creatif|visuel|contenu/.test(text)) return 'creative-agent';
  return 'general-agent';
}

// ════════════════════════════════════════════════════════════════════════════
// IDEMPORENCE — clé par intention (client-side UUID)
// ════════════════════════════════════════════════════════════════════════════
//
// Mécanisme :
//   1. Le frontend génère un UUID v4 à chaque ouverture de la modale de dispatch.
//   2. Cet UUID est envoyé comme `clientKey` dans le payload POST /dispatch.
//   3. Le backend stocke ce `clientKey` dans `agent_runs.idempotency_key`.
//   4. Une contrainte UNIQUE en base garantit qu'un même clientKey = un seul run.
//
// Comportements :
//   - Retry technique (réseau coupé) : le frontend renvoie le MÊME clientKey → même run retourné.
//   - Double clic : même clientKey → même run, pas de doublon.
//   - Refresh page : nouveau clientKey généré → nouveau run possible (volontaire).
//   - Relance volontaire : POST /tasks/:taskId/dispatch-retry → nouveau run explicite.
//   - Timeout Base44 : le run reste en statut 'pending' ou 'dispatching', polling frontend.
//
// Durée de validité du clientKey : illimitée tant que le run existe en base.
// Le clientKey n'expire pas — il est lié au run de façon permanente.

// ─── Connecteur Base44 (REAL) — exécuté de façon asynchrone ──────────────────
async function dispatchToBase44(agent, task, instructions, executionMode, runId) {
  // Vérification stricte : BASE44_API_KEY obligatoire, pas de fallback
  if (!BASE44_API_KEY) {
    throw new Error('BASE44_API_KEY non configurée côté serveur (pas de fallback VITE_ autorisé)');
  }

  var base44AgentId = agent.base44_id;

  // 1. Créer une conversation
  var convRes = await fetch(BASE44_API_URL + '/' + base44AgentId + '/conversations', {
    method: 'POST',
    headers: { 'api_key': BASE44_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!convRes.ok) {
    var errBody = await convRes.text();
    throw new Error('Base44 conv creation failed: ' + convRes.status + ' ' + errBody.substring(0, 200));
  }

  var convData = await convRes.json();
  var convId = convData.id;

  if (!convId) {
    throw new Error('Base44: conversation ID missing in response');
  }

  // 2. Construire le message
  var messageContent = '[TASK DISPATCH from Cockpit]\n' +
    'Task: ' + (task.titre || 'Untitled') + '\n' +
    'Description: ' + (task.description || '') + '\n' +
    'Client: ' + (task.client_nom || 'N/A') + '\n' +
    'Project: ' + (task.projet_nom || 'N/A') + '\n' +
    'Priority: ' + (task.priorite || 'normale') + '\n' +
    'Due: ' + (task.date_echeance || 'N/A') + '\n' +
    'Execution mode: ' + executionMode + '\n' +
    'Instructions: ' + (instructions || 'N/A') + '\n' +
    'Sensitive actions require human approval: ' + SENSITIVE_ACTIONS.join(', ');

  // 3. Envoyer le message (timeout 120s)
  var msgRes = await fetch(BASE44_API_URL + '/' + base44AgentId + '/conversations/' + convId + '/messages', {
    method: 'POST',
    headers: { 'api_key': BASE44_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', content: messageContent }),
    signal: AbortSignal.timeout(120000),
  });

  if (!msgRes.ok) {
    var errBody2 = await msgRes.text();
    throw new Error('Base44 message send failed: ' + msgRes.status + ' ' + errBody2.substring(0, 200));
  }

  var msgData = await msgRes.json();

  return {
    convId: convId,
    msgId: msgData.id || null,
    response: msgData.content || msgData.message || '',
  };
}

// ─── Traitement asynchrone du dispatch (découplé de la requête HTTP) ─────────
// Cette fonction est appelée SANS await — elle s'exécute en arrière-plan.
// Le statut du run est mis à jour en base au fur et à mesure.
async function processDispatchAsync(runId, agent, task, instructions, executionMode) {
  try {
    // Statut → dispatching
    await supabaseDataPatch('agent_runs', 'id=eq.' + encodeURIComponent(runId), {
      status: 'dispatching',
      started_at: new Date().toISOString(),
      base44_agent_id: agent.base44_id,
    });

    // Appel Base44 (peut prendre 30-120s)
    var result = await dispatchToBase44(agent, task, instructions, executionMode, runId);

    // Succès → statut dispatched + résultat initial
    await supabaseDataPatch('agent_runs', 'id=eq.' + encodeURIComponent(runId), {
      status: 'dispatched',
      base44_conv_id: result.convId,
      base44_msg_id: result.msgId,
      result: { initial_response: result.response.substring(0, 4000) },
    });

    // Mettre à jour le statut de la tâche
    await supabaseDataPatch('Tache', 'id=eq.' + encodeURIComponent(task.id), {
      statut: 'en_cours',
      notes: (task.notes || '') + '\n[Dispatch] Agent ' + agent.functional_role + ' run ' + runId + ' conv ' + result.convId,
    });

    // Si mode approval_required, passer en awaiting_approval et créer une demande
    if (executionMode === 'approval_required') {
      await supabaseDataPatch('agent_runs', 'id=eq.' + encodeURIComponent(runId), {
        status: 'awaiting_approval',
      });
      // Vérifier si une approval pending existe déjà (évite 409 sur contrainte UNIQUE)
      var existingApprovals = await supabaseDataSelect('agent_approvals', 'id',
        '&agent_run_id=eq.' + encodeURIComponent(runId) + '&status=eq.pending&limit=1');
      if (!existingApprovals || existingApprovals.length === 0) {
        await supabaseDataInsert('agent_approvals', {
          agent_run_id: runId,
          status: 'pending',
        });
      }
      console.log('[dispatch] Run ' + runId + ' → awaiting_approval (approval_required)');
    }

    console.log('[dispatch] Run ' + runId + ' dispatched successfully (conv: ' + result.convId + ')');

  } catch (err) {
    // Échec → statut failed + erreur lisible
    console.error('[dispatch] Run ' + runId + ' failed:', err.message);
    try {
      await supabaseDataPatch('agent_runs', 'id=eq.' + encodeURIComponent(runId), {
        status: 'failed',
        error: err.message.substring(0, 1000),
        completed_at: new Date().toISOString(),
      });
    } catch (patchErr) {
      console.error('[dispatch] Run ' + runId + ' — failed to update status:', patchErr.message);
    }
  }
}

// ─── Helper multi-tenant NULL-safe ───────────────────────────────────────────
// Deux organisations NULL ne sont PAS considérées comme identiques.
// L'isolation par email reste le garde-fou pour les users sans organisation.
function canAccessRun(user, run) {
  // Superadmin voit tout
  if (user.role === 'superadmin') return true;
  // Meme email -> autorise (c'est son run)
  if (run.requested_by === user.email) return true;
  // Meme organisation non-NULL -> autorise (meme org)
  if (user.organisation && run.organisation && user.organisation === run.organisation) return true;
  // Sinon -> refuse (isolation par email pour les NULL)
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════════════════

// GET /agents — liste des rôles fonctionnels (pas de provider exposé)
router.get('/agents', function (req, res) {
  res.json({ agents: AVAILABLE_AGENTS });
});

// POST /tasks/:taskId/dispatch — créer un run (202 + runId immédiat)
router.post('/tasks/:taskId/dispatch', async function (req, res) {
  try {
    // 1. Vérifier la session
    var user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Session invalide ou expirée.' });
    if (!requireRole(user, 3)) return res.status(403).json({ error: 'Droits insuffisants. Admin requis.' });

    // 2. Vérifier BASE44_API_KEY (503 si absent)
    if (!BASE44_API_KEY) {
      return res.status(503).json({
        error: 'Service non configuré',
        detail: 'BASE44_API_KEY manquante côté serveur. Ajoutez cette variable dans Railway (runtime, sans préfixe frontend prefix).',
      });
    }

    var taskId = req.params.taskId;
    var body = req.body || {};
    var agentId = body.agentId;
    var executionMode = body.executionMode;
    var instructions = body.instructions;
    var attachments = body.attachments || [];
    var clientKey = body.clientKey; // UUID fourni par le frontend (idempotence par intention)

    // 3. Valider le payload
    if (!agentId) return res.status(400).json({ error: 'agentId requis.' });
    var validModes = ['prepare_only', 'approval_required', 'autonomous'];
    if (!executionMode || validModes.indexOf(executionMode) === -1) {
      return res.status(400).json({ error: 'executionMode invalide.' });
    }
    if (!clientKey) return res.status(400).json({ error: 'clientKey requis (UUID pour idempotence).' });
    var agent = AGENT_MAP[agentId];
    if (!agent) return res.status(400).json({ error: 'agentId inconnu.' });

    // 4. Récupérer la tâche
    var tasks = await supabaseDataSelect('Tache', '*', '&id=eq.' + encodeURIComponent(taskId) + '&limit=1');
    if (!tasks || tasks.length === 0) return res.status(404).json({ error: 'Tache introuvable.' });
    var task = tasks[0];

    // 5. Refuser les tâches incompatibles
    if (task.statut === 'termine' || task.statut === 'annule') {
      return res.status(409).json({ error: 'Tache non dispatchable (statut: ' + task.statut + ').' });
    }

    // 6. Idempotence — vérifier si un run existe déjà avec ce clientKey
    var existing = await supabaseDataSelect('agent_runs', 'id,status,base44_conv_id,execution_mode,created_at',
      '&idempotency_key=eq.' + encodeURIComponent(clientKey) + '&limit=1');
    if (existing && existing.length > 0) {
      // Retry technique ou double clic → retourner le run existant (200, pas 202)
      return res.status(200).json({
        success: true,
        runId: existing[0].id,
        status: existing[0].status,
        idempotent: true,
        message: 'Run déjà existant pour cette intention.',
      });
    }

    // 7. Préparer l'input
    var input = {
      task: {
        id: task.id, titre: task.titre, description: task.description,
        client_nom: task.client_nom, projet_nom: task.projet_nom,
        priorite: task.priorite, date_echeance: task.date_echeance, notes: task.notes,
      },
      instructions: instructions || '',
      attachments: attachments,
      sensitive_actions: SENSITIVE_ACTIONS,
      execution_constraints: {
        prepare_only: executionMode === 'prepare_only',
        approval_required: executionMode === 'approval_required',
        autonomous: executionMode === 'autonomous',
      },
    };

    // 8. Créer l'agent_run en statut pending
    var run;
    try {
      run = await supabaseDataInsert('agent_runs', {
        task_id: taskId,
        agent_id: agentId,
        status: 'pending',
        execution_mode: executionMode,
        input: input,
        idempotency_key: clientKey,
        requested_by: user.email,
        organisation: user.organisation || null,
        provider_agent_id: agent.base44_id,    // provider réel stocké en base
        provider_name: agent.provider_name,    // nom du provider pour audit
        functional_role: agent.functional_role, // rôle fonctionnel affiché
      });
    } catch (insertErr) {
      // Contrainte UNIQUE → race condition, récupérer le run existant
      var errMsg = String(insertErr.message || '');
      if (errMsg.indexOf('23505') !== -1 || errMsg.indexOf('duplicate') !== -1) {
        var existing2 = await supabaseDataSelect('agent_runs', 'id,status',
          '&idempotency_key=eq.' + encodeURIComponent(clientKey) + '&limit=1');
        if (existing2 && existing2.length > 0) {
          return res.status(200).json({
            success: true, runId: existing2[0].id, status: existing2[0].status,
            idempotent: true, message: 'Run déjà existant (race condition résolue).',
          });
        }
      }
      throw insertErr;
    }

    if (!run || run.length === 0) return res.status(500).json({ error: 'Echec creation agent_run.' });
    var runId = run[0].id;

    // 9. DISPATCH ASYNCHRONE — fire and forget (sans await)
    //     processDispatchAsync gère la transition awaiting_approval + création agent_approvals
    //     Le frontend reçoit 202 immédiatement avec le runId.
    //     Le traitement Base44 s'exécute en arrière-plan.
    processDispatchAsync(runId, agent, task, instructions, executionMode);

    // 11. Réponse 202 Accepted — le run est créé, le traitement est en cours
    res.status(202).json({
      success: true,
      runId: runId,
      status: 'pending',
      agentId: agentId,
      functionalRole: agent.functional_role,
      executionMode: executionMode,
      message: 'Run créé. Traitement en cours. Utilisez GET /api/runs/' + runId + ' pour suivre le statut.',
      pollUrl: '/api/runs/' + runId,
      pollIntervalMs: 3000,
    });

  } catch (err) {
    console.error('[dispatch] Error:', err.message);
    res.status(500).json({ error: 'Erreur serveur lors du dispatch.' });
  }
});

// POST /tasks/:taskId/dispatch-retry — relance volontaire (nouveau run)
router.post('/tasks/:taskId/dispatch-retry', async function (req, res) {
  try {
    var user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Session invalide.' });
    if (!requireRole(user, 3)) return res.status(403).json({ error: 'Droits insuffisants.' });

    var taskId = req.params.taskId;
    var body = req.body || {};
    var newClientKey = body.clientKey; // nouveau UUID obligatoire

    if (!newClientKey) return res.status(400).json({ error: 'clientKey requis (nouveau UUID pour la relance).' });

    // Vérifier qu'un run précédent existe (on ne peut pas relancer sans historique)
    var prevRuns = await supabaseDataSelect('agent_runs', 'id,status,agent_id,execution_mode',
      '&task_id=eq.' + encodeURIComponent(taskId) + '&order=created_at.desc&limit=1');

    if (!prevRuns || prevRuns.length === 0) {
      return res.status(404).json({ error: 'Aucun run précédent à relancer.' });
    }

    var prevRun = prevRuns[0];
    var agentId = body.agentId || prevRun.agent_id;
    var executionMode = body.executionMode || prevRun.execution_mode;
    var instructions = body.instructions || '';
    var agent = AGENT_MAP[agentId];
    if (!agent) return res.status(400).json({ error: 'agentId inconnu.' });

    // Récupérer la tâche
    var tasks = await supabaseDataSelect('Tache', '*', '&id=eq.' + encodeURIComponent(taskId) + '&limit=1');
    if (!tasks || tasks.length === 0) return res.status(404).json({ error: 'Tache introuvable.' });
    var task = tasks[0];

    if (task.statut === 'termine' || task.statut === 'annule') {
      return res.status(409).json({ error: 'Tache non dispatchable.' });
    }

    // Vérifier idempotence du nouveau clientKey
    var existing = await supabaseDataSelect('agent_runs', 'id',
      '&idempotency_key=eq.' + encodeURIComponent(newClientKey) + '&limit=1');
    if (existing && existing.length > 0) {
      return res.status(200).json({
        success: true, runId: existing[0].id, idempotent: true,
        message: 'Run déjà existant pour ce clientKey.',
      });
    }

    // Créer un NOUVEAU run (relance volontaire)
    var input = {
      task: {
        id: task.id, titre: task.titre, description: task.description,
        client_nom: task.client_nom, projet_nom: task.projet_nom,
        priorite: task.priorite, date_echeance: task.date_echeance, notes: task.notes,
      },
      instructions: instructions,
      sensitive_actions: SENSITIVE_ACTIONS,
      execution_constraints: {
        prepare_only: executionMode === 'prepare_only',
        approval_required: executionMode === 'approval_required',
        autonomous: executionMode === 'autonomous',
      },
      retry_of: prevRun.id, // référence au run précédent
    };

    var run = await supabaseDataInsert('agent_runs', {
      task_id: taskId,
      agent_id: agentId,
      status: 'pending',
      execution_mode: executionMode,
      input: input,
      idempotency_key: newClientKey,
      requested_by: user.email,
      organisation: user.organisation || null,
      provider_agent_id: agent.base44_id,
      provider_name: agent.provider_name,
      functional_role: agent.functional_role,
    });

    if (!run || run.length === 0) return res.status(500).json({ error: 'Echec creation run.' });
    var runId = run[0].id;

    // processDispatchAsync gère la transition awaiting_approval + création agent_approvals

    // Dispatch asynchrone
    processDispatchAsync(runId, agent, task, instructions, executionMode);

    res.status(202).json({
      success: true,
      runId: runId,
      status: 'pending',
      retryOf: prevRun.id,
      message: 'Relance créée. Suivi: GET /api/runs/' + runId,
      pollUrl: '/api/runs/' + runId,
      pollIntervalMs: 3000,
    });

  } catch (err) {
    console.error('[dispatch-retry] Error:', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de la relance.' });
  }
});

// GET /tasks/:taskId/runs — lister les exécutions d'une tâche
router.get('/tasks/:taskId/runs', async function (req, res) {
  try {
    var user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Session invalide.' });

    var filter = '&task_id=eq.' + encodeURIComponent(req.params.taskId) + '&order=created_at.desc';
    // Non-superadmin ne voit que les runs de son organisation
    if (user.role !== 'superadmin') {
      if (user.organisation) {
        filter += '&or=(requested_by.eq.' + encodeURIComponent(user.email) + ',organisation.eq.' + encodeURIComponent(user.organisation) + ')';
      } else {
        // Organisation NULL → isolation par email uniquement
        filter += '&requested_by=eq.' + encodeURIComponent(user.email);
      }
    }

    var runs = await supabaseDataSelect('agent_runs',
      'id,task_id,agent_id,functional_role,status,execution_mode,requested_by,created_at,started_at,completed_at,error,base44_conv_id',
      filter);
    res.json({ runs: runs || [] });
  } catch (err) {
    console.error('[dispatch] Error listing runs:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /runs/:runId — statut détaillé d'un run (pour polling)
router.get('/runs/:runId', async function (req, res) {
  try {
    var user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Session invalide.' });

    var runs = await supabaseDataSelect('agent_runs', '*',
      '&id=eq.' + encodeURIComponent(req.params.runId) + '&limit=1');
    if (!runs || runs.length === 0) return res.status(404).json({ error: 'Execution introuvable.' });

    var run = runs[0];

    // Vérifier l'appartenance (multi-tenant NULL-safe)
    if (!canAccessRun(user, run)) {
      return res.status(403).json({ error: 'Accès refusé : ce run appartient à une autre organisation.' });
    }

    var approvals = await supabaseDataSelect('agent_approvals', '*',
      '&agent_run_id=eq.' + encodeURIComponent(req.params.runId) + '&order=created_at.desc');

    res.json({
      run: run,
      approvals: approvals || [],
      // Métadonnées de polling
      pollIntervalMs: 3000,
      terminalStatuses: ['completed', 'failed', 'cancelled'],
    });
  } catch (err) {
    console.error('[dispatch] Error getting run:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /runs/:runId/cancel
router.post('/runs/:runId/cancel', async function (req, res) {
  try {
    var user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Session invalide.' });
    if (!requireRole(user, 3)) return res.status(403).json({ error: 'Droits insuffisants.' });
    var runs = await supabaseDataSelect('agent_runs', 'id,status,requested_by',
      '&id=eq.' + encodeURIComponent(req.params.runId) + '&limit=1');
    if (!runs || runs.length === 0) return res.status(404).json({ error: 'Execution introuvable.' });

    // Vérifier l'appartenance (multi-tenant NULL-safe)
    if (!canAccessRun(user, runs[0])) {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    var cancellable = ['pending', 'dispatching', 'dispatched', 'running', 'awaiting_approval'];
    if (cancellable.indexOf(runs[0].status) === -1) {
      return res.status(409).json({ error: 'Execution non annulable (statut: ' + runs[0].status + ').' });
    }
    await supabaseDataPatch('agent_runs', 'id=eq.' + encodeURIComponent(req.params.runId), {
      status: 'cancelled', completed_at: new Date().toISOString(),
    });
    res.json({ success: true, message: 'Execution annulee.' });
  } catch (err) {
    console.error('[dispatch] Error cancelling run:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /runs/:runId/approve
router.post('/runs/:runId/approve', async function (req, res) {
  try {
    var user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Session invalide.' });
    if (!requireRole(user, 3)) return res.status(403).json({ error: 'Droits insuffisants.' });
    var runs = await supabaseDataSelect('agent_runs', 'id,status,requested_by',
      '&id=eq.' + encodeURIComponent(req.params.runId) + '&limit=1');
    if (!runs || runs.length === 0) return res.status(404).json({ error: 'Execution introuvable.' });

    if (!canAccessRun(user, runs[0])) {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    if (runs[0].status !== 'awaiting_approval') {
      return res.status(409).json({ error: 'Execution non en attente d approbation.' });
    }
    await supabaseDataPatch('agent_approvals',
      'agent_run_id=eq.' + encodeURIComponent(req.params.runId) + '&status=eq.pending',
      { status: 'approved', approved_at: new Date().toISOString(), approved_by: user.email });
    await supabaseDataPatch('agent_runs', 'id=eq.' + encodeURIComponent(req.params.runId), { status: 'running' });
    res.json({ success: true, message: 'Execution approuvee.' });
  } catch (err) {
    console.error('[dispatch] Error approving run:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /runs/:runId/reject
router.post('/runs/:runId/reject', async function (req, res) {
  try {
    var user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Session invalide.' });
    if (!requireRole(user, 3)) return res.status(403).json({ error: 'Droits insuffisants.' });
    var reason = (req.body || {}).reason;
    var runs = await supabaseDataSelect('agent_runs', 'id,status,requested_by',
      '&id=eq.' + encodeURIComponent(req.params.runId) + '&limit=1');
    if (!runs || runs.length === 0) return res.status(404).json({ error: 'Execution introuvable.' });

    if (!canAccessRun(user, runs[0])) {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    if (runs[0].status !== 'awaiting_approval') {
      return res.status(409).json({ error: 'Execution non en attente d approbation.' });
    }
    await supabaseDataPatch('agent_approvals',
      'agent_run_id=eq.' + encodeURIComponent(req.params.runId) + '&status=eq.pending',
      { status: 'rejected', rejected_at: new Date().toISOString(), rejection_reason: reason || 'Non specifie' });
    await supabaseDataPatch('agent_runs', 'id=eq.' + encodeURIComponent(req.params.runId), {
      status: 'cancelled', completed_at: new Date().toISOString(), error: reason || 'Rejete par l utilisateur',
    });
    res.json({ success: true, message: 'Execution rejetee.' });
  } catch (err) {
    console.error('[dispatch] Error rejecting run:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});


// ════════════════════════════════════════════════════════════════════════════
// PROXY CHAT — AgentsIA.jsx utilise cet endpoint au lieu d'appeler Base44 directement
// La cle BASE44_API_KEY reste cote serveur, jamais exposee au frontend.
// Securite : session, role, whitelist agentId, validation taille, rate limit,
//            isolation conversation par user, gestion 429/502/timeout, logs sans cle.
// ════════════════════════════════════════════════════════════════════════════

// ─── Liste blanche des agents Base44 autorises pour le chat ──────────────────
// Seuls ces agentIds sont acceptes. Aucun agentId arbitraire n'est permis.
var CHAT_ALLOWED_AGENT_IDS = [
  '6a1845e17cc526d1e44965bc',
  '6a0208edd1e235b62b4bda38',
  '69fcda52258a254f4220b0bd',
  '6a0371a87c9257126b051d5a',
  '6a22f0c096ce009a943f4a05',
  '69ff4dc771a2cdab275f8a00',
  '6a035427dca907aa03b71398',
  '69e732e1d54abfd1783f5d06',
];

// ─── Constantes de securite ──────────────────────────────────────────────────
var CHAT_MAX_MESSAGE_LENGTH = 10000;
var CHAT_MAX_CONV_ID_LENGTH = 200;
var CHAT_TIMEOUT_CREATE_MS = 30000;
var CHAT_TIMEOUT_MESSAGE_MS = 120000;
var CHAT_RATE_LIMIT_WINDOW_MS = 60000;
var CHAT_RATE_LIMIT_MAX = 20;

// ─── Rate limiting en memoire (par user email) ───────────────────────────────
var chatRateLimit = {};

function chatCheckRateLimit(userEmail) {
  var now = Date.now();
  var window = chatRateLimit[userEmail] || { count: 0, resetAt: now + CHAT_RATE_LIMIT_WINDOW_MS };
  if (now > window.resetAt) {
    window = { count: 0, resetAt: now + CHAT_RATE_LIMIT_WINDOW_MS };
  }
  window.count++;
  chatRateLimit[userEmail] = window;
  return window.count <= CHAT_RATE_LIMIT_MAX;
}

// ─── Validation conversationId ───────────────────────────────────────────────
function isValidConvId(convId) {
  if (!convId || typeof convId !== 'string') return false;
  if (convId.length > CHAT_MAX_CONV_ID_LENGTH) return false;
  return /^[a-zA-Z0-9_-]+$/.test(convId);
}

// ─── Tracking conversation ownership (en memoire) ────────────────────────────
var chatConvOwnership = {};

// POST /agents-chat/conversations — creer une conversation
router.post('/agents-chat/conversations', async function (req, res) {
  try {
    var user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Session requise.' });
    if (!requireRole(user, 2)) return res.status(403).json({ error: 'Droits insuffisants.' });
    if (!BASE44_API_KEY) return res.status(503).json({ error: 'Service non configure.' });

    var agentId = (req.body || {}).agentId;
    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({ error: 'agentId requis.' });
    }
    if (CHAT_ALLOWED_AGENT_IDS.indexOf(agentId) === -1) {
      return res.status(400).json({ error: 'Agent non autorise.' });
    }

    if (!chatCheckRateLimit(user.email)) {
      return res.status(429).json({ error: 'Trop de requetes. Reessayez plus tard.' });
    }

    var convRes = await fetch(BASE44_API_URL + '/' + agentId + '/conversations', {
      method: 'POST',
      headers: { 'api_key': BASE44_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_CREATE_MS),
    });

    if (convRes.status === 429) {
      return res.status(429).json({ error: 'Service temporairement surcharge.' });
    }
    if (convRes.status === 502 || convRes.status === 503) {
      return res.status(502).json({ error: 'Service temporairement indisponible.' });
    }
    if (!convRes.ok) {
      console.error('[agents-chat] Base44 error creating conversation: HTTP', convRes.status);
      return res.status(502).json({ error: 'Erreur du service distant.' });
    }

    var convData = await convRes.json();
    if (convData.id) {
      chatConvOwnership[convData.id] = user.email;
    }

    res.json({ id: convData.id });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      console.error('[agents-chat] Timeout creating conversation');
      return res.status(504).json({ error: 'Delai depasse.' });
    }
    console.error('[agents-chat] Error creating conversation:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /agents-chat/conversations/:convId/messages — envoyer un message
router.post('/agents-chat/conversations/:convId/messages', async function (req, res) {
  try {
    var user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Session requise.' });
    if (!requireRole(user, 2)) return res.status(403).json({ error: 'Droits insuffisants.' });
    if (!BASE44_API_KEY) return res.status(503).json({ error: 'Service non configure.' });

    var convId = req.params.convId;
    if (!isValidConvId(convId)) {
      return res.status(400).json({ error: 'ConversationId invalide.' });
    }

    var owner = chatConvOwnership[convId];
    if (owner && owner !== user.email && user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Cette conversation ne vous appartient pas.' });
    }
    if (!owner) {
      chatConvOwnership[convId] = user.email;
    }

    var agentId = (req.body || {}).agentId;
    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({ error: 'agentId requis.' });
    }
    if (CHAT_ALLOWED_AGENT_IDS.indexOf(agentId) === -1) {
      return res.status(400).json({ error: 'Agent non autorise.' });
    }

    var content = (req.body || {}).content;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content requis (string).' });
    }
    content = content.trim();
    if (content.length === 0) {
      return res.status(400).json({ error: 'Le message ne peut pas etre vide.' });
    }
    if (content.length > CHAT_MAX_MESSAGE_LENGTH) {
      return res.status(413).json({ error: 'Message trop long (max ' + CHAT_MAX_MESSAGE_LENGTH + ' caracteres).' });
    }

    if (!chatCheckRateLimit(user.email)) {
      return res.status(429).json({ error: 'Trop de requetes.' });
    }

    var msgRes = await fetch(BASE44_API_URL + '/' + agentId + '/conversations/' + convId + '/messages', {
      method: 'POST',
      headers: { 'api_key': BASE44_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: content }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MESSAGE_MS),
    });

    if (msgRes.status === 429) {
      return res.status(429).json({ error: 'Service temporairement surcharge.' });
    }
    if (msgRes.status === 502 || msgRes.status === 503) {
      return res.status(502).json({ error: 'Service temporairement indisponible.' });
    }
    if (!msgRes.ok) {
      console.error('[agents-chat] Base44 error sending message: HTTP', msgRes.status);
      return res.status(502).json({ error: 'Erreur du service distant.' });
    }

    var msgData = await msgRes.json();
    res.json({ content: msgData.content || msgData.message || '...', id: msgData.id || null });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      console.error('[agents-chat] Timeout sending message');
      return res.status(504).json({ error: 'Delai depasse.' });
    }
    console.error('[agents-chat] Error sending message:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;

// ════════════════════════════════════════════════════════════════════════════
// RÉCUPÉRATION APRÈS CRASH — recoveryStuckRuns()
// ════════════════════════════════════════════════════════════════════════════
//
// Au démarrage du serveur, rechercher les agent_runs en statut 'dispatching'
// depuis plus de STUCK_THRESHOLD_MINUTES minutes.
//
// Stratégie retenue : passage en 'failed' avec message explicite.
//   → Un run en 'dispatching' depuis trop longtemps signifie que le processus
//   serveur a crashé ou a été redéployé pendant l'appel Base44.
//   → La conversation Base44 peut ou non avoir été créée — on ne peut pas le savoir.
//   → Mieux vaut marquer 'failed' et permettre une relance volontaire
//   plutôt que de laisser un run fantôme en 'dispatching' indéfiniment.
//
// Délai retenu : 5 minutes
//   → Un appel Base44 peut prendre jusqu'à 120s (timeout configuré).
//   → 5 min laisse une marge confortable : si après 5 min le run est encore
//   en 'dispatching', c'est que le serveur a crashé pendant le traitement.
//
// Comportements couverts :
//   - Redémarrage Railway (redeploy) : le nouveau processus appelle recoveryStuckRuns()
//     → les runs en 'dispatching' du processus précédent sont marqués 'failed'.
//   - Crash Node (OOM, exception non catchée) : au redémarrage, même logique.
//   - Timeout Base44 : si l'appel Base44 timeout (120s), processDispatchAsync
//     catche l'erreur et marque le run 'failed' normalement — pas besoin de recovery.
//     Mais si le serveur crash PENDANT le timeout, recovery s'en occupe au redémarrage.
//
// Cette fonction est idempotente : peut être appelée plusieurs fois sans effet
// secondaire (elle ne touche que les runs en 'dispatching', pas les autres statuts).

var STUCK_THRESHOLD_MINUTES = 5;

async function recoveryStuckRuns() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[dispatch-recovery] Supabase non configuré — récupération ignorée.');
    return;
  }

  try {
    // Calculer le seuil temporel : now - 5 minutes
    var threshold = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();

    // Sélectionner les runs en 'dispatching' depuis plus de 5 minutes
    var stuckRuns = await supabaseDataSelect('agent_runs',
      'id,task_id,agent_id,functional_role,started_at,requested_by',
      "&status=eq.dispatching&started_at=lt." + encodeURIComponent(threshold) + "&limit=50");

    if (!stuckRuns || stuckRuns.length === 0) {
      console.log('[dispatch-recovery] ✅ Aucun run bloqué en dispatching.');
      return;
    }

    console.warn('[dispatch-recovery] ⚠️ ' + stuckRuns.length + ' run(s) bloqué(s) en dispatching détecté(s).');

    for (var i = 0; i < stuckRuns.length; i++) {
      var run = stuckRuns[i];
      console.warn('[dispatch-recovery] → Run ' + run.id + ' (tâche: ' + run.task_id +
        ', agent: ' + (run.functional_role || run.agent_id) +
        ', commencé: ' + run.started_at + ') → marqué failed');

      try {
        await supabaseDataPatch('agent_runs', 'id=eq.' + encodeURIComponent(run.id), {
          status: 'failed',
          error: 'Récupération après crash : run resté en dispatching pendant plus de ' +
                 STUCK_THRESHOLD_MINUTES + ' minutes (serveur probablement redémarré). ' +
                 'Relance possible via POST /api/tasks/' + run.task_id + '/dispatch-retry.',
          completed_at: new Date().toISOString(),
        });
      } catch (patchErr) {
        console.error('[dispatch-recovery] Erreur mise à jour run ' + run.id + ':', patchErr.message);
      }
    }

    console.log('[dispatch-recovery] Récupération terminée : ' + stuckRuns.length + ' run(s) marqué(s) failed.');

  } catch (err) {
    console.error('[dispatch-recovery] Erreur lors de la récupération:', err.message);
    // Non bloquant — le serveur continue de démarrer
  }
}

// Exporter pour appel au démarrage du serveur
router.recoveryStuckRuns = recoveryStuckRuns;
