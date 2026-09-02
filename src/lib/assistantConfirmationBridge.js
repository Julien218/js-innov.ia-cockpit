const AFFIRMATIVE = new Set([
  'oui', 'ok', 'oki', 'okj', 'd accord', 'daccord', 'confirme', 'je confirme',
  'confirmation', 'confirmer', 'execute', 'j execute', 'vas y', 'vasy', 'go',
  'c est bon', 'cest bon', 'fais le', 'fait le', 'confirme pour executer',
]);

const NEGATIVE = new Set([
  'non', 'annule', 'annuler', 'stop', 'laisse tomber', 'ne fais pas', 'ne pas executer',
]);

const STORAGE_KEY = 'jsinnovia:assistant-confirmations:v1';
const state = new Map();

function isAffirmativeIntent(value) {
  const intent = normalize(value);
  return AFFIRMATIVE.has(intent)
    || /^(?:oui|ok|oki|go|je confirme|confirme|confirmation|execute|vas y|fais le)\b/.test(intent);
}

function executionProof(result) {
  if (!Array.isArray(result?.results) || result.results.length === 0) return '';
  return result.results.map((item, index) => {
    const error = item.error ? ` — erreur: ${item.error}` : '';
    return `${index + 1}. task_id=${item.task_id || 'absent'} · run_id=${item.run_id || 'aucun'} · statut=${item.status || (item.success ? 'créée' : 'échec')}${error}`;
  }).join('\n');
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input?.url || '';
}

async function requestJson(input, init) {
  try {
    if (typeof init?.body === 'string') return JSON.parse(init.body);
    if (input instanceof Request) {
      const text = await input.clone().text();
      return text ? JSON.parse(text) : {};
    }
  } catch {
    // La requête continue normalement si son corps n'est pas du JSON.
  }
  return {};
}

function conversationKey(body = {}) {
  return String(body.conversation_id || 'main').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'main';
}

function sessionStore() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function persistState() {
  const store = sessionStore();
  if (!store) return;
  try {
    const now = Date.now();
    const entries = [...state.entries()].filter(([, pending]) => pending?.token && Number(pending.expiresAt) > now);
    store.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Une indisponibilité du stockage ne bloque jamais l'assistant.
  }
}

function restoreState() {
  const store = sessionStore();
  if (!store) return;
  try {
    const entries = JSON.parse(store.getItem(STORAGE_KEY) || '[]');
    const now = Date.now();
    for (const [key, pending] of Array.isArray(entries) ? entries : []) {
      if (pending?.token && Number(pending.expiresAt) > now) state.set(String(key), pending);
    }
    persistState();
  } catch {
    try { store.removeItem(STORAGE_KEY); } catch { /* rien à faire */ }
  }
}

function setPending(key, pending) {
  state.set(key, pending);
  persistState();
}

function deletePending(key) {
  state.delete(key);
  persistState();
}

function deletePendingByToken(token) {
  for (const [key, pending] of state.entries()) {
    if (pending.token === token) state.delete(key);
  }
  persistState();
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function appendHistory(originalFetch, conversationId, userMessage, assistantMessage) {
  try {
    await originalFetch('/api/assistant/history/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        conversation_id: conversationId,
        messages: [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: assistantMessage },
        ],
      }),
    });
  } catch {
    // L'exécution métier ne dépend jamais de l'écriture de l'historique.
  }
}

async function executeConfirmedAction(originalFetch, pending, userMessage) {
  const confirmRes = await originalFetch('/api/assistant/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ token: pending.token }),
  });
  const confirmData = await confirmRes.json().catch(() => ({}));
  if (!confirmRes.ok) {
    return jsonResponse({ error: confirmData.error || 'Confirmation refusée' }, confirmRes.status);
  }

  let executionResult = confirmData.result || null;
  if (confirmData.client_action) {
    const actionRes = await originalFetch(confirmData.client_action.url, {
      method: confirmData.client_action.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(confirmData.client_action.body || {}),
    });
    const actionData = await actionRes.json().catch(() => ({}));

    if (confirmData.completion_token) {
      await originalFetch('/api/assistant/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          token: confirmData.completion_token,
          success: actionRes.ok,
          details: actionRes.ok ? 'Action exécutée après confirmation conversationnelle' : (actionData.error || `HTTP ${actionRes.status}`),
        }),
      }).catch(() => null);
    }

    if (!actionRes.ok) {
      return jsonResponse({ error: actionData.error || 'Action métier non exécutée' }, actionRes.status);
    }
    executionResult = actionData;
  }

  const label = confirmData.action_summary || pending.summary || confirmData.action_type || 'Action';
  const proof = executionProof(executionResult);
  const message = `✅ ${label} — action exécutée une seule fois et journalisée.${proof ? `\n\nPreuves du lot:\n${proof}` : ''}`;
  await appendHistory(originalFetch, pending.conversationId, userMessage, message);

  return jsonResponse({
    message,
    response: message,
    confirmation: null,
    auto_confirmed: true,
    action_type: confirmData.action_type || pending.type || null,
    execution: confirmData.execution || null,
    result: executionResult,
    conversation_id: pending.conversationId,
  });
}

export function installAssistantConfirmationBridge() {
  if (typeof window === 'undefined' || window.__JSINNOVIA_ASSISTANT_CONFIRMATION_BRIDGE__) return;
  window.__JSINNOVIA_ASSISTANT_CONFIRMATION_BRIDGE__ = true;
  restoreState();

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = requestUrl(input);

    if (url.includes('/api/assistant/confirm')) {
      const body = await requestJson(input, init);
      const response = await originalFetch(input, init);
      if (body.token && (response.ok || [400, 404, 409, 410].includes(response.status))) {
        deletePendingByToken(body.token);
      }
      return response;
    }

    if (!url.includes('/api/assistant/chat')) return originalFetch(input, init);

    const body = await requestJson(input, init);
    const key = conversationKey(body);
    const pending = state.get(key);
    const intent = normalize(body.message);

    if (pending && Date.now() > pending.expiresAt) deletePending(key);

    if (pending && NEGATIVE.has(intent)) {
      deletePending(key);
      const message = 'Action annulée. Aucune modification n’a été exécutée.';
      appendHistory(originalFetch, key, body.message, message);
      return jsonResponse({ message, response: message, confirmation: null, cancelled: true, conversation_id: key });
    }

    if (pending && isAffirmativeIntent(intent)) {
      // On consomme le jeton avant l'appel : un double clic ou une répétition ne peut pas rejouer l'action.
      deletePending(key);
      return executeConfirmedAction(originalFetch, pending, body.message);
    }

    const response = await originalFetch(input, init);
    try {
      const data = await response.clone().json();
      if (response.ok && data?.confirmation?.token) {
        setPending(key, {
          token: data.confirmation.token,
          type: data.confirmation.type || null,
          summary: data.confirmation.summary || null,
          conversationId: key,
          expiresAt: Date.now() + Math.max(1, Number(data.confirmation.expires_in) || 300) * 1000,
        });
      }
    } catch {
      // Une réponse non JSON n'altère pas le flux normal.
    }
    return response;
  };
}
