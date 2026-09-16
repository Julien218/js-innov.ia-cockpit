function cleanDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
}

export function notificationDomain(event) {
  const explicit = cleanDomain(event?.domain);
  if (explicit) return explicit;
  const title = String(event?.title || '');
  const match = title.match(/(?:Incident critique|Service rétabli|Surveillance adaptée)\s*[—–-]\s*([^\s]+)$/i);
  return cleanDomain(match?.[1]);
}

function eventTime(event) {
  const value = new Date(event?.created_at || 0).getTime();
  return Number.isFinite(value) ? value : null;
}

export function filterActiveNotifications(events) {
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  const resolvedAt = new Map();

  for (const event of list) {
    if (!['site.restored', 'site.monitoring_updated'].includes(event?.event_type)) continue;
    const domain = notificationDomain(event);
    const time = eventTime(event);
    if (!domain || time === null) continue;
    resolvedAt.set(domain, Math.max(resolvedAt.get(domain) || 0, time));
  }

  return list.filter((event) => {
    if (event?.active === false) return false;
    if (event?.event_type !== 'site.down') return true;
    const domain = notificationDomain(event);
    if (!domain) return true;
    const resolved = resolvedAt.get(domain);
    if (!resolved) return true;
    const created = eventTime(event);
    return created !== null && created > resolved;
  });
}
