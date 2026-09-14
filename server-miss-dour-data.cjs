// Server-to-server read-only connector. No database credentials in the browser.
const FIELDS = Object.freeze(['id', 'source', 'first_name', 'last_name', 'email', 'phone', 'city', 'category', 'status', 'year', 'created_at', 'updated_at']);
const SUPPORTED_YEARS = new Set([2026, 2027]);

function missDourConfigured() {
  return Boolean(process.env.MISS_DOUR_REGISTRATIONS_URL && String(process.env.MISS_DOUR_REGISTRATIONS_TOKEN || '').length >= 32);
}

async function listMissDourRegistrations(fetcher = fetch) {
  if (!missDourConfigured()) throw new Error('La liaison Miss et Mister Dour n’est pas encore configurée.');
  const url = new URL(process.env.MISS_DOUR_REGISTRATIONS_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('URL de liaison invalide.');
  const records = [];
  const ids = new Set();
  let cursor = '';
  for (let page = 0; page < 100; page += 1) {
    const pageUrl = new URL(url);
    if (cursor) pageUrl.searchParams.set('cursor', cursor);
    const response = await fetcher(pageUrl, {
      headers: { Authorization: `Bearer ${process.env.MISS_DOUR_REGISTRATIONS_TOKEN}`, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('La base des inscriptions Miss et Mister Dour est indisponible. Aucune liste vide n’a été substituée.');
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('La source des inscriptions ne renvoie pas les données attendues.');
    const payload = await response.json();
    if (payload.collection !== 'miss-mister-dour-inscriptions' || !SUPPORTED_YEARS.has(Number(payload.year)) || !Array.isArray(payload.records) || payload.records.length > 200) throw new Error('Réponse de la source invalide.');
    for (const row of payload.records) {
      if (!row || !/^(candidate|application):[0-9]{10}$/.test(row.id) || !SUPPORTED_YEARS.has(Number(row.year))) throw new Error('Inscription source invalide.');
      if (ids.has(row.id)) throw new Error('Pagination incohérente de la source.');
      ids.add(row.id);
      records.push(Object.fromEntries(FIELDS.map((field) => [field, row[field] ?? null])));
    }
    if (payload.nextCursor === null) return records;
    if (typeof payload.nextCursor !== 'string' || !/^(candidate|application):[0-9]{10}$/.test(payload.nextCursor) || payload.nextCursor <= cursor || payload.nextCursor !== payload.records.at(-1)?.id) throw new Error('Pagination incohérente de la source.');
    cursor = payload.nextCursor;
  }
  throw new Error('La liste dépasse la limite de lecture; export interrompu pour éviter un résultat incomplet.');
}

module.exports = { FIELDS, missDourConfigured, listMissDourRegistrations };
