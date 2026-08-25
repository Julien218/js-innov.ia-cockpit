const crypto = require('crypto');

const EVIDENCE_STATUSES = new Set(['actual', 'estimated', 'manual_verified', 'unverified']);

const SOURCE_CATALOG = [
  { id: 'llm_api', label: 'LLM / API IA', mappingTypes: ['openai_project'], mode: 'api', envAny: ['OPENAI_ADMIN_KEY'] },
  { id: 'railway', label: 'Railway par projet et service', mappingTypes: ['railway_project', 'railway_service'], mode: 'adapter', envAll: ['RAILWAY_API_TOKEN', 'RAILWAY_COSTS_ENDPOINT'] },
  { id: 'github', label: 'GitHub Actions, Packages et Copilot', mappingTypes: ['github_user', 'github_org', 'github_repo'], mode: 'api', envAny: ['GITHUB_BILLING_TOKEN', 'GITHUB_TOKEN'] },
  { id: 'local_ai', label: 'IA locale (machine + électricité)', mappingTypes: [], mode: 'calculation', envAll: ['LOCAL_AI_POWER_WATTS', 'LOCAL_AI_ENERGY_EUR_KWH', 'LOCAL_AI_MACHINE_EUR_HOUR'] },
  { id: 'twilio', label: 'Twilio', mappingTypes: ['twilio_account'], mode: 'api', envAll: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] },
  { id: 'supabase', label: 'Supabase', mappingTypes: ['supabase_project'], mode: 'adapter', envAll: ['SUPABASE_COSTS_ENDPOINT', 'COST_IMPORT_ADAPTER_TOKEN'] },
  { id: 'dropbox', label: 'Dropbox', mappingTypes: ['dropbox_account'], mode: 'adapter', envAll: ['DROPBOX_COSTS_ENDPOINT', 'COST_IMPORT_ADAPTER_TOKEN'] },
  { id: 'storage', label: 'Stockage et sauvegardes', mappingTypes: ['storage_account'], mode: 'invoice' },
  { id: 'media_ai', label: 'Génération vidéo / image', mappingTypes: ['media_provider'], mode: 'adapter', envAll: ['MEDIA_COSTS_ENDPOINT', 'COST_IMPORT_ADAPTER_TOKEN'] },
  { id: 'communications', label: 'Communications', mappingTypes: ['communications_provider'], mode: 'usage' },
  { id: 'api', label: 'Autres API', mappingTypes: ['api_provider'], mode: 'usage' },
  { id: 'other', label: 'Autres frais techniques', mappingTypes: ['other_provider'], mode: 'invoice' },
];

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function minor(value) {
  return Math.max(0, Math.round(number(value)));
}

function evidenceStatus(event = {}) {
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  const explicit = String(metadata.evidence_status || '').trim().toLowerCase();
  if (EVIDENCE_STATUSES.has(explicit)) return explicit;
  if (metadata.cost_estimated === true || metadata.estimated === true || event.source_type === 'local_ai') return 'estimated';
  if (metadata.manual === true && metadata.verification_ref) return 'manual_verified';
  return 'unverified';
}

function validateEvidence({ status, verificationRef, calculationMethod, calculationInputs, billable }) {
  const normalized = EVIDENCE_STATUSES.has(status) ? status : 'unverified';
  if ((normalized === 'actual' || normalized === 'manual_verified') && !String(verificationRef || '').trim()) {
    throw new Error('verification_ref requis pour un coût réel ou vérifié manuellement');
  }
  if (normalized === 'estimated' && (!String(calculationMethod || '').trim() || !calculationInputs || typeof calculationInputs !== 'object')) {
    throw new Error('calculation_method et calculation_inputs requis pour un coût estimé');
  }
  if (normalized === 'unverified' && billable !== false) {
    throw new Error('Un coût non vérifié ne peut pas être facturable');
  }
  return normalized;
}

