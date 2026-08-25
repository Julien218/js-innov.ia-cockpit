const {
  parseGitHubUsage,
  parseTwilioUsage,
  sourceToEurMinor,
  stableRef,
} = require('./server-cost-accounting-core.cjs');

function periodKey(year, month) {
  return `${Number(year)}-${String(Number(month)).padStart(2, '0')}`;
}

function total(lines) {
  return (lines || []).reduce((sum, line) => sum + Math.max(0, Number(line.total_minor || 0)), 0);
}

async function readJson(response, provider) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!response.ok) throw new Error(`${provider} API ${response.status}: ${data.message || data.error || 'échec du collecteur'}`);
  return data;
}

async function importGitHubCharges(mapping, periodYear, periodMonth, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const token = String(env.GITHUB_BILLING_TOKEN || env.GITHUB_TOKEN || '').trim();
  if (!token) return { lines: [], totalEurMinor: 0, error: 'GITHUB_BILLING_TOKEN non configuré' };

  const period = periodKey(periodYear, periodMonth);
  const metadata = mapping.metadata && typeof mapping.metadata === 'object' ? mapping.metadata : {};
  let accountType = mapping.service_type === 'github_org' ? 'organization' : 'user';
  let account = String(mapping.external_id || '').trim();
  if (mapping.service_type === 'github_repo') {
    const [owner] = account.split('/');
    account = String(metadata.billing_account || owner || '').trim();
    accountType = metadata.account_type === 'organization' ? 'organization' : 'user';
  }
  if (!account) return { lines: [], totalEurMinor: 0, error: 'Compte GitHub absent du rattachement' };
  const base = accountType === 'organization'
    ? `/organizations/${encodeURIComponent(account)}`
    : `/users/${encodeURIComponent(account)}`;
  const url = `https://api.github.com${base}/settings/billing/usage?year=${Number(periodYear)}&month=${Number(periodMonth)}`;

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'JS-InnovIA-Cockpit-Cost-Control',
      },
    });
    const data = await readJson(response, 'GitHub');
    const lines = parseGitHubUsage(data, mapping, period, env);
    return { lines, totalEurMinor: total(lines), provider: 'github', evidenceStatus: 'actual' };
  } catch (error) {
    return { lines: [], totalEurMinor: 0, error: error.message, provider: 'github' };
  }
}

async function importTwilioCharges(mapping, periodYear, periodMonth, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const accountSid = String(mapping.external_id || env.TWILIO_ACCOUNT_SID || '').trim();
  const authSid = String(env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(env.TWILIO_AUTH_TOKEN || '').trim();
  if (!accountSid || !authSid || !authToken) return { lines: [], totalEurMinor: 0, error: 'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN ou rattachement Twilio manquant' };

  const start = `${Number(periodYear)}-${String(Number(periodMonth)).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(Number(periodYear), Number(periodMonth), 0));
  const end = endDate.toISOString().slice(0, 10);
  const period = periodKey(periodYear, periodMonth);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Usage/Records.json?StartDate=${start}&EndDate=${end}&Category=totalprice`;

  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${authSid}:${authToken}`).toString('base64')}` },
    });
    const data = await readJson(response, 'Twilio');
    const lines = parseTwilioUsage(data, mapping, period, env);
    return { lines, totalEurMinor: total(lines), provider: 'twilio', evidenceStatus: 'actual' };
  } catch (error) {
    return { lines: [], totalEurMinor: 0, error: error.message, provider: 'twilio' };
  }
}

const ADAPTER_SOURCES = {
  supabase_project: { sourceType: 'supabase', envKey: 'SUPABASE_COSTS_ENDPOINT', idParam: 'project_id' },
  dropbox_account: { sourceType: 'dropbox', envKey: 'DROPBOX_COSTS_ENDPOINT', idParam: 'account_id' },
  media_provider: { sourceType: 'media_ai', envKey: 'MEDIA_COSTS_ENDPOINT', idParam: 'provider_id' },
};

async function importVerifiedAdapterCharges(mapping, periodYear, periodMonth, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const definition = ADAPTER_SOURCES[mapping.service_type];
  if (!definition) return { lines: [], totalEurMinor: 0, error: `Adaptateur inconnu: ${mapping.service_type}` };
  const endpoint = String(env[definition.envKey] || '').trim();
  const token = String(env.COST_IMPORT_ADAPTER_TOKEN || '').trim();
  if (!endpoint || !token) {
    return { lines: [], totalEurMinor: 0, provider: definition.sourceType, error: `${definition.envKey}/COST_IMPORT_ADAPTER_TOKEN non configuré` };
  }
  const externalId = String(mapping.external_id || '').trim();
  if (!externalId) return { lines: [], totalEurMinor: 0, provider: definition.sourceType, error: 'Identifiant externe absent du rattachement' };

  const period = periodKey(periodYear, periodMonth);

  try {
    const url = new URL(endpoint);
    url.searchParams.set(definition.idParam, externalId);
    url.searchParams.set('year', String(Number(periodYear)));
    url.searchParams.set('month', String(Number(periodMonth)));
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const data = await readJson(response, definition.sourceType);
    if (data.accounting_status !== 'actual') throw new Error(`${definition.sourceType}: accounting_status=actual requis`);
    const items = Array.isArray(data.costs) ? data.costs : Array.isArray(data.data) ? data.data : [];
    const lines = items.map((item) => {
      const amount = Number(item.net_amount ?? item.cost ?? item.amount);
      if (!Number.isFinite(amount) || amount < 0) throw new Error(`${definition.sourceType}: montant fournisseur invalide`);
      const verificationRef = String(item.verification_ref || '').trim();
      if (!verificationRef) throw new Error(`${definition.sourceType}: verification_ref requis`);
      const currency = String(item.currency || 'EUR').toUpperCase();
      const converted = sourceToEurMinor(amount, currency, env);
      const itemRef = stableRef([definition.sourceType, externalId, period, item.id, item.name, amount, currency, verificationRef]);
      return {
        line_type: definition.sourceType,
        description: `${definition.sourceType === 'media_ai' ? 'Génération média' : definition.sourceType} — ${item.name || item.service || item.id || period}`,
        total_minor: converted.totalMinor,
        external_ref: `${definition.sourceType}:${externalId}:${period}:${itemRef}`,
        metadata: {
          evidence_status: 'actual',
          verification_ref: verificationRef,
          source: definition.sourceType,
          source_amount: amount,
          source_currency: currency,
          fx_rate: converted.fxRate,
          fx_source: converted.fxSource,
          external_id: externalId,
          usage: item.usage || null,
          model: item.model || null,
          generation_id: item.generation_id || null,
        },
      };
    }).filter((line) => line.total_minor > 0);
    return { lines, totalEurMinor: total(lines), provider: definition.sourceType, evidenceStatus: 'actual' };
  } catch (error) {
    return { lines: [], totalEurMinor: 0, provider: definition.sourceType, error: error.message };
  }
}

module.exports = { importGitHubCharges, importTwilioCharges, importVerifiedAdapterCharges, periodKey };
