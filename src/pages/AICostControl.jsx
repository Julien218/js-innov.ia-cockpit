import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, BarChart3, Bot, CheckCircle2, CircleDollarSign,
  Gauge, Layers3, RefreshCw, Save, ShieldCheck, TrendingUp, Users,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

const MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'];

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
    max_request_usd: 2,
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

  if (summaryQuery.isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (summaryQuery.isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5 text-red-600">
        <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-5 h-5" /> AI Cost Control indisponible</div>
        <p className="text-sm mt-2">{summaryQuery.error?.message}. Vérifie que la migration Supabase AI Cost Control a bien été appliquée.</p>
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
              <p className="text-sm text-muted-foreground">Coûts OpenAI, budgets, alertes et routage intelligent des modèles.</p>
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
            onClick={() => { summaryQuery.refetch(); usageQuery.refetch(); }}
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

      {alertState && (
        <div className={`rounded-xl px-4 py-3 border flex items-center gap-2 text-sm font-medium ${alertState.level === 'danger' ? 'bg-red-500/10 border-red-500/20 text-red-700' : alertState.level === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-amber-700' : 'bg-blue-500/10 border-blue-500/20 text-blue-700'}`}>
          <AlertTriangle className="w-4 h-4" /> {alertState.text}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard icon={CircleDollarSign} label="Dépense du mois" value={usd(totals.cost_usd)} detail={`${totals.requests || 0} appels enregistrés`} />
        <KpiCard icon={TrendingUp} label="Prévision fin de mois" value={usd(totals.forecast_usd)} detail="Projection au rythme actuel" tone="violet" />
        <KpiCard icon={ShieldCheck} label="Budget restant" value={remaining === null ? 'À configurer' : usd(remaining)} detail={globalBudget?.enabled ? `${globalBudget.percent || 0}% consommé` : 'Protection désactivée'} tone="emerald" />
        <KpiCard icon={Bot} label="Tokens" value={tokens((totals.input_tokens || 0) + (totals.output_tokens || 0))} detail={`${tokens(totals.input_tokens)} entrée · ${tokens(totals.output_tokens)} sortie`} tone="amber" />
      </div>

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
              <input type="number" min="0" step="0.1" value={routingForm.max_request_usd ?? ''} onChange={(e) => setRoutingForm((v) => ({ ...v, max_request_usd: e.target.value }))} className="h-10 px-3 rounded-xl border border-border bg-background text-sm" />
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
