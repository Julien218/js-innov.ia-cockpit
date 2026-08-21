const LOCAL_AGENT_ORIGINS = new Set([
  'http://127.0.0.1:8787',
  'http://localhost:8787',
]);

const TEXT_KEYS = ['response', 'reply', 'message', 'content', 'text', 'answer', 'output', 'result', 'data'];

function normalizeText(value, depth = 0, seen = new Set()) {
  if (depth > 6 || value == null) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    return text || null;
  }
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = normalizeText(item, depth + 1, seen);
      if (text) return text;
    }
    return null;
  }

  for (const key of TEXT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const text = normalizeText(value[key], depth + 1, seen);
      if (text) return text;
    }
  }

  const choices = value.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const text = normalizeText(choice?.message?.content ?? choice?.text ?? choice, depth + 1, seen);
      if (text) return text;
    }
  }

  return null;
}

function normalizeModelList(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(raw.map((item) => {
    if (typeof item === 'string') return item.trim();
    if (!item || typeof item !== 'object') return '';
    return String(item.name || item.model || item.id || '').trim();
  }).filter(Boolean))];
}

export function extractLocalAgentText(payload) {
  return normalizeText(payload);
}

export function extractLocalAgentModels(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.models,
    payload.model,
    payload.details?.models,
    payload.details?.model,
    payload.agent?.models,
    payload.agent?.model,
    payload.services?.ollama?.models,
    payload.ollama?.models,
  ];
  for (const candidate of candidates) {
    const models = normalizeModelList(candidate);
    if (models.length) return models;
  }
  return [];
}

function getUrl(input) {
  try {
    return new URL(typeof input === 'string' ? input : input?.url, globalThis.location?.href || 'http://localhost');
  } catch {
    return null;
  }
}

function isLocalAgentUrl(url) {
  return Boolean(url && LOCAL_AGENT_ORIGINS.has(url.origin));
}

function jsonResponseLike(source, payload) {
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

export function installLocalAgentFetchCompat() {
  if (globalThis.__JSINNOVIA_LOCAL_AGENT_FETCH_COMPAT__) return;
  if (typeof globalThis.fetch !== 'function') return;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.__JSINNOVIA_LOCAL_AGENT_FETCH_COMPAT__ = true;

  globalThis.fetch = async (input, init) => {
    const url = getUrl(input);
    const response = await originalFetch(input, init);
    if (!isLocalAgentUrl(url)) return response;

    if (url.pathname === '/api/agent/chat' && response.ok) {
      try {
        const payload = await response.clone().json();
        const text = extractLocalAgentText(payload);
        if (text) {
          const normalized = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? { ...payload, response: text }
            : { response: text, data: payload };
          return jsonResponseLike(response, normalized);
        }
      } catch {
        // Laisse la réponse originale intacte si le corps n'est pas du JSON.
      }
      return response;
    }

    if (url.pathname === '/api/agent/models') {
      try {
        if (response.ok) {
          const payload = await response.clone().json();
          const models = extractLocalAgentModels(payload);
          if (models.length) return jsonResponseLike(response, { models });
          if (Array.isArray(payload)) return jsonResponseLike(response, { models: normalizeModelList(payload) });
        }

        const healthResponse = await originalFetch(`${url.origin}/health`, { signal: init?.signal });
        if (healthResponse.ok) {
          const health = await healthResponse.json();
          const models = extractLocalAgentModels(health);
          if (models.length) {
            return new Response(JSON.stringify({ models }), {
              status: 200,
              headers: { 'content-type': 'application/json; charset=utf-8' },
            });
          }
        }
      } catch {
        // Le checkAgent existant gère l'absence de modèles sans rendre le Local indisponible.
      }
    }

    return response;
  };
}
