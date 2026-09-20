const crypto = require('node:crypto');
const express = require('express');
const { cleanTenant } = require('./server-tenant.cjs');
const { searchProspects: searchPilotyaProspects } = require('./server-pilotyasign-prospecting.cjs');

const turns = new Map();
const confirmationCache = new Map();
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

function bareConfirmationSignal(message) {
  const text = normalize(message)
    .replace(/\b(?:merci|stp|svp|s['’]?il te plait|s il te plait)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(oui|ok|oki|okay|je confirme|confirme|confirmer|go|vas[- ]y|execute|executer)[.!\s]*$/.test(text);
}

function confirmationActionSignal(message) {
  const text = normalize(message);
  if (!text) return false;
  return /^(?:oui|ok|oki|okay|je confirme|confirme|confirmer)\b.{0,100}\b(?:envoie|envoyer|execute|executer|lance|lancer)\b/.test(text);
}

function ambiguousMessageSignal(message) {
  const source = String(message || '').trim();
  return Boolean(source) && /^[?!.…,;:\s]+$/.test(source);
}

function dispatchVerificationSignal(message) {
  const raw = String(message || '').trim();
  const text = normalize(raw);
  const mentionsTasks = /\btaches?\b/.test(text);
  const mentionsRouting = /\b(?:dispatch\w*|delegu\w*|assign\w*|rout\w*)\b/.test(text);
  const asksForState = /[?]\s*$/.test(raw)
    || /^(?:as(?: tu)?|est ce que|peux tu|pourrais tu|verifie|controle|confirme|dis moi)\b/.test(text)
    || /\b(?:etat|statut|sont elles|ont elles|bien ete)\b/.test(text);
  const asksToExecute = /\b(?:puis|et ensuite|ensuite|maintenant)\s+(?:dispatch\w*|delegu\w*|assign\w*)\b/.test(text);
  return mentionsTasks && mentionsRouting && asksForState && !asksToExecute;
}

function signageProspectingSignal(message) {
  const text = normalize(message);
  const action = /\b(?:cherche|chercher|recherche|rechercher|trouve|trouver|liste|lister|prospecte|prospecter)\b/.test(text);
  const target = /\b(?:prospect|prospects|commerce|commerces|entreprise|entreprises|magasin|magasins)\b/.test(text);
  const signage = /\b(?:ecran geant|espace c|publicite|pilotyasign|signelya)\b/.test(text);
  const contactAction = /\b(?:contacte|contacter|envoie|envoyer|mail|email|telephone|appelle|appeler)\b/.test(text);
  return action && target && signage && !contactAction;
}

function signageProspectingParams(message) {
  const raw = String(message || '');
  const text = normalize(raw);
  const radiusMatch = text.match(/\b(\d{1,2})\s*(?:km|kilometres?)\b/);
  const radiusKm = radiusMatch ? Math.max(1, Math.min(25, Number(radiusMatch[1]))) : 12;

  let sector = 'all';
  if (/\b(?:horeca|restaurant|restaurants|cafe|cafes|bar|bars|snack|snacks)\b/.test(text)) sector = 'horeca';
  else if (/\b(?:coiffeur|coiffeurs|beaute|esthetique|bien etre|fitness)\b/.test(text)) sector = 'beauty';
  else if (/\b(?:garage|garages|auto|automobile|voiture|moto|pneu|pneus)\b/.test(text)) sector = 'auto';
  else if (/\b(?:sante|pharmacie|pharmacies|dentiste|dentistes|medecin|medecins|veterinaire)\b/.test(text)) sector = 'health';
  else if (/\b(?:service|services|bureau|bureaux|artisan|artisans|profession)\b/.test(text)) sector = 'services';
  else if (/\b(?:loisir|loisirs|sport|sports|cinema|theatre)\b/.test(text)) sector = 'leisure';
  else if (/\b(?:commerce|commerces|magasin|magasins|boutique|boutiques|retail)\b/.test(text)) sector = 'retail';

  let zone = 'Dour, Belgique';
  const zoneMatch = raw.match(/(?:autour de|près de|pres de|sur|à|a)\s+([A-Za-zÀ-ÿ' -]{2,60})(?:\s+(?:dans un rayon|rayon|pour|secteur|et|$)|[,.!?]|$)/i);
  if (zoneMatch?.[1]) {
    const candidate = String(zoneMatch[1]).trim().replace(/\s+/g, ' ');
    if (candidate.length >= 2 && candidate.length <= 60) zone = `${candidate}, Belgique`;
  }

  return { zone, radius: radiusKm * 1000, sector };
}

function signageProspectingMessage(result) {
  const candidates = Array.isArray(result?.candidates) ? result.candidates.slice(0, 8) : [];
  const lines = candidates.map((candidate, index) => {
    const contact = [candidate.phone, candidate.email, candidate.website].filter(Boolean);
    return `${index + 1}. ${candidate.name} · ${candidate.category || 'commerce'} · score ${candidate.score || 0}/100${candidate.address ? ` · ${candidate.address}` : ''}${contact.length ? ` · ${contact.join(' · ')}` : ''}`;
  });
  return [
    `Recherche PilotyaSign terminée autour de ${result?.zone || 'Dour'} : ${result?.count || 0} prospect(s) public(s) trouvé(s).`,
    candidates.length ? 'Premiers résultats :' : 'Aucun résultat exploitable dans cette recherche.',
    ...lines,
    candidates.length ? 'Ouvrez PilotyaSign · Prospection dans le Cockpit pour vérifier les doublons et ajouter les commerces retenus au pipeline.' : 'Essayez un autre secteur ou un rayon différent dans PilotyaSign · Prospection.',
    'Les coordonnées publiques doivent être vérifiées avant tout contact commercial.',
  ].join('\n');
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function canonicalTaskTitle(value) {
  return normalize(value)
    .replace(/\b(delegation automatique|duplicata|copie)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
  if (status === 'awaiting_approval' || status === 'awaiting_review') return 'en_attente_validation';
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
    const key = canonicalTaskTitle(task.titre || task.title) || String(task.id || crypto.randomUUID());
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }

  const entries = [];
  for (const group of groups.values()) {
    const orderedTasks = [...group].sort((a, b) => timestamp(a.created_at || a.date_creation) - timestamp(b.created_at || b.date_creation));
    const canonical = orderedTasks[0];
    const taskIds = new Set(orderedTasks.map((task) => String(task.id || '')).filter(Boolean));
    const relatedRuns = runs
      .filter((run) => taskIds.has(String(run.task_id || '')))
      .sort((a, b) => timestamp(b.updated_at || b.started_at || b.created_at) - timestamp(a.updated_at || a.started_at || a.created_at));
    const latest = relatedRuns[0] || null;
    entries.push({
      task_id: canonical?.id || null,
      task_ids: [...taskIds],
      title: canonical?.titre || canonical?.title || 'Tâche sans titre',
      task_status: canonical?.statut || canonical?.status || null,
      priority: canonical?.priorite || canonical?.priority || null,
      duplicate_task_count: Math.max(0, orderedTasks.length - 1),
      run_count: relatedRuns.length,
      duplicate_run_count: Math.max(0, relatedRuns.length - 1),
      latest_run_id: latest?.id || null,
      latest_run_status: latest?.status || null,
      latest_run_at: latest?.updated_at || latest?.started_at || latest?.created_at || null,
      latest_agent: latest?.agent_id || latest?.provider_agent_id || latest?.provider_name || null,
      latest_error: latest?.error || null,
      dispatch_state: dispatchState(latest, now),
    });
  }

  const severity = {
    non_dispatchee: 0,
    echec: 1,
    execution_obsolete: 2,
    en_attente_prolongee: 3,
    en_attente_validation: 4,
    dispatch_en_attente: 5,
    en_execution: 6,
    resultat_non_synchronise: 7,
  };
  entries.sort((a, b) => (severity[a.dispatch_state] ?? 8) - (severity[b.dispatch_state] ?? 8) || String(a.title).localeCompare(String(b.title), 'fr'));

  const count = (state) => entries.filter((entry) => entry.dispatch_state === state).length;
  return {
    inspected_at: new Date(now).toISOString(),
    task_rows: tasks.length,
    unique_tasks: entries.length,
    duplicate_task_rows: entries.reduce((sum, entry) => sum + entry.duplicate_task_count, 0),
    duplicate_runs: entries.reduce((sum, entry) => sum + entry.duplicate_run_count, 0),
    non_dispatched: count('non_dispatchee'),
    failed: count('echec'),
    stale: count('execution_obsolete') + count('en_attente_prolongee'),
    awaiting_validation: count('en_attente_validation'),
    active: count('en_execution') + count('dispatch_en_attente'),
    unsynchronised_results: count('resultat_non_synchronise'),
    entries,
  };
}

function dispatchReportMessage(report) {
  const stateLabel = {
    non_dispatchee: 'non dispatchée',
    echec: 'échec',
    execution_obsolete: 'exécution obsolète',
    en_attente_prolongee: 'attente prolongée',
    en_attente_validation: 'attente de validation',
    dispatch_en_attente: 'dispatchée, en attente',
    en_execution: 'en exécution',
    resultat_non_synchronise: 'résultat à synchroniser',
  };
  const lines = report.entries.slice(0, 80).map((entry, index) => {
    const duplicates = entry.duplicate_task_count || entry.duplicate_run_count
      ? ` · doublons tâches=${entry.duplicate_task_count} · relances=${entry.duplicate_run_count}`
      : '';
    const error = entry.latest_error ? ` · blocage=${String(entry.latest_error).replace(/[\r\n]+/g, ' ').slice(0, 180)}` : '';
    return `${index + 1}. ${entry.title} · ${stateLabel[entry.dispatch_state] || entry.dispatch_state} · agent=${entry.latest_agent || 'aucun'} · task_id=${entry.task_id || 'absent'} · run_id=${entry.latest_run_id || 'aucun'}${duplicates}${error}`;
  });
  const hidden = report.entries.length > 80 ? `\n… ${report.entries.length - 80} autre(s) tâche(s) disponible(s) dans le rapport structuré.` : '';
  return [
    'Contrôle réel des délégations terminé, sans aucune modification.',
    `Tâches ouvertes: ${report.task_rows} ligne(s), ${report.unique_tasks} objectif(s) unique(s), ${report.duplicate_task_rows} doublon(s) de tâche.`,
    `État: ${report.active} réellement active(s), ${report.awaiting_validation} en attente de validation, ${report.stale} stagnante(s), ${report.failed} en échec, ${report.non_dispatched} non dispatchée(s), ${report.unsynchronised_results} résultat(s) non synchronisé(s).`,
    'Le statut « en cours » d’une fiche n’est pas considéré comme une preuve: seuls les agent_runs et leurs horodatages sont utilisés.',
    ...lines,
  ].join('\n') + hidden;
}

async function readAgentJson(path, organisation) {
  if (!AGENT_KEY) throw new Error('Agent server key not configured');
  const response = await fetch(`${AGENT_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': AGENT_KEY,
      'x-organisation-id': organisation,
    },
    signal: AbortSignal.timeout(45_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.message || `Agent HTTP ${response.status}`);
  return data;
}

async function inspectTaskDispatches(req) {
  const organisation = cleanTenant(req.user?.organisation) || 'jsinnovia';
  const [tasks, runs] = await Promise.all([
    readAgentJson('/data/Tache?limit=500', organisation),
    readAgentJson('/agent-runs?limit=1000', organisation),
  ]);
  return summarizeTaskDispatches(tasks, runs);
}

function officialAssistantText(value) {
  return String(value || '')
    .replace(/\bNOVA\b/g, ELYNEA_NAME)
    .replace(/\bNova\b/g, ELYNEA_NAME);
}

function stripUnbackedConfirmationLanguage(value) {
  const cleaned = officialAssistantText(value)
    .replace(/[^.!?\n]*(?:veuillez|merci de)\s+confirmer[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*confirmez[- ]?vous\s+que\s+je[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*cliquez[^.!?\n]*(?:bouton|confirmer)[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*utilisez\s+le\s+bouton[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*souhaitez[- ]?vous\s+que\s+je\s+(?:lance|ex[eé]cute|proc[eè]de)[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*(?:l['’]?email|le\s+mail|le\s+message)[^.!?\n]*(?:pr[eê]t[^.!?\n]*[àa]\s+[eê]tre\s+envoy[eé]|pr[eê]t[^.!?\n]*pour\s+l['’]?envoi)[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*l['’]?envoi[^.!?\n]*(?:en\s+attente|attend)[^.!?\n]*confirm[^.!?\n]*[.!?]?/gi, '')
    .replace(/[^.!?\n]*(?:souhaitez[- ]?vous|veux[- ]?tu)\s+que\s+je\s+(?:le\s+)?fasse(?:\s+maintenant)?[^.!?\n]*[.!?]?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned || 'Aucune action exécutable n’a été préparée pour cette demande. Reformulez la cible si une action doit réellement être lancée.';
}

function normalizeAssistantPayload(req, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const output = { ...payload };
  const hasConfirmation = Boolean(output.confirmation?.token);
  const shouldStrip = req.method === 'POST' && req.path === '/chat' && !hasConfirmation;
  for (const key of ['message', 'response', 'reply', 'content', 'text']) {
    if (typeof output[key] === 'string') {
      output[key] = shouldStrip ? stripUnbackedConfirmationLanguage(output[key]) : officialAssistantText(output[key]);
    }
  }
  if (output.display && typeof output.display === 'object') {
    output.display = { ...output.display };
    if (/^nova$/i.test(String(output.display.assistant_name || ''))) output.display.assistant_name = ELYNEA_NAME;
  }
  if (output.confirmation && typeof output.confirmation === 'object') {
    output.confirmation = {
      ...output.confirmation,
      summary: officialAssistantText(output.confirmation.summary),
    };
  }
  return output;
}

function rememberConfirmation(req, confirmation) {
  if (!confirmation?.token) return;
  const ttl = Math.max(30, Math.min(600, Number(confirmation.expires_in || 300))) * 1000;
  confirmationCache.set(scopeFor(req), {
    token: String(confirmation.token),
    request_nonce: confirmation.request_nonce || null,
    expiresAt: Date.now() + ttl,
  });
}

function cachedConfirmation(req) {
  const key = scopeFor(req);
  const item = confirmationCache.get(key);
  if (!item) return null;
  if (item.expiresAt < Date.now()) {
    confirmationCache.delete(key);
    return null;
  }
  return item;
}

function deleteConfirmationByToken(token) {
  const needle = String(token || '');
  if (!needle) return;
  for (const [key, item] of confirmationCache) {
    if (item.token === needle) confirmationCache.delete(key);
  }
}

const router = express.Router();
router.use(async (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const normalizedPayload = normalizeAssistantPayload(req, payload);
    if (normalizedPayload?.confirmation?.token) rememberConfirmation(req, normalizedPayload.confirmation);
    if (req.method === 'POST' && req.path === '/confirm') deleteConfirmationByToken(req.body?.token);
    return originalJson(normalizedPayload);
  };

  if (req.method === 'POST' && req.path === '/chat' && typeof req.body?.message === 'string' && req.body.message.trim()) {
    const message = req.body.message.trim();

    // Si une confirmation structurée existe, "oui merci", "je confirme" ou
    // "je confirme et envoie" consomme le vrai jeton. Sans jeton, une phrase
    // combinant confirmation + action continue vers l'assistant afin qu'il
    // reconstruise l'action depuis le dernier brouillon au lieu de boucler.
    const cached = cachedConfirmation(req);
    const confirmationOnly = bareConfirmationSignal(message);
    const confirmationWithAction = confirmationActionSignal(message);
    if ((confirmationOnly || confirmationWithAction) && cached?.token) {
      req.url = '/confirm';
      req.body = {
        ...req.body,
        token: cached.token,
      };
      return next();
    }
    if (confirmationOnly) {
      return res.json({
        message: 'Aucune action exécutable n’est en attente. Elynea ne vous demandera plus de confirmer sans bouton actif. Reformulez la cible si nécessaire.',
        confirmation: null,
      });
    }

    confirmationCache.delete(scopeFor(req));
    beginRequest(req);

    if (ambiguousMessageSignal(message)) {
      return res.json({ message: 'Message trop ambigu pour exécuter une action. Aucune tâche, aucun projet et aucune donnée n’ont été modifiés.', confirmation: null });
    }

    if (dispatchVerificationSignal(message)) {
      try {
        const report = await inspectTaskDispatches(req);
        const reportMessage = dispatchReportMessage(report);
        return res.json({
          message: reportMessage,
          response: reportMessage,
          confirmation: null,
          inspection_only: true,
          dispatch_report: report,
          conversation_id: String(req.body?.conversation_id || 'main'),
        });
      } catch (error) {
        return res.status(502).json({
          error: 'Contrôle des délégations impossible',
          details: String(error.message || error).slice(0, 300),
          confirmation: null,
        });
      }
    }

    const canProspectSignage = req.user?.role === 'superadmin'
      || (['admin', 'collaborateur'].includes(req.user?.role)
        && Array.isArray(req.user?.permissions)
        && req.user.permissions.includes('pilotyasign_prospecting'));

    if (canProspectSignage && signageProspectingSignal(message)) {
      try {
        const params = signageProspectingParams(message);
        const report = await searchPilotyaProspects(params);
        const reportMessage = signageProspectingMessage(report);
        return res.json({
          message: reportMessage,
          response: reportMessage,
          confirmation: null,
          inspection_only: true,
          pilotyasign_path: '/pilotyasign',
          prospecting_report: report,
          conversation_id: String(req.body?.conversation_id || 'main'),
        });
      } catch (error) {
        return res.status(502).json({
          error: 'Recherche de prospects PilotyaSign impossible',
          details: String(error.message || error).slice(0, 300),
          confirmation: null,
        });
      }
    }
  }
  next();
});

router.post('/cancel', (req, res) => {
  const scope = scopeFor(req);
  confirmationCache.delete(scope);
  if (!req.body?.request_nonce || turns.get(scope)?.nonce === req.body.request_nonce) turns.delete(scope);
  res.json({ success: true, confirmation: null });
});

module.exports = {
  router,
  beginRequest,
  isCurrentTurn,
  requestedTaskStatus,
  taskStatusMatches,
  bareConfirmationSignal,
  confirmationActionSignal,
  ambiguousMessageSignal,
  dispatchVerificationSignal,
  signageProspectingSignal,
  signageProspectingParams,
  signageProspectingMessage,
  summarizeTaskDispatches,
  dispatchReportMessage,
  stripUnbackedConfirmationLanguage,
  normalizeAssistantPayload,
};