// ════════════════════════════════════════════════════════════════════════════
// server-dispatch.cjs — Task Dispatch to Agent (REAL Base44 connector)
// ════════════════════════════════════════════════════════════════════════════
// Endpoints :
//   POST   /tasks/:taskId/dispatch     — envoyer une tâche à un agent IA
//   GET    /tasks/:taskId/runs         — lister les exécutions d'une tâche
//   GET    /runs/:runId                — détail d'une exécution
//   POST   /runs/:runId/cancel         — annuler une exécution
//   POST   /runs/:runId/approve        — valider (mode approval_required)
//   POST   /runs/:runId/reject         — rejeter (mode approval_required)
//
// Connecteur réel : API Base44 Agents
//   POST /api/agents/{agentId}/conversations → crée conversation
//   POST /api/agents/{agentId}/conversations/{convId}/messages → envoie message
//   Auth: header "api_key" = BASE44_API_KEY (runtime only, jamais exposé)
//
// Sécurité :
//   - Session vérifiée via cookie HttpOnly
//   - Rôles admin/superadmin requis pour dispatch
//   - BASE44_API_KEY jamais exposé au frontend
//   - Idempotence via contrainte UNIQUE sur idempotency_key
//   - Aucun secret dans les logs
// ════════════════════════════════════════════════════════════════════════════

var express = require('express');
var crypto = require('crypto');

var router = express.Router();

// ─── Config (runtime only, jamais exposé au frontend) ────────────────────────
var SUPABASE_URL = process.env.SUPABASE_URL || '';
var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
var BASE44_API_URL = 'https://app.base44.com/api/agents';
var BASE44_API_KEY = process.env.BASE44_API_KEY || process.env.VITE_BASE44_API_KEY || '';

// ─── Mapping agents cockpit → Base44 agent IDs ───────────────────────────────
var AGENT_MAP = {
  'communication-agent':  { base44_id: '69ff4dc771a2cdab275f8a00', name: 'NOVA JS-Innov.IA',    description: 'Communication, emails, messagerie' },
  'social-media-agent':  { base44_id: '69ff4dc771a2cdab275f8a00', name: 'NOVA JS-Innov.IA',    description: 'Réseaux sociaux, contenus' },
  'developer-agent':     { base44_id: '6a1845e17cc526d1e44965bc', name: 'JsInnov-Agent',       description: 'Code, bugs, déploiement, CI/CD' },
  'billing-agent':       { base44_id: '69ff4dc771a2cdab275f8a00', name: 'NOVA JS-Innov.IA',    description: 'Facturation, devis, relances' },
  'sales-agent':         { base44_id: '69ff4dc771a2cdab275f8a00', name: 'NOVA JS-Innov.IA',    description: 'Commercial, leads, prospects' },
  'seo-audit-agent':     { base44_id: '6a1845e17cc526d1e44965bc', name: 'JsInnov-Agent',       description: 'SEO, audit, référencement' },
  'creative-agent':      { base44_id: '69ff4dc771a2cdab275f8a00', name: 'NOVA JS-Innov.IA',    description: 'Design, branding, créatif' },
  'general-agent':       { base44_id: '69ff4dc771a2cdab275f8a00', name: 'NOVA JS-Innov.IA',    description: 'Tâches générales et polyvalentes' },
};

