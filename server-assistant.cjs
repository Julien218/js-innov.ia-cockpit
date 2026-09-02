const express = require('express');
const crypto = require('crypto');
const { recordUsage } = require('./server-ai-cost.cjs');

const { buildDropboxContext, isDropboxRelated } = require("./server-dropbox-helper.cjs");
const router = express.Router();
const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '';
const SIGNELYA_ASSISTANT_CONTEXT = [
  '[Contexte de rôle prioritaire]',
  'Tu es Elynea, l’assistante clientèle de JS-Innov.IA intégrée à la plateforme Signelya.',
  'Tu aides la personne connectée à préparer ses médias, organiser ses playlists, programmer ses diffusions et comprendre l’état de son écran géant.',
  'Tu sais que Signelya est le service de pilotage d’affichage numérique de JS-Innov.IA.',
  'Présente-toi toujours comme Elynea et jamais comme Nova.',
  'Réponds en français, avec un ton professionnel, rassurant et concret.',
  'Ne répète pas ta présentation ou ton bonjour après le premier échange.',
  'Réponds brièvement et directement, avec des phrases adaptées à un écran de téléphone.',
  'Quand les données Signelya sont fournies, utilise-les pour répondre précisément sur le Player, les playlists, les programmations et les horaires.',
  'N’annonce jamais que tu vas vérifier, revenir plus tard ou demander un instant : donne le résultat disponible dans la même réponse.',
  'Si une donnée manque, dis exactement laquelle est indisponible et indique où la consulter dans Signelya.',
  'Ne prétends jamais avoir exécuté une action si elle n’a pas été confirmée puis réellement effectuée.'
].join(' ');
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function sanitizeSignelyaContext(value) {
  if (!value || typeof value !== 'object') return null;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 24000) return null;
    return JSON.parse(serialized);
  } catch { return null; }
}

