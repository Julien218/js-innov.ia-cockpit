const {
  calculateTotals,
  importOpenAICharges,
  importRailwayCharges,
  getPreviousMonth,
} = require('./server-cost-centers.cjs');

const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.VITE_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.AGENT_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function agentFetch(table, method = 'GET', body = null, id = null) {
  if (!AGENT_KEY) throw new Error('AGENT_API_KEY not configured');
  const url = id ? `${AGENT_URL}/data/${table}/${id}` : `${AGENT_URL}/data/${table}`;
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY },
    body: body && ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Agent API ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
  return text ? JSON.parse(text) : null;
}

async function agentQuery(table, filters = {}) {
  if (!AGENT_KEY) throw new Error('AGENT_API_KEY not configured');
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => params.set(key, String(value)));
  const response = await fetch(`${AGENT_URL}/data/${table}?${params}`, {
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY },
  });
  if (!response.ok) throw new Error(`Agent API ${response.status}`);
  return response.json();
}

async function supabaseSelect(path) {
  if (!SUPABASE_URL || !SUPABASE_SECRET) return [];
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SECRET,
      Authorization: `Bearer ${SUPABASE_SECRET}`,
    },
  });
  if (!response.ok) return [];
  return response.json();
}

function invoiceSequence(invoices, year, month) {
  const prefix = `CC-${year}-${String(month).padStart(2, '0')}-`;
  const used = (invoices || [])
    .map((invoice) => String(invoice.invoice_number || ''))
    .filter((number) => number.startsWith(prefix))
    .map((number) => Number(number.slice(prefix.length)))
    .filter(Number.isFinite);
  return used.length ? Math.max(...used) + 1 : 1;
}

function invoiceNumber(year, month, sequence) {
  return `CC-${year}-${String(month).padStart(2, '0')}-${String(sequence).padStart(3, '0')}`;
}

async function loadProjectExternalLines(centerId, periodMonth) {
  if (!SUPABASE_URL || !SUPABASE_SECRET) return [];
  const scopes = await supabaseSelect(
    `project_cost_scopes?select=id,project_name,billing_mode,cost_center_id&cost_center_id=eq.${encodeURIComponent(centerId)}&billing_mode=eq.draft_for_approval&is_active=eq.true`
  );
  const lines = [];
  for (const scope of scopes) {
    const entries = await supabaseSelect(
      `project_cost_entries?select=provider,source,description,cost_usd,cost_eur_minor,external_ref,metadata&scope_id=eq.${encodeURIComponent(scope.id)}&period_month=eq.${encodeURIComponent(periodMonth)}`
    );
    for (const entry of entries) {
      const provider = String(entry.provider || 'other').toLowerCase();
      const lineType = provider === 'railway'
        ? 'railway'
        : ['openai', 'xai', 'anthropic', 'gemini', 'mistral', 'groq', 'deepseek', 'openrouter', 'perplexity'].includes(provider)
          ? 'llm_api'
          : 'other';
      const totalMinor = Math.max(0, Number(entry.cost_eur_minor || 0));
      if (!totalMinor) continue;
      lines.push({
        line_type: lineType,
        description: entry.description || `${provider} — ${scope.project_name}`,
        quantity: 1,
        unit_price_minor: totalMinor,
        total_minor: totalMinor,
        external_ref: entry.external_ref || `${provider}:${scope.id}:${periodMonth}`,
        metadata: {
          ...(entry.metadata || {}),
          source: entry.source || 'project_cost_entries',
          provider,
          project_scope_id: scope.id,
          project_name: scope.project_name,
        },
      });
    }
  }
  return lines;
}

