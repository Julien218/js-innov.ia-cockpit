const express = require('express');
const crypto = require('crypto');
const { cleanTenant } = require('./server-tenant.cjs');
const { sanitizeTaskBatchPayload, executeTaskBatch } = require('./server-task-batch.cjs');
const { runAutopilot } = require('./server-task-autopilot.cjs');

const router = express.Router();
const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '';
const pendingBatches = new Map();

function agentFetch(path, options = {}) {
  if (!AGENT_KEY) throw new Error('Agent server key not configured');
  return fetch(`${AGENT_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': AGENT_KEY,
      ...(options.headers || {}),
    },
  });
}

function conversationIdFrom(req) {
  const value = String(req.body?.conversation_id || req.query?.conversation_id || 'main');
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'main';
}

function sessionIdFor(req) {
  const conversationId = conversationIdFrom(req);
  const tenant = cleanTenant(req.user?.organisation) || 'jsinnovia';
  const base = req.user?.role === 'client'
    ? `cockpit:client:${tenant}:${req.user.id}`
    : `cockpit:${req.user.id}`;
  return conversationId === 'main' ? base : `${base}:${conversationId}`;
}

function canBatch(user) {
  return ['collaborateur', 'admin', 'superadmin'].includes(String(user?.role || ''));
}

function batchSignals(text) {
  const source = String(text || '').toLowerCase();
  const hasWorkItem = /t[aâ]ches?|tasks?|actions?|diagnostics?|audits?/.test(source);
  const hasAgent = /agents?|d[eé]l[eé]gu|sp[eé]cialistes?|qa|devops|backend|support|produit|vid[eé]o/.test(source);
  const hasPlural = /plusieurs|toutes?|chacun|chaque|liste|six|6|diff[eé]rentes?/.test(source);
  const hasExecutionIntent = /(effectue|ex[eé]cute|lance|fais|faites|continue|poursuis|traite|r[eé]alise|finalis(?:e|er)|termin(?:e|er)|cl[oô]tur(?:e|er)|ach[eè]v(?:e|er)).*(t[aâ]ches?|actions?)/.test(source)
    || /(toutes?|chaque).*(t[aâ]ches?|actions?).*(effectue|ex[eé]cute|lance|fais|traite|r[eé]alise|finalis(?:e|er)|termin(?:e|er)|cl[oô]tur(?:e|er)|ach[eè]v(?:e|er))/.test(source);
  return (hasWorkItem && (hasAgent || hasPlural)) || hasExecutionIntent;
}

function executionProhibited(message) {
  const source = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /(?:\bne\s+|\bn['’]\s*)(?:execute|lance|effectue|realise|applique|delegue|modifie)\b/.test(source)
    || /\bsans\s+(?:executer|lancer|effectuer|realiser|appliquer|deleguer|modifier)\b/.test(source)
    || /\b(?:lecture\s+seule|rapport\s+uniquement|analyse\s+uniquement|diagnostic\s+uniquement)\b/.test(source)
    || /\baucune\s+(?:ecriture|modification|generation|depense|delegation|execution)\b/.test(source);
}

function scopedTaskExecutionAuthorization(message) {
  const source = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const scopedIntent = /\b(?:j['’]\s*autorise(?:\s+explicitement)?|je\s+confirme(?:\s+explicitement)?|effectue|execute|lance|reprends?)\b[\s\S]{0,180}\b(?:reprendre\s+et\s+)?executer\s+uniquement\s+(?:la\s+)?tache\b/.test(source)
    || /\b(?:effectue|execute|lance|reprends?)\s+uniquement\s+(?:la\s+)?tache\b/.test(source);
  return scopedIntent && /\b[a-f0-9]{8}-[a-f0-9-]{20,}\b/.test(source);
}

function scopedTaskId(message) {
  const match = String(message || '').match(/\b(?:task_id|t[aâ]che(?:\s+existante)?)\s*[:=]?\s*([a-f0-9]{8}-[a-f0-9-]{20,})\b/i);
  return match?.[1] || null;
}

function scopedProjectId(message) {
  const match = String(message || '').match(/\bprojet(?:\s+cible)?\s*[:=]?\s*([a-f0-9]{8}-[a-f0-9-]{20,})\b/i);
  return match?.[1] || null;
}

function scopedTaskBatchPayload(message, task) {
  if (!task?.id || !String(task.titre || '').trim()) return null;
  return sanitizeTaskBatchPayload({
    tasks: [{
      task_id: task.id,
      titre: task.titre,
      description: String(message || '').slice(0, 4000),
      priorite: task.priorite,
      date_echeance: task.date_echeance,
      projet_id: scopedProjectId(message) || task.projet_id,
      client_id: task.client_id,
      notes: task.notes,
      read_only: false,
    }],
  });
}

function explicitExecutionAuthorization(message) {
  const source = String(message || '').trim().toLowerCase();
  if (scopedTaskExecutionAuthorization(message)) return true;
  if (executionProhibited(message)) return false;
  return /\b(?:je\s+)?confirme(?:\s+explicitement)?\s+(?:l['’]\s*)?(?:ex[eé]cution|lancement|d[eé]l[eé]gation)\b/.test(source)
    || /\b(?:j['’]\s*)?autorise(?:\s+explicitement)?\b.*\b(?:ex[eé]cuter|lancer|d[eé]l[eé]guer|effectuer)\b/.test(source)
    || /(effectue|ex[eé]cute|lance|fais|faites|continue|poursuis|traite|r[eé]alise|finalis(?:e|er)|termin(?:e|er)|cl[oô]tur(?:e|er)|ach[eè]v(?:e|er)|applique|d[eé]l[eè]gue).*(toutes?|chaque|les|la|le|mes)?\s*(t[aâ]ches?|actions?|changements?|modifications?|diagnostics?|audits?)/.test(source)
    || /(go|oki|ok|oui)[,\s!-]*(effectue|ex[eé]cute|lance|continue|poursuis)/.test(source);
}

function directAutopilotSignal(message) {
  const source = String(message || '').toLowerCase();
  if (executionProhibited(message)) return false;
  return /(effectue|ex[eé]cute|lance|traite|r[eé]alise).*(toutes?|les)\s+t[aâ]ches?/.test(source)
    || /toutes?\s+les\s+t[aâ]ches?.*(effectue|ex[eé]cute|lance|traite|r[eé]alise)/.test(source)
    || /(finalis(?:e|er)|termin(?:e|er)|cl[oô]tur(?:e|er)|ach[eè]v(?:e|er)).*(?:toutes?\s+les\s+|les\s+|mes\s+)t[aâ]ches?(?:\s+(?:ouvertes?|non\s+termin[eé]es?|en\s+cours|[àa]\s+faire))?/.test(source);
}

function directInspectionSignal(message) {
  const source = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return executionProhibited(message)
    && /\b(?:analyse|inspecte|controle|verifie|liste|rapport|etat)\b/.test(source)
    && /\b(?:taches?|executions?|runs?|blocages?|preuves?)\b/.test(source)
    && /\b(?:toutes?\s+les\s+taches?|taches?\s+non\s+terminees?|chaque\s+tache|liste\s+des\s+taches?|ensemble\s+des\s+taches?)\b/.test(source);
}

function targetedInspectionSignal(message) {
  const source = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const hasProjectId = /\bprojet\s+[a-f0-9-]{20,}\b/.test(source) || /\bupdate_project\b/.test(source);
  const hasTaskId = /\b(?:task_id|tache)\s*[:=]?\s*[a-f0-9-]{20,}\b/.test(source);
  return !scopedTaskExecutionAuthorization(message)
    && executionProhibited(message)
    && /\b(?:controle|inspecte|verifie|affiche|preuve|lecture seule)\b/.test(source)
    && (hasProjectId || hasTaskId);
}

function idAfterLabel(message, labels) {
  const label = labels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = String(message || '').match(new RegExp(`(?:${label})\\s*(?:id)?\\s*[:=]?\\s*([a-f0-9-]{20,})`, 'i'));
  return match?.[1] || null;
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function recordFrom(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.data && !Array.isArray(payload.data)) return payload.data;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && !payload.data && !payload.items) return payload;
  return rowsFrom(payload)[0] || null;
}

async function readAgentJson(path) {
  const response = await agentFetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Agent ${response.status}`);
  return data;
}

