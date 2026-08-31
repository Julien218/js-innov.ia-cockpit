import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, BarChart3, Bot, CheckCircle2, CircleDollarSign,
  Database, Gauge, Layers3, RefreshCw, Save, ShieldCheck, TrendingUp, Users,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { getLocalTelemetryCurrent } from '../lib/localTelemetry';
import OpenAICostConnectionTest from '../components/OpenAICostConnectionTest';

const MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'];
const MAPPING_OPTIONS = [
  ['openai_project', 'Projet OpenAI'], ['railway_project', 'Projet Railway'], ['railway_service', 'Service Railway'],
  ['github_repo', 'Dépôt GitHub'], ['github_org', 'Organisation GitHub'], ['github_user', 'Compte GitHub'],
  ['twilio_account', 'Compte Twilio'], ['supabase_project', 'Projet Supabase'],
  ['dropbox_account', 'Compte Dropbox'], ['media_provider', 'Fournisseur vidéo / image'],
  ['api_provider', 'Autre API'],
];

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function usd(value, digits = 2) {
  return new Intl.NumberFormat('fr-BE', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0));
}

function tokens(value) {
  return new Intl.NumberFormat('fr-BE', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));
}

function eurMinor(value, digits = 2) {
  return new Intl.NumberFormat('fr-BE', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(Number(value || 0) / 100);
}

async function fetchJson(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}

function KpiCard({ icon: Icon, label, value, detail, tone = 'primary' }) {
  const toneClasses = {
    primary: 'bg-primary/10 text-primary',
    emerald: 'bg-emerald-500/10 text-emerald-600',
    amber: 'bg-amber-500/10 text-amber-600',
    violet: 'bg-violet-500/10 text-violet-600',
  };
  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold mt-1 text-foreground">{value}</p>
          {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${toneClasses[tone] || toneClasses.primary}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

function BreakdownTable({ title, icon: Icon, rows, emptyLabel }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-sm min-w-0">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">{title}</h2>
      </div>
      <div className="space-y-2">
        {(rows || []).slice(0, 8).map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 py-2 border-b border-border/60 last:border-0">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{row.label}</p>
              <p className="text-[11px] text-muted-foreground">{row.requests} appel{row.requests > 1 ? 's' : ''} · {tokens(row.input_tokens + row.output_tokens)} tokens</p>
            </div>
            <p className="text-sm font-semibold tabular-nums">{usd(row.cost_usd, 3)}</p>
          </div>
        ))}
        {(!rows || rows.length === 0) && <p className="text-sm text-muted-foreground py-6 text-center">{emptyLabel}</p>}
      </div>
    </div>
  );
}