async function importCenterCosts(center, year, month) {
  const mappings = await agentQuery('client_external_mappings', { cost_center_id: center.id, is_active: 'true' });
  const lines = [];
  const warnings = [];

  for (const mapping of mappings || []) {
    let result = null;
    if (mapping.service_type === 'openai_project') {
      result = await importOpenAICharges(mapping, year, month);
    } else if (mapping.service_type === 'railway_project') {
      result = await importRailwayCharges(mapping, year, month);
    }
    if (!result) continue;
    lines.push(...(result.lines || []));
    if (result.error) warnings.push({ mapping: mapping.external_label || mapping.external_id, error: result.error });
  }

  const period = `${year}-${String(month).padStart(2, '0')}`;
  const externalLines = await loadProjectExternalLines(center.id, period);
  const existingRefs = new Set(lines.map((line) => line.external_ref).filter(Boolean));
  for (const line of externalLines) {
    if (line.external_ref && existingRefs.has(line.external_ref)) continue;
    lines.push(line);
  }

  return { lines, warnings };
}

async function prepareMonthlyBilling(now = new Date()) {
  const currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Brussels', year: 'numeric' }).format(now));
  const currentMonth = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Brussels', month: 'numeric' }).format(now));
  const period = getPreviousMonth(currentYear, currentMonth);
  const centers = await agentQuery('client_cost_centers', { is_active: 'true' });
  const periodInvoices = await agentQuery('client_invoices', { period_year: period.year, period_month: period.month });
  let sequence = invoiceSequence(periodInvoices, period.year, period.month);
  const results = [];

  for (const center of centers || []) {
    const metadata = center.metadata && typeof center.metadata === 'object' ? center.metadata : {};
    if (metadata.billing_mode === 'track_only' || metadata.owner_type === 'internal') {
      results.push({ product_code: center.product_code, skipped: true, reason: 'track_only' });
      continue;
    }

    const existing = (periodInvoices || []).find((invoice) => invoice.cost_center_id === center.id && invoice.status !== 'cancelled');
    if (existing) {
      results.push({ product_code: center.product_code, skipped: true, reason: 'already_exists', invoice_number: existing.invoice_number });
      continue;
    }

    try {
      const imported = await importCenterCosts(center, period.year, period.month);
      const invoiceLines = [];
      let sortOrder = 0;

      if (Number(center.monthly_fee_minor || 0) > 0) {
        invoiceLines.push({
          line_type: 'forfait',
          description: `Forfait mensuel — ${center.product_code}`,
          quantity: 1,
          unit_price_minor: Number(center.monthly_fee_minor),
          total_minor: Number(center.monthly_fee_minor),
          sort_order: sortOrder++,
        });
      }

      for (const line of imported.lines) {
        if (line.line_type === 'domain' || /domaine/i.test(line.description || '')) continue;
        invoiceLines.push({ ...line, sort_order: sortOrder++ });
      }

      const totals = calculateTotals(invoiceLines);
      const number = invoiceNumber(period.year, period.month, sequence++);
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + 30);

      const invoice = await agentFetch('client_invoices', 'POST', {
        cost_center_id: center.id,
        invoice_number: number,
        period_year: period.year,
        period_month: period.month,
        status: 'draft',
        approval_status: 'pending',
        subtotal_minor: totals.subtotalMinor,
        tax_rate: totals.taxRate,
        tax_amount_minor: totals.taxAmountMinor,
        total_minor: totals.totalMinor,
        currency: center.currency || 'EUR',
        due_date: dueDate.toISOString().split('T')[0],
        notes: 'Brouillon mensuel généré automatiquement — validation humaine obligatoire avant envoi.',
      });

      for (const line of invoiceLines) {
        await agentFetch('client_invoice_lines', 'POST', { ...line, invoice_id: invoice.id });
      }

      results.push({
        product_code: center.product_code,
        invoice_id: invoice.id,
        invoice_number: number,
        status: 'draft',
        approval_status: 'pending',
        total_minor: totals.totalMinor,
        line_count: invoiceLines.length,
        warnings: imported.warnings,
      });
    } catch (error) {
      results.push({ product_code: center.product_code, error: error.message });
    }
  }

  return {
    period: `${period.year}-${String(period.month).padStart(2, '0')}`,
    results,
  };
}

module.exports = { prepareMonthlyBilling, invoiceSequence, invoiceNumber, loadProjectExternalLines };