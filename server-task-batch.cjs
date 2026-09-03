const crypto = require('node:crypto');

const {
  executeBusinessTask,
  executeProjectTask,
  executeSiteTask,
  executeVideoTask,
  resolveNovaExecutor,
} = require('./server-nova-executors.cjs');

const PRIORITIES = new Set(['basse', 'moyenne', 'haute', 'urgente']);
// Les runs en attente d'une validation ou d'une revue restent actifs. Les considérer
// comme terminés recrée le même dispatch à chaque passage de l'autopilote.
const ACTIVE_STATUSES = new Set([
  'pending',
  'queued',
  'dispatching',
  'dispatched',
  'running',
  'awaiting_approval',
  'awaiting_review',
]);
const STALE_RUNNING_MS = 30 * 60 * 1000;
const MAX_BATCH_TASKS = 250;

function cleanText(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
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

function canonicalTaskTitle(value) {
  return cleanText(value, 240)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalTaskKey(task = {}) {
  const title = canonicalTaskTitle(task.titre || task.title);
  const client = canonicalTaskTitle(task.client_id || task.client_nom);
  const project = canonicalTaskTitle(task.projet_id || task.projet_nom);
  return [title, client, project].join('|');
}

function taskStatusRank(task = {}) {
  const status = canonicalTaskTitle(task.statut || task.status);
  if (status === 'en cours') return 0;
  if (status === 'a faire') return 1;
  if (status === 'bloquee') return 2;
  return 3;
}

function taskTimestamp(task = {}) {
  return Date.parse(task.updated_at || task.created_at || task.created_date || '') || 0;
}

function preferredCanonicalTask(current, candidate) {
  if (!current) return candidate;
  const rank = taskStatusRank(candidate) - taskStatusRank(current);
  if (rank < 0) return candidate;
  if (rank > 0) return current;
  return taskTimestamp(candidate) > taskTimestamp(current) ? candidate : current;
}

function completionProof(outcome = {}, executor = {}) {
  const result = outcome?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result) || !Object.keys(result).length) return null;
  const existingEvidence = Array.isArray(result.evidence) ? result.evidence.filter(Boolean) : [];
  const reference = result.run_id || result.audit_id || result.update_id || result.journal_id
    || result.id || result.domain || result.checked_at || executor.id;
  return {
    ...result,
    proof_status: 'verified',
    evidence: existingEvidence.length
      ? existingEvidence
      : [{ type: 'executor_result', reference: cleanText(reference, 500) }],
  };
}

function latestActiveRun(payload, taskId, now = Date.now()) {
  return rowsFrom(payload)
    .filter((run) => String(run.task_id || '') === String(taskId || ''))
    .filter((run) => {
      const status = cleanText(run.status, 40).toLowerCase();
      if (!ACTIVE_STATUSES.has(status)) return false;
      if (status !== 'running') return true;
      const changed = Date.parse(run.updated_at || run.started_at || run.created_at || '');
      return Number.isFinite(changed) && now - changed <= STALE_RUNNING_MS;
    })
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))[0] || null;
}

async function readJson(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || fallback || `HTTP ${response.status}`);
  return data;
}

async function activeRunForTask(agentFetch, taskId, organisation) {
  const response = await agentFetch(`/agent-runs?task_id=${encodeURIComponent(taskId)}&limit=20`, {
    headers: { 'x-organisation-id': organisation },
  });
  return latestActiveRun(await readJson(response, `Lecture runs HTTP ${response.status}`), taskId);
}