function summarizeAccounting(events = []) {
  const totals = {
    actual_cost_minor: 0,
    manual_verified_minor: 0,
    estimated_cost_minor: 0,
    unverified_cost_minor: 0,
    billable_minor: 0,
    unbilled_billable_minor: 0,
    actual_events: 0,
    manual_verified_events: 0,
    estimated_events: 0,
    unverified_events: 0,
  };
  const bySource = new Map();

  for (const event of events || []) {
    const source = String(event.source_type || 'other');
    const status = evidenceStatus(event);
    const amount = minor(event.actual_cost_minor);
    const row = bySource.get(source) || {
      source_type: source,
      actual_cost_minor: 0,
      manual_verified_minor: 0,
      estimated_cost_minor: 0,
      unverified_cost_minor: 0,
      billable_minor: 0,
      events: 0,
      unverified_events: 0,
    };
    row.events += 1;

    if (status === 'actual') {
      totals.actual_cost_minor += amount;
      totals.actual_events += 1;
      row.actual_cost_minor += amount;
    } else if (status === 'manual_verified') {
      totals.manual_verified_minor += amount;
      totals.manual_verified_events += 1;
      row.manual_verified_minor += amount;
    } else if (status === 'estimated') {
      totals.estimated_cost_minor += amount;
      totals.estimated_events += 1;
      row.estimated_cost_minor += amount;
    } else {
      totals.unverified_events += 1;
      row.unverified_events += 1;
      totals.unverified_cost_minor += amount;
      row.unverified_cost_minor += amount;
    }

    if (status !== 'unverified' && event.billable) {
      const billableAmount = minor(event.billable_minor);
      totals.billable_minor += billableAmount;
      row.billable_minor += billableAmount;
      if (!event.facture_id && !event.invoice_id) totals.unbilled_billable_minor += billableAmount;
    }
    bySource.set(source, row);
  }

  return {
    ...totals,
    verified_cost_minor: totals.actual_cost_minor + totals.manual_verified_minor,
    by_source: [...bySource.values()].sort((a, b) => (b.actual_cost_minor + b.manual_verified_minor + b.estimated_cost_minor + b.unverified_cost_minor) - (a.actual_cost_minor + a.manual_verified_minor + a.estimated_cost_minor + a.unverified_cost_minor)),
  };
}

function configured(env, source, mappings = []) {
  const envAll = source.envAll || [];
  const envAny = source.envAny || [];
  const missingAll = envAll.filter((key) => !String(env[key] || '').trim());
  const anyOk = !envAny.length || envAny.some((key) => String(env[key] || '').trim());
  const relevantMappings = mappings.filter((mapping) => source.mappingTypes.includes(mapping.service_type) && mapping.is_active !== false);
  const mappingRequired = source.mappingTypes.length > 0;
  const missing = [...missingAll];
  if (!anyOk) missing.push(envAny.join(' ou '));
  if (mappingRequired && relevantMappings.length === 0) missing.push('rattachement client/projet');
  const ready = missing.length === 0 && source.mode !== 'invoice';
  return {
    ...source,
    ready,
    mappings: relevantMappings.length,
    missing_configuration: missing,
    accounting_state: ready ? 'connected' : source.mode === 'invoice' ? 'invoice_required' : 'configuration_required',
  };
}

function buildSourceCoverage(env = {}, mappings = [], events = []) {
  const summary = summarizeAccounting(events);
  const stats = new Map(summary.by_source.map((row) => [row.source_type, row]));
  return SOURCE_CATALOG.map((source) => {
    const amounts = stats.get(source.id) || {
      actual_cost_minor: 0,
      manual_verified_minor: 0,
      estimated_cost_minor: 0,
      unverified_cost_minor: 0,
      billable_minor: 0,
      events: 0,
      unverified_events: 0,
    };
    const state = configured(env, source, mappings);
    const documented = amounts.actual_cost_minor > 0 || amounts.manual_verified_minor > 0 || amounts.estimated_cost_minor > 0;
    return {
      ...state,
      ...amounts,
      documented,
      accounting_state: documented ? 'documented' : state.accounting_state,
      ready: documented || state.ready,
    };
  });
}

function accountingCompleteness(sources = []) {
  const gaps = (sources || [])
    .filter((source) => !source.documented)
    .map((source) => ({ id: source.id, label: source.label, state: source.accounting_state, missing: source.missing_configuration || [] }));
  return {
    complete: gaps.length === 0,
    scope: 'operational_cost_ledger',
    warning: gaps.length
      ? 'AI Cost Control ne constitue pas encore un total comptable complet. Les sources absentes, non connectées ou sans justificatif restent exclues.'
      : null,
    gaps,
  };
}

