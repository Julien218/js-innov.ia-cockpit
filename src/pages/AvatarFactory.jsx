import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, CircleDollarSign, Cpu, Factory, Loader2,
  Play, RefreshCw, ShieldCheck, Sparkles, WalletCards,
} from 'lucide-react';
import { avatarFactory } from '@/api/avatarFactoryClient';

const POLICIES = [
  { value: 'standard_margin', label: 'Standard + marge' },
  { value: 'fixed_plus_overage', label: 'Forfait + dépassements' },
  { value: 'technical_costs_only', label: 'Coûts techniques uniquement' },
  { value: 'custom', label: 'Personnalisée' },
];

const STATUS_LABELS = {
  queued: 'En file', running: 'Production', awaiting_approval: 'Validation requise',
  queued_after_approval: 'Reprise', completed: 'Terminé', failed: 'Erreur',
};

const STATUS_CLASS = {
  queued: 'bg-slate-500/10 text-slate-600',
  running: 'bg-blue-500/10 text-blue-700',
  awaiting_approval: 'bg-amber-500/10 text-amber-700',
  queued_after_approval: 'bg-violet-500/10 text-violet-700',
  completed: 'bg-emerald-500/10 text-emerald-700',
  failed: 'bg-red-500/10 text-red-700',
};

function euro(value) {
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 }).format(Number(value || 0));
}

function Field({ label, children }) {
  return <label className="space-y-1.5"><span className="text-xs font-semibold text-muted-foreground">{label}</span>{children}</label>;
}

const inputClass = 'w-full h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20';

