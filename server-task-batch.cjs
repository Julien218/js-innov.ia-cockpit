const crypto = require('crypto');

const PRIORITIES = new Set(['basse', 'moyenne', 'haute', 'urgente']);
const BASE44_API_URL = String(process.env.BASE44_AGENT_URL || 'https://app.base44.com/api/agents').replace(/\/$/, '');
const BASE44_API_KEY = String(process.env.BASE44_API_KEY || process.env.BASE44_SERVER_API_KEY || '').trim();

function cleanText(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function canonicalTaskTitle(value) {
  return cleanText(value, 240)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function latestActiveRun(payload) {
  return rowsFrom(payload)
    .filter((run) => ['running', 'queued', 'pending'].includes(cleanText(run.status, 40).toLowerCase()))
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))[0] || null;
}

async function activeRunForTask(agentFetch, taskId, organisation) {
  const response = await agentFetch(`/agent-runs?task_id=${encodeURIComponent(taskId)}&limit=20`, {
    headers: { 'x-organisation-id': organisation },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Lecture runs HTTP ${response.status}`);
  return latestActiveRun(data);
}

function sanitizeTaskItem(item = {}) {
  const titre = cleanText(item.titre || item.title, 240);
  if (!titre) return null;

  const agentName = cleanText(item.agent_name || item.assigne_a || item.agent, 180);
  const agentRole = cleanText(item.agent_role || item.functional_role || 'project_delivery_manager', 120);
  const provider = cleanText(item.provider || (item.provider_agent_id ? 'base44' : 'jsinnovia-agent'), 80);
  const providerAgentId = cleanText(item.provider_agent_id || item.base44_agent_id, 180);
  const priority = PRIORITIES.has(String(item.priorite || '').trim()) ? String(item.priorite).trim() : 'moyenne';
  const readOnly = item.read_only === true;
  const notesParts = [cleanText(item.notes, 1600)];
  if (agentName) notesParts.push(`Agent métier: ${agentName}`);
  if (agentRole) notesParts.push(`Rôle métier: ${agentRole}`);
  if (provider) notesParts.push(`Provider: ${provider}`);

  const record = {
    titre,
    description: cleanText(item.description, 5000) || null,
    statut: 'a_faire',
    priorite: priority,
    date_echeance: cleanText(item.date_echeance, 20) || null,
    projet_id: cleanText(item.projet_id, 80) || null,
    client_id: cleanText(item.client_id, 80) || null,
    notes: notesParts.filter(Boolean).join('\n').slice(0, 4000) || null,
  };

  return {
    record,
    agent: {
      name: agentName || `Agent métier ${agentRole}`,
      role: agentRole,
      provider,
      provider_agent_id: providerAgentId || null,
      read_only: readOnly,
    },
  };
}

function sanitizeTaskBatchPayload(payload = {}) {
  const source = Array.isArray(payload.tasks) ? payload.tasks : [];
  if (!source.length || source.length > 20) return null;
  const tasks = source.map(sanitizeTaskItem);
  if (tasks.some((item) => !item)) return null;
  const unique = [];
  const titles = new Set();
  for (const item of tasks) {
    const key = canonicalTaskTitle(item.record.titre);
    if (titles.has(key)) continue;
    titles.add(key);
    unique.push(item);
  }
  return { tasks: unique };
}

async function jsonFetch(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchBase44ReadOnly(agent, task) {
  if (!BASE44_API_KEY || !agent?.provider_agent_id) return null;
  const headers = { api_key: BASE44_API_KEY, 'Content-Type': 'application/json' };
  const conversation = await jsonFetch(`${BASE44_API_URL}/${encodeURIComponent(agent.provider_agent_id)}/conversations`, {
    method: 'POST', headers, body: JSON.stringify({}),
  });
  if (!conversation?.id) throw new Error(`Conversation Base44 absente pour ${agent.name}`);
  const prompt = [
    `Tu es ${agent.name}, agent métier délégué par le Cockpit JS-Innov.IA.`,
    `Rôle: ${agent.role}.`,
    'Mission STRICTEMENT en lecture seule: exécute le diagnostic demandé et rends un rapport factuel.',
    'Ne crée, ne modifie, ne publie, ne déploie, n’envoie et ne supprime rien.',
    `Tâche: ${task.titre}`,
    task.description ? `Description: ${task.description}` : '',
    'Réponds avec: constats vérifiés, anomalies, preuves disponibles, travail restant et prochaine action recommandée.',
  ].filter(Boolean).join('\n');
  const answer = await jsonFetch(`${BASE44_API_URL}/${encodeURIComponent(agent.provider_agent_id)}/conversations/${encodeURIComponent(conversation.id)}/messages`, {
    method: 'POST', headers, body: JSON.stringify({ role: 'user', content: prompt }),
  }, 60000);
  return {
    provider: 'base44',
    conversation_id: conversation.id,
    content: cleanText(answer?.content || answer?.message || answer?.response, 8000),
  };
}

async function dispatchVirtualReadOnly(agentFetch, agent, task, index) {
  const sessionId = `batch:${String(agent.role || 'specialist').replace(/[^a-zA-Z0-9_-]/g, '_')}:${Date.now()}:${index}`;
  const response = await agentFetch('/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: [
        `Tu es ${agent.name}, spécialiste métier délégué par le Companion JS-Innov.IA.`,
        `Rôle: ${agent.role}.`,
        'Mission STRICTEMENT en lecture seule. Aucun effet métier réel n’est autorisé.',
        `Tâche: ${task.titre}`,
        task.description ? `Description: ${task.description}` : '',
        'Fournis un diagnostic factuel, les anomalies, les preuves, le travail restant et les prochaines étapes.',
      ].filter(Boolean).join('\n'),
      session_id: sessionId,
      assistant_mode: 'owner',
      available_actions: [],
      user_context: { role: 'superadmin', organisation: 'jsinnovia', full_name: 'JS-Innov.IA Companion' },
      server_context: 'Délégation interne lecture seule. Ne propose aucune action d’écriture.',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Agent ${response.status}`);
  return { provider: 'jsinnovia-agent', session_id: sessionId, content: cleanText(data?.response || data?.message, 8000) };
}

async function patchTask(agentFetch, taskId, payload, tenant) {
  if (!taskId) return null;
  const response = await agentFetch(`/data/Tache/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    headers: tenant ? { 'x-organisation-id': tenant } : {},
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Agent ${response.status}`);
  return data;
}

async function executeTaskBatch({ payload, token, user, tenant, agentFetch }) {
  const results = [];
  const organisation = tenant || 'jsinnovia';
  const existingPayload = await agentFetch('/data/Tache?limit=250', {
    headers: { 'x-organisation-id': organisation },
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Lecture tâches HTTP ${response.status}`);
    return data;
  });
  const existingByTitle = new Map();
  for (const candidate of rowsFrom(existingPayload)) {
    const key = canonicalTaskTitle(candidate.titre || candidate.title);
    const status = cleanText(candidate.statut || candidate.status, 40).toLowerCase();
    if (key && !['terminee', 'terminée'].includes(status) && !existingByTitle.has(key)) {
      existingByTitle.set(key, candidate);
    }
  }

  for (let index = 0; index < payload.tasks.length; index += 1) {
    const item = payload.tasks[index];
    const taskKey = `${token}:task:${index}`;
    let task = null;
    let run = null;
    try {
      const titleKey = canonicalTaskTitle(item.record.titre);
      task = existingByTitle.get(titleKey) || null;
      const reusedTask = Boolean(task);
      if (task && cleanText(task.statut || task.status, 40).toLowerCase() === 'en_cours') {
        const activeRun = await activeRunForTask(agentFetch, task.id, organisation);
        if (activeRun?.id) {
          results.push({ index, success: true, task_id: task.id, run_id: activeRun.id, status: 'already_running', reused: true, verified: true });
          continue;
        }
        await patchTask(agentFetch, task.id, {
          statut: 'a_faire',
          notes: `${task.notes || ''}\nStatut en_cours obsolète corrigé automatiquement: aucun agent_run actif trouvé.`.trim().slice(0, 4000),
        }, organisation);
      }
      if (!task) {
        const createResponse = await agentFetch('/data/Tache', {
          method: 'POST',
          headers: { 'idempotency-key': taskKey, 'x-organisation-id': organisation },
          body: JSON.stringify(item.record),
        });
        const createData = await createResponse.json().catch(() => ({}));
        if (!createResponse.ok) throw new Error(createData?.error || `Création tâche HTTP ${createResponse.status}`);
        task = createData;
        existingByTitle.set(titleKey, task);
      }

      const runKey = `${token}:run:${index}`;
      const runResponse = await agentFetch('/agent-runs', {
        method: 'POST',
        headers: { 'x-organisation-id': organisation },
        body: JSON.stringify({
          task_id: String(task.id),
          agent_id: item.agent.provider_agent_id || item.agent.name,
          functional_role: item.agent.role,
          provider_agent_id: item.agent.provider_agent_id,
          provider_name: item.agent.provider || 'jsinnovia-agent',
          status: 'running',
          execution_mode: item.agent.read_only ? 'prepare_only' : 'delegated_execution',
          input: { titre: item.record.titre, description: item.record.description, read_only: item.agent.read_only },
          idempotency_key: runKey,
          requested_by: cleanText(user?.email || user?.id || 'companion', 180),
          base44_agent_id: item.agent.provider === 'base44' ? item.agent.provider_agent_id : null,
        }),
      });
      const runData = await runResponse.json().catch(() => ({}));
      if (!runResponse.ok) throw new Error(runData?.error || `Création run HTTP ${runResponse.status}`);
      run = runData;

      await patchTask(agentFetch, task.id, {
        statut: 'en_cours',
        notes: `${item.record.notes || ''}\nDélégation lancée automatiquement par le Companion.`.trim().slice(0, 4000),
      }, organisation);

      if (item.agent.read_only) {
        let report = null;
        if (item.agent.provider === 'base44' && item.agent.provider_agent_id && BASE44_API_KEY) {
          report = await dispatchBase44ReadOnly(item.agent, item.record);
        } else {
          report = await dispatchVirtualReadOnly(agentFetch, item.agent, item.record, index);
        }

        const runPatch = await agentFetch(`/agent-runs/${encodeURIComponent(run.id)}`, {
          method: 'PATCH',
          headers: { 'x-organisation-id': organisation },
          body: JSON.stringify({
            status: 'completed',
            result: { report: report?.content || '', provider: report?.provider || item.agent.provider },
            base44_conv_id: report?.conversation_id || null,
            completed_at: new Date().toISOString(),
          }),
        });
        const patchedRun = await runPatch.json().catch(() => ({}));
        if (!runPatch.ok) throw new Error(patchedRun?.error || `Mise à jour run HTTP ${runPatch.status}`);

        await patchTask(agentFetch, task.id, {
          statut: 'terminee',
          notes: `${item.record.notes || ''}\nDiagnostic agent terminé et résultat vérifié par le moteur batch.`.trim().slice(0, 4000),
        }, organisation);

        results.push({ index, success: true, task_id: task.id, run_id: run.id, status: 'completed', reused: reusedTask, report: report?.content || '' });
      } else {
        results.push({ index, success: true, task_id: task.id, run_id: run.id, status: 'running', reused: reusedTask, delegated: true });
      }
    } catch (error) {
      if (task?.id) {
        await patchTask(agentFetch, task.id, {
          statut: 'bloquee',
          notes: `${item.record.notes || ''}\nBlocage d’exécution: ${cleanText(error.message, 600)}`.trim().slice(0, 4000),
        }, organisation).catch(() => null);
      }
      if (run?.id) {
        await agentFetch(`/agent-runs/${encodeURIComponent(run.id)}`, {
          method: 'PATCH',
          headers: { 'x-organisation-id': organisation },
          body: JSON.stringify({ status: 'failed', error: cleanText(error.message, 500), completed_at: new Date().toISOString() }),
        }).catch(() => null);
      }
      results.push({ index, success: false, task_id: task?.id || null, run_id: run?.id || null, error: cleanText(error.message, 600) });
    }
  }

  const succeeded = results.filter((item) => item.success).length;
  return {
    success: succeeded === results.length,
    requested: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
    verification: 'Résultat calculé à partir des créations réelles de tâches, runs et délégations; les tâches d’écriture restent en_cours tant qu’un résultat final n’est pas enregistré.',
  };
}

module.exports = {
  canonicalTaskTitle,
  latestActiveRun,
  sanitizeTaskBatchPayload,
  executeTaskBatch,
};
