function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function formatComfyErrorBody(payload) {
  if (typeof payload === "string") return payload.trim() || "erreur inconnue";
  if (!payload || typeof payload !== "object") return String(payload || "erreur inconnue");

  const error = payload.error;
  const parts = [];
  const message = typeof error === "string"
    ? error
    : error?.message || payload.message || "";
  const type = typeof error === "object" ? error?.type : payload.type;

  if (message) parts.push(String(message));
  if (type && String(type) !== String(message)) parts.push(`type=${type}`);
  if (typeof error === "object" && error?.details) parts.push(`details=${safeJson(error.details)}`);
  if (typeof error === "object" && error?.extra_info) parts.push(`extra_info=${safeJson(error.extra_info)}`);
  if (payload.node_errors) parts.push(`node_errors=${safeJson(payload.node_errors)}`);

  return parts.join(" — ") || safeJson(payload);
}

module.exports = { formatComfyErrorBody };