async function inspectTargetedProject(message) {
  const identifiers = String(message).match(/\b[a-f0-9]{8}-[a-f0-9-]{20,}\b/gi) || [];
  const projectId = idAfterLabel(message, ['projet', 'cible']) || identifiers[0] || null;
  const taskId = idAfterLabel(message, ['task_id', 'tâche', 'tache']);
  const [projectPayload, taskPayload, runPayload, logPayload] = await Promise.all([
    projectId ? readAgentJson(`/data/Projet/${encodeURIComponent(projectId)}`) : Promise.resolve(null),
    taskId ? readAgentJson(`/data/Tache/${encodeURIComponent(taskId)}`).catch(() => null) : Promise.resolve(null),
    taskId ? readAgentJson(`/agent-runs?task_id=${encodeURIComponent(taskId)}&limit=20`).catch(() => []) : Promise.resolve([]),
    readAgentJson('/data/LogAction?limit=250').catch(() => []),
  ]);
  const project = recordFrom(projectPayload);
  const task = recordFrom(taskPayload);
  const runs = rowsFrom(runPayload).filter((run) => !taskId || String(run.task_id) === String(taskId));
  const logs = rowsFrom(logPayload)
    .filter((log) => /update_project/i.test(String(log.action || ''))
    .filter((log) => !projectId || String(log.details || '').includes(projectId))
    .sort((a, b) => Date.parse(b.created_at || b.date_creation || 0) - Date.parse(a.created_at || a.date_creation || 0));
  const latestRun = runs.sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0))[0] || null;
  const latestLog = logs[0] || null;
  const projectFields = project ? {
    id: project.id,
    nom: project.nom,
    statut: project.statut,
    client_id: project.client_id || null,
    client_nom: project.client_nom || null,
    organisation_id: project.organisation_id || null,
    description: project.description || null,
    date_debut: project.date_debut || null,
    date_fin_prevue: project.date_fin_prevue || null,
    budget: project.budget ?? null,
    notes: project.notes || null,
    updated_at: project.updated_at || project.date_modification || null,
  } : null;
  const lines = [
    'Inspection ciblée sans effet terminée.',
    `Projet: ${projectId || 'non fourni'}`,
    `Champs actuels: ${projectFields ? JSON.stringify(projectFields) : 'projet introuvable'}`,
    'Valeurs avant modification: indisponibles (aucun instantané avant/après n’est conservé par cette action).',
    `Journal update_project: ${latestLog?.id || 'absent'} · heure=${latestLog?.created_at || latestLog?.date_creation || 'absente'} · exécuteur=${latestLog?.effectue_par || 'absent'} · statut=${latestLog?.statut || 'absent'}`,
    `Tâche liée: ${taskId || 'non fournie'} · titre=${task?.titre || 'absent'} · statut=${task?.statut || 'absent'}`,
    `Dernier run lié: ${latestRun?.id || 'aucun'} · statut=${latestRun?.status || 'absent'} · exécuteur=${latestRun?.agent_id || latestRun?.provider_name || 'absent'} · preuve=${latestRun?.result ? JSON.stringify(latestRun.result).slice(0, 1200) : 'aucune'}`,
    'Aucune écriture, tâche, exécution ou dépense n’a été créée par cette inspection.',
  ];
  return { message: lines.join('\n'), result: { inspection_only: true, project: projectFields, task, latest_run: latestRun, action_log: latestLog } };
}

