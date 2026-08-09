const OPENAI_ADMIN_KEY = process.env.OPENAI_ADMIN_KEY || '';
const XAI_MANAGEMENT_API_KEY = process.env.XAI_MANAGEMENT_API_KEY || '';
const XAI_TEAM_ID = process.env.XAI_TEAM_ID || '';

const OPENAI_BASE_URL = 'https://api.openai.com';
const XAI_MANAGEMENT_BASE_URL = 'https://management-api.x.ai';
const REQUEST_TIMEOUT_MS = Math.min(30000, Math.max(3000, Number(process.env.AI_PROVIDER_BILLING_TIMEOUT_MS) || 12000));

function roundUsd(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(6)) : 0;
}

function formatUtcDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Date invalide');
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = data?.error?.message || data?.message || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Délai dépassé lors de la lecture de la facturation fournisseur');
    if (error instanceof SyntaxError) throw new Error('Réponse fournisseur invalide');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sumOpenAICostResponse(response = {}) {
  let total = 0;
  const lineItems = new Map();
  for (const bucket of Array.isArray(response.data) ? response.data : []) {
    for (const result of Array.isArray(bucket?.results) ? bucket.results : []) {
      const value = Number(result?.amount?.value);
      if (!Number.isFinite(value)) continue;
      total += value;
      const key = String(result?.line_item || 'Autres coûts');
      lineItems.set(key, (lineItems.get(key) || 0) + value);
    }
  }
  return {
    cost_usd: roundUsd(total),
    line_items: [...lineItems.entries()]
      .map(([label, cost]) => ({ label, cost_usd: roundUsd(cost) }))
      .sort((a, b) => b.cost_usd - a.cost_usd),
  };
}

async function fetchOpenAIBilling(window) {
  if (!OPENAI_ADMIN_KEY) {
    return {
      provider: 'openai',
      configured: false,
      available: false,
      currency: 'usd',
      cost_usd: null,
      required_variables: ['OPENAI_ADMIN_KEY'],
      note: 'La facturation OpenAI utilise une clé Admin d’organisation, distincte de la clé API de génération.',
    };
  }

  let page = null;
  let pages = 0;
  let total = 0;
  const lineItems = new Map();

  do {
    const params = new URLSearchParams({
      start_time: String(Math.floor(window.start.getTime() / 1000)),
      end_time: String(Math.floor(window.end.getTime() / 1000)),
      bucket_width: '1d',
      limit: '180',
    });
    params.append('group_by', 'line_item');
    if (page) params.set('page', page);

    const response = await fetchJson(`${OPENAI_BASE_URL}/v1/organization/costs?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${OPENAI_ADMIN_KEY}`,
        Accept: 'application/json',
      },
    });

    const parsed = sumOpenAICostResponse(response);
    total += parsed.cost_usd;
    for (const item of parsed.line_items) {
      lineItems.set(item.label, (lineItems.get(item.label) || 0) + item.cost_usd);
    }

    page = response?.has_more ? response?.next_page : null;
    pages += 1;
  } while (page && pages < 5);

  return {
    provider: 'openai',
    configured: true,
    available: true,
    currency: 'usd',
    cost_usd: roundUsd(total),
    source: 'OpenAI Costs API',
    reconciles_to_invoice: true,
    line_items: [...lineItems.entries()]
      .map(([label, cost]) => ({ label, cost_usd: roundUsd(cost) }))
      .sort((a, b) => b.cost_usd - a.cost_usd),
  };
}

function buildXaiUsageRequest(window) {
  return {
    analyticsRequest: {
      timeRange: {
        startTime: formatUtcDateTime(window.start),
        endTime: formatUtcDateTime(new Date(window.end.getTime() - 1000)),
        timezone: 'Etc/GMT',
      },
      timeUnit: 'TIME_UNIT_DAY',
      values: [{ name: 'usd', aggregation: 'AGGREGATION_SUM' }],
      groupBy: [],
    },
  };
}

