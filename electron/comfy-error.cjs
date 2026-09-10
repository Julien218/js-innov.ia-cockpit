function safeJson(value) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
  } catch (_) {
    // Le corps peut contenir une référence circulaire.
  }
  return typeof value === 'object' ? '<objet ComfyUI non sérialisable>' : String(value);
}

function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return safeJson(value);
}

function formatComfyErrorBody(payload) {
  if (typeof payload === 'string') return payload.trim() || 'erreur inconnue';
  if (!payload || typeof payload !== 'object') return String(payload || 'erreur inconnue');

  const error = payload.error;
  const parts = [];
  const rawMessage = typeof error === 'string'
    ? error
    : error?.message ?? payload.message ?? payload.error_message;
  const message = textValue(rawMessage);
  const type = typeof error === 'object' ? error?.type : payload.type;
  const details = textValue(typeof error === 'object' ? error?.details : payload.details);
  const extraInfo = textValue(typeof error === 'object' ? error?.extra_info : payload.extra_info);

  if (message) parts.push(message);
  if (type && String(type) !== message) parts.push(`type=${type}`);
  if (details && details !== message) parts.push(`details=${details}`);
  if (extraInfo) parts.push(`extra_info=${extraInfo}`);
  if (payload.node_errors) parts.push(`node_errors=${safeJson(payload.node_errors)}`);
  if (!parts.length && error) parts.push(textValue(error));

  return parts.join(' — ') || safeJson(payload);
}

module.exports = { formatComfyErrorBody };
