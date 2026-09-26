const crypto = require('node:crypto');
const express = require('express');
const { cleanTenant } = require('./server-tenant.cjs');
const { stripInjectedContext } = require('./server-immediate-execution-policy.cjs');

const turns = new Map();
const confirmationCache = new Map();
const confirmationReceipts = new Map();
const lastReceipts = new Map();
const AGENT_URL = String(process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app').replace(/\/$/, '');
const AGENT_KEY = String(process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '').trim();
const STALE_RUNNING_MS = 30 * 60 * 1000;
const STALE_PENDING_MS = 24 * 60 * 60 * 1000;
const ELYNEA_NAME = 'Elynea';
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function conversationIdFor(req) {
  return String(req.body?.conversation_id || req.query?.conversation_id || 'main').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'main';
}
function scopeFor(req) {
  return `${cleanTenant(req.user?.organisation)}:${req.user?.id}:${conversationIdFor(req)}`;
}
function beginRequest(req) {
  if (req.novaTurn) return req.novaTurn;
  const now = Date.now();
  for (const [key, value] of turns) if (value.expiresAt < now) turns.delete(key);
  const turn = { scope: scopeFor(req), nonce: crypto.randomUUID(), expiresAt: now + 5 * 60_000 };
  turns.set(turn.scope, turn);
  req.novaTurn = turn;
  return turn;
}
function isCurrentTurn(turn, user) {
  const sameAccount = !user || turn?.scope.startsWith(`${cleanTenant(user.organisation)}:${user.id}:`);
  return Boolean(sameAccount && turn && turn.expiresAt > Date.now() && turns.get(turn.scope)?.nonce === turn.nonce);
}
function requestedTaskStatus(message) {
  const text = normalize(message);
  if (/\b(comment|pourquoi|explique|verifie|analyse|delegue|deleguer|assigne|confie)\b|\bne\b.*\bpas\b|\bsans\b/.test(text)) return null;
  if (!/\b(mets?|mettre|mettez|passe[rz]?|marque[rz]?|change[rz]?|modifie[rz]?|termine[rz]?|bloque[rz]?|demarre[rz]?|reprends?|actualise[rz]?)\b/.test(text)) return null;
  const statuses = [
    ['a_faire', /\ba[_ ]faire\b/], ['en_cours', /\ben[_ ]cours\b|\bdemarre[rz]?\b/],
    ['terminee', /\btermine(?:e|es|s|r|z)?\b/], ['bloquee', /\bbloque(?:e|es|s|r|z)?\b/],
  ].filter(([, pattern]) => pattern.test(text)).map(([status]) => status);
  return statuses.length === 1 ? statuses[0] : null;
}
function taskStatusMatches(message, action, task) {
  const text = normalize(message), title = normalize(task?.titre);
  const id = String(action.id || '');
  const idMentioned = id && new RegExp(`(?:^|[^a-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9_-])`, 'i').test(text);
  const titleMentioned = title.length >= 8 && text.includes(title) && /\btache\b/.test(text);
  return task?.id === action.id && requestedTaskStatus(message) === action.payload.statut && Boolean(idMentioned || titleMentioned);
}
function confirmationText(message) {
  return normalize(stripInjectedContext(message)).replace(/[’']/g, ' ')
    .replace(/\b(?:merci|stp|svp|s il te plait|s il vous plait)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function bareConfirmationSignal(message) {
  const text = confirmationText(message);
  // A compound acknowledgement still confirms the same pending proposal, not a new request.
  return /^(?:(?:oui|ok|oki|okay)(?:[,\s]+(?:je confirme|confirme|confirmer))?|je confirme|confirme|confirmer|go|vas[- ]y|execute|executer)(?:\s+(?:immediatement|maintenant|tout de suite))?[.!\s]*$/.test(text);
}
function confirmationActionSignal(message) {
  const text = confirmationText(message);
  if (!text || /\b(?:pas|non|annule|annuler|mais|plutot|sauf|sans)\b/.test(text)) return false;
  if (!/^(?:oui|ok|oki|okay|je confirme|confirme|confirmer)\b/.test(text)) return false;
  // Preserve explicit send/execute recovery. Creation words alone are not an authorization.
  if (/^(?:oui|ok|oki|okay|je confirme|confirme|confirmer)\b.{0,180}\b(?:envoie|envoyer|envoi|execute|executer|execution)\b/.test(text)) return true;
  // Named media confirmations use the cached proposal and its existing target/project guards.
  // New quote/invoice/task/project requests must stay with their own intent handlers.
  return /\b(?:videos?|images?|visuels?|tiktok|montage|animation)\b/.test(text)
    && !/\b(?:devis|factures?|taches?|projets?)\b/.test(text)
    && /^(?:oui|ok|oki|okay|je confirme|confirme|confirmer)\b.{0,180}\b(?:lance|lancer|lancement|creation|realisation|generation)\b/.test(text);
}
function confirmationTargetMatches(message, confirmation) {
  if (bareConfirmationSignal(message)) return true;
  const text = confirmationText(message);
  const type = normalize(confirmation?.type).replace(/_/g, ' ');
  const summary = normalize(confirmation?.summary).replace(/[^a-z0-9]+/g, ' ');
  const domains = [
    ['video', /\b(?:video|videos|tiktok|montage|animation)\b/],
    ['image', /\b(?:image|images|visuel|visuels)\b/],
    ['email', /\b(?:email|emails|mail|courriel)\b/],
    ['invoice', /\b(?:facture|factures)\b/],
    ['quote', /\bdevis\b/], ['task', /\btache\b/], ['project', /\bprojet\b/],
  ];
  const requested = domains.filter(([, pattern]) => pattern.test(text)).map(([domain]) => domain);
  if (requested.some(domain => !type.includes(domain))) return false;
  const neutral = new Set(('oui ok oki okay je tu vous confirme confirmer creation realisation generation execution executer execute lance lancer lancement envoi envoie envoyer action maintenant immediatement suite de du des le la les un une cette ce cet ces et pour a au aux en video videos image images visuel visuels email emails mail courriel facture factures devis tache projet merci s il te plait peux pouvez tu veuillez proceder realise realiser genere generer faire fais tiktok').split(' '));
  const targetWords = text.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(word => word.length > 1 && !neutral.has(word));
  const summaryWords = new Set(summary.split(' '));
  return targetWords.every(word => summaryWords.has(word));
}
function ambiguousMessageSignal(message) {
  const source = String(message || '').trim();
  return Boolean(source) && /^[?!.…,;:\s]+$/.test(source);
}
function dispatchVerificationSignal(message) {
  const raw = stripInjectedContext(message);
  const text = normalize(raw);
  const mentionsTasks = /\btaches?\b/.test(text);
  const mentionsRouting = /\b(?:dispatch\w*|delegu\w*|assign\w*|rout\w*)\b/.test(text);
  const asksForState = /[?]\s*$/.test(raw)
    || /^(?:as(?: tu)?|est ce que|peux tu|pourrais tu|verifie|controle|confirme|dis moi)\b/.test(text)
    || /\b(?:etat|statut|sont elles|ont elles|bien ete)\b/.test(text);
  const asksToExecute = /\b(?:puis|et ensuite|ensuite|maintenant)\s+(?:dispatch\w*|delegu\w*|assign\w*)\b/.test(text);
  return mentionsTasks && mentionsRouting && asksForState && !asksToExecute;
}
function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}
function canonicalTaskTitle(value) {
  return normalize(value).replace(/\b(delegation automatique|duplicata|copie)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}
function normalizedRunStatus(run) {
  return normalize(run?.status).replace(/\s+/g, '_');
}
function dispatchState(run, now = Date.now()) {
  if (!run) return 'non_dispatchee';
  const status = normalizedRunStatus(run);
  const changedAt = timestamp(run.updated_at || run.started_at || run.created_at);
  const age = changedAt ? now - changedAt : Number.POSITIVE_INFINITY;
  if (status === 'running' && age > STALE_RUNNING_MS) return 'execution_obsolete';
  if (['pending', 'queued', 'dispatching', 'dispatched'].includes(status) && age > STALE_PENDING_MS) return 'en_attente_prolongee';
  // A legacy approval is not evidence that a worker started or produced an artifact.
  if (['awaiting_approval', 'awaiting_review', 'approval_granted'].includes(status)) return 'en_attente_validation';
  if (status === 'running') return 'en_execution';
  if (['pending', 'queued', 'dispatching', 'dispatched'].includes(status)) return 'dispatch_en_attente';
  if (status === 'completed') return 'resultat_non_synchronise';
  if (['failed', 'cancelled', 'canceled'].includes(status)) return 'echec';
  return status || 'inconnu';
}
function summarizeTaskDispatches(tasksPayload, runsPayload, now = Date.now()) {
  const tasks = rowsFrom(tasksPayload).filter((task) => !['terminee', 'terminée', 'archivee', 'archivée'].includes(normalize(task.statut || task.status)));
  const runs = rowsFrom(runsPayload);
  const groups = new Map();
  for (const task of tasks) {
    // Similar titles in separate projects are not duplicates of the same operation.
    const key = JSON.stringify([task.organisation_id || '', task.projet_id || task.project_id || '', task.client_id || '', canonicalTaskTitle(task.titre || task.title) || String(task.id || crypto.randomUUID())]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  const entries = [];
  for (const group of groups.values()) {
    const orderedTasks = [...group].sort((a, b) => timestamp(a.created_at || a.date_creation) - timestamp(b.created_at || b.date_creation));
    const canonical = orderedTasks[0];
    const taskIds = new Set(orderedTasks.map((task) => String(task.id || '')).filter(Boolean));
    const relatedRuns = runs.filter((run) => taskIds.has(String(run.task_id || '')))
      .sort((a, b) => timestamp(b.updated_at || b.started_at || b.created_at) - timestamp(a.updated_at || a.started_at || a.created_at));
    const latest = relatedRuns[0] || null;
    entries.push({
      task_id: canonical?.id || null, task_ids: [...taskIds], title: canonical?.titre || canonical?.title || 'Tâche sans titre',
      task_status: canonical?.statut || canonical?.status || null, priority: canonical?.priorite || canonical?.priority || null,
      duplicate_task_count: Math.max(0, orderedTasks.length - 1), run_count: relatedRuns.length,
      duplicate_run_count: Math.max(0, relatedRuns.length - 1), latest_run_id: latest?.id || null,
      latest_run_status: latest?.status || null, latest_run_at: latest?.updated_at || latest?.started_at || latest?.created_at || null,
      latest_agent: latest?.agent_id || latest?.provider_agent_id || latest?.provider_name || null,
      latest_error: latest?.error || null, dispatch_state: dispatchState(latest, now),
    });
  }
  const severity = { non_dispatchee: 0, echec: 1, execution_obsolete: 2, en_attente_prolongee: 3, en_attente_validation: 4, dispatch_en_attente: 5, en_execution: 6, resultat_non_synchronise: 7 };
  entries.sort((a, b) => (severity[a.dispatch_state] ?? 8) - (severity[b.dispatch_state] ?? 8) || String(a.title).localeCompare(String(b.title), 'fr'));
  const count = (state) => entries.filter((entry) => entry.dispatch_state === state).length;
  return {
    inspected_at: new Date(now).toISOString(), task_rows: tasks.length, unique_tasks: entries.length,
    duplicate_task_rows: entries.reduce((sum, entry) => sum + entry.duplicate_task_count, 0),
    duplicate_runs: entries.reduce((sum, entry) => sum + entry.duplicate_run_count, 0),
    non_dispatched: count('non_dispatchee'), failed: count('echec'), stale: count('execution_obsolete') + count('en_attente_prolongee'),
    awaiting_validation: count('en_attente_validation'), active: count('en_execution') + count('dispatch_en_attente'),
    unsynchronised_results: count('resultat_non_synchronise'), entries,
  };
}
function dispatchReportMessage(report) {
  const stateLabel = { non_dispatchee: 'non dispatchée', echec: 'échec', execution_obsolete: 'exécution obsolète', en_attente_prolongee: 'attente prolongée', en_attente_validation: 'attente de validation', dispatch_en_attente: 'dispatchée, en attente', en_execution: 'en exécution', resultat_non_synchronise: 'résultat à synchroniser' };
  const lines = report.entries.slice(0, 80).map((entry, index) => {
    const duplicates = entry.duplicate_task_count || entry.duplicate_run_count ? ` · doublons tâches=${entry.duplicate_task_count} · relances=${entry.duplicate_run_count}` : '';
    const error = entry.latest_error ? ` · blocage=${String(entry.latest_error).replace(/[\r\n]+/g, ' ').slice(0, 180)}` : '';
    return `${index + 1}. ${entry.title} · ${stateLabel[entry.dispatch_state] || entry.dispatch_state} · agent=${entry.latest_agent || 'aucun'} · task_id=${entry.task_id || 'absent'} · run_id=${entry.latest_run_id || 'aucun'}${duplicates}${error}`;
  });
  const hidden = report.entries.length > 80 ? `\n… ${report.entries.length - 80} autre(s) tâche(s) disponible(s) dans le rapport structuré.` : '';
  return [
    'Contrôle réel des délégations terminé, sans aucune modification.',
    `Tâches ouvertes: ${report.task_rows} ligne(s), ${report.unique_tasks} objectif(s) unique(s), ${report.duplicate_task_rows} doublon(s) de tâche.`,
    `État: ${report.active} réellement active(s), ${report.awaiting_validation} en attente de validation, ${report.stale} stagnante(s), ${report.failed} en échec, ${report.non_dispatched} non dispatchée(s), ${report.unsynchronised_results} résultat(s) non synchronisé(s).`,
    'Le statut « en cours » d’une fiche n’est pas considéré comme une preuve: seuls les agent_runs et leurs horodatages sont utilisés.', ...lines,
  ].join('\n') + hidden;
}
async function readAgentJson(path, organisation) {
  if (!AGENT_KEY) throw new Error('Agent server key not configured');
  const response = await fetch(`${AGENT_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY, 'x-organisation-id': organisation },
    signal: AbortSignal.timeout(45_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.message || `Agent HTTP ${response.status}`);
  return data;
}
async function inspectTaskDispatches(req) {
  const organisation = cleanTenant(req.user?.organisation) || 'jsinnovia';
  const [tasks, runs] = await Promise.all([readAgentJson('/data/Tache?limit=500', organisation), readAgentJson('/agent-runs?limit=1000', organisation)]);
  return summarizeTaskDispatches(tasks, runs);
}
function officialAssistantText(value) {
  return String(value || '').replace(/\bNOVA\b/g, ELYNEA_NAME).replace(/\bNova\b/g, ELYNEA_NAME);
}
function stripUnbackedConfirmationLanguage(value) {
  const cleaned = officialAssistantText(value)
    .replace(/[^.!?\n]*(?:veuillez|merci de|je (?:vous|te) demande de)\s+confirmer[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*(?:confirmez[- ]?vous|confirmes[- ]?tu)\s+que\s+je[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*cliquez[^.!?\n]*(?:bouton|confirmer)[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*utilisez\s+le\s+bouton[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*(?:souhaitez[- ]?vous|souhaites[- ]?tu|veux[- ]?tu)\s+(?:confirmer|que\s+je\s+(?:lance|ex[eé]cute|proc[eè]de))[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*(?:l['’]?email|le\s+mail|le\s+message)[^.!?\n]*(?:pr[eê]t[^.!?\n]*[àa]\s+[eê]tre\s+envoy[eé]|pr[eê]t[^.!?\n]*pour\s+l['’]?envoi)[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*(?:en\s+attente|attend)[^.!?\n]*confirm[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*(?:souhaitez[- ]?vous|veux[- ]?tu)\s+que\s+je\s+(?:le\s+)?fasse(?:\s+maintenant)?[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*je\s+confirme\s+l['’]action[^.!?\n]*[.!?]?/gi, '')
    .replace(/\n{3,}/g, '\n\n').trim();
  return cleaned || 'Aucune action exécutable n’a été préparée pour cette demande. Reformulez la cible si une action doit réellement être lancée.';
}
function normalizeAssistantPayload(req, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const output = { ...payload };
  const hasConfirmation = Boolean(output.confirmation?.token);
  const shouldStrip = req.method === 'POST' && req.path === '/chat' && !hasConfirmation;
  for (const key of ['message', 'response', 'reply', 'content', 'text']) {
    if (typeof output[key] === 'string') output[key] = shouldStrip ? stripUnbackedConfirmationLanguage(output[key]) : officialAssistantText(output[key]);
  }
  if (output.display && typeof output.display === 'object') {
    output.display = { ...output.display };
    if (/^nova$/i.test(String(output.display.assistant_name || ''))) output.display.assistant_name = ELYNEA_NAME;
  }
  if (output.confirmation && typeof output.confirmation === 'object') output.confirmation = { ...output.confirmation, summary: officialAssistantText(output.confirmation.summary) };
  if (req.method === 'POST' && req.path === '/complete' && output.success === true) {
    output.report_received = true;
    output.execution_status = req.body?.success === true ? 'reported_success' : 'reported_failure';
    output.verified = false; // A renderer boolean is a report, not a server-side artifact check.
  }
  return output;
}
function cleanCaches() {
  const now = Date.now();
  for (const [key, item] of confirmationCache) if (item.expiresAt < now) confirmationCache.delete(key);
  for (const [key, item] of confirmationReceipts) if (item.expiresAt < now) confirmationReceipts.delete(key);
  for (const [key, item] of lastReceipts) if (item.expiresAt < now) lastReceipts.delete(key);
}
function ownerFor(req) { return JSON.stringify([cleanTenant(req.user?.organisation), String(req.user?.id || '')]); }
function rememberConfirmation(req, confirmation) {
  if (!confirmation?.token) return;
  cleanCaches();
  if (confirmationCache.size >= 500 && !confirmationCache.has(scopeFor(req))) return;
  const ttl = Math.max(30, Math.min(600, Number(confirmation.expires_in || 300))) * 1000;
  confirmationCache.set(scopeFor(req), {
    id: crypto.randomUUID(), token: String(confirmation.token), request_nonce: confirmation.request_nonce || null,
    type: confirmation.type || '', summary: confirmation.summary || '', owner: ownerFor(req),
    conversationId: conversationIdFor(req), projectId: String(req.body?.project_id || ''), expiresAt: Date.now() + ttl,
  });
}
function cachedConfirmation(req) {
  cleanCaches();
  return confirmationCache.get(scopeFor(req)) || null;
}
function sameProject(req, item) { return String(req.body?.project_id || '') === String(item?.projectId || ''); }
function receiptKey(req, token) { return JSON.stringify([ownerFor(req), String(token)]); }
function receiptStatus(payload, statusCode = 200) {
  if (statusCode >= 400 || payload?.error || payload?.success === false) return 'failed';
  if (payload?.client_action) return 'dispatched';
  const status = String(payload?.result?.status || payload?.result?.statut || '').toLowerCase();
  if (['queued', 'pending', 'accepted', 'running', 'processing'].includes(status)) return status;
  if (payload?.success === true && payload?.execution && payload?.result) return 'completed';
  return 'unverified';
}
function replayReceipt(item) {
  const labels = {
    running: 'La première requête est encore en cours de traitement.',
    dispatched: 'L’action a déjà été transmise à son exécuteur. Le résultat final n’est pas encore vérifié.',
    queued: 'La tâche a été placée en file d’attente. Ce statut ne signifie pas que le fichier est prêt.',
    pending: 'La tâche est en attente.', accepted: 'La demande a été acceptée, sans résultat final vérifié.',
    processing: 'Le dernier état reçu indique un traitement en cours.',
    completed: 'Le serveur a confirmé l’exécution de cette action.',
    failed: 'La requête a échoué. Aucun nouvel essai automatique n’a été déclenché.',
    reported_success: 'Le navigateur a signalé une réussite ; le fichier final doit encore être vérifié côté serveur.',
    reported_failure: 'Le navigateur a signalé un échec.',
    unverified: 'Le résultat de cette action n’a pas été vérifié.',
  };
  return {
    message: `${labels[item.status] || labels.unverified} Aucun doublon n’a été lancé. Dernier retour : ${item.observedAt}.`,
    confirmation: null, duplicate: true, execution_id: item.id, execution_status: item.status,
    observed_at: item.observedAt, current_status_verified: false,
  };
}
const router = express.Router();
router.use(async (req, res, next) => {
  cleanCaches();
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const normalizedPayload = normalizeAssistantPayload(req, payload);
    if (normalizedPayload?.confirmation?.token) {
      rememberConfirmation(req, normalizedPayload.confirmation);
      normalizedPayload.confirmation.execution_id = cachedConfirmation(req)?.id || null;
    }
    if (req.method === 'POST' && req.path === '/confirm') {
      const item = confirmationReceipts.get(receiptKey(req, req.body?.token));
      if (item && normalizedPayload && typeof normalizedPayload === 'object' && !normalizedPayload.duplicate) {
        item.status = receiptStatus(normalizedPayload, res.statusCode);
        item.observedAt = new Date().toISOString();
        item.completionToken = normalizedPayload?.completion_token || null;
        normalizedPayload.execution_id = item.id;
        normalizedPayload.execution_status = item.status;
        lastReceipts.set(item.scope, item);
      }
      const cached = confirmationCache.get(scopeFor(req));
      if (cached?.token === String(req.body?.token || '')) confirmationCache.delete(scopeFor(req));
    }
    if (req.method === 'POST' && req.path === '/complete' && res.statusCode < 400) {
      for (const item of confirmationReceipts.values()) {
        if (item.owner === ownerFor(req) && item.completionToken === String(req.body?.token || '') && item.completionToken) {
          item.status = normalizedPayload.execution_status;
          item.observedAt = new Date().toISOString();
          item.completionToken = null;
        }
      }
    }
    return originalJson(normalizedPayload);
  };
  if (req.method === 'POST' && req.path === '/chat' && typeof req.body?.message === 'string' && req.body.message.trim()) {
    const message = stripInjectedContext(req.body.message).trim();
    const cached = cachedConfirmation(req);
    const confirmationOnly = bareConfirmationSignal(message);
    const confirmationWithAction = confirmationActionSignal(message);
    if ((confirmationOnly || confirmationWithAction) && cached?.token) {
      const differentProject = !sameProject(req, cached);
      if (differentProject || !confirmationTargetMatches(message, cached)) {
        return res.json({ message: 'Cette confirmation ne correspond pas à la cible de l’action préparée. Aucune exécution lancée.', confirmation: null, execution_status: 'target_mismatch' });
      }
      req.url = '/confirm';
      req.body = { ...req.body, token: cached.token };
    } else if (confirmationOnly || confirmationWithAction) {
      const last = lastReceipts.get(scopeFor(req));
      if (last && sameProject(req, last) && confirmationTargetMatches(message, last)) return res.json(replayReceipt(last));
      // Preserve the existing explicit email-send recovery from a server-held draft.
      if (!last && !confirmationOnly && /\b(?:envoie|envoyer)\b/.test(confirmationText(message))) {
        beginRequest(req);
        return next();
      }
      return res.json({ message: 'Aucune action exécutable n’est en attente dans cette conversation. Aucune génération ni autre opération n’a été lancée par cette confirmation.', confirmation: null, execution_status: 'not_prepared' });
    } else if (/^(?:queued|queued\.?\s*(?:ca veut dire quoi|c est quoi)|ce qui veut dire|c['’ ]est pret|c['’ ]est fini|c est pret oui)[?.!\s]*$/.test(normalize(message))) {
      const last = lastReceipts.get(scopeFor(req));
      if (last && sameProject(req, last)) return res.json(replayReceipt(last));
      if (cached && sameProject(req, cached)) return res.json({ message: 'Une proposition existe, mais elle attend encore son autorisation. Aucun résultat final n’est vérifié.', confirmation: null, execution_status: 'awaiting_confirmation' });
      return res.json({ message: /queued/.test(normalize(message)) ? 'Queued signifie « en file d’attente ». Cela ne prouve ni un démarrage du moteur ni un fichier terminé.' : 'Je n’ai pas de résultat technique rattaché à cette conversation permettant de déclarer le travail terminé.', confirmation: null, execution_status: 'unverified' });
    } else {
      confirmationCache.delete(scopeFor(req));
      lastReceipts.delete(scopeFor(req));
      beginRequest(req);
      if (ambiguousMessageSignal(message)) return res.json({ message: 'Message trop ambigu pour exécuter une action. Aucune tâche, aucun projet et aucune donnée n’ont été modifiés.', confirmation: null });
      if (dispatchVerificationSignal(message)) {
        try {
          const report = await inspectTaskDispatches(req);
          const reportMessage = dispatchReportMessage(report);
          return res.json({ message: reportMessage, response: reportMessage, confirmation: null, inspection_only: true, dispatch_report: report, conversation_id: String(req.body?.conversation_id || 'main') });
        } catch (error) {
          return res.status(502).json({ error: 'Contrôle des délégations impossible', details: String(error.message || error).slice(0, 300), confirmation: null });
        }
      }
    }
  }
  if (req.method === 'POST' && req.path === '/confirm') {
    const token = String(req.body?.token || '');
    const key = receiptKey(req, token);
    const existing = confirmationReceipts.get(key);
    if (existing) {
      if ((req.body?.project_id !== undefined && !sameProject(req, existing)) || (req.body?.conversation_id && conversationIdFor(req) !== existing.conversationId)) return res.status(400).json({ error: 'Cette action appartient à une autre conversation.' });
      return res.status(existing.status === 'running' ? 202 : 200).json(replayReceipt(existing));
    }
    const cached = [...confirmationCache.values()].find(item => item.token === token && item.owner === ownerFor(req) && (!req.body?.conversation_id || item.conversationId === conversationIdFor(req)));
    if (!cached || !token || (req.body?.project_id !== undefined && !sameProject(req, cached))) return res.status(400).json({ error: 'Confirmation invalide ou expirée', confirmation: null });
    if (confirmationReceipts.size >= 500) return res.status(429).json({ error: 'Trop d’actions en attente de rapprochement. Aucune nouvelle exécution.' });
    req.body.conversation_id = cached.conversationId;
    const item = {
      id: cached.id, owner: ownerFor(req), conversationId: cached.conversationId,
      scope: scopeFor(req), type: cached.type, summary: cached.summary, projectId: cached.projectId, status: 'running', observedAt: new Date().toISOString(), expiresAt: Date.now() + 10 * 60_000,
    };
    confirmationReceipts.set(key, item);
    lastReceipts.set(item.scope, item);
  }
  next();
});
router.post('/cancel', (req, res) => {
  const scope = scopeFor(req);
  confirmationCache.delete(scope);
  lastReceipts.delete(scope);
  if (!req.body?.request_nonce || turns.get(scope)?.nonce === req.body.request_nonce) turns.delete(scope);
  res.json({ success: true, confirmation: null });
});
module.exports = {
  router, beginRequest, isCurrentTurn, requestedTaskStatus, taskStatusMatches, bareConfirmationSignal,
  confirmationActionSignal, confirmationTargetMatches, ambiguousMessageSignal, dispatchVerificationSignal,
  summarizeTaskDispatches, dispatchReportMessage, stripUnbackedConfirmationLanguage, normalizeAssistantPayload, receiptStatus,
};