function sumXaiUsageResponse(response = {}) {
  let total = 0;
  for (const series of Array.isArray(response.timeSeries) ? response.timeSeries : []) {
    for (const point of Array.isArray(series?.dataPoints) ? series.dataPoints : []) {
      const value = Number(Array.isArray(point?.values) ? point.values[0] : 0);
      if (Number.isFinite(value)) total += value;
    }
  }
  return roundUsd(total);
}

function centsToUsd(value) {
  const number = Number(value);
  return Number.isFinite(number) ? roundUsd(number / 100) : null;
}

async function optionalXaiGet(path) {
  try {
    return await fetchJson(`${XAI_MANAGEMENT_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${XAI_MANAGEMENT_API_KEY}`,
        Accept: 'application/json',
      },
    });
  } catch {
    return null;
  }
}

async function fetchXaiBilling(window) {
  if (!XAI_MANAGEMENT_API_KEY || !XAI_TEAM_ID) {
    const missing = [];
    if (!XAI_MANAGEMENT_API_KEY) missing.push('XAI_MANAGEMENT_API_KEY');
    if (!XAI_TEAM_ID) missing.push('XAI_TEAM_ID');
    return {
      provider: 'xai',
      configured: false,
      available: false,
      currency: 'usd',
      cost_usd: null,
      required_variables: missing,
      note: 'La facturation Grok utilise une clé xAI Management API, distincte de la clé API d’inférence.',
    };
  }

  const encodedTeam = encodeURIComponent(XAI_TEAM_ID);
  const usage = await fetchJson(`${XAI_MANAGEMENT_BASE_URL}/v1/billing/teams/${encodedTeam}/usage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${XAI_MANAGEMENT_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(buildXaiUsageRequest(window)),
  });

  const isCurrentMonth = (() => {
    const now = new Date();
    return window.start.getUTCFullYear() === now.getUTCFullYear() && window.start.getUTCMonth() === now.getUTCMonth();
  })();

  const [prepaid, preview] = await Promise.all([
    optionalXaiGet(`/v1/billing/teams/${encodedTeam}/prepaid/balance`),
    isCurrentMonth ? optionalXaiGet(`/v1/billing/teams/${encodedTeam}/postpaid/invoice/preview`) : Promise.resolve(null),
  ]);

  return {
    provider: 'xai',
    configured: true,
    available: true,
    currency: 'usd',
    cost_usd: sumXaiUsageResponse(usage),
    source: 'xAI Management Billing API',
    limit_reached: Boolean(usage?.limitReached),
    prepaid_balance_raw_cents: prepaid?.total?.val ?? null,
    postpaid_invoice_preview_usd: preview?.coreInvoice?.amountAfterVat != null
      ? centsToUsd(preview.coreInvoice.amountAfterVat)
      : null,
    spending_limit_usd: preview?.effectiveSpendingLimit != null
      ? centsToUsd(preview.effectiveSpendingLimit)
      : null,
  };
}

async function getProviderBilling(window) {
  const settled = await Promise.allSettled([
    fetchOpenAIBilling(window),
    fetchXaiBilling(window),
  ]);

  const providers = settled.map((result, index) => {
    const provider = index === 0 ? 'openai' : 'xai';
    if (result.status === 'fulfilled') return result.value;
    return {
      provider,
      configured: provider === 'openai' ? Boolean(OPENAI_ADMIN_KEY) : Boolean(XAI_MANAGEMENT_API_KEY && XAI_TEAM_ID),
      available: false,
      currency: 'usd',
      cost_usd: null,
      error: String(result.reason?.message || 'Facturation fournisseur indisponible').slice(0, 240),
    };
  });

  const available = providers.filter((item) => item.available && Number.isFinite(Number(item.cost_usd)));
  return {
    month: window.month,
    providers,
    total_provider_cost_usd: roundUsd(available.reduce((sum, item) => sum + Number(item.cost_usd || 0), 0)),
    configured_count: providers.filter((item) => item.configured).length,
    available_count: available.length,
    fetched_at: new Date().toISOString(),
  };
}

module.exports = {
  getProviderBilling,
  fetchOpenAIBilling,
  fetchXaiBilling,
  sumOpenAICostResponse,
  sumXaiUsageResponse,
  buildXaiUsageRequest,
  formatUtcDateTime,
};
