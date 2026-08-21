const express = require('express');
const crypto = require('crypto');
const { cleanTenant } = require('./server-tenant.cjs');
const { sanitizeTaskBatchPayload, executeTaskBatch } = require('./server-task-batch.cjs');

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
  const hasTask = /t[aâ]ches?|task/.test(source);
  const hasAgent = /agents?|d[eé]l[eé]gu|sp[eé]cialistes?|qa|devops|backend|support|produit|vid[eé]o/.test(source);
  const hasPlural = /plusieurs|toutes?|chacun|chaque|liste|six|6|diff[eé]rentes?/.test(source);
  return hasTask && (hasAgent || hasPlural);
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
  if (batchSignals(message)) return true;
  const normalized = String(message || '').trim().toLowerCase();
  if (!/^(oui|ok|oki|go|confirme|confirmer|je confirme|confirm)$/i.test(normalized)) return false;
  const history = await recentContext(req);
  const contextText = history.slice(-8).map((item) => item?.content || '').join('\n');
  return batchSignals(contextText);
}

router.post('/chat', async (req, res, next) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 4000) : '';
  if (!message) return next();
  if (!(await shouldHandleBatch(req, message))) return next();

  const sessionId = sessionIdFor(req);
  try {
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
          'Quand plusieurs tâches métier doivent être créées, utilise uniquement propose_action avec type=create_task_batch.',
          'Payload obligatoire: { tasks: [{ titre, description, priorite, projet_id?, client_id?, agent_name, agent_role, provider, provider_agent_id?, read_only }] }.',
          'Chaque tâche doit avoir un titre non vide. read_only=true pour diagnostic/analyse sans effet métier.',
          'Une seule confirmation utilisateur couvre le batch complet.',
          'Ne dis jamais que les tâches sont créées tant que le Cockpit n’a pas renvoyé un résultat d’exécution réel.',
        ].join('\n'),
        security: { assistant: req.user?.role === 'superadmin' ? 'owner' : 'staff', require_confirmation_for_actions: true },
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
      const summary = String(data.action_summary || `Créer ${payload.tasks.length} tâche(s) et déléguer le diagnostic`).slice(0, 300);
      pendingBatches.set(token, {
        payload,
        summary,
        userId: req.user.id,
        tenant: cleanTenant(req.user?.organisation) || 'jsinnovia',
        expiresAt: Date.now() + 5 * 60_000,
      });
      confirmation = { token, type: 'create_task_batch', summary, expires_in: 300 };
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
    return res.status(502).json({ error: 'Préparation du batch impossible', details: error.message });
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
      return res.status(502).json({
        error: `Batch incomplet: ${result.succeeded}/${result.requested} tâche(s) exécutée(s).`,
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
