// Account-wide IONOS reads. No write tools, arbitrary URLs or browser credentials.
const Ajv = require('ajv');
const catalog = require('./ionos-read-tools.json');
const ENDPOINT = 'https://mcp.ionos.com/mcp';
const CLOUD = 'https://api.ionos.com/cloudapi/v6';
const tools = new Map(catalog.map(tool => [tool.name, tool]));
const ajv = new Ajv({ strict: false });
const validators = new Map(catalog.map(tool => [tool.name, ajv.compile(tool.inputSchema)]));
const cloudSchema = { type: 'object', additionalProperties: false, properties: {
  datacenter_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' },
  server_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' },
  offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 },
} };
validators.set('cloud_read', ajv.compile(cloudSchema));

function failure(message, status = 502) { return Object.assign(new Error(message), { status }); }
function secret(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw failure(`Connexion IONOS à configurer : ${name} absent des variables Railway.`, 503);
  if (/[\r\n]/.test(value)) throw failure('Identifiant IONOS invalide.', 503);
  return value;
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /password|secret|token|authcode|authinfo|privatekey/i.test(key.replace(/[^a-z]/gi, '')) ? '[masqué]' : redact(item)]));
  if (typeof value === 'string') {
    for (const name of ['IONOS_PAT', 'IONOS_CLOUD_TOKEN']) {
      if (process.env[name]) value = value.split(process.env[name]).join('[masqué]');
    }
  }
  return value;
}
function configuration() {
  return { version: 'ionos-read-v1', read_only: true,
    hosting_configured: Boolean(String(process.env.IONOS_PAT || '').trim()),
    cloud_configured: Boolean(String(process.env.IONOS_CLOUD_TOKEN || '').trim()),
    // Configuration presence is not proof that credentials work.
    connection_verified: false };
}
function validate(name, args) {
  if (!validators.has(name)) throw failure('Opération IONOS non autorisée. Consultation uniquement.', 400);
  if (!validators.get(name)(args)) throw failure('Paramètres IONOS invalides.', 400);
  if (name === 'cloud_read' && args.server_id && !args.datacenter_id) throw failure('Centre de données requis.', 400);
}
async function hostingRead(name, args, fetchImpl = global.fetch) {
  const token = secret('IONOS_PAT');
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const signal = AbortSignal.timeout(30_000);
  const client = new Client({ name: 'nova-elynea-ionos', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' },
    fetch: (input, init = {}) => {
      if (String(input) !== ENDPOINT) throw failure('Destination IONOS non autorisée.');
      return fetchImpl(input, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal });
    },
    reconnectionOptions: { maxRetries: 0 },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 25_000 });
    if (result.isError) throw failure('Lecture refusée par IONOS. Vérifier le contrat et les permissions du PAT.');
    const data = result.structuredContent || result.content?.filter(item => item.type === 'text').map(item => {
      try { return JSON.parse(item.text); } catch { return item.text; }
    });
    return redact(data);
  } catch (_) {
    throw failure('Lecture IONOS impossible. Vérifier le PAT, ses permissions, le contrat et la disponibilité du service.');
  } finally { await client.close().catch(() => {}); }
}
async function cloudRead(args, fetchImpl = global.fetch) {
  let path = '/datacenters';
  if (args.datacenter_id) path += `/${args.datacenter_id}/servers`;
  if (args.server_id) path += `/${args.server_id}`;
  const query = new URLSearchParams({ depth: args.server_id ? '2' : '1' });
  if (!args.server_id) { query.set('offset', String(args.offset || 0)); query.set('limit', String(args.limit || 100)); }
  const token = secret('IONOS_CLOUD_TOKEN');
  try {
    const response = await fetchImpl(`${CLOUD}${path}?${query}`, { method: 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw failure('Cloud API indisponible.');
    return redact(await response.json());
  } catch (_) { throw failure('Lecture Public Cloud impossible. Vérifier le token et ses droits.'); }
}
async function read(name, args = {}, options = {}) {
  validate(name, args);
  const data = name === 'cloud_read' ? await cloudRead(args, options.fetchImpl) : await hostingRead(name, args, options.fetchImpl);
  return { provider: 'IONOS', read_only: true, tool: name, checked_at: new Date().toISOString(), data };
}
function rows(value) {
  if (Array.isArray(value)) {
    if (value.length === 1 && (Array.isArray(value[0]) || (value[0] && typeof value[0] === 'object' && !value[0].id))) return rows(value[0]);
    return value;
  }
  if (value && typeof value === 'object') {
    for (const key of ['items', 'domains', 'zones', 'records', 'servers', 'contracts', 'data', 'result']) {
      if (value[key] !== undefined) return rows(value[key]);
    }
    return [value];
  }
  return value ? [value] : [];
}
function chatIntent(message) {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!/\bionos\b/.test(text)) return null;
  // Existing mailbox routing owns IONOS email requests.
  if (/\b(emails?|mails?|courriels?|boite)\b/.test(text) && !/\bdns\b|\bvps\b|serveur|domaine/.test(text)) return null;
  if (/supprim|effac|modifi|chang|cre[ez]|creer|redemarr|arret|stop|reinstall|transfer|achete|deploy|deploi|ajout/.test(text)) return 'write_unsupported';
  if (/public cloud|datacenter|centre de donnees|\bdcd\b/.test(text)) return 'cloud_read';
  if (/\bvps\b/.test(text)) return 'corevps_list_contracts';
  if (/dedie|serveur/.test(text)) return 'dedicatedserver_list_contracts';
  if (/\bdns\b|zone|enregistrement/.test(text)) return 'dns_get_zones';
  if (/domaine/.test(text)) return 'domains_list_domains';
  return 'status';
}
module.exports = { read, validate, redact, configuration, rows, chatIntent, catalog, tools, cloudRead };
