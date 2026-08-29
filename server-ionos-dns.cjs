const IONOS_DNS_API = 'https://api.hosting.ionos.com/dns/v1';
const WRITABLE_TYPES = new Set(['CNAME', 'TXT']);

function apiKey() {
  return String(process.env.IONOS_API_KEY || '').trim();
}

function isConfigured() {
  return apiKey().includes('.') && apiKey().length >= 32;
}

function safeApiError(status, body) {
  const candidate = body?.message || body?.error?.message || body?.error || '';
  const detail = typeof candidate === 'string' ? candidate.replace(/[\r\n]+/g, ' ').slice(0, 240) : '';
  return new Error(`IONOS DNS HTTP ${status}${detail ? `: ${detail}` : ''}`);
}

async function ionosRequest(path, options = {}, fetchImpl = global.fetch) {
  if (!isConfigured()) throw new Error('IONOS_API_KEY non configurée dans les variables serveur Railway.');
  if (typeof fetchImpl !== 'function') throw new Error('Client HTTP indisponible.');
  const response = await fetchImpl(`${IONOS_DNS_API}${path}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': apiKey(),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal || AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { message: text.slice(0, 240) }; }
  }
  if (!response.ok) throw safeApiError(response.status, data);
  return data;
}

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

function normalizeRecordName(value, domain) {
  const raw = normalizeDomain(value);
  if (!raw || raw === '@') return domain;
  if (raw === domain || raw.endsWith(`.${domain}`)) return raw;
  if (/^[a-z0-9_*.-]+$/i.test(raw) && !raw.includes('..')) return `${raw}.${domain}`;
  throw new Error('Nom DNS invalide.');
}

function normalizeChange(change, domain) {
  const type = String(change?.type || '').trim().toUpperCase();
  if (!WRITABLE_TYPES.has(type)) throw new Error(`Type DNS interdit: ${type || 'absent'}. Seuls CNAME et TXT sont autorisés.`);
  const name = normalizeRecordName(change?.name, domain);
  if (type === 'CNAME' && name === domain) throw new Error('Un CNAME ne peut pas remplacer le domaine racine.');
  const content = String(change?.content ?? '').trim();
  if (!content || content.length > 1024 || /[\u0000-\u001f\u007f]/.test(content)) throw new Error(`Contenu ${type} invalide.`);
  if (type === 'CNAME' && !/^(?=.{1,253}\.?$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$/i.test(content)) {
    throw new Error('Cible CNAME invalide.');
  }
  const ttl = Number(change?.ttl ?? 3600);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86_400) throw new Error('TTL invalide (60 à 86400 secondes).');
  return { name, type, content, ttl, prio: 0, disabled: false };
}

function validateChanges(domainValue, changesValue, managedDomains) {
  const domain = normalizeDomain(domainValue);
  if (!managedDomains || !Object.prototype.hasOwnProperty.call(managedDomains, domain)) throw new Error('Domaine non géré par le Cockpit.');
  if (!Array.isArray(changesValue) || changesValue.length < 1 || changesValue.length > 5) throw new Error('Entre 1 et 5 changements DNS sont requis.');
  const changes = changesValue.map((change) => normalizeChange(change, domain));
  const unique = new Set(changes.map((change) => `${change.name}|${change.type}`));
  if (unique.size !== changes.length) throw new Error('Un seul changement par couple nom/type est autorisé.');
  return { domain, changes };
}

function recordsFromZone(zone) {
  if (Array.isArray(zone?.records)) return zone.records;
  if (Array.isArray(zone?.items)) return zone.items;
  return [];
}

async function findZone(domain, fetchImpl = global.fetch) {
  const zones = await ionosRequest('/zones', {}, fetchImpl);
  const zone = (Array.isArray(zones) ? zones : zones?.items || []).find((item) => normalizeDomain(item?.type === 'zone' ? item?.properties?.zoneName : item?.zoneName || item?.name) === domain);
  if (!zone?.id) throw new Error(`Zone IONOS introuvable pour ${domain}.`);
  return zone;
}

async function listRecords(domain, fetchImpl = global.fetch) {
  const zone = await findZone(domain, fetchImpl);
  const details = await ionosRequest(`/zones/${encodeURIComponent(zone.id)}`, {}, fetchImpl);
  return { zoneId: zone.id, records: recordsFromZone(details) };
}

function sameRecord(record, change) {
  return normalizeDomain(record?.name) === change.name && String(record?.type || '').toUpperCase() === change.type;
}

function publicRecord(record) {
  return {
    id: record?.id || null,
    name: normalizeDomain(record?.name),
    type: String(record?.type || '').toUpperCase(),
    content: String(record?.content ?? ''),
    ttl: Number(record?.ttl || 0),
    disabled: Boolean(record?.disabled),
  };
}

async function prepareChangeSet(domainValue, changesValue, managedDomains, fetchImpl = global.fetch) {
  const { domain, changes } = validateChanges(domainValue, changesValue, managedDomains);
  const { zoneId, records } = await listRecords(domain, fetchImpl);
  const plan = changes.map((change) => {
    const existing = records.find((record) => sameRecord(record, change));
    return {
      action: existing ? 'update' : 'create',
      before: existing ? publicRecord(existing) : null,
      after: { name: change.name, type: change.type, content: change.content, ttl: change.ttl, disabled: false },
      recordId: existing?.id || null,
    };
  });
  return { domain, zoneId, plan };
}

async function applyPreparedChangeSet(prepared, fetchImpl = global.fetch) {
  const results = [];
  for (const item of prepared.plan) {
    if (item.action === 'update') {
      const result = await ionosRequest(`/zones/${encodeURIComponent(prepared.zoneId)}/records/${encodeURIComponent(item.recordId)}`, {
        method: 'PUT',
        body: { content: item.after.content, ttl: item.after.ttl, prio: 0, disabled: false },
      }, fetchImpl);
      results.push(result);
    } else {
      const result = await ionosRequest(`/zones/${encodeURIComponent(prepared.zoneId)}/records`, {
        method: 'POST',
        body: [{ ...item.after, prio: 0 }],
      }, fetchImpl);
      results.push(result);
    }
  }
  const refreshed = await listRecords(prepared.domain, fetchImpl);
  const verified = prepared.plan.every((item) => refreshed.records.some((record) => (
    sameRecord(record, item.after)
    && String(record.content ?? '') === item.after.content
    && !record.disabled
  )));
  return {
    success: verified,
    verified,
    domain: prepared.domain,
    changes: prepared.plan.map(({ action, before, after }) => ({ action, before, after })),
    checked_at: new Date().toISOString(),
    provider_responses: results.length,
  };
}

module.exports = {
  IONOS_DNS_API,
  WRITABLE_TYPES,
  isConfigured,
  ionosRequest,
  normalizeRecordName,
  validateChanges,
  listRecords,
  prepareChangeSet,
  applyPreparedChangeSet,
};
