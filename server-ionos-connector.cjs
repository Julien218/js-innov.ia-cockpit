// Account-wide IONOS reads. No write tools, arbitrary URLs or browser credentials.
const Ajv = require('ajv');
const catalog = require('./ionos-read-tools.json');
const ENDPOINT = 'https://mcp.ionos.com/mcp';
const CLOUD = 'https://api.ionos.com/cloudapi/v6';
const DNS = 'https://api.hosting.ionos.com/dns/v1/zones';
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
function dnsAccountDefinitions() {
  return [
    { id: 'primary', label: 'Compte IONOS 1', env: 'IONOS_DNS_API_KEY' },
    { id: 'secondary', label: 'Compte IONOS 2', env: 'IONOS_DNS_API_KEY_SECONDARY' },
  ];
}
function configuredDnsAccounts() {
  return dnsAccountDefinitions().filter(account => String(process.env[account.env] || '').trim());
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /password|secret|token|authcode|authinfo|privatekey/i.test(key.replace(/[^a-z]/gi, '')) ? '[masqué]' : redact(item)]));
  if (typeof value === 'string') {
    for (const name of ['IONOS_PAT', 'IONOS_CLOUD_TOKEN', 'IONOS_DNS_API_KEY', 'IONOS_PAT_SECONDARY', 'IONOS_CLOUD_TOKEN_SECONDARY', 'IONOS_DNS_API_KEY_SECONDARY']) {
      if (process.env[name]) value = value.split(process.env[name]).join('[masqué]');
    }
  }
  return value;
}
function configuration() {
  const accounts = configuredDnsAccounts();
  return { version: 'ionos-read-v3', read_only: true,
    hosting_configured: Boolean(String(process.env.IONOS_PAT || '').trim()),
    dns_configured: accounts.length > 0,
    dns_account_count: accounts.length,
    dns_accounts: accounts.map(({ id, label }) => ({ id, label, configured: true })),
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
  const dnsFallback = !configuration().hosting_configured && configuration().dns_configured && ['dns_get_zones', 'dns_get_zone', 'domains_list_domains'].includes(name);
  const data = dnsFallback ? await dnsRead(name, args, options.fetchImpl)
    : name === 'cloud_read' ? await cloudRead(args, options.fetchImpl) : await hostingRead(name, args, options.fetchImpl);
  const scope = dnsFallback && name === 'domains_list_domains' ? 'dns_zones_only' : undefined;
  return { provider: 'IONOS', read_only: true, tool: name, checked_at: new Date().toISOString(), data, scope,
    notice: scope ? 'Domaines présents dans les zones DNS ; cet accès ne fournit pas l’inventaire des contrats de domaines.' : undefined };
}
async function dnsRead(name, args, fetchImpl = global.fetch, accountId = 'primary') {
  let url = DNS;
  if (name === 'dns_get_zone') {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(args.zone_id)) throw failure('Identifiant de zone invalide.', 400);
    url += `/${args.zone_id}`;
    const query = new URLSearchParams();
    if (args.record_name) query.set('recordName', args.record_name);
    if (args.record_type) query.set('recordType', args.record_type);
    if (query.size) url += `?${query}`;
  }
  const account = dnsAccountDefinitions().find(item => item.id === accountId);
  if (!account) throw failure('Compte IONOS inconnu.', 400);
  const key = secret(account.env);
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error',
      headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw failure('DNS API indisponible.');
    const data = redact(await response.json());
    if (name !== 'domains_list_domains') return data;
    if (args.tld || args.pending_provisioning !== undefined || args.include_domain_status) {
      throw failure('Ces filtres de domaines nécessitent le PAT Hosting.', 400);
    }
    const filtered = rows(data).filter(item => !args.name || String(item.name || item.zoneName || '').includes(args.name));
    return filtered.slice(args.offset || 0, (args.offset || 0) + (args.limit || 100));
  } catch (error) {
    if (error.status === 400) throw error;
    throw failure('Lecture DNS impossible. Vérifier la clé API Hosting et ses droits.');
  }
}
function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\.$/, '').split('/')[0];
}
function domainFromMessage(message) {
  const source = String(message || '').toLowerCase();
  const match = source.match(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/i);
  return match ? normalizeDomain(match[0]) : null;
}
async function findDnsZone(domainValue, fetchImpl = global.fetch) {
  const domain = normalizeDomain(domainValue);
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw failure('Domaine DNS invalide.', 400);
  }
  const accounts = configuredDnsAccounts();
  if (!accounts.length) throw failure('Connexion IONOS DNS à configurer dans Railway.', 503);
  let reachable = 0;
  for (const account of accounts) {
    try {
      const zones = await dnsRead('dns_get_zones', {}, fetchImpl, account.id);
      reachable += 1;
      const zone = rows(zones).find(item => normalizeDomain(item?.zoneName || item?.name || item?.properties?.zoneName) === domain);
      if (zone?.id) return { account_id: account.id, account_label: account.label, zone };
    } catch (_) {
      // Un compte indisponible ne doit pas empêcher la recherche dans l'autre compte.
    }
  }
  if (!reachable) throw failure('Lecture DNS IONOS impossible sur les comptes configurés.', 502);
  const error = failure(`Zone IONOS introuvable pour ${domain}.`, 404);
  error.code = 'IONOS_ZONE_NOT_FOUND';
  throw error;
}
async function readDomainDns(domainValue, options = {}) {
  const domain = normalizeDomain(domainValue);
  const found = await findDnsZone(domain, options.fetchImpl);
  const data = await dnsRead('dns_get_zone', { zone_id: String(found.zone.id) }, options.fetchImpl, found.account_id);
  return {
    provider: 'IONOS',
    read_only: true,
    tool: 'dns_get_zone',
    checked_at: new Date().toISOString(),
    domain,
    account_id: found.account_id,
    account_label: found.account_label,
    zone_id: found.zone.id,
    zone_name: found.zone.zoneName || found.zone.name || domain,
    data: redact(data),
  };
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
  const explicitIonos = /\bionos\b/.test(text);
  const domain = domainFromMessage(message);
  const dnsTopic = /\bdns\b|zone|enregistrement/.test(text);
  const mutation = /supprim|effac|modifi|chang|cre[ez]|creer|redemarr|arret|stop|reinstall|transfer|achete|deploy|deploi|ajout/.test(text);

  // Une simple consultation DNS avec un domaine doit utiliser IONOS même si
  // l'utilisateur ne prononce pas le nom du fournisseur.
  if (!explicitIonos && dnsTopic && domain && !mutation) return 'dns_domain';
  if (!explicitIonos) return null;

  // Existing mailbox routing owns IONOS email requests.
  if (/\b(emails?|mails?|courriels?|boite)\b/.test(text) && !dnsTopic && !/\bvps\b|serveur|domaine/.test(text)) return null;
  if (mutation) return 'write_unsupported';
  if (/public cloud|datacenter|centre de donnees|\bdcd\b/.test(text)) return 'cloud_read';
  if (/\bvps\b/.test(text)) return 'corevps_list_contracts';
  if (/dedie|serveur/.test(text)) return 'dedicatedserver_list_contracts';
  if (dnsTopic && domain) return 'dns_domain';
  if (dnsTopic) return 'dns_get_zones';
  if (/domaine/.test(text)) return 'domains_list_domains';
  return 'status';
}
module.exports = {
  read, validate, redact, configuration, rows, chatIntent, catalog, tools, cloudRead,
  domainFromMessage, findDnsZone, readDomainDns, configuredDnsAccounts,
};
