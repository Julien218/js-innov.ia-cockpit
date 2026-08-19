import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, RefreshCw, Save, WalletCards } from 'lucide-react';

function euro(value) {
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(value || 0));
}

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const policies = [
  ['standard_margin', 'Standard + marge'],
  ['fixed_plus_overage', 'Forfait + dépassements'],
  ['technical_costs_only', 'Coûts techniques uniquement'],
  ['custom', 'Personnalisée'],
];

export default function FinOps() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ client_key: '', entity_key: '', policy: 'standard_margin', markup_percent: 50, minimum_margin_percent: 30, minimum_invoice_eur: 0 });

  const summary = useQuery({ queryKey: ['finops-summary', month], queryFn: () => request(`/api/finops/summary?month=${encodeURIComponent(month)}`), refetchInterval: 60000 });
  const policyQuery = useQuery({ queryKey: ['finops-policies'], queryFn: () => request('/api/finops/policies'), refetchInterval: 60000 });

  const marginPercent = useMemo(() => {
    const totals = summary.data?.totals || {};
    return Number(totals.billable_eur || 0) > 0 ? ((Number(totals.margin_eur || 0) / Number(totals.billable_eur)) * 100) : 0;
  }, [summary.data]);

  const savePolicy = async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await request('/api/finops/policies', { method: 'PUT', body: JSON.stringify({ ...form, markup_percent: Number(form.markup_percent || 0), minimum_margin_percent: Number(form.minimum_margin_percent || 0), minimum_invoice_eur: Number(form.minimum_invoice_eur || 0) }) });
      setNotice({ type: 'success', text: 'Politique FinOps enregistrée.' });
      await policyQuery.refetch();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally { setSaving(false); }
  };

  if (summary.isError) return <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-red-700"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-5 h-5" /> FinOps indisponible</div><p className="text-sm mt-2">{summary.error?.message}. Vérifie la migration Supabase et les variables serveur.</p></div>;

  const totals = summary.data?.totals || {};
  return <div className="space-y-6">
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div className="flex items-center gap-3"><div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><WalletCards className="w-5 h-5" /></div><div><h1 className="text-2xl font-bold">FinOps & Rentabilité</h1><p className="text-sm text-muted-foreground">Coût réel, refacturation et marge par client, société/ASBL, projet et ressource.</p></div></div>
      <div className="flex gap-2"><input type="month" value={month} onChange={e => setMonth(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm"/><button onClick={() => {summary.refetch(); policyQuery.refetch();}} className="h-10 px-3 rounded-xl border border-border flex items-center gap-2 text-sm hover:bg-muted"><RefreshCw className="w-4 h-4"/>Actualiser</button></div>
    </div>

    {notice && <div className={`rounded-xl border px-4 py-3 text-sm ${notice.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700' : 'bg-red-500/10 border-red-500/20 text-red-700'}`}>{notice.text}</div>}

    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3"><Kpi label="Coût réel" value={euro(totals.cost_eur)} /><Kpi label="Refacturable" value={euro(totals.billable_eur)} /><Kpi label="Marge" value={euro(totals.margin_eur)} /><Kpi label="Marge %" value={`${marginPercent.toFixed(1)} %`} /></div>

    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <Breakdown title="Par client" rows={summary.data?.by_client || []} />
      <Breakdown title="Par société / ASBL" rows={summary.data?.by_entity || []} />
      <Breakdown title="Par projet" rows={summary.data?.by_project || []} />
      <Breakdown title="Par catégorie de coût" rows={summary.data?.by_category || []} />
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <form onSubmit={savePolicy} className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-3">
        <div><h2 className="font-semibold">Politique de facturation</h2><p className="text-xs text-muted-foreground mt-1">Utilise <code>__default__</code> pour appliquer une règle à toutes les entités d'un client.</p></div>
        <Input label="Client key" value={form.client_key} onChange={v => setForm(f => ({...f, client_key:v}))} placeholder="olivier" />
        <Input label="Entity key" value={form.entity_key} onChange={v => setForm(f => ({...f, entity_key:v}))} placeholder="__default__" />
        <label className="space-y-1.5 block"><span className="text-xs font-semibold text-muted-foreground">Politique</span><select className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm" value={form.policy} onChange={e => setForm(f => ({...f, policy:e.target.value}))}>{policies.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <Input label="Markup %" type="number" value={form.markup_percent} onChange={v => setForm(f => ({...f, markup_percent:v}))} />
        <Input label="Marge minimum %" type="number" value={form.minimum_margin_percent} onChange={v => setForm(f => ({...f, minimum_margin_percent:v}))} />
        <Input label="Minimum facture €" type="number" value={form.minimum_invoice_eur} onChange={v => setForm(f => ({...f, minimum_invoice_eur:v}))} />
        <button disabled={saving} className="w-full h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2"><Save className="w-4 h-4"/>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </form>

      <div className="xl:col-span-2 bg-card border border-border rounded-2xl p-5 shadow-sm"><h2 className="font-semibold mb-4">Règles actives</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground border-b"><th className="py-2">Client</th><th>Entité</th><th>Politique</th><th>Markup</th><th>Marge min.</th></tr></thead><tbody>{(policyQuery.data?.policies || []).map(row => <tr key={`${row.client_key}:${row.entity_key}`} className="border-b border-border/50"><td className="py-3 font-medium">{row.client_key}</td><td>{row.entity_key}</td><td>{policies.find(p => p[0] === row.policy)?.[1] || row.policy}</td><td>{Number(row.markup_percent || 0).toFixed(1)} %</td><td>{Number(row.minimum_margin_percent || 0).toFixed(1)} %</td></tr>)}</tbody></table></div></div>
    </div>
  </div>;
}

function Kpi({ label, value }) { return <div className="bg-card border border-border rounded-2xl p-4 shadow-sm"><p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p><p className="text-xl font-bold mt-1">{value}</p></div>; }
function Breakdown({ title, rows }) { return <div className="bg-card border border-border rounded-2xl p-5 shadow-sm"><div className="flex items-center gap-2 mb-3"><BarChart3 className="w-4 h-4 text-primary"/><h2 className="font-semibold">{title}</h2></div><div className="space-y-2">{rows.slice(0,12).map(row => <div key={row.key} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center border-b border-border/50 py-2 text-sm"><span className="truncate font-medium">{row.key}</span><span>{euro(row.cost_eur)}</span><span className={Number(row.margin_eur) < 0 ? 'text-red-600' : 'text-emerald-600'}>{euro(row.margin_eur)}</span></div>)}{!rows.length && <p className="text-sm text-muted-foreground py-6 text-center">Aucune donnée.</p>}</div></div>; }
function Input({ label, value, onChange, placeholder, type='text' }) { return <label className="space-y-1.5 block"><span className="text-xs font-semibold text-muted-foreground">{label}</span><input required className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm" type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}/></label>; }
