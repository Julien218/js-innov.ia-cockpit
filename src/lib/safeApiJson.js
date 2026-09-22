export class ApiJsonError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ApiJsonError';
    Object.assign(this, details);
  }
}

function responseLabel(response, label) {
  if (label) return label;
  try {
    return new URL(response?.url || window.location.href).pathname || 'API';
  } catch {
    return 'API';
  }
}

export async function readApiJson(response, { label } = {}) {
  const name = responseLabel(response, label);
  const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
  const raw = await response.text();
  const preview = raw.trim().slice(0, 180);
  const looksHtml = /^\s*<!doctype\b|^\s*<html\b/i.test(raw);
  const looksJson = contentType.includes('application/json') || /^[\s]*[\[{]/.test(raw);

  if (!looksJson) {
    throw new ApiJsonError(
      looksHtml
        ? `${name} a renvoyé une page HTML au lieu de l’API JSON. Vérifiez le proxy /api ou la session Cockpit.`
        : `${name} a renvoyé un format de réponse inattendu.`,
      { status: response.status, contentType, responsePreview: preview, code: looksHtml ? 'html_instead_of_json' : 'unexpected_content_type' },
    );
  }

  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new ApiJsonError(`${name} a renvoyé un JSON invalide.`, {
      status: response.status,
      contentType,
      responsePreview: preview,
      code: 'invalid_json',
    });
  }

  if (!response.ok) {
    const fallback = response.status === 401
      ? 'Session Cockpit expirée ou absente.'
      : response.status === 403
        ? 'Accès refusé pour ce module.'
        : `${name} indisponible (HTTP ${response.status}).`;
    throw new ApiJsonError(data?.error || data?.message || fallback, {
      status: response.status,
      contentType,
      data,
      code: response.status === 401 ? 'session_required' : response.status === 403 ? 'forbidden' : 'http_error',
    });
  }

  return data;
}

export async function fetchApiJson(input, init, options) {
  const response = await fetch(input, init);
  return readApiJson(response, options);
}