export default function AvatarFactory() {
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [form, setForm] = useState({
    client_id: '', entity_id: '', project_id: '', character_id: 'vaincriez-canary', billing_policy: 'standard_margin',
  });

  const health = useQuery({ queryKey: ['avatar-factory-health'], queryFn: avatarFactory.health, retry: false, refetchInterval: 30000 });
  const jobs = useQuery({ queryKey: ['avatar-factory-jobs'], queryFn: avatarFactory.listJobs, retry: false, refetchInterval: 8000 });
  const costs = useQuery({ queryKey: ['avatar-factory-costs'], queryFn: avatarFactory.costSummary, retry: false, refetchInterval: 15000 });
  const detail = useQuery({
    queryKey: ['avatar-factory-job', selectedId],
    queryFn: () => avatarFactory.getJob(selectedId),
    enabled: Boolean(selectedId),
    retry: false,
    refetchInterval: selectedId ? 5000 : false,
  });

  useEffect(() => {
    if (!selectedId && jobs.data?.jobs?.[0]?.id) setSelectedId(jobs.data.jobs[0].id);
  }, [jobs.data, selectedId]);

  const productionCounts = useMemo(() => {
    const rows = jobs.data?.jobs || [];
    return {
      total: rows.length,
      running: rows.filter(j => ['queued', 'running', 'queued_after_approval'].includes(j.status)).length,
      approval: rows.filter(j => j.status === 'awaiting_approval').length,
      failed: rows.filter(j => j.status === 'failed').length,
    };
  }, [jobs.data]);

  const create = async (event) => {
    event.preventDefault();
    setNotice(null);
    setCreating(true);
    try {
      const created = await avatarFactory.createJob(form);
      setSelectedId(created.id);
      setNotice({ type: 'success', text: 'Production créée et transmise à la station locale.' });
      await Promise.all([jobs.refetch(), costs.refetch()]);
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setCreating(false);
    }
  };

  const approve = async () => {
    if (!selectedId) return;
    setApproving(true);
    setNotice(null);
    try {
      await avatarFactory.approveJob(selectedId);
      setNotice({ type: 'success', text: 'Validation accordée. Le pipeline reprend automatiquement.' });
      await Promise.all([detail.refetch(), jobs.refetch()]);
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setApproving(false);
    }
  };

  const online = health.isSuccess && health.data?.ok;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><Factory className="w-6 h-6" /></div>
          <div>
            <h1 className="text-2xl font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Avatar Factory</h1>
            <p className="text-sm text-muted-foreground">Production 3D locale orchestrée, QA, validations et FinOps par client / entité / projet.</p>
          </div>
        </div>
        <div className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium border ${online ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700' : 'bg-red-500/10 border-red-500/20 text-red-700'}`}>
          <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />
          {online ? 'Agent local 8791 connecté' : 'Agent local 8791 hors ligne'}
        </div>
      </div>

      {!online && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 flex gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div><p className="font-semibold">Station locale requise</p><p className="mt-1">Lance <code>scripts/start_avatar_factory.ps1</code> sur le PC de production. Le Cockpit reste utilisable, mais aucun job ne peut être envoyé tant que l'agent est hors ligne.</p></div>
        </div>
      )}

      {notice && (
        <div className={`rounded-xl px-4 py-3 text-sm flex items-center gap-2 border ${notice.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700' : 'bg-red-500/10 border-red-500/20 text-red-700'}`}>
          {notice.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}{notice.text}
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi icon={Sparkles} label="Jobs" value={productionCounts.total} />
        <Kpi icon={Cpu} label="En production" value={productionCounts.running} />
        <Kpi icon={ShieldCheck} label="À valider" value={productionCounts.approval} />
        <Kpi icon={CircleDollarSign} label="Coût cumulé" value={euro(costs.data?.cost_eur)} />
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-3 gap-5">
        <form onSubmit={create} className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
          <div><h2 className="font-semibold">Nouvelle production</h2><p className="text-xs text-muted-foreground mt-1">Chaque job est isolé et imputé à une entité précise.</p></div>
          <Field label="Client ID"><input className={inputClass} value={form.client_id} onChange={e => setForm(v => ({ ...v, client_id: e.target.value }))} placeholder="client-xxx" required /></Field>
          <Field label="Société / ASBL / entité"><input className={inputClass} value={form.entity_id} onChange={e => setForm(v => ({ ...v, entity_id: e.target.value }))} placeholder="synergie-dour-asbl" required /></Field>
          <Field label="Projet"><input className={inputClass} value={form.project_id} onChange={e => setForm(v => ({ ...v, project_id: e.target.value }))} placeholder="mascotte-3d" required /></Field>
          <Field label="Personnage"><input className={inputClass} value={form.character_id} onChange={e => setForm(v => ({ ...v, character_id: e.target.value }))} required /></Field>
          <Field label="Politique de facturation"><select className={inputClass} value={form.billing_policy} onChange={e => setForm(v => ({ ...v, billing_policy: e.target.value }))}>{POLICIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></Field>
          <button disabled={!online || creating} className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Lancer la production
          </button>
        </form>

        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm min-w-0">
          <div className="flex items-center justify-between mb-4"><div><h2 className="font-semibold">Productions</h2><p className="text-xs text-muted-foreground">Actualisation automatique</p></div><button onClick={() => jobs.refetch()} className="p-2 rounded-lg hover:bg-muted"><RefreshCw className="w-4 h-4" /></button></div>
          <div className="space-y-2 max-h-[580px] overflow-y-auto">
            {(jobs.data?.jobs || []).map(job => (
              <button key={job.id} onClick={() => setSelectedId(job.id)} className={`w-full text-left rounded-xl border p-3 transition ${selectedId === job.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
                <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold truncate">{job.character_id}</p><span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${STATUS_CLASS[job.status] || 'bg-muted'}`}>{STATUS_LABELS[job.status] || job.status}</span></div>
                <p className="text-xs text-muted-foreground mt-1 truncate">{job.entity_id} · {job.project_id}</p><p className="text-[11px] text-muted-foreground mt-1">Étape : {job.current_stage || '—'}</p>
              </button>
            ))}
            {!jobs.isLoading && !(jobs.data?.jobs || []).length && <p className="text-sm text-muted-foreground text-center py-10">Aucune production.</p>}
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm min-w-0">
          <h2 className="font-semibold">Détail & validation</h2>
          {!selectedId ? <p className="text-sm text-muted-foreground py-10">Sélectionne une production.</p> : detail.isLoading ? <Loader2 className="w-5 h-5 animate-spin my-10 mx-auto" /> : detail.data ? <JobDetail job={detail.data} onApprove={approve} approving={approving} /> : <p className="text-sm text-red-600 py-8">Impossible de charger le job.</p>}
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4"><WalletCards className="w-5 h-5 text-primary" /><div><h2 className="font-semibold">FinOps par entité</h2><p className="text-xs text-muted-foreground">Coût réel interne et montant refacturable séparés.</p></div></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground border-b"><th className="py-2">Client</th><th>Entité</th><th>Jobs</th><th>Coût réel</th><th>Refacturable</th></tr></thead><tbody>{(costs.data?.by_entity || []).map(row => <tr key={`${row.client_id}-${row.entity_id}`} className="border-b border-border/50"><td className="py-3">{row.client_id}</td><td className="font-medium">{row.entity_id}</td><td>{row.jobs}</td><td>{euro(row.cost_eur)}</td><td className="font-semibold">{euro(row.billable_eur)}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value }) {
  return <div className="bg-card border border-border rounded-2xl p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p><p className="text-xl font-bold mt-1">{value}</p></div><div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-4 h-4" /></div></div></div>;
}

function JobDetail({ job, onApprove, approving }) {
  const costs = job.costs || [];
  return <div className="mt-4 space-y-4">
    <div className="grid grid-cols-2 gap-2"><Mini label="Statut" value={STATUS_LABELS[job.status] || job.status} /><Mini label="Étape" value={job.current_stage || '—'} /><Mini label="Coût" value={euro(job.cost_total_eur)} /><Mini label="Refacturable" value={euro(job.billable_total_eur)} /></div>
    {job.error && <div className="rounded-xl bg-red-500/10 text-red-700 p-3 text-xs">{job.error}</div>}
    {job.status === 'awaiting_approval' && <button onClick={onApprove} disabled={approving} className="w-full h-10 rounded-xl bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">{approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Valider et poursuivre</button>}
    <div><p className="text-xs font-semibold text-muted-foreground mb-2">Événements récents</p><div className="space-y-2 max-h-56 overflow-y-auto">{(job.events || []).slice(0, 20).map(event => <div key={event.id} className="rounded-lg bg-muted/50 px-3 py-2"><div className="flex justify-between gap-2"><span className="text-xs font-medium">{event.stage || 'orchestrateur'}</span><span className="text-[10px] text-muted-foreground">{new Date(event.created_at).toLocaleTimeString('fr-BE')}</span></div><p className={`text-xs mt-1 ${event.level === 'error' ? 'text-red-600' : 'text-muted-foreground'}`}>{event.message}</p></div>)}</div></div>
    <div><p className="text-xs font-semibold text-muted-foreground mb-2">Coûts du job</p>{costs.length ? <div className="space-y-1">{costs.map(c => <div key={c.id} className="flex justify-between text-xs border-b border-border/50 py-1.5"><span>{c.category}</span><span>{euro(c.cost_eur)} → {euro(c.billable_eur)}</span></div>)}</div> : <p className="text-xs text-muted-foreground">Aucun coût enregistré pour le moment.</p>}</div>
  </div>;
}

function Mini({ label, value }) { return <div className="rounded-xl bg-muted/50 p-3"><p className="text-[10px] uppercase text-muted-foreground font-semibold">{label}</p><p className="text-sm font-semibold mt-1 truncate">{value}</p></div>; }