function directEntityMutationSignal(message) {
  const source = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const mutation = /(complete|completer|mets? a jour|mettre a jour|modifie|modifier|corrige|corriger|renseigne|renseigner|ajoute|ajouter)/.test(source);
  const entity = /(fiche\s+projet|projet\s+[a-z0-9]|informations?\s+(?:du|de ce)\s+projet)/.test(source);
  const explicitBatch = /(plusieurs|tous|toutes|chaque|lot|batch|liste)\s+(?:les\s+)?(?:fiches?\s+)?projets?/.test(source);
  return mutation && entity && !explicitBatch;
}

function autopilotMessage(result) {
  if (result?.skipped) return `Autopilote déjà en cours (${result.reason}).`;
  const executed = Array.isArray(result?.executed) ? result.executed : [];
  const queued = Array.isArray(result?.queued) ? result.queued : [];
  const blocked = Array.isArray(result?.blocked) ? result.blocked : [];
  const awaitingAuthorization = Array.isArray(result?.awaiting_authorization) ? result.awaiting_authorization : [];
  const ready = Array.isArray(result?.ready) ? result.ready : [];
  const title = (item) => String(item?.title || 'titre indisponible').replace(/[\r\n]+/g, ' ').slice(0, 180);
  const proof = (item) => item?.tool_run_id || item?.journal_id || item?.result?.journal_id || item?.result?.update_id || item?.result?.run_id || item?.run_id || 'aucune';
  const lines = executed.map((item) => `✅ ${title(item)} · task_id=${item.task_id} · run_id=${item.run_id || 'aucun'} · exécuteur=${item.executor || 'NOVA'} · statut=${item.status || 'completed'} · preuve=${proof(item)}`)
    .concat(queued.map((item) => `⏳ ${title(item)} · task_id=${item.task_id} · run_id=${item.run_id || 'aucun'} · exécuteur=${item.executor || 'NOVA'} · statut=${item.status} · preuve=${proof(item)}`))
    .concat(ready.map((item) => `🔎 ${title(item)} · task_id=${item.task_id} · exécuteur=${item.executor || 'NOVA'} · statut=exécutable_non_lancé · raison=inspection_sans_effet`))
    .concat(awaitingAuthorization.map((item) => `⏸️ ${title(item)} · task_id=${item.task_id} · exécuteur=${item.executor || 'NOVA'} · statut=en_attente_autorisation · raison=${item.reason || 'autorisation_explicite_requise'}`))
    .concat(blocked.map((item) => `⛔ ${title(item)} · task_id=${item.task_id} · exécuteur=${item.executor || 'non attribué'} · statut=bloquee · raison=${item.reason || 'exécuteur ou accès indisponible'}`));
  const prefix = result?.inspection_only ? 'Inspection déterministe sans effet terminée.' : 'Prise en charge déterministe terminée.';
  return `${prefix} run_id=${result?.run_id || 'absent'} · tâches uniques=${result?.unique || 0} · terminées=${executed.length} · en traitement=${queued.length} · exécutables non lancées=${ready.length} · en attente d’autorisation=${awaitingAuthorization.length} · bloquées=${blocked.length}\n${lines.join('\n')}`;
}