var AVAILABLE_AGENTS = Object.keys(AGENT_MAP).map(function (id) {
  return { id: id, name: AGENT_MAP[id].name, description: AGENT_MAP[id].description };
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
    var users = await supabaseSelect('cockpit_users', 'id,email,full_name,role,is_active',
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

// ─── Idempotence — clé déterministe ───────────────────────────────────────────
function makeIdempotencyKey(taskId, agentId, executionMode, userId) {
  var raw = taskId + ':' + agentId + ':' + executionMode + ':' + userId;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── Connecteur Base44 (REAL) ─────────────────────────────────────────────────
async function dispatchToBase44(agent, task, instructions, executionMode) {
  if (!BASE44_API_KEY) {
    throw new Error('BASE44_API_KEY non configurée côté serveur');
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
    throw new Error('Base44 conv creation failed: ' + convRes.status + ' ' + errBody.substring(0, 100));
  }

  var convData = await convRes.json();
  var convId = convData.id;

  if (!convId) {
    throw new Error('Base44 conversation ID missing in response');
  }

  // 2. Construire le message pour l'agent
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

  // 3. Envoyer le message avec timeout de 120s (l'agent peut prendre du temps)
  var msgRes = await fetch(BASE44_API_URL + '/' + base44AgentId + '/conversations/' + convId + '/messages', {
    method: 'POST',
    headers: { 'api_key': BASE44_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', content: messageContent }),
    signal: AbortSignal.timeout(120000),
  });

  if (!msgRes.ok) {
    var errBody2 = await msgRes.text();
    throw new Error('Base44 message send failed: ' + msgRes.status + ' ' + errBody2.substring(0, 100));
  }

  var msgData = await msgRes.json();

  return {
    convId: convId,
    msgId: msgData.id || null,
    response: msgData.content || msgData.message || '',
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════════════════

// GET /agents — liste des agents disponibles
router.get('/agents', function (req, res) {
  res.json({ agents: AVAILABLE_AGENTS });
});

// POST /tasks/:taskId/dispatch — envoyer une tâche à un agent
router.post('/tasks/:taskId/dispatch', async function (req, res) {
  try {
    // 1. Vérifier la session
    var user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Session invalide ou expirée.' });
    if (!requireRole(user, 3)) return res.status(403).json({ error: 'Droits insuffisants. Admin requis.' });

    var taskId = req.params.taskId;
    var body = req.body || {};
    var agentId = body.agentId;
    var executionMode = body.executionMode;
    var instructions = body.instructions;
    var attachments = body.attachments || [];

    // 2. Valider le payload
    if (!agentId) return res.status(400).json({ error: 'agentId requis.' });
    var validModes = ['prepare_only', 'approval_required', 'autonomous'];
    if (!executionMode || validModes.indexOf(executionMode) === -1) {
      return res.status(400).json({ error: 'executionMode invalide.' });
    }
    var agent = AGENT_MAP[agentId];
    if (!agent) return res.status(400).json({ error: 'agentId inconnu.' });

    // 3. Récupérer la tâche
    var tasks = await supabaseSelect('Tache', '*', '&id=eq.' + encodeURIComponent(taskId) + '&limit=1');
    if (!tasks || tasks.length === 0) return res.status(404).json({ error: 'Tache introuvable.' });
    var task = tasks[0];

    // 4. Refuser les tâches incompatibles
    if (task.statut === 'termine' || task.statut === 'annule') {
      return res.status(409).json({ error: 'Tache non dispatchable (statut: ' + task.statut + ').' });
    }

    // 5. Idempotence — clé déterministe (taskId + agentId + mode + userId)
    var idempotencyKey = makeIdempotencyKey(taskId, agentId, executionMode, user.id);

    // Vérifier si un run existe déjà avec cette clé (DB constraint UNIQUE)
    var existing = await supabaseSelect('agent_runs', 'id,status,base44_conv_id',
      '&idempotency_key=eq.' + encodeURIComponent(idempotencyKey) + '&limit=1');
    if (existing && existing.length > 0) {
      return res.status(200).json({
        success: true,
        runId: existing[0].id,
        status: existing[0].status,
        idempotent: true,
        message: 'Execution deja en cours (idempotence). Run: ' + existing[0].id,
      });
    }

    // 6. Préparer l'input
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

    // 7. Créer l'agent_run en statut pending
    var run;
    try {
      run = await supabaseInsert('agent_runs', {
        task_id: taskId, agent_id: agentId, status: 'pending',
        execution_mode: executionMode, input: input,
        idempotency_key: idempotencyKey, requested_by: user.email,
      });
    } catch (insertErr) {
      // Si la contrainte UNIQUE se déclenche (race condition), récupérer le run existant
      if (String(insertErr.message).indexOf('23505') !== -1 || String(insertErr.message).indexOf('duplicate') !== -1) {
        var existing2 = await supabaseSelect('agent_runs', 'id,status',
          '&idempotency_key=eq.' + encodeURIComponent(idempotencyKey) + '&limit=1');
        if (existing2 && existing2.length > 0) {
          return res.status(200).json({
            success: true, runId: existing2[0].id, status: existing2[0].status,
            idempotent: true, message: 'Execution deja en cours (idempotence).',
          });
        }
      }
      throw insertErr;
    }

    if (!run || run.length === 0) return res.status(500).json({ error: 'Echec creation agent_run.' });
    var runId = run[0].id;

    // 8. Si mode approval_required, créer une demande d'approbation
    if (executionMode === 'approval_required') {
      await supabaseInsert('agent_approvals', { agent_run_id: runId, status: 'pending' });
    }

    // 9. DISPATCH RÉEL vers Base44
    try {
      var dispatchResult = await dispatchToBase44(agent, task, instructions, executionMode);

      // Mettre à jour le run avec les infos Base44
      await supabasePatch('agent_runs', 'id=eq.' + encodeURIComponent(runId), {
        status: 'dispatched',
        started_at: new Date().toISOString(),
        base44_agent_id: agent.base44_id,
        base44_conv_id: dispatchResult.convId,
        base44_msg_id: dispatchResult.msgId,
        result: { initial_response: dispatchResult.response.substring(0, 2000) },
      });

      // 10. Mettre à jour le statut de la tâche
      await supabasePatch('Tache', 'id=eq.' + encodeURIComponent(taskId), {
        statut: 'en_cours',
        notes: (task.notes || '') + '\n[Dispatch] Agent ' + agentId + ' run ' + runId + ' conv ' + dispatchResult.convId,
      });

      res.status(201).json({
        success: true, runId: runId, status: 'dispatched',
        agentId: agentId, executionMode: executionMode,
        base44_conv_id: dispatchResult.convId,
        message: 'Tache envoyee a ' + agent.name + ' (mode: ' + executionMode + ').',
      });

    } catch (dispatchErr) {
      // Marquer comme failed — ne JAMAIS afficher "envoyée" si l'agent n'a pas reçu
      await supabasePatch('agent_runs', 'id=eq.' + encodeURIComponent(runId), {
        status: 'failed',
        error: dispatchErr.message,
        completed_at: new Date().toISOString(),
      });

      res.status(502).json({
        success: false,
        runId: runId,
        status: 'failed',
        error: 'Dispatch echoue: ' + dispatchErr.message,
        message: 'L agent n a pas pu recevoir la tache. Verifiez la configuration.',
      });
    }

  } catch (err) {
    console.error('[dispatch] Error:', err.message);
    res.status(500).json({ error: 'Erreur serveur lors du dispatch.' });
  }
});

// GET /tasks/:taskId/runs — lister les exécutions d'une tâche
router.get('/tasks/:taskId/runs', async function (req, res) {
  try {
    var user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Session invalide.' });
    var runs = await supabaseSelect('agent_runs',
      'id,task_id,agent_id,status,execution_mode,requested_by,created_at,started_at,completed_at,error,base44_conv_id',
      '&task_id=eq.' + encodeURIComponent(req.params.taskId) + '&order=created_at.desc');
    res.json({ runs: runs || [] });
  } catch (err) {
    console.error('[dispatch] Error listing runs:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /runs/:runId — détail d'une exécution
router.get('/runs/:runId', async function (req, res) {
  try {
    var user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Session invalide.' });
    var runs = await supabaseSelect('agent_runs', '*',
      '&id=eq.' + encodeURIComponent(req.params.runId) + '&limit=1');
    if (!runs || runs.length === 0) return res.status(404).json({ error: 'Execution introuvable.' });
    var approvals = await supabaseSelect('agent_approvals', '*',
      '&agent_run_id=eq.' + encodeURIComponent(req.params.runId) + '&order=created_at.desc');
    res.json({ run: runs[0], approvals: approvals || [] });
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
    var runs = await supabaseSelect('agent_runs', 'id,status',
      '&id=eq.' + encodeURIComponent(req.params.runId) + '&limit=1');
    if (!runs || runs.length === 0) return res.status(404).json({ error: 'Execution introuvable.' });
    var cancellable = ['pending', 'dispatched', 'running', 'awaiting_approval'];
    if (cancellable.indexOf(runs[0].status) === -1) {
      return res.status(409).json({ error: 'Execution non annulable (statut: ' + runs[0].status + ').' });
    }
    await supabasePatch('agent_runs', 'id=eq.' + encodeURIComponent(req.params.runId), {
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
    var runs = await supabaseSelect('agent_runs', 'id,status',
      '&id=eq.' + encodeURIComponent(req.params.runId) + '&limit=1');
    if (!runs || runs.length === 0) return res.status(404).json({ error: 'Execution introuvable.' });
    if (runs[0].status !== 'awaiting_approval') {
      return res.status(409).json({ error: 'Execution non en attente d approbation.' });
    }
    await supabasePatch('agent_approvals',
      'agent_run_id=eq.' + encodeURIComponent(req.params.runId) + '&status=eq.pending',
      { status: 'approved', approved_at: new Date().toISOString(), approved_by: user.email });
    await supabasePatch('agent_runs', 'id=eq.' + encodeURIComponent(req.params.runId), { status: 'running' });
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
    var runs = await supabaseSelect('agent_runs', 'id,status',
      '&id=eq.' + encodeURIComponent(req.params.runId) + '&limit=1');
    if (!runs || runs.length === 0) return res.status(404).json({ error: 'Execution introuvable.' });
    if (runs[0].status !== 'awaiting_approval') {
      return res.status(409).json({ error: 'Execution non en attente d approbation.' });
    }
    await supabasePatch('agent_approvals',
      'agent_run_id=eq.' + encodeURIComponent(req.params.runId) + '&status=eq.pending',
      { status: 'rejected', rejected_at: new Date().toISOString(), rejection_reason: reason || 'Non specifie' });
    await supabasePatch('agent_runs', 'id=eq.' + encodeURIComponent(req.params.runId), {
      status: 'cancelled', completed_at: new Date().toISOString(), error: reason || 'Rejete par l utilisateur',
    });
    res.json({ success: true, message: 'Execution rejetee.' });
  } catch (err) {
    console.error('[dispatch] Error rejecting run:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