function sourceToEurMinor(amount, currency, env = process.env) {
  const sourceAmount = number(amount, NaN);
  if (!Number.isFinite(sourceAmount)) throw new Error('Montant fournisseur invalide');
  const code = String(currency || '').trim().toUpperCase();
  if (code === 'EUR') return { totalMinor: minor(sourceAmount * 100), fxRate: 1, fxSource: 'provider_currency_eur' };
  if (code !== 'USD') throw new Error(`Devise fournisseur non prise en charge: ${code || 'absente'}`);
  const fxRate = number(env.BILLING_EUR_PER_USD, 0);
  const fxSource = String(env.BILLING_FX_SOURCE || '').trim();
  if (!(fxRate > 0) || !fxSource) throw new Error('BILLING_EUR_PER_USD et BILLING_FX_SOURCE requis pour convertir un coût USD');
  return { totalMinor: minor(sourceAmount * fxRate * 100), fxRate, fxSource };
}

function stableRef(parts) {
  const raw = parts.map((part) => String(part ?? '')).join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function parseGitHubUsage(data, mapping, period, env = process.env) {
  const items = Array.isArray(data?.usageItems) ? data.usageItems : [];
  const wantedRepo = mapping.service_type === 'github_repo' ? String(mapping.external_id || '').toLowerCase() : '';
  return items
    .filter((item) => {
      if (!wantedRepo) return true;
      const repository = String(item.repositoryName || '').toLowerCase();
      return repository === wantedRepo || repository === wantedRepo.split('/').pop();
    })
    .filter((item) => number(item.netAmount, 0) !== 0)
    .map((item) => {
      const amountUsd = number(item.netAmount, 0);
      if (amountUsd < 0) throw new Error('GitHub a retourné un avoir négatif; import comptable manuel requis');
      const converted = sourceToEurMinor(amountUsd, 'USD', env);
      const reference = stableRef([period, item.date, item.product, item.sku, item.repositoryName, item.netAmount]);
      return {
        line_type: 'github',
        description: `GitHub — ${item.product || 'Service'} — ${item.sku || 'usage'}${item.repositoryName ? ` — ${item.repositoryName}` : ''}`,
        total_minor: converted.totalMinor,
        external_ref: `github:${mapping.external_id}:${period}:${reference}`,
        metadata: {
          evidence_status: 'actual',
          verification_ref: `github-billing-api:${mapping.external_id}:${period}:${reference}`,
          source: 'github',
          source_amount: amountUsd,
          source_currency: 'USD',
          fx_rate: converted.fxRate,
          fx_source: converted.fxSource,
          product: item.product || null,
          product_key: String(item.product || '').trim().toLowerCase(),
          sku: item.sku || null,
          repository: item.repositoryName || null,
          gross_amount: number(item.grossAmount, 0),
          discount_amount: number(item.discountAmount, 0),
          net_amount: amountUsd,
        },
      };
    });
}

function parseTwilioUsage(data, mapping, period, env = process.env) {
  const records = Array.isArray(data?.usage_records) ? data.usage_records : Array.isArray(data?.usageRecords) ? data.usageRecords : [];
  const total = records.find((record) => String(record.category || '').toLowerCase() === 'totalprice');
  if (!total) throw new Error('Twilio totalprice absent: import bloqué pour éviter un double comptage des catégories');
  const rawPrice = number(total.price ?? total.usage, NaN);
  if (!Number.isFinite(rawPrice)) throw new Error('Twilio totalprice invalide');
  if (rawPrice < 0) throw new Error('Twilio a retourné un avoir négatif; import comptable manuel requis');
  const currency = String(total.price_unit || total.priceUnit || total.usage_unit || total.usageUnit || '').toUpperCase();
  const converted = sourceToEurMinor(rawPrice, currency, env);
  const reference = stableRef([mapping.external_id, period, total.as_of || total.asOf, rawPrice, currency]);
  return rawPrice === 0 ? [] : [{
    line_type: 'twilio',
    description: `Twilio — consommation ${period}`,
    total_minor: converted.totalMinor,
    external_ref: `twilio:${mapping.external_id}:${period}:${reference}`,
    metadata: {
      evidence_status: 'actual',
      verification_ref: `twilio-usage-api:${mapping.external_id}:${period}:${reference}`,
      source: 'twilio',
      source_amount: rawPrice,
      source_currency: currency,
      fx_rate: converted.fxRate,
      fx_source: converted.fxSource,
      as_of: total.as_of || total.asOf || null,
    },
  }];
}

module.exports = {
  EVIDENCE_STATUSES,
  SOURCE_CATALOG,
  evidenceStatus,
  validateEvidence,
  summarizeAccounting,
  buildSourceCoverage,
  accountingCompleteness,
  sourceToEurMinor,
  parseGitHubUsage,
  parseTwilioUsage,
  stableRef,
};