function removeStaleConfirmationLanguage(value) {
  return String(value || '')
    .replace(/[^.!?\n]*(?:pr[eê]tes?\s+[àa]\s+[eê]tre\s+confirm[eé]es?|pr[eê]t\s+[àa]\s+[eê]tre\s+confirm[eé])[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*souhaitez-vous\s+que\s+je\s+(?:les?\s+)?(?:envoie|lance|ex[eé]cute)[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*(?:n[eé]cessite|requiert)\s+(?:votre|une)\s+confirmation[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*veuillez\s+confirmer[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*veux-tu\s+que\s+je\s+(?:confirme|lance|ex[eé]cute)[^.!?\n]*[.!?]?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function executionProof(result) {
  if (!result?.results?.length) return '';
  const lines = result.results.map((item, index) => {
    const taskId = item.task_id || 'absent';
    const runId = item.run_id || 'aucun';
    const status = item.status || (item.success ? 'créée' : 'échec');
    const error = item.error ? ` — erreur: ${item.error}` : '';
    return `${index + 1}. task_id=${taskId} · run_id=${runId} · exécuteur=${item.executor || 'non attribué'} · statut=${status}${error}`;
  });
  return `\n\nPreuves du lot:\n${lines.join('\n')}`;
}

async function recentContext(req) {
  const sessionId = sessionIdFor(req);
  try {
    const response = await agentFetch(`/chat/session/${encodeURIComponent(sessionId)}?limit=12`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return [];
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

async function shouldHandleBatch(req, message) {
  if (!canBatch(req.user)) return false;
  if (scopedTaskExecutionAuthorization(message)) return true;
  if (directEntityMutationSignal(message)) return false;
  if (batchSignals(message)) return true;
  const normalized = String(message || '').trim().toLowerCase();
  if (!/^(oui|ok|oki|go|confirme|confirmer|je confirme|confirm)$/i.test(normalized)) return false;
  const history = await recentContext(req);
  const contextText = history.slice(-8).map((item) => item?.content || '').join('\n');
  if (directEntityMutationSignal(contextText)) return false;
  return batchSignals(contextText);
}

router.post('/chat', async (req, res, next) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 4000) : '';
  if (!message) return next();
  if (canBatch(req.user) && targetedInspectionSignal(message)) {
    try {
      const inspection = await inspectTargetedProject(message);
      return res.json({ ...inspection, confirmation: null, conversation_id: conversationIdFrom(req), assistant_mode: req.user?.role === 'superadmin' ? 'owner' : 'staff' });
    } catch (error) {
      return res.status(502).json({ error: 'Inspection ciblée impossible', details: String(error.message || error).slice(0, 300) });
    }
  }
  if (!(await shouldHandleBatch(req, message))) return next();

  const sessionId = sessionIdFor(req);
  const userAlreadyAuthorizedExecution = explicitExecutionAuthorization(message);
  try {
    if (scopedTaskExecutionAuthorization(message)) {
      const taskId = scopedTaskId(message);
      if (!taskId) return res.status(422).json({ error: 'task_id ciblé absent ou invalide', confirmation: null });
      const task = recordFrom(await readAgentJson(`/data/Tache/${encodeURIComponent(taskId)}`));
      const payload = scopedTaskBatchPayload(message, task);
      if (!payload) return res.status(422).json({ error: 'Tâche ciblée introuvable ou incomplète', confirmation: null });
      const result = await executeTaskBatch({
        payload,
        token: crypto.randomBytes(24).toString('hex'),
        user: req.user,
        tenant: cleanTenant(req.user?.organisation) || 'jsinnovia',
        agentFetch,
      });
      const completed = result.results.filter((item) => item.status === 'completed').length;
      const following = result.results.filter((item) => ['queued_local', 'awaiting_review', 'already_running'].includes(item.status)).length;
      const blocked = result.results.length - completed - following;
      return res.status(result.success ? 200 : 207).json({
        message: `Exécution limitée à la tâche autorisée terminée. ${completed} terminée(s), ${following} en suivi, ${blocked} bloquée(s).${executionProof(result)}`,
        confirmation: null,
        execution_result: result,
        conversation_id: conversationIdFrom(req),
        assistant_mode: req.user?.role === 'superadmin' ? 'owner' : 'staff',
      });
    }
    if (directInspectionSignal(message)) {
      const result = await runAutopilot({ inspectOnly: true, requestedBy: req.user?.email || req.user?.id || 'companion', user: req.user });
      return res.json({ message: autopilotMessage(result), confirmation: null, result, conversation_id: conversationIdFrom(req), assistant_mode: req.user?.role === 'superadmin' ? 'owner' : 'staff' });
    }
    if (userAlreadyAuthorizedExecution && directAutopilotSignal(message)) {
      const result = await runAutopilot({ allowWrites: true, requestedBy: req.user?.email || req.user?.id || 'companion', user: req.user });
      return res.json({ message: autopilotMessage(result), confirmation: null, result, conversation_id: conversationIdFrom(req), assistant_mode: req.user?.role === 'superadmin' ? 'owner' : 'staff' });
    }
    const response = await agentFetch('/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        session_id: sessionId,
        assistant_mode: req.user?.role === 'superadmin' ? 'owner' : 'staff',
        user_context: {
          id: req.user?.id,
          full_name: req.user?.full_name,
          role: req.user?.role,
          organisation: req.user?.organisation,
        },
        server_context: [
          '[MODE BATCH TÂCHES COCKPIT — CONTRAT TECHNIQUE]',
          'La doctrine comportementale, l’identité et la politique VERT/ORANGE/ROUGE de NOVA sont définies exclusivement par le system prompt canonique de jsinnovia-agent.',
          'Ce bloc décrit uniquement le format d’échange technique du batch; il ne redéfinit pas la personnalité ni les permissions de NOVA.',
          'Pour plusieurs tâches métier, utiliser propose_action avec type=create_task_batch.',
          'Payload obligatoire: { tasks: [{ titre, description, priorite, projet_id?, client_id?, agent_name, agent_role, provider, provider_agent_id?, read_only }] }.',
          'Chaque tâche doit avoir un titre non vide. read_only=true uniquement pour diagnostic/analyse sans effet métier.',
          'Le Cockpit n’annonce une création ou une terminaison que si executeTaskBatch renvoie un résultat réel avec task_id/run_id/statut.',
          '[/MODE BATCH TÂCHES COCKPIT — CONTRAT TECHNIQUE]',
        ].join('\n'),
        security: {
          assistant: req.user?.role === 'superadmin' ? 'owner' : 'staff',
          require_confirmation_for_actions: !userAlreadyAuthorizedExecution,
        },
        action_protocol: {
          proposed_action: { type: 'create_task_batch', payload: { tasks: [] } },
          action_summary: 'Résumé français du batch',
          immutable_after_proposal: true,
        },
        available_actions: ['create_task_batch'],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Agent ${response.status}`);

    const rawAction = data.proposed_action || data.action;
    let confirmation = null;
    let executionResult = null;

    if (rawAction?.type === 'create_task_batch') {
      const payload = sanitizeTaskBatchPayload(rawAction.payload || {});
      if (!payload) {
        return res.status(422).json({
          error: 'Batch invalide: chaque tâche doit contenir au minimum un titre et le tableau tasks doit être non vide.',
          message: data.response || data.message || 'Le batch proposé est incomplet.',
          confirmation: null,
          conversation_id: conversationIdFrom(req),
        });
      }

      const token = crypto.randomBytes(24).toString('hex');
      const summary = String(data.action_summary || `Créer ${payload.tasks.length} tâche(s) et les déléguer`).slice(0, 300);
      const batchContext = {
        payload,
        summary,
        userId: req.user.id,
        tenant: cleanTenant(req.user?.organisation) || 'jsinnovia',
        expiresAt: Date.now() + 5 * 60_000,
      };

      if (userAlreadyAuthorizedExecution) {
        executionResult = await executeTaskBatch({
          payload,
          token,
          user: req.user,
          tenant: batchContext.tenant,
          agentFetch,
        });
      } else {
        pendingBatches.set(token, batchContext);
        confirmation = { token, type: 'create_task_batch', summary, expires_in: 300 };
      }
    }

    if (executionResult) {
      const counts = executionResult.results.reduce((summary, item) => {
        summary[item.status] = (summary[item.status] || 0) + 1;
        return summary;
      }, {});
      const suffix = `\n\nPrise en charge réelle: ${counts.completed || 0} terminée(s), ${counts.queued_local || 0} transmise(s) à Windows, ${(counts.awaiting_review || 0) + (counts.already_running || 0)} en suivi, ${(counts.blocked || 0) + (counts.failed || 0)} bloquée(s).`;
      return res.status(executionResult.success ? 200 : 207).json({
        message: `${removeStaleConfirmationLanguage(data.response || data.reply || data.message || 'Batch préparé.')}${suffix}${executionProof(executionResult)}`,
        confirmation: null,
        execution_result: executionResult,
        conversation_id: conversationIdFrom(req),
        model_used: data.model_used || data.model,
        assistant_mode: req.user?.role === 'superadmin' ? 'owner' : 'staff',
      });
    }

    return res.json({
      message: data.response || data.reply || data.message || 'Réponse vide',
      confirmation,
      conversation_id: conversationIdFrom(req),
      model_used: data.model_used || data.model,
      assistant_mode: req.user?.role === 'superadmin' ? 'owner' : 'staff',
    });
  } catch (error) {
    console.error('[assistant-batch] chat failed:', error.message);
    return res.status(502).json({ error: 'Préparation ou exécution du batch impossible', details: error.message });
  }
});

router.post('/confirm', async (req, res, next) => {
  const token = String(req.body?.token || '');
  const item = pendingBatches.get(token);
  if (!item) return next();
  pendingBatches.delete(token);

  if (item.userId !== req.user?.id || item.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'Confirmation batch invalide ou expirée' });
  }

  try {
    const result = await executeTaskBatch({
      payload: item.payload,
      token,
      user: req.user,
      tenant: item.tenant,
      agentFetch,
    });

    if (!result.success) {
      return res.status(207).json({
        error: `Batch partiel: ${result.succeeded}/${result.requested} tâche(s) traitée(s).`,
        action_type: 'create_task_batch',
        action_summary: item.summary,
        result,
      });
    }

    return res.json({
      success: true,
      action_type: 'create_task_batch',
      action_summary: item.summary,
      execution: { target: 'Tache+agent_runs', requested: result.requested },
      result,
    });
  } catch (error) {
    console.error('[assistant-batch] confirm failed:', error.message);
    return res.status(502).json({ error: 'Batch non exécuté', details: error.message });
  }
});

module.exports = router;
module.exports.batchSignals = batchSignals;
module.exports.explicitExecutionAuthorization = explicitExecutionAuthorization;
module.exports.removeStaleConfirmationLanguage = removeStaleConfirmationLanguage;
module.exports.executionProof = executionProof;
module.exports.directAutopilotSignal = directAutopilotSignal;
module.exports.autopilotMessage = autopilotMessage;
module.exports.directEntityMutationSignal = directEntityMutationSignal;
module.exports.executionProhibited = executionProhibited;
module.exports.directInspectionSignal = directInspectionSignal;
module.exports.targetedInspectionSignal = targetedInspectionSignal;
module.exports.idAfterLabel = idAfterLabel;
module.exports.scopedTaskExecutionAuthorization = scopedTaskExecutionAuthorization;
module.exports.scopedTaskId = scopedTaskId;
module.exports.scopedProjectId = scopedProjectId;
module.exports.scopedTaskBatchPayload = scopedTaskBatchPayload;
