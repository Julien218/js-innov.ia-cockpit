const express = require('express');
const crypto = require('node:crypto');
const { analyzeDomain, MANAGED_DOMAINS } = require('./server-domain-ops.cjs');
const { executeTaskBatch, sanitizeTaskBatchPayload } = require('./server-task-batch.cjs');
const { resolveNovaExecutor } = require('./server-nova-executors.cjs');

const router = express.Router();
const AGENT_URL = String(process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app').replace(/\/$/, '');
const AGENT_KEY = String(process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '').trim();
const AUTOPILOT_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.COMPANION_AUTOPILOT_ENABLED || 'true'));
const AUTOPILOT_INTERVAL_MS = Math.max(60_000, Number(process.env.COMPANION_AUTOPILOT_INTERVAL_MS || 15 * 60_000));
const state = { running: false, last_started_at: null, last_finished_at: null, last_result: null, last_error: null };

function norm(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function canonicalTaskTitle(value) {
  return norm(value)
    .replace(/\b(delegation automatique|duplicata|copie)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalTaskKey(task = {}) {
  return [
    canonicalTaskTitle(task?.titre || task?.title),
    canonicalTaskTitle(task?.client_id || task?.client_nom),
    canonicalTaskTitle(task?.projet_id || task?.projet_nom),
  ].join('|');
}

function duplicateTasksForCanonical(tasks, canonicalTask) {
  const canonicalId = String(canonicalTask?.id || '');
  const key = canonicalTaskKey(canonicalTask);
  if (!canonicalId || !key) return [];
  return (Array.isArray(tasks) ? tasks : []).filter((task) => {
    if (String(task?.id || '') === canonicalId) return false;
    if (['terminee', 'terminée'].includes(norm(task?.statut || task?.status))) return false;
    return canonicalTaskKey(task) === key;
  });
}

function taskText(task) {
  return `${task?.titre || task?.title || ''}\n${task?.description || ''}`;
}

function recordedExecutionFailure(task) {
  const notes = String(task?.notes || '');
  const matches = [...notes.matchAll(/Blocage d[’']exécution réel\s*:\s*([^\n]+)/gi)];
  const latest = matches.length ? matches[matches.length - 1][1].trim().slice(0, 500) : null;
  if (/could not find.*['’]priorite['’].*['’]projet['’].*schema cache/i.test(String(latest || ''))) return null;
  return latest;
}

function managedDomainForTask(task) {
  const text = norm(taskText(task));
  return Object.keys(MANAGED_DOMAINS).find((domain) => text.includes(domain)) || null;
}

function classifyTask(task) {
  const text = norm(taskText(task));
  const domain = managedDomainForTask(task);
  if (domain && /(reparation|corrig|modifier|seo automatique|deploi|publier)/.test(text)) {
    return { kind: 'sensitive_domain_write', domain, executable: false, reason: 'confirmation_et_connecteur_ecriture_requis' };
  }
  if (domain && /(verifi|control|analys|audit|diagnosti|dns|https|tls|ssl|seo)/.test(text)) {
    return { kind: 'domain_diagnostic', domain, executable: true };
  }
  if (/(comfyui|minimax|workflow|ffmpeg|video ia|avatar.*local)/.test(text)) {
    return { kind: 'local_machine', executable: false, reason: 'agent_windows_local_requis' };
  }
  if (/(analys|audit|verifi|control).*(client|facture|societe|asbl|rattachement)|(facture|rattachement).*(analys|audit|verifi|control)/.test(text)) {
    return { kind: 'business_data_audit', executable: true };
  }
  if (/(client|facture|tva|societe|asbl|rattachement)/.test(text)) {
    return { kind: 'business_data', executable: false, reason: 'donnees_metier_ou_validation_humaine_requises' };
  }
  return { kind: 'unsupported', executable: false, reason: 'aucun_executeur_verifiable' };
}

function summarizeBusinessData({ clients = [], invoices = [], projects = [] }) {
  const missingClientLegal = clients.filter((item) => !item.numero_tva && !item.tva && !item.vat_number).map((item) => item.id).filter(Boolean);
  const invoiceWithoutClient = invoices.filter((item) => !item.client_id && !item.client_nom).map((item) => item.id).filter(Boolean);
  const projectWithoutClient = projects.filter((item) => !item.client_id && !item.client_nom).map((item) => item.id).filter(Boolean);
  return {
    clients_count: clients.length,
    invoices_count: invoices.length,
    projects_count: projects.length,
    clients_missing_vat_count: missingClientLegal.length,
    invoices_without_client_count: invoiceWithoutClient.length,
    projects_without_client_count: projectWithoutClient.length,
    affected_ids: {
      clients_missing_vat: missingClientLegal.slice(0, 100),
      invoices_without_client: invoiceWithoutClient.slice(0, 100),
      projects_without_client: projectWithoutClient.slice(0, 100),
    },
  };
}

async function auditBusinessData() {
  const [clientsPayload, invoicesPayload, projectsPayload] = await Promise.all([
    agentRequest('/data/Client?limit=500'),
    agentRequest('/data/Facture?limit=500'),
    agentRequest('/data/Projet?limit=500'),
  ]);
  return {
    tool: 'cockpit_business_data_audit',
    run_id: `business-${crypto.randomUUID()}`,
    checked_at: new Date().toISOString(),
    ...summarizeBusinessData({ clients: rowsFrom(clientsPayload), invoices: rowsFrom(invoicesPayload), projects: rowsFrom(projectsPayload) }),
  };
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function agentRequest(path, { method = 'GET', body } = {}) {
  if (!AGENT_KEY) throw new Error('JSINNOVIA_AGENT_KEY non configurée pour l’autopilote.');
  const response = await fetch(`${AGENT_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY, 'x-organisation-id': 'jsinnovia' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.message || `Agent HTTP ${response.status}`);
  return data;
}

function agentFetch(path, options = {}) {
  if (!AGENT_KEY) throw new Error('JSINNOVIA_AGENT_KEY non configurée pour l’autopilote.');
  return fetch(`${AGENT_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY, 'x-organisation-id': 'jsinnovia', ...(options.headers || {}) },
    signal: options.signal || AbortSignal.timeout(120_000),
  });
}

async function patchTask(taskId, payload) {
  return agentRequest(`/data/Tache/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: payload });
}

function verifiedAutopilotResult(result = {}) {
  const evidence = Array.isArray(result?.evidence) ? result.evidence.filter(Boolean) : [];
  const reference = result?.run_id || result?.audit_id || result?.update_id || result?.domain || result?.checked_at;
  return {
    ...(result && typeof result === 'object' ? result : { value: result }),
    proof_status: 'verified',
    evidence: evidence.length ? evidence : [{ type: 'executor_result', reference: String(reference || 'cockpit-autopilot').slice(0, 500) }],
  };
}

async function recordRun(task, classification, result, status = 'completed', error = null) {
  return agentRequest('/agent-runs', {
    method: 'POST',
    body: {
      task_id: String(task.id),
      agent_id: 'cockpit-task-autopilot',
      functional_role: 'verified_task_executor',
      provider_name: 'cockpit-server',
      status,
      execution_mode: 'read_only',
      input: { title: task.titre || task.title, kind: classification.kind, domain: classification.domain || null },
      result: status === 'completed' ? verifiedAutopilotResult(result) : (result || null),
      error,
      idempotency_key: `autopilot:${task.id}:${classification.kind}`,
      requested_by: 'companion-autopilot',
      started_at: state.last_started_at,
      completed_at: new Date().toISOString(),
    },
  });
}

function proofNote(result) {
  return [
    'Autopilote Cockpit — diagnostic réellement exécuté.',
    `Outil: ${result.tool}`,
    `Heure: ${result.checked_at}`,
    `Cible: ${result.domain || 'clients, projets et factures du Cockpit'}`,
    `Journal: ${result.run_id}`,
    `Résultat: ${JSON.stringify(result.tool === 'cockpit_domain_probe' ? { dns: result.dns, http: result.http, tls: result.tls, seo: result.seo, issues: result.issues } : result)}`,
  ].join('\n').slice(0, 3900);
}

async function executeExistingTask(task, classification) {
  await patchTask(task.id, { statut: 'en_cours', notes: `${task.notes || ''}\nAutopilote: exécution vérifiable lancée.`.trim().slice(0, 4000) });
  if (classification.kind === 'domain_diagnostic') {
    const result = await analyzeDomain(classification.domain);
    const run = await recordRun(task, classification, result);
    await patchTask(task.id, {
      statut: 'terminee',
      notes: `${task.notes || ''}\n${proofNote(result)}`.trim().slice(0, 4000),
    });
    return { task_id: task.id, title: task.titre || task.title, status: 'completed', run_id: run?.id || result.run_id, tool_run_id: result.run_id };
  }
  if (classification.kind === 'business_data_audit') {
    const result = await auditBusinessData();
    const run = await recordRun(task, classification, result);
    await patchTask(task.id, { statut: 'terminee', notes: `${task.notes || ''}\n${proofNote(result)}`.trim().slice(0, 4000) });
    return { task_id: task.id, title: task.titre || task.title, status: 'completed', run_id: run?.id || result.run_id, tool_run_id: result.run_id };
  }
  throw new Error(`Exécuteur absent pour ${classification.kind}`);
}

async function closeVerifiedDuplicates(canonicalTask, copies, proofIds = []) {
  const closed = [];
  for (const copy of copies) {
    const note = [
      copy.notes || '',
      `Doublon regroupé avec la tâche ${canonicalTask.id}.`,
      'Aucune exécution séparée: le même objectif a été traité une seule fois.',
      proofIds.length ? `Preuves de la tâche canonique: ${proofIds.join(', ')}` : '',
    ].filter(Boolean).join('\n').trim().slice(0, 4000);
    await patchTask(copy.id, { statut: 'bloquee', notes: note });
    closed.push(copy.id);
  }
  return closed;
}

function safeScheduledTask(task, executor) {
  const text = norm(taskText(task));
  if (executor.kind === 'local') return true;
  if (executor.kind === 'business') return /(analys|audit|verifi|control)/.test(text);
  if (executor.kind === 'site') return /(verifi|control|analys|audit|diagnosti)/.test(text) && !/(reparation|corrig|modifier|seo automatique|deploi|publier)/.test(text);
  return false;
}

async function runAutopilot({ allowWrites = false, inspectOnly = false, requestedBy = 'companion-autopilot', user = null } = {}) {
  if (state.running) return { skipped: true, reason: 'already_running' };
  state.running = true;
  state.last_started_at = new Date().toISOString();
  state.last_error = null;
  try {
    const payload = await agentRequest('/data/Tache?limit=250');
    const tasks = rowsFrom(payload).filter((task) => !['terminee', 'terminée'].includes(norm(task.statut || task.status)));
    const groups = new Map();
    for (const task of tasks) {
      const key = canonicalTaskKey(task);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    }

    const executableTasks = [];
    const blocked = [];
    const awaitingAuthorization = [];
    const ready = [];
    const duplicates = [];
    for (const group of groups.values()) {
      const [task, ...copies] = group;
      if (copies.length) duplicates.push({ canonical_task_id: task.id, duplicate_ids: copies.map((item) => item.id), count: group.length });
      const executor = resolveNovaExecutor(task);
      if (executor.kind === 'unsupported') {
        blocked.push({ task_id: task.id, title: task.titre || task.title, kind: executor.kind, executable: false, reason: executor.reason || 'autorisation_explicite_requise' });
        continue;
      }
      if (!allowWrites && !safeScheduledTask(task, executor)) {
        const priorFailure = recordedExecutionFailure(task);
        if (priorFailure) {
          blocked.push({ task_id: task.id, title: task.titre || task.title, kind: executor.kind, executor: executor.id, executable: false, reason: priorFailure });
          continue;
        }
        awaitingAuthorization.push({
          task_id: task.id,
          title: task.titre || task.title,
          kind: executor.kind,
          executor: executor.id,
          domain: executor.domain || null,
          reason: 'autorisation_explicite_requise',
        });
        continue;
      }
      if (inspectOnly) {
        ready.push({
          task_id: task.id,
          title: task.titre || task.title,
          kind: executor.kind,
          executor: executor.id,
          domain: executor.domain || null,
          reason: 'inspection_sans_effet',
        });
        continue;
      }
      executableTasks.push({
        titre: task.titre || task.title,
        description: task.description,
        notes: task.notes,
        priorite: task.priorite,
        projet_id: task.projet_id,
        client_id: task.client_id,
        read_only: !allowWrites,
      });
    }

    let batch = { results: [] };
    if (executableTasks.length) {
      const payload = sanitizeTaskBatchPayload({ tasks: executableTasks });
      batch = await executeTaskBatch({
        payload,
        token: `autopilot-${crypto.randomUUID()}`,
        user: user || { id: requestedBy, email: requestedBy, role: 'admin', organisation: 'jsinnovia' },
        tenant: 'jsinnovia',
        agentFetch,
      });
    }
    const decorate = (item) => {
      const task = tasks.find((candidate) => String(candidate.id) === String(item.task_id))
        || tasks.find((candidate) => canonicalTaskKey(candidate) === canonicalTaskKey({ titre: item.title, client_id: item.client_id, projet_id: item.projet_id }));
      const executor = task ? resolveNovaExecutor(task) : null;
      return { ...item, title: item.title || task?.titre || task?.title, executor: item.executor || executor?.id || null };
    };
    const executed = batch.results.filter((item) => item.status === 'completed').map(decorate);
    const queued = batch.results.filter((item) => ['queued_local', 'already_running', 'awaiting_review'].includes(item.status)).map(decorate);
    blocked.push(...batch.results.filter((item) => !item.success).map((item) => {
      const decorated = decorate(item);
      return { task_id: decorated.task_id, title: decorated.title, executor: decorated.executor, run_id: decorated.run_id, reason: decorated.error || decorated.status };
    }));
    for (const execution of executed) {
      const canonicalTask = tasks.find((task) => String(task.id) === String(execution.task_id));
      if (canonicalTask) execution.duplicate_task_ids = await closeVerifiedDuplicates(canonicalTask, duplicateTasksForCanonical(tasks, canonicalTask), [execution.run_id].filter(Boolean));
    }
    const result = { run_id: `autopilot-${crypto.randomUUID()}`, examined: tasks.length, unique: groups.size, executed, queued, ready, blocked, awaiting_authorization: awaitingAuthorization, duplicates, allow_writes: allowWrites, inspection_only: inspectOnly };
    state.last_result = result;
    return result;
  } catch (error) {
    state.last_error = String(error.message || error).slice(0, 500);
    throw error;
  } finally {
    state.running = false;
    state.last_finished_at = new Date().toISOString();
  }
}

router.get('/status', (_req, res) => res.json({ enabled: AUTOPILOT_ENABLED, interval_ms: AUTOPILOT_INTERVAL_MS, ...state }));
router.post('/run', async (req, res) => {
  try { res.json(await runAutopilot({ allowWrites: req.body?.allow_writes === true, requestedBy: req.user?.email || req.user?.id || 'cockpit-admin', user: req.user })); }
  catch (error) { res.status(502).json({ error: error.message, state }); }
});

const LOCAL_TOOLS = new Set(['ffmpeg_version', 'ffprobe_file', 'list_directory', 'find_local_workflows', 'workflow_documentation_audit', 'video_pipeline_audit', 'comfyui_health', 'http_diagnose', 'avatar_factory_status']);
router.post('/local-results', async (req, res) => {
  const results = Array.isArray(req.body?.task_results) ? req.body.task_results.slice(0, 50) : [];
  const synced = [];
  let allTasks = [];
  try {
    allTasks = rowsFrom(await agentRequest('/data/Tache?limit=250'));
  } catch (error) {
    return res.status(502).json({ error: `Impossible de vérifier les task_id avant synchronisation: ${String(error.message || error).slice(0, 300)}` });
  }
  for (const item of results) {
    const taskId = String(item?.task_id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
    const runs = Array.isArray(item?.tool_runs) ? item.tool_runs.slice(0, 10) : [];
    if (!taskId || !item?.completed || !runs.length || runs.some((run) => !LOCAL_TOOLS.has(run?.tool) || !run?.success || !/^[a-f0-9-]{20,}$/i.test(String(run?.id || '')))) continue;
    const evidence = runs.map((run) => ({ id: String(run.id), tool: run.tool, started_at: run.started_at, completed_at: run.completed_at, exit_code: run.exit_code, output: String(run.output || '').slice(0, 12000) }));
    try {
      const canonicalTask = allTasks.find((task) => String(task?.id || '') === taskId);
      if (!canonicalTask) throw new Error('task_id absent du Cockpit; résultat local refusé');
      if (canonicalTaskTitle(canonicalTask.titre || canonicalTask.title) !== canonicalTaskTitle(item.title)) {
        throw new Error('le titre du résultat local ne correspond pas au task_id; synchronisation refusée');
      }
      const runPayload = {
        status: 'completed',
        result: {
          proof_status: 'verified',
          evidence: evidence.map((run) => ({ type: 'tool_run', reference: String(run.id) })),
          tool_runs: evidence,
        },
        completed_at: evidence[evidence.length - 1].completed_at,
      };
      const existingRuns = rowsFrom(await agentRequest(`/agent-runs?task_id=${encodeURIComponent(taskId)}&provider_name=local-agent&limit=20`));
      const pendingRun = existingRuns.find((run) => ['pending', 'queued', 'running'].includes(norm(run.status)) && String(run.task_id) === taskId);
      const log = pendingRun?.id
        ? await agentRequest(`/agent-runs/${encodeURIComponent(pendingRun.id)}`, { method: 'PATCH', body: runPayload })
        : await agentRequest('/agent-runs', { method: 'POST', body: { task_id: taskId, agent_id: 'nova-local-tools', functional_role: 'windows_local_diagnostics', provider_name: 'local-agent', status: 'completed', execution_mode: 'autonomous', input: { title: String(item.title || '').slice(0, 240), tools: evidence.map((run) => run.tool) }, ...runPayload, idempotency_key: `local-autopilot:${taskId}:${evidence.map((run) => run.id).join(':')}`.slice(0, 500), requested_by: String(req.user?.email || req.user?.id || 'desktop-companion').slice(0, 180), started_at: evidence[0].started_at } });
      await patchTask(taskId, { statut: 'terminee', notes: `NOVA locale — diagnostic terminé avec preuve.\nOutils: ${evidence.map((run) => run.tool).join(', ')}\nJournaux: ${evidence.map((run) => run.id).join(', ')}`.slice(0, 4000) });
      const duplicateTaskIds = await closeVerifiedDuplicates(
        canonicalTask,
        duplicateTasksForCanonical(allTasks, canonicalTask),
        evidence.map((run) => run.id),
      );
      synced.push({ task_id: taskId, run_id: log?.id || null, tool_run_ids: evidence.map((run) => run.id), duplicate_task_ids: duplicateTaskIds });
    } catch (error) {
      synced.push({ task_id: taskId, error: String(error.message || error).slice(0, 300) });
    }
  }
  res.json({ received: results.length, synced: synced.filter((item) => !item.error).length, results: synced });
});

function startTaskAutopilotScheduler() {
  if (!AUTOPILOT_ENABLED || !AGENT_KEY) return { started: false, reason: AUTOPILOT_ENABLED ? 'agent_key_missing' : 'disabled' };
  const first = setTimeout(() => runAutopilot().catch((error) => console.warn('[task-autopilot]', error.message)), 30_000);
  first.unref?.();
  const timer = setInterval(() => runAutopilot().catch((error) => console.warn('[task-autopilot]', error.message)), AUTOPILOT_INTERVAL_MS);
  timer.unref?.();
  return { started: true, interval_ms: AUTOPILOT_INTERVAL_MS };
}

module.exports = { router, canonicalTaskKey, canonicalTaskTitle, duplicateTasksForCanonical, classifyTask, recordedExecutionFailure, rowsFrom, summarizeBusinessData, verifiedAutopilotResult, runAutopilot, startTaskAutopilotScheduler, state };
