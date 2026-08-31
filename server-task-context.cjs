const { stripInjectedContext } = require('./server-immediate-execution-policy.cjs');

function clean(value, max = 4000) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

function recentMediaLines(media) {
  if (!media || typeof media !== 'object') return [];
  const lines = [];
  const fileName = clean(media.fileName || media.originalFileName, 300);
  const documentId = clean(media.documentId, 120);
  const dropboxPath = clean(media.dropboxPath, 1200);
  if (fileName) lines.push(`Média source: ${fileName}`);
  if (documentId) lines.push(`Index Cockpit: ${documentId}`);
  if (dropboxPath) lines.push(`Chemin Dropbox: ${dropboxPath}`);
  return lines;
}

function enrichTaskBatchWithRequestContext(payload = {}, message = '', recentMedia = null) {
  if (!Array.isArray(payload?.tasks)) return payload;
  const request = clean(stripInjectedContext(message), 4000);
  const contextLines = [request ? `Demande source: ${request}` : '', ...recentMediaLines(recentMedia)].filter(Boolean);
  if (!contextLines.length) return payload;
  return {
    ...payload,
    tasks: payload.tasks.map((task) => {
      if (!task || typeof task !== 'object') return task;
      const existing = String(task.description || '').trim();
      const missing = contextLines.filter((line) => !existing.includes(line));
      return { ...task, description: [existing, ...missing].filter(Boolean).join('\n').slice(0, 5000) };
    }),
  };
}

module.exports = { enrichTaskBatchWithRequestContext, recentMediaLines };
