const {
  executeBusinessTask,
  executeProjectTask,
  executeSiteTask,
  executeVideoTask,
  resolveNovaExecutor,
} = require('./server-nova-executors.cjs');
const { isCanonicalUuid, isInternalClientReference } = require('./server-video-generation-core.cjs');

const PRIORITIES = new Set(['basse', 'moyenne', 'haute', 'urgente']);
const ACTIVE_STATUSES = new Set(['pending', 'queued', 'dispatching', 'dispatched', 'running', 'awaiting_approval', 'awaiting_review']);
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
    .replace(/\b(delegation automatique|duplicata|copie)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalTaskKey(task = {}) {
  return [canonicalTaskTitle(task.titre || task.title) || `id:${task.id || ''}`,
    String(task.organisation_id || task.organisation || ''),
    String(task.client_id || task.client_nom || ''), String(task.projet_id || task.projet_nom || '')].join('|');
}

function operationalStatus(outcome = {}) {
  if (outcome.in_progress) return 'RUNNING';
  if (outcome.retrying) return 'RETRYING';
  if (outcome.requires_authorization) return 'WAITING_AUTHORIZATION';
  if (outcome.completed) return 'DONE';
  if (outcome.technical_error) return 'TECHNICAL_ERROR';
  if (/executeur|developpement_non_execute|correction_repertoire_interne_a_executer/.test(outcome.reason || '')) return 'NO_EXECUTOR';
  if (outcome.result?.missing_fields?.length || /absent|manquant|ambigu|incomplete|cible_site/.test(outcome.reason || '')) return 'WAITING_INPUT';
  return 'FAILED';
}

function completionResult(outcome, executor) {
  const result = outcome?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result) || !Object.keys(result).length) {
    throw new Error('preuve_finale_structuree_absente');
  }
  return { ...result, operational_status: 'DONE', proof_status: 'verified',
    verified_at: new Date().toISOString(),
    evidence: [{ type: 'executor_result', executor_id: executor.id, result }],
  };
}

function persistedRunState(run = {}) {
  const result = run.result || {};
  const explicit = result.operational_status || run.operational_status;
  if (run.status === 'completed') return {
    operational_status: run.completed_at && (result.proof_status || run.proof_status) === 'verified'
      && (result.evidence?.length || run.has_evidence) ? 'DONE' : 'TECHNICAL_ERROR',
    reason: 'verification_preuve_finale',
  };
  if (['WAITING_AUTHORIZATION', 'WAITING_INPUT', 'RUNNING', 'RETRYING', 'NO_EXECUTOR', 'TECHNICAL_ERROR', 'FAILED'].includes(explicit)) {
    return { operational_status: explicit, reason: run.error || null };
  }
  if (result.missing_fields?.length || result.source_required === true) return { operational_status: 'WAITING_INPUT', reason: 'source_ou_information_requise' };
  if (result.dispatched === false && result.repository) return { operational_status: 'NO_EXECUTOR', reason: 'correction_repertoire_interne_a_executer' };
  if (run.status === 'pending' && run.requested_by === 'cockpit-domaines'
      && run.provider_name === 'cockpit-server' && run.execution_mode === 'confirmed_write'
      && ['seo', 'repair'].includes(run.input?.kind) && run.input?.domain
      && typeof result.summary === 'string' && !result.conversation_id && !run.base44_conv_id
      && !result.dispatch && !result.evidence?.length) {
    return { operational_status: 'NO_EXECUTOR', reason: 'ancienne_reservation_domaine_sans_dispatch' };
  }
  if (run.status === 'awaiting_approval') return { operational_status: 'WAITING_AUTHORIZATION', reason: 'autorisation_requise' };
  if (run.status === 'awaiting_review') return { operational_status: 'WAITING_INPUT', reason: 'information_ou_controle_requis' };
  if (run.status === 'running') return { operational_status: 'RUNNING', reason: null };
  if (['pending', 'queued', 'dispatching', 'dispatched'].includes(run.status)) return {
    operational_status: 'WAITING_INPUT', reason: 'attente_confirmation_execution_agent',
  };
  return { operational_status: run.status === 'failed' ? 'FAILED' : null, reason: run.error || null };
}

