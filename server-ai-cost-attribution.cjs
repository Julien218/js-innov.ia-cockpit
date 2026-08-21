const { cleanTenant } = require('./server-tenant.cjs');

const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '';
let installed = false;

function safe(value, max = 180) {
  return String(value || '').trim().slice(0, max);
}

function displayName(client = {}) {
  return safe(
    client.denomination_legale || client.entreprise ||
    [client.prenom, client.nom].filter(Boolean).join(' ') || client.nom || client.id,
    180,
  );
}

async function resolveClient(organisation, actor) {
  const tenant = cleanTenant(organisation);
  if (!tenant || !AGENT_KEY) return null;
  const url = new URL('/data/Client', AGENT_URL);
  url.searchParams.set('organisation_id', tenant);
  url.searchParams.set('limit', '50');
  const response = await fetch(url, {
    headers: {
      'x-agent-key': AGENT_KEY,
      'x-organisation-id': tenant,
    },
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return null;
  const email = String(actor || '').toLowerCase();
  return rows.find((row) => [row.email, row.email_facturation]
    .some((value) => String(value || '').toLowerCase() === email)) || rows[0];
}

function installAICostAttribution() {
  if (installed) return;
  const aiCost = require('./server-ai-cost.cjs');
  const original = aiCost.recordUsage;
  if (typeof original !== 'function') return;

  aiCost.recordUsage = async (raw = {}, actor = 'service') => {
    const metadata = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
      ? { ...raw.metadata }
      : {};
    const mode = safe(metadata.assistant_mode, 30);
    const providedClientId = safe(raw.client_key || metadata.client_id, 120);

    if (providedClientId) {
      return original({
        ...raw,
        client_key: providedClientId,
        metadata: { ...metadata, canonical_client_id: providedClientId, billable: mode === 'client' || metadata.billable === true },
      }, actor);
    }

    if (mode === 'client') {
      const client = await resolveClient(metadata.organisation, actor).catch(() => null);
      if (client?.id) {
        return original({
          ...raw,
          client_key: String(client.id),
          client_name: displayName(client),
          metadata: {
            ...metadata,
            canonical_client_id: String(client.id),
            billable: true,
            attribution: 'organisation+authenticated-user',
          },
        }, actor);
      }
    }

    // Les échanges owner/staff sont des coûts internes JS-Innov.IA par défaut.
    return original({
      ...raw,
      metadata: { ...metadata, billable: metadata.billable === true && mode === 'client' },
    }, actor);
  };
  installed = true;
}

module.exports = { installAICostAttribution, resolveClient };
