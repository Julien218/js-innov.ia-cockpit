export function sumExportMetric(exports, field) {
  return exports.reduce((sum, item) => {
    const value = Number(item?.[field]);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
}

export function exportAvailability(item) {
  const status = String(item?.status || '').toLowerCase();
  if (['error', 'failed'].includes(status)) return 'error';
  if (['pending', 'queued', 'running', 'rendering', 'processing'].includes(status)) return 'pending';
  return item?.file_url ? 'ready' : 'missing';
}

export function exportFilename(item) {
  let extension = 'webm';
  try {
    const path = new URL(item?.file_url, 'http://localhost').pathname;
    extension = path.match(/\.(mp4|webm|mov|mkv)$/i)?.[1]?.toLowerCase() || extension;
  } catch {}
  return `${String(item?.title || 'export').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.${extension}`;
}

export function formatExportSize(value) {
  const mb = Number(value);
  if (!Number.isFinite(mb) || mb <= 0) return '–';
  return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
}