export default function AICostControl() {
  const [month, setMonth] = useState(currentMonth());
  const [saving, setSaving] = useState('');
  const [notice, setNotice] = useState(null);
  const [budgetForm, setBudgetForm] = useState({ enabled: false, monthly_budget_usd: '', hard_limit_usd: '' });
  const [routingForm, setRoutingForm] = useState({
    auto_route: true,
    default_model: 'gpt-5.6-terra',
    simple_model: 'gpt-5.6-luna',
    balanced_model: 'gpt-5.6-terra',
    complex_model: 'gpt-5.6-sol',
    max_request_usd: 0,
  });

  const summaryQuery = useQuery({
    queryKey: ['ai-cost-summary', month],
    queryFn: () => fetchJson(`/api/ai-cost/summary?month=${encodeURIComponent(month)}`),
    refetchInterval: 60000,
  });

  const usageQuery = useQuery({
    queryKey: ['ai-cost-usage', month],
    queryFn: () => fetchJson(`/api/ai-cost/usage?month=${encodeURIComponent(month)}&limit=25`),
    refetchInterval: 60000,
  });
  const [mappingForm, setMappingForm] = useState({ cost_center_id: '', service_type: 'github_repo', external_id: '', external_label: '', project_id: '' });
  const [centerForm, setCenterForm] = useState({ client_id: '', product_code: '', project_id: '' });
  const [localRatesForm, setLocalRatesForm] = useState({ power_watts: '', energy_eur_kwh: '', machine_eur_hour: '' });
  const [manualCostForm, setManualCostForm] = useState({ client_id: '', cost_center_id: '', source_type: 'supabase', amount_eur: '', verification_ref: '', description: '' });

  const accountingQuery = useQuery({
    queryKey: ['cost-accounting-overview', month],
    queryFn: () => fetchJson(`/api/client-costs/accounting/overview?month=${encodeURIComponent(month)}`),
    refetchInterval: 60000,
  });

  const localTelemetryQuery = useQuery({
    queryKey: ['local-windows-telemetry'],
    queryFn: getLocalTelemetryCurrent,
    refetchInterval: 5000,
    retry: false,
  });

  const centersQuery = useQuery({
    queryKey: ['cost-accounting-centers'],
    queryFn: () => fetchJson('/api/client-costs/accounting/cost-centers'),
  });

  const clientsQuery = useQuery({
    queryKey: ['cost-accounting-clients'],
    queryFn: () => fetchJson('/api/client-costs/accounting/clients'),
  });

  const summary = summaryQuery.data;
  const globalBudget = summary?.global_budget;

  useEffect(() => {
    if (!globalBudget) return;
    setBudgetForm({
      enabled: Boolean(globalBudget.enabled),
      monthly_budget_usd: globalBudget.monthly_budget_usd || '',
      hard_limit_usd: globalBudget.hard_limit_usd || '',
    });
  }, [globalBudget?.updated_at, globalBudget?.monthly_budget_usd, globalBudget?.hard_limit_usd, globalBudget?.enabled]);

  useEffect(() => {
    if (summary?.routing) setRoutingForm(summary.routing);
  }, [summary?.routing]);

  useEffect(() => {
    const first = centersQuery.data?.centers?.[0];
    if (first && !mappingForm.cost_center_id) setMappingForm((value) => ({ ...value, cost_center_id: first.id }));
  }, [centersQuery.data?.centers, mappingForm.cost_center_id]);

  useEffect(() => {
    const first = clientsQuery.data?.clients?.[0];
    if (first && !centerForm.client_id) setCenterForm((value) => ({ ...value, client_id: first.id }));
    if (first && !manualCostForm.client_id) setManualCostForm((value) => ({ ...value, client_id: first.id }));
  }, [clientsQuery.data?.clients, centerForm.client_id, manualCostForm.client_id]);

  useEffect(() => {
    const rates = accountingQuery.data?.local_rates;
    if (!rates) return;
    setLocalRatesForm({
      power_watts: rates.power_watts || '',
      energy_eur_kwh: rates.energy_eur_kwh || '',
      machine_eur_hour: rates.machine_eur_hour || '',
    });
  }, [accountingQuery.data?.local_rates?.power_watts, accountingQuery.data?.local_rates?.energy_eur_kwh, accountingQuery.data?.local_rates?.machine_eur_hour]);

  const alertState = useMemo(() => {
    if (!globalBudget?.enabled) return null;
    if (globalBudget.blocked) return { level: 'danger', text: `Plafond de sécurité atteint (${usd(globalBudget.hard_limit_usd)}).` };
    const reached = globalBudget.reached_thresholds || [];
    const last = reached.length ? Math.max(...reached) : 0;
    if (last >= 90) return { level: 'danger', text: `${globalBudget.percent}% du budget mensuel consommé.` };
    if (last >= 75) return { level: 'warning', text: `${globalBudget.percent}% du budget mensuel consommé.` };
    if (last >= 50) return { level: 'info', text: `${globalBudget.percent}% du budget mensuel consommé.` };
    return null;
  }, [globalBudget]);

  const saveBudget = async () => {
    setSaving('budget');
    setNotice(null);
    try {
      await fetchJson('/api/ai-cost/budget', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope_type: 'global',
          scope_key: 'global',
          scope_name: 'Budget OpenAI global',
          enabled: budgetForm.enabled,
          monthly_budget_usd: Number(budgetForm.monthly_budget_usd || 0),
          hard_limit_usd: Number(budgetForm.hard_limit_usd || 0),
          alert_thresholds: [50, 75, 90],
        }),
      });
      setNotice({ type: 'success', text: 'Budget AI Cost Control enregistré.' });
      await summaryQuery.refetch();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setSaving('');
    }
  };

  const saveRouting = async () => {
    setSaving('routing');
    setNotice(null);
    try {
      await fetchJson('/api/ai-cost/routing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...routingForm, max_request_usd: Number(routingForm.max_request_usd || 0) }),
      });
      setNotice({ type: 'success', text: 'Politique de routage enregistrée.' });
      await summaryQuery.refetch();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setSaving('');
    }
  };

  const syncAccounting = async () => {
    setSaving('sync');
    setNotice(null);
    try {
      const result = await fetchJson('/api/client-costs/accounting/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month }),
      });
      setNotice({
        type: result.blocked_sources > 0 ? 'error' : 'success',
        text: `${result.imported_events || 0} nouvelle(s) dépense(s) importée(s) · ${result.blocked_sources || 0} source(s) bloquée(s).`,
      });
      await accountingQuery.refetch();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setSaving('');
    }
  };

  const saveMapping = async () => {
    if (!mappingForm.cost_center_id || !mappingForm.external_id.trim()) {
      setNotice({ type: 'error', text: 'Choisis un client/projet et indique l’identifiant du fournisseur.' });
      return;
    }
    if (mappingForm.service_type === 'railway_service' && !mappingForm.project_id.trim()) {
      setNotice({ type: 'error', text: 'Indique aussi l’identifiant du projet Railway parent.' });
      return;
    }
    setSaving('mapping');
    setNotice(null);
    try {
      await fetchJson(`/api/client-costs/accounting/cost-centers/${encodeURIComponent(mappingForm.cost_center_id)}/mappings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_type: mappingForm.service_type,
          external_id: mappingForm.external_id.trim(),
          external_label: mappingForm.external_label.trim(),
          metadata: mappingForm.service_type === 'railway_service' ? { project_id: mappingForm.project_id.trim() } : {},
        }),
      });
      setMappingForm((value) => ({ ...value, external_id: '', external_label: '', project_id: '' }));
      setNotice({ type: 'success', text: 'Fournisseur rattaché au bon client/projet.' });
      await Promise.all([centersQuery.refetch(), accountingQuery.refetch()]);
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setSaving('');
    }
  };

  const saveLocalRates = async () => {
    setSaving('local-rates');
    setNotice(null);
    try {
      await fetchJson('/api/client-costs/accounting/local-rates', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          power_watts: Number(localRatesForm.power_watts),
          energy_eur_kwh: Number(localRatesForm.energy_eur_kwh),
          machine_eur_hour: Number(localRatesForm.machine_eur_hour),
        }),
      });
      setNotice({ type: 'success', text: 'Tarifs du poste local enregistrés et utilisés pour les prochains calculs.' });
      await accountingQuery.refetch();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setSaving('');
    }
  };

  const importManualCost = async () => {
    if (!manualCostForm.client_id || !manualCostForm.amount_eur || !manualCostForm.verification_ref.trim()) {
      setNotice({ type: 'error', text: 'Client, montant et référence du justificatif sont obligatoires.' });
      return;
    }
    setSaving('manual-cost');
    setNotice(null);
    try {
      await fetchJson(`/api/client-costs/clients/${encodeURIComponent(manualCostForm.client_id)}/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: manualCostForm.source_type,
          cost_center_id: manualCostForm.cost_center_id || null,
          actual_cost_eur: Number(manualCostForm.amount_eur),
          evidence_status: 'manual_verified',
          verification_ref: manualCostForm.verification_ref.trim(),
          description: manualCostForm.description.trim() || `Justificatif ${manualCostForm.source_type}`,
          external_ref: `manual:${manualCostForm.client_id}:${manualCostForm.source_type}:${manualCostForm.verification_ref.trim()}`,
          metadata: { manual: true, imported_from: 'ai_cost_control' },
        }),
      });
      setManualCostForm((value) => ({ ...value, amount_eur: '', verification_ref: '', description: '' }));
      setNotice({ type: 'success', text: 'Justificatif importé comme coût manuel vérifié.' });
      await accountingQuery.refetch();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setSaving('');
    }
  };

  const saveCostCenter = async () => {
    if (!centerForm.client_id || !centerForm.project_id || !centerForm.product_code.trim()) {
      setNotice({ type: 'error', text: 'Choisis un client, son projet métier et un code court.' });
      return;
    }
    setSaving('center');
    setNotice(null);
    try {
      const result = await fetchJson('/api/client-costs/accounting/cost-centers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(centerForm),
      });
      setCenterForm((value) => ({ ...value, product_code: '' }));
      setNotice({ type: 'success', text: 'Centre de coût client/projet créé. Refacturation désactivée jusqu’à validation des règles.' });
      const refreshed = await centersQuery.refetch();
      if (result.cost_center?.id) setMappingForm((value) => ({ ...value, cost_center_id: result.cost_center.id }));
      await Promise.all([clientsQuery.refetch(), accountingQuery.refetch()]);
      return refreshed;
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setSaving('');
    }
  };

  if (summaryQuery.isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (summaryQuery.isError) {
    return (
      <div className="space-y-4">
        <OpenAICostConnectionTest />
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5 text-red-600">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-5 h-5" /> AI Cost Control indisponible</div>
          <p className="text-sm mt-2">{summaryQuery.error?.message}. Vérifie que la migration Supabase AI Cost Control a bien été appliquée.</p>
        </div>
      </div>
    );
  }

  const totals = summary?.totals || {};
  const budgetPercent = Math.min(100, Math.max(0, Number(globalBudget?.percent || 0)));
  const remaining = globalBudget?.enabled && Number(globalBudget.budget_usd) > 0
    ? Math.max(0, Number(globalBudget.budget_usd) - Number(totals.cost_usd || 0))
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>AI Cost Control</h1>
              <p className="text-sm text-muted-foreground">Coûts IA, Railway, GitHub, services cloud et production locale, rattachés aux clients.</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="h-10 px-3 rounded-xl border border-border bg-background text-sm"
          />
          <button
            onClick={() => { summaryQuery.refetch(); usageQuery.refetch(); accountingQuery.refetch(); }}
            className="h-10 px-3 rounded-xl border border-border hover:bg-muted flex items-center gap-2 text-sm"
          >
            <RefreshCw className="w-4 h-4" /> Actualiser
          </button>
        </div>
      </div>

      {notice && (
        <div className={`rounded-xl px-4 py-3 text-sm flex items-center gap-2 border ${notice.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700' : 'bg-red-500/10 border-red-500/20 text-red-700'}`}>
          {notice.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {notice.text}
        </div>
      )}

      <OpenAICostConnectionTest />

      {alertState && (
        <div className={`rounded-xl px-4 py-3 border flex items-center gap-2 text-sm font-medium ${alertState.level === 'danger' ? 'bg-red-500/10 border-red-500/20 text-red-700' : alertState.level === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-amber-700' : 'bg-blue-500/10 border-blue-500/20 text-blue-700'}`}>
          <AlertTriangle className="w-4 h-4" /> {alertState.text}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard icon={CircleDollarSign} label="Usage IA suivi" value={usd(totals.cost_usd)} detail={`${totals.requests || 0} appels enregistrés · réel et estimé détaillés ci-dessous`} />
        <KpiCard icon={TrendingUp} label="Prévision fin de mois" value={usd(totals.forecast_usd)} detail="Projection au rythme actuel" tone="violet" />
        <KpiCard icon={ShieldCheck} label="Budget restant" value={remaining === null ? 'À configurer' : usd(remaining)} detail={globalBudget?.enabled ? `${globalBudget.percent || 0}% consommé` : 'Protection désactivée'} tone="emerald" />
        <KpiCard icon={Bot} label="Tokens" value={tokens((totals.input_tokens || 0) + (totals.output_tokens || 0))} detail={`${tokens(totals.input_tokens)} entrée · ${tokens(totals.output_tokens)} sortie`} tone="amber" />
      </div>

      {accountingQuery.isError ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-700">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" /> Vue comptable indisponible</div>
          <p className="mt-1">{accountingQuery.error?.message}</p>
        </div>
      ) : accountingQuery.data && (
        <div className="space-y-4">
          {!accountingQuery.data.completeness?.complete && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800">
              <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" /> Total comptable incomplet</div>
              <p className="mt-1">{accountingQuery.data.completeness?.warning || 'AI Cost Control ne doit pas être utilisé comme total comptable complet.'}</p>
              <p className="mt-1 text-xs">{accountingQuery.data.completeness?.gaps?.length || 0} source(s) restent à connecter ou à justifier.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <KpiCard icon={ShieldCheck} label="Réel API" value={eurMinor(accountingQuery.data.accounting?.actual_cost_minor)} detail="Preuves fournisseur" tone="emerald" />
            <KpiCard icon={Database} label="Manuel vérifié" value={eurMinor(accountingQuery.data.accounting?.manual_verified_minor)} detail="Factures et justificatifs" />
            <KpiCard icon={TrendingUp} label="Coûts estimés" value={eurMinor(accountingQuery.data.accounting?.estimated_cost_minor)} detail="Calculs internes, séparés du réel" tone="violet" />
            <KpiCard icon={CircleDollarSign} label="Montant facturable" value={eurMinor(accountingQuery.data.accounting?.billable_minor)} detail={`${eurMinor(accountingQuery.data.accounting?.unbilled_billable_minor)} reste à facturer`} />
            <KpiCard icon={AlertTriangle} label="Non vérifié" value={eurMinor(accountingQuery.data.accounting?.unverified_cost_minor)} detail={`${accountingQuery.data.accounting?.unverified_events || 0} élément(s), exclus des factures`} tone="amber" />
          </div>

          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="font-semibold">Couverture comptable par fournisseur</h2>
                <p className="text-xs text-muted-foreground">Une source absente ou non connectée n’est jamais comptée comme 0 €.</p>
              </div>
              <button onClick={syncAccounting} disabled={saving === 'sync'} className="h-10 px-3 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 text-sm font-medium">
                <RefreshCw className={`w-4 h-4 ${saving === 'sync' ? 'animate-spin' : ''}`} /> {saving === 'sync' ? 'Synchronisation…' : 'Synchroniser les coûts'}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1120px]">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3 font-medium">Source</th>
                    <th className="py-2 pr-3 font-medium">Connexion</th>
                    <th className="py-2 pr-3 font-medium text-right">Réel API</th>
                    <th className="py-2 pr-3 font-medium text-right">Manuel vérifié</th>
                    <th className="py-2 pr-3 font-medium text-right">Estimé</th>
                    <th className="py-2 pr-3 font-medium text-right">Non vérifié</th>
                    <th className="py-2 font-medium">Action requise</th>
                  </tr>
                </thead>
                <tbody>
                  {(accountingQuery.data.sources || []).map((source) => {
                    return (
                      <tr key={source.id} className="border-b border-border/50 last:border-0">
                        <td className="py-2.5 pr-3 font-medium">{source.label}</td>
                        <td className="py-2.5 pr-3">
                          <span className={`text-[11px] px-2 py-1 rounded-full ${source.ready ? 'bg-emerald-500/10 text-emerald-700' : source.accounting_state === 'invoice_required' ? 'bg-blue-500/10 text-blue-700' : 'bg-amber-500/10 text-amber-700'}`}>
                            {source.ready ? 'Configuré' : source.accounting_state === 'invoice_required' ? 'Facture à importer' : 'À configurer'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{eurMinor(source.actual_cost_minor)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{eurMinor(source.manual_verified_minor)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{eurMinor(source.estimated_cost_minor)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-amber-700">{eurMinor(source.unverified_cost_minor)}</td>
                        <td className="py-2.5 text-xs text-muted-foreground">{(source.missing_configuration || []).join(' · ') || 'Aucune'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
              <p><strong className="text-foreground">Réel :</strong> montant reçu d’une API fournisseur avec preuve.</p>
              <p><strong className="text-foreground">Manuel vérifié :</strong> facture ou justificatif identifiable.</p>
              <p><strong className="text-foreground">Estimé :</strong> temps machine, énergie ou tarification par tokens documentée.</p>
              <p><strong className="text-foreground">Facturable :</strong> règle client appliquée sans modifier le coût interne.</p>
              <p><strong className="text-foreground">Non vérifié :</strong> bloqué avant facturation.</p>
            </div>

            <div className="mt-5 pt-5 border-t border-border">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-sm">Ordinateur local et télémétrie</h3>
                      <p className="text-xs text-muted-foreground mt-1">CPU, GPU et durée sont relevés automatiquement. Sans compteur physique, l’électricité reste une estimation documentée.</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${localTelemetryQuery.data?.telemetry ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>
                      {localTelemetryQuery.data?.telemetry ? 'Agent Windows connecté' : 'Télémétrie indisponible'}
                    </span>
                  </div>
                  {localTelemetryQuery.data?.telemetry && (() => {
                    const telemetry = localTelemetryQuery.data.telemetry;
                    const gpu = telemetry.gpu?.devices?.[0];
                    const telemetryCeiling = Number(telemetry.power?.configured_ceiling_watts || 0);
                    const savedCeiling = Number(localRatesForm.power_watts || telemetryCeiling || 0);
                    const effectivePower = telemetryCeiling > 0
                      ? Number((Number(telemetry.power?.estimated_system_watts || 0) / telemetryCeiling * savedCeiling).toFixed(1))
                      : telemetry.power?.estimated_system_watts;
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                        <div className="rounded-lg bg-muted/50 p-2"><p className="text-[10px] text-muted-foreground">CPU observé</p><p className="text-sm font-semibold tabular-nums">{telemetry.cpu?.utilization_percent == null ? 'mesure en cours' : `${telemetry.cpu.utilization_percent} %`}</p></div>
                        <div className="rounded-lg bg-muted/50 p-2"><p className="text-[10px] text-muted-foreground">GPU observé</p><p className="text-sm font-semibold tabular-nums">{gpu?.utilization_percent == null ? 'non détecté' : `${gpu.utilization_percent} %`}</p></div>
                        <div className="rounded-lg bg-muted/50 p-2"><p className="text-[10px] text-muted-foreground">Puissance GPU</p><p className="text-sm font-semibold tabular-nums">{gpu?.power_draw_watts == null ? 'capteur absent' : `${gpu.power_draw_watts} W`}</p></div>
                        <div className="rounded-lg bg-muted/50 p-2"><p className="text-[10px] text-muted-foreground">PC estimé</p><p className="text-sm font-semibold tabular-nums">{effectivePower ?? '—'} W</p></div>
                      </div>
                    );
                  })()}
                  <p className="text-[11px] text-muted-foreground mt-3">Tarifs appliqués aux prochaines productions locales · valeurs de départ JS-Innov.IA : 180 W, 0,30 €/kWh et 0,20 €/h.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                    <label className="text-xs text-muted-foreground">Puissance plafond (W)<input type="number" min="0" step="1" value={localRatesForm.power_watts} onChange={(event) => setLocalRatesForm((value) => ({ ...value, power_watts: event.target.value }))} className="mt-1 h-10 w-full px-3 rounded-xl border border-border bg-background text-sm" /></label>
                    <label className="text-xs text-muted-foreground">Électricité (€/kWh)<input type="number" min="0" step="0.001" value={localRatesForm.energy_eur_kwh} onChange={(event) => setLocalRatesForm((value) => ({ ...value, energy_eur_kwh: event.target.value }))} className="mt-1 h-10 w-full px-3 rounded-xl border border-border bg-background text-sm" /></label>
                    <label className="text-xs text-muted-foreground">Machine (€/h)<input type="number" min="0" step="0.01" value={localRatesForm.machine_eur_hour} onChange={(event) => setLocalRatesForm((value) => ({ ...value, machine_eur_hour: event.target.value }))} className="mt-1 h-10 w-full px-3 rounded-xl border border-border bg-background text-sm" /></label>
                  </div>
                  <button onClick={saveLocalRates} disabled={saving === 'local-rates'} className="mt-3 h-10 px-3 rounded-xl border border-primary text-primary hover:bg-primary/10 disabled:opacity-50 text-sm font-medium">{saving === 'local-rates' ? 'Enregistrement…' : 'Enregistrer les tarifs locaux'}</button>
                </div>

                <div className="rounded-xl border border-border p-4">
                  <h3 className="font-semibold text-sm">Importer une facture ou un justificatif</h3>
                  <p className="text-xs text-muted-foreground mt-1">Pour Supabase, Dropbox, Railway, Twilio ou un générateur vidéo lorsque l’API monétaire n’est pas disponible.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                    <select value={manualCostForm.client_id} onChange={(event) => setManualCostForm((value) => ({ ...value, client_id: event.target.value, cost_center_id: '' }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm"><option value="">Client</option>{(clientsQuery.data?.clients || []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
                    <select value={manualCostForm.cost_center_id} onChange={(event) => setManualCostForm((value) => ({ ...value, cost_center_id: event.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm"><option value="">Projet / centre de coût (optionnel)</option>{(centersQuery.data?.centers || []).filter((center) => !manualCostForm.client_id || String(center.client_id) === String(manualCostForm.client_id)).map((center) => <option key={center.id} value={center.id}>{center.product_code}</option>)}</select>
                    <select value={manualCostForm.source_type} onChange={(event) => setManualCostForm((value) => ({ ...value, source_type: event.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm"><option value="railway">Railway</option><option value="github">GitHub</option><option value="supabase">Supabase</option><option value="dropbox">Dropbox</option><option value="twilio">Twilio</option><option value="media_ai">Générateur vidéo / image</option><option value="other">Autre</option></select>
                    <input type="number" min="0" step="0.01" value={manualCostForm.amount_eur} onChange={(event) => setManualCostForm((value) => ({ ...value, amount_eur: event.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm" placeholder="Montant comptabilisé selon justificatif (€)" />
                    <input value={manualCostForm.verification_ref} onChange={(event) => setManualCostForm((value) => ({ ...value, verification_ref: event.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm" placeholder="N° facture ou référence vérifiable" />
                    <input value={manualCostForm.description} onChange={(event) => setManualCostForm((value) => ({ ...value, description: event.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm" placeholder="Description" />
                  </div>
                  <button onClick={importManualCost} disabled={saving === 'manual-cost'} className="mt-3 h-10 px-3 rounded-xl border border-primary text-primary hover:bg-primary/10 disabled:opacity-50 text-sm font-medium">{saving === 'manual-cost' ? 'Import…' : 'Importer comme manuel vérifié'}</button>
                </div>
              </div>

              <div className="mb-5">
                <h3 className="font-semibold text-sm">1. Créer le centre de coût du projet</h3>
                <p className="text-xs text-muted-foreground mt-1">À faire une seule fois par client et par projet facturable.</p>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 mt-3">
                  <select value={centerForm.client_id} onChange={(event) => setCenterForm((value) => ({ ...value, client_id: event.target.value, project_id: '' }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm">
                    <option value="">Client</option>
                    {(clientsQuery.data?.clients || []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                  </select>
                  <select aria-label="Projet métier du client" value={centerForm.project_id} onChange={(event) => setCenterForm((value) => ({ ...value, project_id: event.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm">
                    <option value="">Projet métier</option>
                    {(clientsQuery.data?.clients || []).find((client) => client.id === centerForm.client_id)?.projects?.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                  <input value={centerForm.product_code} onChange={(event) => setCenterForm((value) => ({ ...value, product_code: event.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm" placeholder="Code projet, ex. ROUGRAFF_VIDEO" />
                  <button onClick={saveCostCenter} disabled={saving === 'center' || clientsQuery.isLoading} className="h-10 px-3 rounded-xl border border-primary text-primary hover:bg-primary/10 disabled:opacity-50 text-sm font-medium">{saving === 'center' ? 'Création…' : 'Créer le centre'}</button>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <Database className="w-4 h-4 text-primary" />
                <div>
                  <h3 className="font-semibold text-sm">2. Rattacher un fournisseur à ce client/projet</h3>
                  <p className="text-xs text-muted-foreground">Un identifiant externe ne peut appartenir qu’à un seul client.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
                <select value={mappingForm.cost_center_id} onChange={(event) => setMappingForm((value) => ({ ...value, cost_center_id: event.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm">
                  <option value="">Client / projet</option>
                  {(centersQuery.data?.centers || []).map((center) => <option key={center.id} value={center.id}>{center.client_name} · {center.product_code}</option>)}
                </select>
                <select value={mappingForm.service_type} onChange={(event) => setMappingForm((value) => ({ ...value, service_type: event.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm">
                  {MAPPING_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {mappingForm.service_type === 'railway_service' && <input value={mappingForm.project_id} onChange={(event) => setMappingForm((value) => ({ ...value, project_id: event.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm" placeholder="ID projet Railway parent" />}
                <input value={mappingForm.external_id} onChange={(event) => setMappingForm((value) => ({ ...value, external_id: event.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm" placeholder="ID projet, compte ou owner/dépôt" />
                <input value={mappingForm.external_label} onChange={(event) => setMappingForm((value) => ({ ...value, external_label: event.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm" placeholder="Nom lisible (facultatif)" />
                <button onClick={saveMapping} disabled={saving === 'mapping' || centersQuery.isLoading} className="h-10 px-3 rounded-xl border border-primary text-primary hover:bg-primary/10 disabled:opacity-50 text-sm font-medium">{saving === 'mapping' ? 'Ajout…' : 'Ajouter le rattachement'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-card border border-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold">Coût journalier</h2>
              <p className="text-xs text-muted-foreground">USD par jour pour {summary.month}</p>
            </div>
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={summary.daily || []}>
                <defs>
                  <linearGradient id="aiCostArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(217,91%,50%)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="hsl(217,91%,50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                <XAxis dataKey="date" tickFormatter={(value) => value.slice(8)} tick={{ fontSize: 11 }} minTickGap={12} />
                <YAxis tickFormatter={(value) => `$${value}`} tick={{ fontSize: 11 }} width={55} />
                <Tooltip formatter={(value) => [usd(value, 4), 'Coût']} labelFormatter={(value) => `Date : ${value}`} />
                <Area type="monotone" dataKey="cost_usd" stroke="hsl(217,91%,50%)" fill="url(#aiCostArea)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold">Budget global</h2>
              <p className="text-xs text-muted-foreground">Alertes automatiques à 50 %, 75 % et 90 %</p>
            </div>
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>{usd(totals.cost_usd)}</span>
                <span>{globalBudget?.enabled && globalBudget.budget_usd > 0 ? usd(globalBudget.budget_usd) : 'Budget désactivé'}</span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${budgetPercent}%` }} />
              </div>
            </div>
            <label className="flex items-center justify-between text-sm">
              <span>Activer le contrôle budgétaire</span>
              <input type="checkbox" checked={budgetForm.enabled} onChange={(e) => setBudgetForm((v) => ({ ...v, enabled: e.target.checked }))} className="w-4 h-4" />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Budget mensuel (USD)</span>
              <input type="number" min="0" step="1" value={budgetForm.monthly_budget_usd} onChange={(e) => setBudgetForm((v) => ({ ...v, monthly_budget_usd: e.target.value }))} className="mt-1 w-full h-10 px-3 rounded-xl border border-border bg-background text-sm" placeholder="Ex. 100" />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Hard limit de sécurité (USD)</span>
              <input type="number" min="0" step="1" value={budgetForm.hard_limit_usd} onChange={(e) => setBudgetForm((v) => ({ ...v, hard_limit_usd: e.target.value }))} className="mt-1 w-full h-10 px-3 rounded-xl border border-border bg-background text-sm" placeholder="Ex. 125" />
            </label>
            <button onClick={saveBudget} disabled={saving === 'budget'} className="w-full h-10 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 text-sm font-medium">
              <Save className="w-4 h-4" /> {saving === 'budget' ? 'Enregistrement…' : 'Enregistrer le budget'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <BreakdownTable title="Par modèle" icon={Bot} rows={summary.by_model} emptyLabel="Aucune consommation enregistrée." />
        <BreakdownTable title="Par projet" icon={Layers3} rows={summary.by_project} emptyLabel="Aucun projet attribué." />
        <BreakdownTable title="Par client" icon={Users} rows={summary.by_client} emptyLabel="Aucun client attribué." />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold">Routage intelligent</h2>
              <p className="text-xs text-muted-foreground">Luna pour le simple, Terra par défaut, Sol pour le complexe.</p>
            </div>
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between text-sm">
              <span>Routage automatique</span>
              <input type="checkbox" checked={Boolean(routingForm.auto_route)} onChange={(e) => setRoutingForm((v) => ({ ...v, auto_route: e.target.checked }))} className="w-4 h-4" />
            </label>
            {[
              ['simple_model', 'Tâches simples'],
              ['balanced_model', 'Tâches standard'],
              ['complex_model', 'Tâches complexes'],
              ['default_model', 'Modèle par défaut'],
            ].map(([key, label]) => (
              <label key={key} className="grid grid-cols-[1fr_190px] items-center gap-3 text-sm">
                <span>{label}</span>
                <select value={routingForm[key] || ''} onChange={(e) => setRoutingForm((v) => ({ ...v, [key]: e.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm">
                  {MODELS.map((model) => <option key={model} value={model}>{model.replace('gpt-5.6-', '')}</option>)}
                </select>
              </label>
            ))}
            <label className="grid grid-cols-[1fr_190px] items-center gap-3 text-sm">
              <span>Coût max estimé par requête</span>
              <input type="number" min="0" step="0.1" value={routingForm.max_request_usd ?? ''} onChange={(e) => setRoutingForm((v) => ({ ...v, max_request_usd: Number(e.target.value || 0) }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm" />
            </label>
            <button onClick={saveRouting} disabled={saving === 'routing'} className="w-full h-10 mt-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 text-sm font-medium">
              <Save className="w-4 h-4" /> {saving === 'routing' ? 'Enregistrement…' : 'Enregistrer le routage'}
            </button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold">Tarification suivie</h2>
              <p className="text-xs text-muted-foreground">Prix standard USD / 1M tokens. Les coûts explicites remontés par un service restent prioritaires.</p>
            </div>
            <CircleDollarSign className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-3">
            {Object.entries(summary.pricing || {}).filter(([key]) => key !== 'gpt-5.6').map(([key, price]) => (
              <div key={key} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm">{price.label || key}</p>
                  <span className="text-[10px] px-2 py-1 rounded-full bg-muted text-muted-foreground">{key}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                  <div><p className="text-muted-foreground">Entrée</p><p className="font-semibold">${price.input}</p></div>
                  <div><p className="text-muted-foreground">Cache</p><p className="font-semibold">${price.cachedInput}</p></div>
                  <div><p className="text-muted-foreground">Sortie</p><p className="font-semibold">${price.output}</p></div>
                </div>
              </div>
            ))}
          </div>
          <div className={`mt-4 rounded-xl p-3 text-xs border ${summary.ingest_ready ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700' : 'bg-amber-500/10 border-amber-500/20 text-amber-700'}`}>
            {summary.ingest_ready ? 'Clé d’ingestion serveur configurée : prête pour jsinnovia-agent et les autres services.' : 'AI_COST_INGEST_KEY n’est pas encore configurée sur le serveur. Le dashboard fonctionne, mais les services externes ne peuvent pas encore remonter leur consommation.'}
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold">Derniers appels enregistrés</h2>
            <p className="text-xs text-muted-foreground">Traçabilité par modèle, source, projet et client.</p>
          </div>
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${usageQuery.isFetching ? 'animate-spin' : ''}`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Modèle</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Projet / client</th>
                <th className="py-2 pr-3 font-medium text-right">Tokens</th>
                <th className="py-2 font-medium text-right">Coût</th>
              </tr>
            </thead>
            <tbody>
              {(usageQuery.data?.items || []).map((item) => (
                <tr key={item.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5 pr-3 text-xs whitespace-nowrap">{new Date(item.created_at).toLocaleString('fr-BE')}</td>
                  <td className="py-2.5 pr-3 font-medium">{item.model}</td>
                  <td className="py-2.5 pr-3 text-muted-foreground">{item.source}</td>
                  <td className="py-2.5 pr-3 text-muted-foreground">{item.project_name || item.project_key || item.client_name || item.client_key || '—'}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{tokens(Number(item.input_tokens || 0) + Number(item.output_tokens || 0))}</td>
                  <td className="py-2.5 text-right font-semibold tabular-nums">{usd(item.cost_usd, 4)}</td>
                </tr>
              ))}
              {(!usageQuery.data?.items || usageQuery.data.items.length === 0) && (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Aucun appel IA enregistré pour ce mois.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {(totals.estimated_requests > 0 || totals.unpriced_requests > 0) && (
          <div className="mt-3 text-xs text-muted-foreground flex flex-wrap gap-4">
            {totals.estimated_requests > 0 && <span>{totals.estimated_requests} coût(s) calculé(s) à partir des tokens.</span>}
            {totals.unpriced_requests > 0 && <span className="text-amber-600">{totals.unpriced_requests} appel(s) avec modèle non tarifé.</span>}
          </div>
        )}
      </div>
    </div>
  );
}
