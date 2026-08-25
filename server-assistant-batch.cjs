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
  const hasExecutionIntent = /(effectue|ex[eé]cute|lance|fais|faites|continue|poursuis|traite|r[eé]alise).*(t[aâ]ches?|actions?)/.test(source)
    || /(toutes?|chaque).*(t[aâ]ches?|actions?).*(effectue|ex[eé]cute|lance|fais|traite|r[eé]alise)/.test(source);
  return (hasWorkItem && (hasAgent || hasPlural)) || hasExecutionIntent;
}

function explicitExecutionAuthorization(message) {
  const source = String(message || '').trim().toLowerCase();
  return /\b(?:je\s+)?confirme(?:\s+explicitement)?\s+(?:l['’]\s*)?(?:ex[eé]cution|lancement|d[eé]l[eé]gation)\b/.test(source)
    || /\b(?:j['’]\s*)?autorise(?:\s+explicitement)?\b.*\b(?:ex[eé]cuter|lancer|d[eé]l[eé]guer|effectuer)\b/.test(source)
    || /(effectue|ex[eé]cute|lance|fais|faites|continue|poursuis|traite|r[eé]alise|applique|d[eé]l[eè]gue).*(toutes?|chaque|les|la|le)?\s*(t[aâ]ches?|actions?|changements?|modifications?|diagnostics?|audits?)/.test(source)
    || /(go|oki|ok|oui)[,\s!-]*(effectue|ex[eé]cute|lance|continue|poursuis)/.test(source);
}

function directAutopilotSignal(message) {
  const source = String(message || '').toLowerCase();
  return /(effectue|ex[eé]cute|lance|traite|r[eé]alise).*(toutes?|les)\s+t[aâ]ches?/.test(source)
    || /toutes?\s+les\s+t[aâ]ches?.*(effectue|ex[eé]cute|lance|traite|r[eé]alise)/.test(source);
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
  const lines = executed.map((item) => `✅ task_id=${item.task_id} · run_id=${item.run_id || item.tool_run_id || 'aucun'} · statut=${item.status || 'completed'}`)
    .concat(queued.map((item) => `⏳ task_id=${item.task_id} · run_id=${item.run_id || 'aucun'} · exécuteur=${item.executor || 'NOVA'} · statut=${item.status}`))
    .concat(awaitingAuthorization.map((item) => `⏸️ task_id=${item.task_id} · exécuteur=${item.executor || 'NOVA'} · statut=en_attente_autorisation`))
    .concat(blocked.map((item) => `⛔ task_id=${item.task_id} · statut=bloquee · raison=${item.reason || 'exécuteur ou accès indisponible'}`));
  return `Prise en charge déterministe terminée. run_id=${result?.run_id || 'absent'} · tâches uniques=${result?.unique || 0} · terminées=${executed.length} · en traitement=${queued.length} · en attente d’autorisation=${awaitingAuthorization.length} · bloquées=${blocked.length}\n${lines.join('\n')}`;
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
  if (!(await shouldHandleBatch(req, message))) return next();

  const sessionId = sessionIdFor(req);
  const userAlreadyAuthorizedExecution = explicitExecutionAuthorization(message);
  try {
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
          'MODE BATCH TÂCHES COCKPIT ACTIF.',
          'Tu es l’orchestrateur du Cockpit: comprends, planifie, délègue, suis, vérifie et clôture.',
          'Quand plusieurs tâches métier doivent être créées, utilise uniquement propose_action avec type=create_task_batch.',
          'Payload obligatoire: { tasks: [{ titre, description, priorite, projet_id?, client_id?, agent_name, agent_role, provider, provider_agent_id?, read_only }] }.',
          'Chaque tâche doit avoir un titre non vide. read_only=true uniquement pour diagnostic/analyse sans effet métier.',
          'Une tâche déléguée n’est jamais considérée terminée tant qu’un résultat réel et vérifié n’existe pas.',
          'Ne demande pas de confirmation supplémentaire lorsque le message utilisateur autorise explicitement l’exécution du lot et que les sous-actions sont normales, réversibles et nécessaires à cette demande.',
          'Ne déclare jamais une capacité indisponible sans vérifier les agents/outils disponibles; un état ancien ne vaut pas état actuel.',
          'Si une branche de travail est bloquée, continue les branches indépendantes et ne bloque pas toute la mission.',
          'Ne dis jamais que les tâches sont créées tant que le Cockpit n’a pas renvoyé un résultat d’exécution réel.',
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