function latestActiveRun(payload, taskId) {
  return rowsFrom(payload)
    .filter((run) => String(run.task_id || '') === String(taskId || ''))
    .filter((run) => {
      const status = cleanText(run.status, 40).toLowerCase();
      if (!ACTIVE_STATUSES.has(status)) return false;
      // Age alone never proves a worker has stopped. Keep the backend claim.
      return true;
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
  const data = await readJson(response, `Lecture runs HTTP ${response.status}`);
  return latestActiveRun(data, taskId) || rowsFrom(data).find(run => String(run.task_id) === String(taskId) && run.status === 'completed' && run.completed_at && run.result?.proof_status === 'verified' && run.result?.evidence?.length) || null;
}

function sanitizeTaskItem(item = {}) {
  const titre = cleanText(item.titre || item.title, 240);
  if (!titre) return null;
  const priority = PRIORITIES.has(String(item.priorite || '').trim()) ? String(item.priorite).trim() : 'moyenne';
  const rawClientId = cleanText(item.client_id, 180) || null;
  const clientId = rawClientId && isCanonicalUuid(rawClientId) ? rawClientId : null;
  const explicitClientName = cleanText(item.client_nom || item.client_name, 180) || null;
  const clientName = explicitClientName
    || (rawClientId ? (isInternalClientReference(rawClientId) ? 'JS-Innov.IA' : rawClientId) : null);
  const legacyClientNote = rawClientId && !clientId && !isInternalClientReference(rawClientId)
    ? `Référence client non canonique conservée pour résolution: ${rawClientId}`
    : null;
  const notes = [cleanText(item.notes, 3800), legacyClientNote].filter(Boolean).join('\n').slice(0, 4000) || null;
  return {
    record: {
      titre,
      description: [cleanText(item.description, 5000), ...['source_document_id', 'start_source_document_id', 'end_source_document_id'].filter(key => /^[A-Za-z0-9_-]{8,180}$/.test(item[key] || '')).map(key => `${key}: ${item[key]}`), ...(Array.isArray(item.reference_document_ids) ? item.reference_document_ids.filter(id => /^[A-Za-z0-9_-]{8,180}$/.test(id)).slice(0, 7).map(id => `document source: ${id}`) : [])].filter(Boolean).join('\n') || null,
      statut: 'a_faire',
      priorite: priority,
      date_echeance: cleanText(item.date_echeance, 20) || null,
      projet_id: cleanText(item.projet_id, 80) || null,
      client_id: clientId,
      client_nom: clientName,
      notes,
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
  const titles = new Set();
  const tasks = sanitized.filter((item) => {
    const key = item.existing_task_id || canonicalTaskKey(item.record);
    if (!key || titles.has(key)) return false;
    titles.add(key);
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
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await agentFetch(`/agent-runs/${encodeURIComponent(runId)}`, {
        method: 'PATCH', headers: { 'x-organisation-id': organisation }, body: JSON.stringify(payload),
      });
      if ([502, 503, 504, 429].includes(response.status) && attempt < 2) {
        await response.text().catch(() => '');
        await new Promise(resolve => setTimeout(resolve, 100 * (2 ** attempt)));
        continue;
      }
      return await readJson(response, `Mise à jour run HTTP ${response.status}`);
    } catch (error) {
      if (attempt < 2 && (error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error.name))) continue;
      error.run_persistence_error = true;
      throw error;
    }
  }
}

function taskNotes(item, message) {
  return [item.record.notes, message].filter(Boolean).join('\n');
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
      idempotency_key: `${token}:run:${index}:${task.id}`,
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
  const existingByTitle = new Map();
  const existingGroups = new Map();
  const candidates = rowsFrom(await readJson(existingResponse, `Lecture tâches HTTP ${existingResponse.status}`));
  const isCompleted = task => ['termine', 'terminee', 'terminée', 'completed', 'done'].includes(String(task.statut || task.status).toLowerCase());
  candidates.sort((a, b) => Number(isCompleted(b)) - Number(isCompleted(a)) || String(a.created_at || a.id).localeCompare(String(b.created_at || b.id)));
  for (const candidate of candidates) {
    const key = canonicalTaskKey({ ...candidate, organisation_id: organisation });
    if (key && !existingByTitle.has(key)) existingByTitle.set(key, candidate);
    if (!existingGroups.has(key)) existingGroups.set(key, []);
    existingGroups.get(key).push(candidate);
  }

  const results = [];
  for (let index = 0; index < payload.tasks.length; index += 1) {
    const item = { ...payload.tasks[index], record: { ...payload.tasks[index].record } };
    let executor = resolveNovaExecutor(item.record);
    let task = null;
    let run = null;
    let outcomePersisted = false;
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
        task = existingByTitle.get(canonicalTaskKey({ ...item.record, organisation_id: organisation })) || null;
      }
      if (task) {
        const incoming = Object.fromEntries(Object.entries(item.record).filter(([key, value]) => value !== null && value !== '' && !['statut', 'notes'].includes(key)));
        item.record = { ...task, ...incoming, notes: [task.notes, item.record.notes && item.record.notes !== task.notes && !String(task.notes || '').startsWith(item.record.notes) ? item.record.notes : null].filter(Boolean).join('\n') };
      }
      executor = resolveExecutor ? resolveExecutor(item.record) : resolveNovaExecutor(item.record);
      const reused = Boolean(task);
      if (prepareOnly && task) {
        results.push({ index, success: true, task_id: task.id, run_id: String(task.notes || '').match(/run_id=([a-zA-Z0-9-]+)/)?.[1] || null, executor: null, status: 'existing', reused: true, reason: 'tache_existante_conservee_sans_relance' });
        continue;
      }
      if (task && ['termine', 'terminee', 'terminée', 'completed', 'done'].includes(String(task.statut || task.status).toLowerCase())) {
        results.push({ index, success: true, task_id: task.id, executor: executor.id, status: 'existing', reused: true, reason: 'tache_historique_terminee_conservee_sans_relance' });
        continue;
      }
      if (task) {
        const peers = existingGroups.get(canonicalTaskKey({ ...task, organisation_id: organisation })) || [task];
        const reservations = await Promise.all(peers.map(peer => activeRunForTask(agentFetch, peer.id, organisation)));
        const active = reservations.find(run => run && ACTIVE_STATUSES.has(run.status))
          || reservations.find(run => run?.status === 'completed' && String(run.task_id) === String(task.id));
        if (active?.id) {
          if (active.status === 'completed') {
            await patchTask(agentFetch, task.id, { statut: 'terminee', notes: taskNotes(item, `Preuve finale existante conservée: run_id=${active.id}.`) }, organisation);
            results.push({ index, success: true, task_id: task.id, run_id: active.id, executor: active.agent_id || executor.id, status: 'completed', operational_status: 'DONE', reused: true });
            continue;
          }
          {
            results.push({ index, success: true, task_id: task.id, run_id: active.id, executor: active.agent_id || executor.id, status: 'already_running', operational_status: persistedRunState(active).operational_status, reused: true });
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
        existingByTitle.set(canonicalTaskKey({ ...item.record, organisation_id: organisation }), task);
      }

      if (prepareOnly) {
        run = await createRun(agentFetch, task, item, executor, token, index, organisation, requestedBy, 'awaiting_approval');
        if (!run?.id) throw new Error('Assignation non vérifiable : identifiant du run absent.');
        await patchTask(agentFetch, task.id, { statut: 'a_faire', notes: taskNotes(item, `Assignée à ${executor.id}; exécution non lancée; run_id=${run.id}.`) }, organisation);
        results.push({ index, success: true, task_id: task.id, run_id: run.id, executor: executor.id, status: 'planned', reused });
        continue;
      }

      if (executor.kind === 'unsupported') {
        const op = executor.operational_status || operationalStatus({ reason: executor.reason });
        run = await createRun(agentFetch, task, item, executor, token, index, organisation, requestedBy, 'pending');
        if (run.reused) {
          results.push({ index, success: true, task_id: task.id, run_id: run.id, executor: run.agent_id || executor.id, status: 'already_running', operational_status: persistedRunState(run).operational_status, reused: true });
          continue;
        }
        await patchRun(agentFetch, run.id, { status: 'failed', result: { operational_status: op }, error: executor.reason, completed_at: new Date().toISOString() }, organisation);
        await patchTask(agentFetch, task.id, { statut: 'bloquee', notes: taskNotes(item, `Blocage NOVA: ${executor.reason}.`) }, organisation);
        results.push({ index, success: false, task_id: task.id, run_id: run.id, executor: executor.id, status: 'blocked', operational_status: op, error: executor.reason });
        continue;
      }

      if (executor.kind === 'local') {
        run = await createRun(agentFetch, task, item, executor, token, index, organisation, requestedBy, 'pending');
        await patchTask(agentFetch, task.id, { statut: 'en_cours', notes: taskNotes(item, `Mise en file Windows locale: run_id=${run.id}.`) }, organisation);
        results.push({ index, success: true, task_id: task.id, run_id: run.id, executor: executor.id, status: 'queued_local', reused });
        continue;
      }

      run = await createRun(agentFetch, task, item, executor, token, index, organisation, requestedBy, 'running');
      if (!run?.id) throw new Error('Identifiant du run absent');
      if (run.reused) {
        results.push({ index, success: true, task_id: task.id, run_id: run.id, executor: run.agent_id || executor.id, status: 'already_running', operational_status: persistedRunState(run).operational_status, reused: true });
        continue;
      }
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

      if (outcome.completed) {
        await patchRun(agentFetch, run.id, { status: 'completed', result: completionResult(outcome, executor), completed_at: new Date().toISOString(), base44_conv_id: outcome.conversation_id || null }, organisation);
        outcomePersisted = true;
        await patchTask(agentFetch, task.id, { statut: 'terminee', notes: taskNotes(item, `Exécution vérifiée et terminée par ${executor.name}: run_id=${run.id}.`) }, organisation);
        results.push({ index, success: true, task_id: task.id, run_id: run.id, executor: executor.id, status: 'completed', operational_status: 'DONE', reused, result: outcome.result });
      } else {
        const reason = outcome.reason || 'resultat_final_non_verifie';
        const op = operationalStatus(outcome);
        const status = ['RUNNING', 'RETRYING'].includes(op) ? 'running' : op === 'WAITING_AUTHORIZATION' ? 'awaiting_approval' : op === 'WAITING_INPUT' ? 'awaiting_review' : 'failed';
        await patchRun(agentFetch, run.id, { status, result: { ...(outcome.result || { report: outcome.report }), operational_status: op }, error: reason, base44_conv_id: outcome.conversation_id || null }, organisation);
        await patchTask(agentFetch, task.id, { statut: ['RUNNING', 'RETRYING'].includes(op) ? 'en_cours' : 'bloquee', notes: taskNotes(item, `Résultat reçu mais non finalisé: ${reason}; run_id=${run.id}.`) }, organisation);
        results.push({ index, success: status !== 'failed', task_id: task.id, run_id: run.id, executor: executor.id, status: outcome.blocked ? 'blocked' : 'awaiting_review', operational_status: op, reused, reason });
      }
    } catch (error) {
      if (run?.id && !run.reused && !outcomePersisted && !error.run_persistence_error) await patchRun(agentFetch, run.id, { status: 'failed', result: { operational_status: 'TECHNICAL_ERROR' }, error: cleanText(error.message, 500), completed_at: new Date().toISOString() }, organisation).catch(() => null);
      if (task?.id && !outcomePersisted) await patchTask(agentFetch, task.id, { statut: 'bloquee', notes: taskNotes(item, `Blocage d’exécution réel: ${cleanText(error.message, 600)}`) }, organisation).catch(() => null);
      results.push({ index, success: false, task_id: task?.id || null, run_id: run?.id || null, executor: executor.id, status: 'failed', operational_status: 'TECHNICAL_ERROR', error: cleanText(error.message, 600) });
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
  persistedRunState,
  activeRunForTask,
  patchRun,
  canonicalTaskTitle,
  canonicalTaskKey,
  completionResult,
  operationalStatus,
  latestActiveRun,
  sanitizeTaskBatchPayload,
  executeTaskBatch,
};