function sanitizeTaskItem(item = {}) {
  const titre = cleanText(item.titre || item.title, 240);
  if (!titre) return null;
  const priority = PRIORITIES.has(String(item.priorite || '').trim()) ? String(item.priorite).trim() : 'moyenne';
  return {
    record: {
      titre,
      description: cleanText(item.description, 5000) || null,
      statut: 'a_faire',
      priorite: priority,
      date_echeance: cleanText(item.date_echeance, 20) || null,
      projet_id: cleanText(item.projet_id, 80) || null,
      client_id: cleanText(item.client_id, 80) || null,
      notes: cleanText(item.notes, 4000) || null,
    },
    requested_agent: {
      name: cleanText(item.agent_name || item.assigne_a || item.agent, 180) || null,
      role: cleanText(item.agent_role || item.functional_role, 120) || null,
      provider: cleanText(item.provider, 80) || null,
      provider_agent_id: cleanText(item.provider_agent_id || item.base44_agent_id, 180) || null,
    },
    read_only: item.read_only === true,
    existing_task_id: cleanText(item.task_id || item.existing_task_id, 80) || null,
  };
}

function sanitizeTaskBatchPayload(payload = {}) {
  const raw = Array.isArray(payload?.tasks) ? payload.tasks : [];
  if (!raw.length) return null;
  const source = raw.slice(0, MAX_BATCH_TASKS);
  const sanitized = source.map(sanitizeTaskItem).filter(Boolean);
  if (!sanitized.length) return null;
  const keys = new Set();
  const tasks = sanitized.filter((item) => {
    const key = canonicalTaskKey(item.record);
    if (!canonicalTaskTitle(item.record.titre) || keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  return tasks.length ? { tasks } : null;
}

async function patchTask(agentFetch, taskId, payload, organisation) {
  const response = await agentFetch(`/data/Tache/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    headers: { 'x-organisation-id': organisation },
    body: JSON.stringify(payload),
  });
  return readJson(response, `Mise à jour tâche HTTP ${response.status}`);
}

async function patchRun(agentFetch, runId, payload, organisation) {
  const response = await agentFetch(`/agent-runs/${encodeURIComponent(runId)}`, {
    method: 'PATCH',
    headers: { 'x-organisation-id': organisation },
    body: JSON.stringify(payload),
  });
  return readJson(response, `Mise à jour run HTTP ${response.status}`);
}

function taskNotes(item, message) {
  return [item.record.notes, message].filter(Boolean).join('\n').slice(0, 4000);
}

function runInput(item, executor) {
  return {
    titre: item.record.titre,
    description: item.record.description,
    notes: item.record.notes,
    read_only: item.read_only,
    executor_kind: executor.kind,
    executor_id: executor.id,
  };
}

async function createRun(agentFetch, task, item, executor, token, index, organisation, requestedBy, status) {
  const response = await agentFetch('/agent-runs', {
    method: 'POST',
    headers: { 'x-organisation-id': organisation },
    body: JSON.stringify({
      task_id: String(task.id),
      agent_id: executor.id,
      functional_role: executor.role,
      provider_agent_id: executor.provider_agent_id || executor.id,
      provider_name: executor.provider,
      status,
      execution_mode: executor.execution_mode || 'autonomous',
      input: runInput(item, executor),
      idempotency_key: `${token}:run:${index}:${crypto.randomUUID()}`,
      requested_by: requestedBy,
      base44_agent_id: executor.provider === 'base44' ? executor.provider_agent_id : null,
    }),
  });
  return readJson(response, `Création run HTTP ${response.status}`);
}

async function executeTaskBatch({ payload, token, user, tenant, agentFetch, executionHandlers = {}, prepareOnly = false, resolveExecutor = null }) {
  if (!payload?.tasks?.length) {
    return {
      success: false,
      requested: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      verification: 'Batch vide ou invalide refusé proprement; aucune tâche ni exécution n’a été créée.',
    };
  }
  const organisation = tenant || 'jsinnovia';
  const requestedBy = cleanText(user?.email || user?.id || 'companion', 180);
  const handlers = {
    site: executionHandlers.site || executeSiteTask,
    business: executionHandlers.business || executeBusinessTask,
    project: executionHandlers.project || executeProjectTask,
    video: executionHandlers.video || executeVideoTask,
  };
  const existingResponse = await agentFetch('/data/Tache?limit=250', {
    headers: { 'x-organisation-id': organisation },
  });
  const existingByKey = new Map();
  for (const candidate of rowsFrom(await readJson(existingResponse, `Lecture tâches HTTP ${existingResponse.status}`))) {
    const key = canonicalTaskKey(candidate);
    const status = cleanText(candidate.statut || candidate.status, 40).toLowerCase();
    if (key && !['terminee', 'terminée'].includes(status)) {
      existingByKey.set(key, preferredCanonicalTask(existingByKey.get(key), candidate));
    }
  }

  const results = [];
  for (let index = 0; index < payload.tasks.length; index += 1) {
    const item = payload.tasks[index];
    const executor = resolveExecutor ? resolveExecutor(item.record) : resolveNovaExecutor(item.existing_task_id ? { titre: item.record.titre } : item.record);
    let task = null;
    let run = null;
    try {
      if (item.existing_task_id) {
        const exactResponse = await agentFetch(`/data/Tache/${encodeURIComponent(item.existing_task_id)}`, {
          headers: { 'x-organisation-id': organisation },
        });
        task = recordFrom(await readJson(exactResponse, `Lecture tâche ciblée HTTP ${exactResponse.status}`));
        if (!task?.id || String(task.id) !== String(item.existing_task_id)) {
          throw new Error('Tâche ciblée introuvable; aucune nouvelle tâche créée.');
        }
      } else {
        task = existingByKey.get(canonicalTaskKey(item.record)) || null;
      }
      const reused = Boolean(task);
      if (prepareOnly && task) {
        results.push({ index, success: true, task_id: task.id, run_id: String(task.notes || '').match(/run_id=([a-zA-Z0-9-]+)/)?.[1] || null, executor: null, status: 'existing', reused: true, reason: 'tache_existante_conservee_sans_relance' });
        continue;
      }
      if (task) {
        const active = await activeRunForTask(agentFetch, task.id, organisation);
        if (active?.id) {
          if (item.existing_task_id && String(active.agent_id || '') !== String(executor.id)) {
            await patchRun(agentFetch, active.id, {
              status: 'failed',
              error: `Exécuteur incorrect remplacé: ${active.agent_id || 'inconnu'} -> ${executor.id}`,
              completed_at: new Date().toISOString(),
            }, organisation);
          } else {
            results.push({ index, success: true, task_id: task.id, run_id: active.id, executor: executor.id, status: 'already_running', reused: true });
            continue;
          }
        }
      } else {
        const response = await agentFetch('/data/Tache', {
          method: 'POST',
          headers: { 'idempotency-key': `${token}:task:${index}`, 'x-organisation-id': organisation },
          body: JSON.stringify(item.record),
        });
        task = await readJson(response, `Création tâche HTTP ${response.status}`);
        if (!task?.id) throw new Error('Création de tâche non vérifiable : identifiant absent.');
        existingByKey.set(canonicalTaskKey(item.record), task);
      }

      if (prepareOnly) {
        run = await createRun(agentFetch, task, item, executor, token, index, organisation, requestedBy, 'awaiting_approval');
        if (!run?.id) throw new Error('Assignation non vérifiable : identifiant du run absent.');
        await patchTask(agentFetch, task.id, { statut: 'a_faire', notes: taskNotes(item, `Assignée à ${executor.id}; exécution non lancée; run_id=${run.id}.`) }, organisation);
        results.push({ index, success: true, task_id: task.id, run_id: run.id, executor: executor.id, status: 'planned', reused });
        continue;
      }

      if (executor.kind === 'unsupported') {
        run = await createRun(agentFetch, task, item, executor, token, index, organisation, requestedBy, 'failed');
        await patchRun(agentFetch, run.id, { status: 'failed', error: executor.reason, completed_at: new Date().toISOString() }, organisation);
        await patchTask(agentFetch, task.id, { statut: 'bloquee', notes: taskNotes(item, `Blocage NOVA: ${executor.reason}.`) }, organisation);
        results.push({ index, success: false, task_id: task.id, run_id: run.id, executor: executor.id, status: 'blocked', error: executor.reason });
        continue;
      }

      if (executor.kind === 'local') {
        run = await createRun(agentFetch, task, item, executor, token, index, organisation, requestedBy, 'pending');
        await patchTask(agentFetch, task.id, { statut: 'en_cours', notes: taskNotes(item, `Mise en file Windows locale: run_id=${run.id}.`) }, organisation);
        results.push({ index, success: true, task_id: task.id, run_id: run.id, executor: executor.id, status: 'queued_local', reused });
        continue;
      }

      run = await createRun(agentFetch, task, item, executor, token, index, organisation, requestedBy, 'running');
      await patchTask(agentFetch, task.id, { statut: 'en_cours', notes: taskNotes(item, `Exécution réelle démarrée par ${executor.name}: run_id=${run.id}.`) }, organisation);

      const agentRequest = async (path, options = {}) => {
        const response = await agentFetch(path, {
          ...options,
          headers: { ...(options.headers || {}), 'x-organisation-id': organisation },
          body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
        });
        return readJson(response, `Exécution métier HTTP ${response.status}`);
      };
      const outcome = executor.kind === 'site'
        ? await handlers.site(executor, item.record, { readOnly: item.read_only })
        : executor.kind === 'project'
          ? await handlers.project(item.record, agentRequest)
          : executor.kind === 'video'
            ? await handlers.video(item.record, agentRequest, null, { user, organisation, taskId: task.id, runId: run.id })
            : await handlers.business(item.record, agentRequest);

      const verifiedResult = outcome.completed ? completionProof(outcome, executor) : null;
      if (outcome.completed && verifiedResult) {
        await patchRun(agentFetch, run.id, { status: 'completed', result: verifiedResult, completed_at: new Date().toISOString(), base44_conv_id: outcome.conversation_id || null }, organisation);
        await patchTask(agentFetch, task.id, { statut: 'terminee', notes: taskNotes(item, `Exécution vérifiée et terminée par ${executor.name}: run_id=${run.id}.`) }, organisation);
        results.push({ index, success: true, task_id: task.id, run_id: run.id, executor: executor.id, status: 'completed', reused, result: verifiedResult });
      } else {
        const reason = outcome.completed ? 'resultat_final_non_verifie' : (outcome.reason || 'resultat_final_non_verifie');
        await patchRun(agentFetch, run.id, { status: 'awaiting_approval', result: outcome.result || { report: outcome.report }, error: reason, base44_conv_id: outcome.conversation_id || null }, organisation);
        await patchTask(agentFetch, task.id, { statut: outcome.blocked ? 'bloquee' : 'en_cours', notes: taskNotes(item, `Résultat reçu mais non finalisé: ${reason}; run_id=${run.id}.`) }, organisation);
        results.push({ index, success: !outcome.blocked, task_id: task.id, run_id: run.id, executor: executor.id, status: outcome.blocked ? 'blocked' : 'awaiting_review', reused, reason });
      }
    } catch (error) {
      if (run?.id) await patchRun(agentFetch, run.id, { status: 'failed', error: cleanText(error.message, 500), completed_at: new Date().toISOString() }, organisation).catch(() => null);
      if (task?.id) await patchTask(agentFetch, task.id, { statut: 'bloquee', notes: taskNotes(item, `Blocage d’exécution réel: ${cleanText(error.message, 600)}`) }, organisation).catch(() => null);
      results.push({ index, success: false, task_id: task?.id || null, run_id: run?.id || null, executor: executor.id, status: 'failed', error: cleanText(error.message, 600) });
    }
  }

  const succeeded = results.filter((item) => item.success).length;
  return {
    success: succeeded === results.length,
    requested: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
    verification: 'Chaque statut provient d’un exécuteur enregistré. Un run local reste pending jusqu’à la preuve Windows; aucun run running n’est créé sans appel réel de son exécuteur.',
  };
}

module.exports = {
  activeRunForTask,
  canonicalTaskKey,
  canonicalTaskTitle,
  completionProof,
  latestActiveRun,
  preferredCanonicalTask,
  sanitizeTaskBatchPayload,
  executeTaskBatch,
};
