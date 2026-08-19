import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, CircleDollarSign, Cpu, Factory, Loader2,
  Play, RefreshCw, ShieldCheck, Sparkles, WalletCards, XCircle,
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
  queued_after_approval: 'Reprise', completed: 'Terminé', failed: 'Erreur', rejected: 'Refusé',
};
const STATUS_CLASS = {
  queued: 'bg-slate-500/10 text-slate-600', running: 'bg-blue-500/10 text-blue-700',
  awaiting_approval: 'bg-amber-500/10 text-amber-700', queued_after_approval: 'bg-violet-500/10 text-violet-700',
  completed: 'bg-emerald-500/10 text-emerald-700', failed: 'bg-red-500/10 text-red-700', rejected: 'bg-red-500/10 text-red-700',
};
const inputClass = 'w-full h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20';

function euro(value) {
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 }).format(Number(value || 0));
}
function Field({ label, children, hint }) {
  return <label className="space-y-1.5 block"><span className="text-xs font-semibold text-muted-foreground">{label}</span>{children}{hint && <span className="block text-[10px] text-muted-foreground">{hint}</span>}</label>;
}

export default function AvatarFactory() {
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({
    client_id: 'olivier', entity_id: 'les-vaincriez-dour', project_id: 'canari-3d',
    character_id: 'vaincriez-canary', reference_path: 'characters/vaincriez-canary/reference.png',
    billing_policy: 'technical_costs_only', preset: 'diagnostic',
  });

  const health = useQuery({ queryKey: ['avatar-factory-health'], queryFn: avatarFactory.health, retry: false, refetchInterval: 30000 });
  const jobs = useQuery({ queryKey: ['avatar-factory-jobs'], queryFn: avatarFactory.listJobs, retry: false, refetchInterval: 8000 });
  const costs = useQuery({ queryKey: ['avatar-factory-costs'], queryFn: avatarFactory.costSummary, retry: false, refetchInterval: 15000 });
  const detail = useQuery({
    queryKey: ['avatar-factory-job', selectedId], queryFn: () => avatarFactory.getJob(selectedId),
    enabled: Boolean(selectedId), retry: false, refetchInterval: selectedId ? 5000 : false,
  });

  useEffect(() => { if (!selectedId && jobs.data?.jobs?.[0]?.id) setSelectedId(jobs.data.jobs[0].id); }, [jobs.data, selectedId]);
  useEffect(() => {
    if (form.client_id.trim().toLowerCase() === 'olivier' && form.billing_policy !== 'technical_costs_only') {
      setForm(current => ({ ...current, billing_policy: 'technical_costs_only' }));
    }
  }, [form.client_id, form.billing_policy]);

  const counts = useMemo(() => {
    const rows = jobs.data?.jobs || [];
    return {
      total: rows.length,
      running: rows.filter(j => ['queued', 'running', 'queued_after_approval'].includes(j.status)).length,
      approval: rows.filter(j => j.status === 'awaiting_approval').length,
      failed: rows.filter(j => ['failed', 'rejected'].includes(j.status)).length,
    };
  }, [jobs.data]);

  const refresh = async () => Promise.all([jobs.refetch(), costs.refetch(), selectedId ? detail.refetch() : Promise.resolve()]);
  const create = async event => {
    event.preventDefault(); setNotice(null); setBusy('create');
    try {
      const created = await avatarFactory.createJob(form);
      setSelectedId(created.id);
      setNotice({ type: 'success', text: 'Production créée. L’agent local exécute automatiquement référence → 3D → rig/idle → QA.' });
      await refresh();
    } catch (error) { setNotice({ type: 'error', text: error.message }); }
    finally { setBusy(''); }
  };
  const approve = async () => {
    setBusy('approve'); setNotice(null);
    try { await avatarFactory.approveJob(selectedId); setNotice({ type: 'success', text: 'Candidat validé. Le job est clôturé comme approuvé.' }); await refresh(); }
    catch (error) { setNotice({ type: 'error', text: error.message }); }
    finally { setBusy(''); }
  };
  const reject = async () => {
    setBusy('reject'); setNotice(null);
    try { await avatarFactory.rejectJob(selectedId, 'Validation visuelle refusée depuis le Cockpit'); setNotice({ type: 'success', text: 'Candidat refusé. Il reste historisé pour comparaison et coûts.' }); await refresh(); }
    catch (error) { setNotice({ type: 'error', text: error.message }); }
    finally { setBusy(''); }
  };

  const online = health.isSuccess && health.data?.ok;
  return <div className="space-y-6">
    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
      <div className="flex items-center gap-3"><div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><Factory className="w-6 h-6" /></div><div><h1 className="text-2xl font-bold">Avatar Factory</h1><p className="text-sm text-muted-foreground">Production 3D locale orchestrée, validation humaine finale et coûts attribués au bon client / entité / projet.</p></div></div>
      <div className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium border ${online ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700' : 'bg-red-500/10 border-red-500/20 text-red-700'}`}><span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />{online ? 'Agent local 8791 connecté' : 'Agent local 8791 hors ligne'}</div>
    </div>

    {!online && <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 flex gap-3"><AlertTriangle className="w-5 h-5 shrink-0" /><div><p className="font-semibold">Station locale requise</p><p className="mt-1">Lance <code>scripts/start_avatar_factory.ps1</code> dans le dépôt compagnon-jsinnovia. ComfyUI doit répondre sur 8188 et Blender doit être accessible.</p></div></div>}
    {notice && <div className={`rounded-xl px-4 py-3 text-sm flex items-center gap-2 border ${notice.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700' : 'bg-red-500/10 border-red-500/20 text-red-700'}`}>{notice.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}{notice.text}</div>}

    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3"><Kpi icon={Sparkles} label="Jobs" value={counts.total} /><Kpi icon={Cpu} label="En production" value={counts.running} /><Kpi icon={ShieldCheck} label="À valider" value={counts.approval} /><Kpi icon={CircleDollarSign} label="Coût local" value={euro(costs.data?.cost_eur)} /></div>

    <div className="grid grid-cols-1 2xl:grid-cols-3 gap-5">
      <form onSubmit={create} className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
        <div><h2 className="font-semibold">Nouvelle production</h2><p className="text-xs text-muted-foreground mt-1">Le premier pilote est préconfiguré pour le canari des Vaincriez Dour.</p></div>
        <Field label="Client ID"><input className={inputClass} value={form.client_id} onChange={e => setForm(v => ({ ...v, client_id: e.target.value }))} required /></Field>
        <Field label="Société / ASBL / entité"><input className={inputClass} value={form.entity_id} onChange={e => setForm(v => ({ ...v, entity_id: e.target.value }))} required /></Field>
        <Field label="Projet"><input className={inputClass} value={form.project_id} onChange={e => setForm(v => ({ ...v, project_id: e.target.value }))} required /></Field>
        <Field label="Personnage"><input className={inputClass} value={form.character_id} onChange={e => setForm(v => ({ ...v, character_id: e.target.value }))} required /></Field>
        <Field label="Image de référence locale" hint="Chemin relatif au dépôt ou chemin absolu sur le PC de production."><input className={inputClass} value={form.reference_path} onChange={e => setForm(v => ({ ...v, reference_path: e.target.value }))} required /></Field>
        <Field label="Qualité"><select className={inputClass} value={form.preset} onChange={e => setForm(v => ({ ...v, preset: e.target.value }))}><option value="diagnostic">Diagnostic 1024 — recommandé 6 Go VRAM</option><option value="production">Production 2048 — si mémoire suffisante</option></select></Field>
        <Field label="Politique de facturation"><select disabled={form.client_id.trim().toLowerCase() === 'olivier'} className={`${inputClass} disabled:opacity-60`} value={form.billing_policy} onChange={e => setForm(v => ({ ...v, billing_policy: e.target.value }))}>{POLICIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></Field>
        {form.client_id.trim().toLowerCase() === 'olivier' && <p className="text-[11px] text-muted-foreground">Règle Olivier : coûts techniques uniquement. La ventilation reste séparée par société/ASBL.</p>}
        <button disabled={!online || busy === 'create'} className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">{busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Lancer la production</button>
      </form>

      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm min-w-0">
        <div className="flex items-center justify-between mb-4"><div><h2 className="font-semibold">Productions</h2><p className="text-xs text-muted-foreground">Actualisation automatique</p></div><button onClick={() => jobs.refetch()} className="p-2 rounded-lg hover:bg-muted"><RefreshCw className="w-4 h-4" /></button></div>
        <div className="space-y-2 max-h-[620px] overflow-y-auto">{(jobs.data?.jobs || []).map(job => <button key={job.id} onClick={() => setSelectedId(job.id)} className={`w-full text-left rounded-xl border p-3 transition ${selectedId === job.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold truncate">{job.character_id}</p><span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${STATUS_CLASS[job.status] || 'bg-muted'}`}>{STATUS_LABELS[job.status] || job.status}</span></div><p className="text-xs text-muted-foreground mt-1 truncate">{job.entity_id} · {job.project_id}</p><p className="text-[11px] text-muted-foreground mt-1">Étape : {job.current_stage || '—'}</p></button>)}{!jobs.isLoading && !(jobs.data?.jobs || []).length && <p className="text-sm text-muted-foreground text-center py-10">Aucune production.</p>}</div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm min-w-0"><h2 className="font-semibold">Détail & validation</h2>{!selectedId ? <p className="text-sm text-muted-foreground py-10">Sélectionne une production.</p> : detail.isLoading ? <Loader2 className="w-5 h-5 animate-spin my-10 mx-auto" /> : detail.data ? <JobDetail job={detail.data} onApprove={approve} onReject={reject} busy={busy} /> : <p className="text-sm text-red-600 py-8">Impossible de charger le job.</p>}</div>
    </div>

    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm"><div className="flex items-center gap-2 mb-4"><WalletCards className="w-5 h-5 text-primary" /><div><h2 className="font-semibold">FinOps local par entité</h2><p className="text-xs text-muted-foreground">Le Cockpit FinOps central reste l’autorité pour la refacturation finale.</p></div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground border-b"><th className="py-2">Client</th><th>Entité</th><th>Jobs</th><th>Coût réel</th><th>Estimation locale</th></tr></thead><tbody>{(costs.data?.by_entity || []).map(row => <tr key={`${row.client_id}-${row.entity_id}`} className="border-b border-border/50"><td className="py-3">{row.client_id}</td><td className="font-medium">{row.entity_id}</td><td>{row.jobs}</td><td>{euro(row.cost_eur)}</td><td className="font-semibold">{euro(row.billable_eur)}</td></tr>)}</tbody></table></div></div>
  </div>;
}

function Kpi({ icon: Icon, label, value }) { return <div className="bg-card border border-border rounded-2xl p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p><p className="text-xl font-bold mt-1">{value}</p></div><div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-4 h-4" /></div></div></div>; }

function JobDetail({ job, onApprove, onReject, busy }) {
  const costs = job.costs || [];
  const candidate = job.output?.candidate_glb;
  const qaReady = job.output?.validation_ready;
  return <div className="mt-4 space-y-4">
    <div className="grid grid-cols-2 gap-2"><Mini label="Statut" value={STATUS_LABELS[job.status] || job.status} /><Mini label="Étape" value={job.current_stage || '—'} /><Mini label="Coût" value={euro(job.cost_total_eur)} /><Mini label="Politique" value={job.billing_policy} /></div>
    {candidate && <div className="rounded-xl bg-muted/50 p-3 text-xs"><p className="font-semibold">Candidat local</p><p className="text-muted-foreground mt-1 break-all">{candidate}</p><p className={`mt-2 font-medium ${qaReady ? 'text-emerald-600' : 'text-amber-600'}`}>{qaReady ? 'QA automatique réussie' : 'QA en attente'}</p></div>}
    {job.error && <div className="rounded-xl bg-red-500/10 text-red-700 p-3 text-xs">{job.error}</div>}
    {job.status === 'awaiting_approval' && <div className="grid grid-cols-2 gap-2"><button onClick={onReject} disabled={Boolean(busy)} className="h-10 rounded-xl border border-red-500/30 text-red-700 text-sm font-semibold flex items-center justify-center gap-2"><XCircle className="w-4 h-4" />Refuser</button><button onClick={onApprove} disabled={Boolean(busy)} className="h-10 rounded-xl bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center gap-2">{busy === 'approve' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}Valider</button></div>}
    <div><p className="text-xs font-semibold text-muted-foreground mb-2">Événements récents</p><div className="space-y-2 max-h-56 overflow-y-auto">{(job.events || []).slice(0, 20).map(event => <div key={event.id} className="rounded-lg bg-muted/50 px-3 py-2"><div className="flex justify-between gap-2"><span className="text-xs font-medium">{event.stage || 'orchestrateur'}</span><span className="text-[10px] text-muted-foreground">{new Date(event.created_at).toLocaleTimeString('fr-BE')}</span></div><p className={`text-xs mt-1 ${event.level === 'error' ? 'text-red-600' : 'text-muted-foreground'}`}>{event.message}</p></div>)}</div></div>
    <div><p className="text-xs font-semibold text-muted-foreground mb-2">Coûts du job</p>{costs.length ? <div className="space-y-1">{costs.map(c => <div key={c.id} className="flex justify-between text-xs border-b border-border/50 py-1.5"><span>{c.category}</span><span>{euro(c.cost_eur)}</span></div>)}</div> : <p className="text-xs text-muted-foreground">Aucun coût enregistré pour le moment.</p>}</div>
  </div>;
}
function Mini({ label, value }) { return <div className="rounded-xl bg-muted/50 p-3"><p className="text-[10px] uppercase text-muted-foreground font-semibold">{label}</p><p className="text-sm font-semibold mt-1 truncate">{value}</p></div>; }