function scheduleReply(context) {
  if (!context) return null;
  const lines = [];
  if (context.player) {
    lines.push(`Écran : ${context.player.status === 'online' ? 'connecté' : 'hors ligne'}${context.player.lastSeenAt ? ` (dernier contact : ${new Date(context.player.lastSeenAt).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' })})` : ''}.`);
  } else {
    lines.push("Aucun écran n’est actuellement associé à ce compte.");
  }

  const schedule = context.schedule;
  if (!schedule) {
    lines.push("Les horaires de l’écran ne sont pas disponibles pour le moment.");
  } else if (!schedule.configured) {
    lines.push("Les horaires automatiques ne sont pas activés : aucune plage hebdomadaire ne commande actuellement l’écran.");
  } else {
    const ranges = (schedule.ranges || []).map(item => `${DAYS[item.dayOfWeek] || 'jour'} ${item.start}–${item.end}`);
    lines.push(ranges.length ? `Horaires actifs : ${ranges.join(', ')}.` : "Les horaires sont activés, mais aucune plage de diffusion n’est définie.");
    if (schedule.blockBelgianHolidays) lines.push("Les jours fériés belges sont bloqués.");
  }

  const pendingPublications = (context.publications || []).filter(item => ['pending', 'active'].includes(item.status));
  if (pendingPublications.length) {
    const playlistNames = new Map((context.playlists || []).map(item => [item.id, item.name]));
    lines.push(`Diffusions prévues : ${pendingPublications.slice(0, 5).map(item => `${playlistNames.get(item.playlistId) || 'programme'} le ${new Date(item.scheduledAt).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' })}`).join(' ; ')}.`);
  } else {
    lines.push("Aucune nouvelle diffusion n’est actuellement en attente.");
  }
  return lines.join('\n');
}
const pending = new Map();
const pendingCompletions = new Map();
const requestWindows = new Map();
const ALL_ROLES = ['collaborateur', 'admin', 'superadmin'];
const ADMIN_ROLES = ['admin', 'superadmin'];

const ALLOWED_ACTIONS = {
  create_task: { method: 'POST', table: 'Tache', roles: ALL_ROLES, fields: ['titre', 'description', 'priorite', 'date_echeance', 'projet_id', 'client_id', 'assigne_a'] },
  update_task_status: { method: 'PATCH', table: 'Tache', roles: ALL_ROLES, fields: ['statut'], requiresId: true },
  create_lead: { method: 'POST', table: 'Lead', roles: ADMIN_ROLES, fields: ['nom', 'prenom', 'email', 'telephone', 'entreprise', 'source', 'notes'] },
  create_project: { method: 'POST', table: 'Projet', roles: ADMIN_ROLES, fields: ['nom', 'client_id', 'client_nom', 'description', 'statut', 'date_debut', 'date_fin_prevue', 'budget', 'progression', 'priorite'] },
  update_project: { method: 'PATCH', table: 'Projet', roles: ADMIN_ROLES, fields: ['nom', 'client_id', 'client_nom', 'description', 'statut', 'date_debut', 'date_fin_prevue', 'budget', 'progression', 'priorite'], requiresId: true },
  create_client: { method: 'POST', table: 'Client', roles: ADMIN_ROLES, fields: ['nom', 'prenom', 'email', 'telephone', 'entreprise', 'adresse', 'ville', 'code_postal', 'type_client', 'statut', 'notes'] },
  update_client: { method: 'PATCH', table: 'Client', roles: ADMIN_ROLES, fields: ['nom', 'prenom', 'email', 'telephone', 'entreprise', 'adresse', 'ville', 'code_postal', 'type_client', 'statut', 'notes'], requiresId: true },
  create_quote: { method: 'POST', table: 'Devis', roles: ADMIN_ROLES, fields: ['numero', 'objet', 'client_id', 'client_nom', 'projet_id', 'lignes', 'montant_ht', 'tva', 'montant_ttc', 'statut', 'date_validite', 'notes'] },
  update_quote: { method: 'PATCH', table: 'Devis', roles: ADMIN_ROLES, fields: ['numero', 'objet', 'client_id', 'client_nom', 'projet_id', 'lignes', 'montant_ht', 'tva', 'montant_ttc', 'statut', 'date_validite', 'notes'], requiresId: true },
  send_quote: { clientAction: '/api/billing/devis/:id/send', roles: ADMIN_ROLES, fields: [], requiresId: true },
  create_invoice: { method: 'POST', table: 'Facture', roles: ADMIN_ROLES, fields: ['numero', 'objet', 'client_id', 'client_nom', 'devis_id', 'lignes', 'montant_ht', 'tva', 'montant_ttc', 'statut', 'date_echeance', 'date_paiement', 'mode_paiement', 'notes'] },
  update_invoice: { method: 'PATCH', table: 'Facture', roles: ADMIN_ROLES, fields: ['numero', 'objet', 'client_id', 'client_nom', 'devis_id', 'lignes', 'montant_ht', 'tva', 'montant_ttc', 'statut', 'date_echeance', 'date_paiement', 'mode_paiement', 'notes'], requiresId: true },
  send_invoice: { clientAction: '/api/billing/factures/:id/send', roles: ADMIN_ROLES, fields: [], requiresId: true },
  send_email: { clientAction: '/api/emails/send', roles: ADMIN_ROLES, fields: ['mailbox', 'to', 'subject', 'text', 'replyToUid'] },
  set_auto_publish: { method: 'PATCH', table: 'SystemConfig', roles: ADMIN_ROLES, fields: ['value'], requiresId: true, fixed: { key: 'AUTO_PUBLISH_ENABLED' } },
  request_automation_reactivation: { method: 'POST', table: 'AutomationAudit', roles: ['superadmin'], fields: ['details'], fixed: { dossier: 'JS-INNOVIA', decision: 'REACTIVATION_DEMANDEE', workflow_version: 'cockpit-assistant-v1' } }
};

function agentFetch(path, options = {}) {
  if (!AGENT_KEY) throw new Error('Agent server key not configured');
  return fetch(`${AGENT_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY, ...(options.headers || {}) }
  });
}

function rateAllowed(userId) {
  const now = Date.now();
  const item = requestWindows.get(userId);
  if (!item || now >= item.resetAt) {
    requestWindows.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  item.count += 1;
  return item.count <= 20;
}

function conversationIdFrom(req) {
  const value = String(req.body?.conversation_id || req.query?.conversation_id || 'main');
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'main';
}

function sessionIdFor(req) {
  const conversationId = conversationIdFrom(req);
  return conversationId === 'main' ? `cockpit:${req.user.id}` : `cockpit:${req.user.id}:${conversationId}`;
}

async function logAction(user, action, status, details = '') {
  try {
    await agentFetch('/data/LogAction', { method: 'POST', body: JSON.stringify({
      action, module: 'assistant_personnel', statut: status, effectue_par: user.email,
      details: String(details).slice(0, 500)
    }) });
  } catch (error) {
    console.warn('[assistant] audit log failed:', error.message);
  }
}

function sanitizeLines(lines) {
  if (!Array.isArray(lines)) return undefined;
  return lines.slice(0, 50).map((line) => ({
    description: String(line?.description || '').slice(0, 500),
    quantite: Number(line?.quantite) || 0,
    prix_unitaire: Number(line?.prix_unitaire) || 0,
    total: Number(line?.total) || 0
  })).filter((line) => line.description);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function sanitizeAction(raw, user) {
  if (!raw || typeof raw !== 'object') return null;
  const definition = ALLOWED_ACTIONS[raw.type];
  if (!definition || !definition.roles.includes(user.role)) return null;
  if (definition.requiresId && !/^[a-zA-Z0-9_-]{1,100}$/.test(String(raw.id || ''))) return null;
  const payload = { ...(definition.fixed || {}) };
  for (const field of definition.fields) {
    const value = raw.payload?.[field];
    if (field === 'lignes') {
      const lines = sanitizeLines(value);
      if (lines) payload.lignes = lines;
    } else if (['string', 'number', 'boolean'].includes(typeof value)) {
      payload[field] = typeof value === 'string' ? value.slice(0, field === 'text' ? 10000 : 1000) : value;
    }
  }

  if (raw.type === 'create_task') payload.statut = 'a_faire';
  if (raw.type === 'update_task_status' && !['a_faire', 'en_cours', 'terminee', 'bloquee'].includes(payload.statut)) return null;
  if (['create_project', 'update_project'].includes(raw.type)) {
    if (payload.statut && !['en_attente', 'en_cours', 'termine', 'annule'].includes(payload.statut)) return null;
    if (payload.priorite && !['basse', 'moyenne', 'haute', 'urgente'].includes(payload.priorite)) return null;
    if (payload.progression !== undefined && (payload.progression < 0 || payload.progression > 100)) return null;
  }
  if (['create_client', 'update_client'].includes(raw.type)) {
    if (payload.email && !validEmail(payload.email)) return null;
    if (payload.type_client && !['particulier', 'professionnel', 'entreprise'].includes(payload.type_client)) return null;
    if (payload.statut && !['actif', 'inactif', 'prospect'].includes(payload.statut)) return null;
  }
  if (['create_quote', 'update_quote'].includes(raw.type) && payload.statut && !['brouillon', 'envoye', 'accepte', 'refuse', 'expire'].includes(payload.statut)) return null;
  if (['create_invoice', 'update_invoice'].includes(raw.type) && payload.statut && !['brouillon', 'envoyee', 'payee', 'en_retard', 'annulee'].includes(payload.statut)) return null;
  if (raw.type === 'send_email') {
    if (!validEmail(payload.to) || !payload.subject || !payload.text) return null;
    if (payload.mailbox && !['contact', 'julien'].includes(payload.mailbox)) return null;
    payload.mailbox = payload.mailbox || 'julien';
  }
  if (raw.type === 'set_auto_publish') payload.value = payload.value === true || payload.value === 'true' ? 'true' : 'false';
  return { type: raw.type, id: raw.id, payload, definition };
}

router.get('/history', async (req, res) => {
  try {
    const sessionId = sessionIdFor(req);
    const response = await agentFetch(`/chat/session/${encodeURIComponent(sessionId)}?limit=80`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Agent ${response.status}`);
    res.json({ conversation_id: conversationIdFrom(req), messages: Array.isArray(data.messages) ? data.messages : [] });
  } catch (error) {
    res.status(502).json({ error: 'Historique momentanément indisponible' });
  }
});

router.post('/history/append', async (req, res) => {
  const messages = (Array.isArray(req.body?.messages) ? req.body.messages : []).slice(0, 4).map((item) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: String(item?.content || '').trim().slice(0, 20000),
  })).filter((item) => item.content);
  if (!messages.length) return res.status(400).json({ error: 'Messages requis' });
  try {
    const sessionId = sessionIdFor(req);
    const response = await agentFetch(`/chat/session/${encodeURIComponent(sessionId)}/messages`, { method: 'POST', body: JSON.stringify({ messages }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Agent ${response.status}`);
    res.status(201).json({ success: true, saved: data.saved || messages.length });
  } catch (error) {
    res.status(502).json({ error: 'Mémoire momentanément indisponible' });
  }
});

router.delete('/history', async (req, res) => {
  try {
    const sessionId = sessionIdFor(req);
    const response = await agentFetch(`/chat/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Agent ${response.status}`);
    res.json({ success: true });
  } catch (error) {
    res.status(502).json({ error: 'Conversation non effacée' });
  }
});

router.post('/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 4000) : '';
  if (!message) return res.status(400).json({ error: 'Message requis' });
  if (!rateAllowed(req.user.id)) return res.status(429).json({ error: 'Trop de requêtes. Réessayez dans une minute.' });

  const sessionId = sessionIdFor(req);
  try {
    const signelyaContext = sanitizeSignelyaContext(req.body?.signelya_context);
    const asksForSchedule = /\b(programmation|programmé|programmée|planning|horaire|heures?|quand|diffusions? prévues?)\b/i.test(message);
    if (req.body?.surface === 'signelya' && asksForSchedule && signelyaContext) {
      const directReply = scheduleReply(signelyaContext);
      if (directReply) {
        await logAction(req.user, 'consultation programmation Signelya', 'succes', `Réponse directe (${conversationIdFrom(req)})`);
        return res.json({ message: directReply, conversation_id: conversationIdFrom(req), source: 'signelya-live-context' });
      }
    }
    // === Enrichissement contexte Dropbox ===
    let dropboxContext = '';
    try {
      dropboxContext = await buildDropboxContext(message);
    } catch (e) { console.warn('[assistant] Dropbox context failed:', e.message); }
    const liveContext = signelyaContext ? `\n\n[Données Signelya consultées maintenant — source prioritaire]\n${JSON.stringify(signelyaContext)}` : '';
    const enrichedMessage = SIGNELYA_ASSISTANT_CONTEXT + liveContext + '\n\n[Demande du client]\n' + message + (dropboxContext || '');
    const response = await agentFetch('/chat', { method: 'POST', body: JSON.stringify({
      message: enrichedMessage,
      session_id: sessionId,
      assistant_context: {
        name: 'Elynea',
        organisation: 'JS-Innov.IA',
        platform: 'Signelya',
        audience: 'clientele',
        mission: 'accompagnement des medias, playlists, programmations et ecrans'
      },
      user_context: { id: req.user.id, role: req.user.role, organisation: req.user.organisation, platform: 'Signelya' },
      security: { assistant: 'elynea_signelya', require_confirmation_for_actions: true },
      action_protocol: { proposed_action: { type: 'one available action', id: 'required for updates/sends', payload: {} }, action_summary: 'French confirmation summary' },
      available_actions: Object.keys(ALLOWED_ACTIONS).filter((name) => ALLOWED_ACTIONS[name].roles.includes(req.user.role))
    }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Agent ${response.status}`);

    if (data.usage || data.cost_usd !== undefined) {
      recordUsage({
        usage: data.usage || {}, model: data.model_used || data.model || data.usage?.model,
        cost_usd: data.cost_usd, request_id: data.request_id || data.id,
        processing_mode: data.processing_mode || 'standard', source: 'cockpit-assistant',
        metadata: { upstream: 'jsinnovia-agent', endpoint: '/chat', conversation_id: conversationIdFrom(req) },
      }, req.user.email).catch((error) => console.warn('[assistant] AI cost logging failed:', error.message));
    }

    const action = sanitizeAction(data.proposed_action || data.action, req.user);
    let confirmation = null;
    if (action) {
      const token = crypto.randomBytes(24).toString('hex');
      pending.set(token, { action, userId: req.user.id, expiresAt: Date.now() + 5 * 60_000 });
      confirmation = { token, type: action.type, summary: String(data.action_summary || `Confirmer l’action ${action.type}`).slice(0, 300), expires_in: 300 };
    }
    await logAction(req.user, 'conversation assistant', 'succes', action ? `Action proposée: ${action.type}` : `Réponse sans action (${conversationIdFrom(req)})`);
    res.json({ message: data.response || data.reply || data.message || 'Réponse vide', confirmation, conversation_id: conversationIdFrom(req), model_used: data.model_used || data.model });
  } catch (error) {
    await logAction(req.user, 'conversation assistant', 'erreur', error.message);
    res.status(502).json({ error: 'Elynea est momentanément indisponible' });
  }
});

router.post('/confirm', async (req, res) => {
  const token = String(req.body?.token || '');
  const item = pending.get(token);
  pending.delete(token);
  if (!item || item.userId !== req.user.id || item.expiresAt < Date.now()) return res.status(400).json({ error: 'Confirmation invalide ou expirée' });

  const { action } = item;
  if (action.definition.clientAction) {
    const completionToken = crypto.randomBytes(24).toString('hex');
    pendingCompletions.set(completionToken, { userId: req.user.id, actionType: action.type, expiresAt: Date.now() + 2 * 60_000 });
    await logAction(req.user, `action assistant autorisée: ${action.type}`, 'succes', 'En attente d’exécution par la route sécurisée');
    return res.json({ success: true, client_action: { method: 'POST', url: action.definition.clientAction.replace(':id', action.id || ''), body: action.payload }, completion_token: completionToken });
  }

  const path = `/data/${action.definition.table}${action.definition.requiresId ? `/${action.id}` : ''}`;
  try {
    const response = await agentFetch(path, { method: action.definition.method, body: JSON.stringify(action.payload), headers: { 'idempotency-key': token } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Agent ${response.status}`);
    await logAction(req.user, `action assistant: ${action.type}`, 'succes', `Cible: ${action.id || action.definition.table}`);
    res.json({ success: true, result: data });
  } catch (error) {
    await logAction(req.user, `action assistant: ${action.type}`, 'erreur', error.message);
    res.status(502).json({ error: 'Action non exécutée' });
  }
});

router.post('/complete', async (req, res) => {
  const token = String(req.body?.token || '');
  const item = pendingCompletions.get(token);
  pendingCompletions.delete(token);
  if (!item || item.userId !== req.user.id || item.expiresAt < Date.now()) return res.status(400).json({ error: 'Compte rendu invalide ou expiré' });
  const success = req.body?.success === true;
  await logAction(req.user, `action assistant: ${item.actionType}`, success ? 'succes' : 'erreur', String(req.body?.details || '').slice(0, 500));
  res.json({ success: true });
});

module.exports = router;
