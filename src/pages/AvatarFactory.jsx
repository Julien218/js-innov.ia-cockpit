import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, CircleDollarSign, Cpu, Factory, Image as ImageIcon,
  Loader2, Play, RefreshCw, ShieldCheck, Sparkles, UploadCloud, WalletCards, XCircle,
  Box, Rotate3D, WandSparkles,
} from 'lucide-react';
import { avatarFactory } from '@/api/avatarFactoryClient';
import Avatar3DViewer from '@/components/avatar/Avatar3DViewer';
import { formatAvatarFactoryError, formatAvatarStage, getAvatarProductionProgress } from '@/lib/avatarFactoryProgress';

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
  queued: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
  running: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  awaiting_approval: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  queued_after_approval: 'bg-violet-500/10 text-violet-700 border-violet-500/20',
  completed: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  failed: 'bg-red-500/10 text-red-700 border-red-500/20',
  rejected: 'bg-red-500/10 text-red-700 border-red-500/20',
};

const inputClass = 'w-full h-10 rounded-xl border border-border/80 bg-background/80 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 transition';

function euro(value) {
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 }).format(Number(value || 0));
}

/** @param {any} props */
function Field({ label, children, hint = null }) {
  return <label className="space-y-1.5 block"><span className="text-xs font-semibold text-muted-foreground">{label}</span>{children}{hint && <span className="block text-[10px] text-muted-foreground">{hint}</span>}</label>;
}

export default function AvatarFactory() {
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [leftPreviewUrl, setLeftPreviewUrl] = useState('');
  const [backPreviewUrl, setBackPreviewUrl] = useState('');
  const [rightPreviewUrl, setRightPreviewUrl] = useState('');
  const [uploadedReference, setUploadedReference] = useState(null);
  const [uploadedLeftReference, setUploadedLeftReference] = useState(null);
  const [uploadedBackReference, setUploadedBackReference] = useState(null);
  const [uploadedRightReference, setUploadedRightReference] = useState(null);
  const fileInputRef = useRef(null);
  const leftFileInputRef = useRef(null);
  const backFileInputRef = useRef(null);
  const rightFileInputRef = useRef(null);
  const previewUrlsRef = useRef(new Set());
  const [form, setForm] = useState({
    client_id: 'olivier', entity_id: 'les-vaincriez-dour', project_id: 'canari-3d',
    character_id: 'vaincriez-canary', reference_path: '', left_reference_path: '', back_reference_path: '', right_reference_path: '',
    billing_policy: 'technical_costs_only', preset: 'diagnostic', seed: 2182026,
  });

  const health = useQuery({ queryKey: ['avatar-factory-health'], queryFn: avatarFactory.health, retry: false, refetchInterval: 30000 });
  const uploadHealth = useQuery({ queryKey: ['avatar-reference-upload-health'], queryFn: avatarFactory.uploadHealth, retry: false, refetchInterval: 30000 });
  const previewHealth = useQuery({ queryKey: ['avatar-preview-health'], queryFn: avatarFactory.previewHealth, retry: false, refetchInterval: 30000 });
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
  useEffect(() => () => {
    previewUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    previewUrlsRef.current.clear();
  }, []);

  const counts = useMemo(() => {
    const rows = jobs.data?.jobs || [];
    return {
      total: rows.length,
      running: rows.filter(job => ['queued', 'running', 'queued_after_approval'].includes(job.status)).length,
      approval: rows.filter(job => job.status === 'awaiting_approval').length,
      failed: rows.filter(job => ['failed', 'rejected'].includes(job.status)).length,
    };
  }, [jobs.data]);

  const selectedJob = detail.data || (jobs.data?.jobs || []).find(job => job.id === selectedId) || null;

  const online = Boolean(health.isSuccess && health.data?.ok);
  const uploaderOnline = Boolean(uploadHealth.isSuccess && uploadHealth.data?.ok);
  const previewOnline = Boolean(previewHealth.isSuccess && previewHealth.data?.ok);
  const stationReady = online && uploaderOnline && previewOnline;

  const refresh = async () => Promise.all([jobs.refetch(), costs.refetch(), selectedId ? detail.refetch() : Promise.resolve()]);

  const uploadReference = async file => {
    if (!file) return;
    setNotice(null); setBusy('upload');
    try {
      const localPreview = URL.createObjectURL(file);
      previewUrlsRef.current.add(localPreview);
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrlsRef.current.delete(previewUrl); }
      setPreviewUrl(localPreview);
      const result = await avatarFactory.uploadReference(file, form.character_id);
      setUploadedReference(result);
      setForm(current => ({ ...current, reference_path: result.reference_path }));
      setNotice({ type: 'success', text: 'Image transférée sur la station locale. Elle est maintenant liée à la prochaine production.' });
    } catch (error) {
      setUploadedReference(null); setForm(current => ({ ...current, reference_path: '' }));
      setNotice({ type: 'error', text: error.message });
    } finally { setBusy(''); }
  };

  const clearReference = () => {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrlsRef.current.delete(previewUrl); }
    setPreviewUrl(''); setUploadedReference(null); setForm(current => ({ ...current, reference_path: '' }));
  };

  const uploadLeftReference = async file => {
    if (!file) return;
    setNotice(null); setBusy('upload-left');
    try {
      const localPreview = URL.createObjectURL(file);
      previewUrlsRef.current.add(localPreview);
      if (leftPreviewUrl) { URL.revokeObjectURL(leftPreviewUrl); previewUrlsRef.current.delete(leftPreviewUrl); }
      setLeftPreviewUrl(localPreview);
      const result = await avatarFactory.uploadReference(file, `${form.character_id}-left`);
      setUploadedLeftReference(result);
      setForm(current => ({ ...current, left_reference_path: result.reference_path }));
      setNotice({ type: 'success', text: 'Vue gauche transférée et liée à la prochaine production.' });
    } catch (error) {
      setUploadedLeftReference(null); setForm(current => ({ ...current, left_reference_path: '' }));
      setNotice({ type: 'error', text: error.message });
    } finally { setBusy(''); }
  };

  const clearLeftReference = () => {
    if (leftPreviewUrl) { URL.revokeObjectURL(leftPreviewUrl); previewUrlsRef.current.delete(leftPreviewUrl); }
    setLeftPreviewUrl(''); setUploadedLeftReference(null);
    setForm(current => ({ ...current, left_reference_path: '' }));
  };

  const uploadBackReference = async file => {
    if (!file) return;
    setNotice(null); setBusy('upload-back');
    try {
      const localPreview = URL.createObjectURL(file);
      previewUrlsRef.current.add(localPreview);
      if (backPreviewUrl) { URL.revokeObjectURL(backPreviewUrl); previewUrlsRef.current.delete(backPreviewUrl); }
      setBackPreviewUrl(localPreview);
      const result = await avatarFactory.uploadReference(file, `${form.character_id}-back`);
      setUploadedBackReference(result);
      setForm(current => ({ ...current, back_reference_path: result.reference_path }));
      setNotice({ type: 'success', text: 'Vue arrière transférée et liée à la prochaine production.' });
    } catch (error) {
      setUploadedBackReference(null); setForm(current => ({ ...current, back_reference_path: '' }));
      setNotice({ type: 'error', text: error.message });
    } finally { setBusy(''); }
  };

  const clearBackReference = () => {
    if (backPreviewUrl) { URL.revokeObjectURL(backPreviewUrl); previewUrlsRef.current.delete(backPreviewUrl); }
    setBackPreviewUrl(''); setUploadedBackReference(null);
    setForm(current => ({ ...current, back_reference_path: '' }));
  };

  const uploadRightReference = async file => {
    if (!file) return;
    setNotice(null); setBusy('upload-right');
    try {
      const localPreview = URL.createObjectURL(file);
      previewUrlsRef.current.add(localPreview);
      if (rightPreviewUrl) { URL.revokeObjectURL(rightPreviewUrl); previewUrlsRef.current.delete(rightPreviewUrl); }
      setRightPreviewUrl(localPreview);
      const result = await avatarFactory.uploadReference(file, `${form.character_id}-right`);
      setUploadedRightReference(result);
      setForm(current => ({ ...current, right_reference_path: result.reference_path }));
      setNotice({ type: 'success', text: 'Vue droite transférée. Le prochain job utilisera le moteur multivue reproductible.' });
    } catch (error) {
      setUploadedRightReference(null); setForm(current => ({ ...current, right_reference_path: '' }));
      setNotice({ type: 'error', text: error.message });
    } finally { setBusy(''); }
  };

  const clearRightReference = () => {
    if (rightPreviewUrl) { URL.revokeObjectURL(rightPreviewUrl); previewUrlsRef.current.delete(rightPreviewUrl); }
    setRightPreviewUrl(''); setUploadedRightReference(null);
    setForm(current => ({ ...current, right_reference_path: '' }));
  };

  const create = async event => {
    event.preventDefault(); setNotice(null);
    if (![form.reference_path, form.left_reference_path, form.back_reference_path, form.right_reference_path].every(Boolean)) {
      return setNotice({ type: 'error', text: 'Ajoute les quatre vues : face, gauche, arrière et droite.' });
    }
    setBusy('create');
    try {
      const created = await avatarFactory.createJob(form);
      setSelectedId(created.id);
      setNotice({ type: 'success', text: 'Production quatre vues lancée : 3D → nettoyage → rig/idle → QA → validation humaine.' });
      await refresh();
    } catch (error) { setNotice({ type: 'error', text: error.message }); } finally { setBusy(''); }
  };

  const approve = async () => {
    setBusy('approve'); setNotice(null);
    try { await avatarFactory.approveJob(selectedId); setNotice({ type: 'success', text: 'Candidat validé.' }); await refresh(); }
    catch (error) { setNotice({ type: 'error', text: error.message }); } finally { setBusy(''); }
  };

  const reject = async () => {
    setBusy('reject'); setNotice(null);
    try { await avatarFactory.rejectJob(selectedId, 'Validation visuelle refusée depuis le Cockpit'); setNotice({ type: 'success', text: 'Candidat refusé et conservé dans l’historique.' }); await refresh(); }
    catch (error) { setNotice({ type: 'error', text: error.message }); } finally { setBusy(''); }
  };

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(135deg,#07111f_0%,#0b1830_55%,#17143d_100%)] text-white shadow-2xl shadow-primary/10 p-5 sm:p-7">
        <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute -bottom-28 left-1/4 w-80 h-80 rounded-full bg-violet-500/15 blur-3xl" />
        <div className="relative flex flex-col xl:flex-row xl:items-end justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 p-3 rounded-2xl bg-white/10 border border-white/10 backdrop-blur"><Factory className="w-7 h-7 text-cyan-300" /></div>
            <div><div className="flex items-center gap-2 mb-1"><span className="text-[10px] tracking-[0.22em] uppercase text-cyan-300 font-bold">JS-Innov.IA Studio</span><WandSparkles className="w-3.5 h-3.5 text-amber-300" /></div><h1 className="text-2xl sm:text-3xl font-bold">Avatar Factory</h1><p className="text-sm text-white/60 mt-1 max-w-2xl">Image → orchestration locale → 3D → QA → revue 360° → validation. Les coûts sont suivis automatiquement.</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill ok={online} label="Agent 8791" />
            <StatusPill ok={uploaderOnline} label="Upload 8792" />
            <StatusPill ok={previewOnline} label="Preview 8793" />
          </div>
        </div>
      </section>

      {!stationReady && <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 flex gap-3"><AlertTriangle className="w-5 h-5 shrink-0" /><div><p className="font-semibold">Connexion locale incomplète</p><p className="mt-1">Vérifie les indicateurs ci-dessus. Depuis <code>compagnon-jsinnovia-production</code>, le script <code>scripts/start_avatar_factory.ps1</code> démarre les services 8791, 8792 et 8793.</p></div></div>}
      {notice && <div className={`rounded-xl px-4 py-3 text-sm flex items-center gap-2 border ${notice.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700' : 'bg-red-500/10 border-red-500/20 text-red-700'}`}>{notice.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}{notice.text}</div>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi icon={Sparkles} label="Jobs" value={counts.total} tone="blue" />
        <Kpi icon={Cpu} label="En production" value={counts.running} tone="violet" />
        <Kpi icon={ShieldCheck} label="À valider" value={counts.approval} tone="cyan" />
        <Kpi icon={CircleDollarSign} label="Coût local" value={euro(costs.data?.cost_eur)} tone="gold" />
      </div>

      {selectedJob && <ProductionProgress job={selectedJob} prominent />}

      <div className="grid grid-cols-1 2xl:grid-cols-[0.95fr_1fr_1.35fr] gap-5 items-start">
        <form onSubmit={create} className="premium-panel p-5 space-y-4">
          <div><h2 className="font-semibold">Nouvelle production</h2><p className="text-xs text-muted-foreground mt-1">Dépose quatre images cohérentes : face, gauche, arrière et droite.</p></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <ReferenceUploader title="Vue avant · obligatoire" previewUrl={previewUrl} uploadedReference={uploadedReference} busy={busy === 'upload'} online={uploaderOnline} onBrowse={() => fileInputRef.current?.click()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) uploadReference(file); }} onClear={clearReference} />
            <ReferenceUploader title="Vue arrière · obligatoire" previewUrl={backPreviewUrl} uploadedReference={uploadedBackReference} busy={busy === 'upload-back'} online={uploaderOnline} onBrowse={() => backFileInputRef.current?.click()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) uploadBackReference(file); }} onClear={clearBackReference} />
            <ReferenceUploader title="Vue gauche · obligatoire" previewUrl={leftPreviewUrl} uploadedReference={uploadedLeftReference} busy={busy === 'upload-left'} online={uploaderOnline} onBrowse={() => leftFileInputRef.current?.click()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) uploadLeftReference(file); }} onClear={clearLeftReference} />
            <ReferenceUploader title="Vue droite · obligatoire" previewUrl={rightPreviewUrl} uploadedReference={uploadedRightReference} busy={busy === 'upload-right'} online={uploaderOnline} onBrowse={() => rightFileInputRef.current?.click()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) uploadRightReference(file); }} onClear={clearRightReference} />
          </div>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) uploadReference(file); event.target.value = ''; }} />
          <input ref={backFileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) uploadBackReference(file); event.target.value = ''; }} />
          <input ref={leftFileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) uploadLeftReference(file); event.target.value = ''; }} />
          <input ref={rightFileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) uploadRightReference(file); event.target.value = ''; }} />
          <div className="grid sm:grid-cols-2 2xl:grid-cols-1 gap-3">
            <Field label="Client ID"><input className={inputClass} value={form.client_id} onChange={e => setForm(v => ({ ...v, client_id: e.target.value }))} required /></Field>
            <Field label="Société / ASBL / entité"><input className={inputClass} value={form.entity_id} onChange={e => setForm(v => ({ ...v, entity_id: e.target.value }))} required /></Field>
            <Field label="Projet"><input className={inputClass} value={form.project_id} onChange={e => setForm(v => ({ ...v, project_id: e.target.value }))} required /></Field>
            <Field label="Personnage"><input className={inputClass} value={form.character_id} onChange={e => setForm(v => ({ ...v, character_id: e.target.value }))} required /></Field>
          </div>
          {uploadedReference && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs"><p className="font-semibold text-emerald-700">Référence prête</p><p className="text-muted-foreground mt-1 break-all">{uploadedReference.relative_path || uploadedReference.reference_path}</p></div>}
          <div className={`rounded-xl px-3 py-2 text-xs border ${[form.reference_path, form.left_reference_path, form.back_reference_path, form.right_reference_path].every(Boolean) ? 'border-cyan-500/20 bg-cyan-500/5 text-cyan-700' : 'border-border bg-muted/40 text-muted-foreground'}`}>{[form.reference_path, form.left_reference_path, form.back_reference_path, form.right_reference_path].filter(Boolean).length}/4 vues prêtes · {[form.reference_path, form.left_reference_path, form.back_reference_path, form.right_reference_path].every(Boolean) ? `multivue complète · graine ${form.seed}` : 'complète les vues manquantes pour lancer'}</div>
          <Field label="Qualité"><select className={inputClass} value={form.preset} onChange={e => setForm(v => ({ ...v, preset: e.target.value }))}><option value="diagnostic">Diagnostic 1024 — recommandé 6 Go VRAM</option><option value="production">Production 2048 — si mémoire suffisante</option></select></Field>
          <Field label="Politique de facturation"><select disabled={form.client_id.trim().toLowerCase() === 'olivier'} className={`${inputClass} disabled:opacity-60`} value={form.billing_policy} onChange={e => setForm(v => ({ ...v, billing_policy: e.target.value }))}>{POLICIES.map(policy => <option key={policy.value} value={policy.value}>{policy.label}</option>)}</select></Field>
          {form.client_id.trim().toLowerCase() === 'olivier' && <p className="text-[11px] text-muted-foreground">Olivier : coûts techniques uniquement, ventilés par entité.</p>}
          <button disabled={!online || !uploaderOnline || ![form.reference_path, form.left_reference_path, form.back_reference_path, form.right_reference_path].every(Boolean) || Boolean(busy)} className="w-full h-11 rounded-xl gradient-primary text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-50">{busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}Lancer la production quatre vues</button>
        </form>

        <section className="premium-panel p-5 min-w-0">
          <div className="flex items-center justify-between mb-4"><div><h2 className="font-semibold">Productions</h2><p className="text-xs text-muted-foreground">Actualisation automatique</p></div><button onClick={() => jobs.refetch()} className="p-2 rounded-lg hover:bg-muted"><RefreshCw className="w-4 h-4" /></button></div>
          <div className="space-y-2 max-h-[760px] overflow-y-auto">
            {(jobs.data?.jobs || []).map(job => <button key={job.id} onClick={() => setSelectedId(job.id)} className={`w-full text-left rounded-2xl border p-3 transition ${selectedId === job.id ? 'border-primary/40 bg-primary/[0.08] shadow-md shadow-primary/5' : 'border-border/70 hover:bg-muted/40'}`}><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold truncate">{job.character_id}</p><span className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${STATUS_CLASS[job.status] || 'bg-muted border-border'}`}>{STATUS_LABELS[job.status] || job.status}</span></div><p className="text-xs text-muted-foreground mt-1 truncate">{job.entity_id} · {job.project_id}</p><ProductionProgress job={job} compact /></button>)}
            {!jobs.isLoading && !(jobs.data?.jobs || []).length && <p className="text-sm text-muted-foreground text-center py-10">Aucune production.</p>}
          </div>
        </section>

        <section className="premium-panel p-5 min-w-0">
          <div className="flex items-center gap-2"><Box className="w-5 h-5 text-primary" /><div><h2 className="font-semibold">Revue & validation</h2><p className="text-xs text-muted-foreground">Contrôle du candidat avant publication.</p></div></div>
          {!selectedId ? <p className="text-sm text-muted-foreground py-10">Sélectionne une production.</p> : detail.isLoading ? <Loader2 className="w-5 h-5 animate-spin my-10 mx-auto" /> : detail.data ? <JobDetail job={detail.data} previewOnline={previewOnline} onApprove={approve} onReject={reject} busy={busy} /> : <p className="text-sm text-red-600 py-8">Impossible de charger le job.</p>}
        </section>
      </div>

      <section className="premium-panel p-5">
        <div className="flex items-center gap-2 mb-4"><WalletCards className="w-5 h-5 text-primary" /><div><h2 className="font-semibold">FinOps local par entité</h2><p className="text-xs text-muted-foreground">Le FinOps central reste l’autorité pour la refacturation finale.</p></div></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground border-b"><th className="py-2">Client</th><th>Entité</th><th>Jobs</th><th>Coût réel</th><th>Estimation locale</th></tr></thead><tbody>{(costs.data?.by_entity || []).map(row => <tr key={`${row.client_id}-${row.entity_id}`} className="border-b border-border/50"><td className="py-3">{row.client_id}</td><td className="font-medium">{row.entity_id}</td><td>{row.jobs}</td><td>{euro(row.cost_eur)}</td><td className="font-semibold">{euro(row.billable_eur)}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

/** @param {any} props */
function ReferenceUploader({ title, previewUrl, uploadedReference, busy, online, onBrowse, onDrop, onClear }) {
  return <div onDragOver={event => event.preventDefault()} onDrop={onDrop} className={`rounded-2xl border-2 border-dashed p-4 transition ${uploadedReference ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-primary/20 bg-primary/[0.025]'} ${!online ? 'opacity-60' : ''}`}><p className="text-xs font-semibold mb-2">{title}</p>{previewUrl ? <div className="space-y-3"><div className="relative rounded-xl overflow-hidden bg-black/5 aspect-square max-h-64"><img src={previewUrl} alt={title} className="w-full h-full object-contain" /><button type="button" onClick={onClear} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 text-white flex items-center justify-center" aria-label="Retirer l’image"><XCircle className="w-4 h-4" /></button></div><button type="button" disabled={busy || !online} onClick={onBrowse} className="w-full h-10 rounded-xl border border-border text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}Remplacer l’image</button></div> : <button type="button" disabled={busy || !online} onClick={onBrowse} className="w-full py-6 flex flex-col items-center justify-center text-center disabled:opacity-50"><div className="w-12 h-12 rounded-2xl gradient-primary text-white shadow-lg shadow-primary/20 flex items-center justify-center mb-3">{busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <ImageIcon className="w-6 h-6" />}</div><p className="text-sm font-semibold">Déposer ou choisir une image</p><p className="text-xs text-muted-foreground mt-1">PNG, JPG/JPEG ou WEBP · max. 12 Mo</p></button>}</div>;
}

/** @param {any} props */
function StatusPill({ ok, label }) { return <div className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold border backdrop-blur ${ok ? 'bg-emerald-400/10 border-emerald-300/20 text-emerald-200' : 'bg-red-400/10 border-red-300/20 text-red-200'}`}><span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />{label}</div>; }

/** @param {any} props */
function Kpi({ icon: Icon, label, value, tone = 'blue' }) {
  const tones = { blue: 'from-blue-500/15 to-cyan-400/5 text-blue-600', violet: 'from-violet-500/15 to-fuchsia-400/5 text-violet-600', cyan: 'from-cyan-500/15 to-sky-400/5 text-cyan-600', gold: 'from-amber-500/15 to-yellow-300/5 text-amber-600' };
  return <div className={`premium-panel p-4 bg-gradient-to-br ${tones[tone] || tones.blue}`}><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p><p className="text-xl font-bold mt-1">{value}</p></div><div className="w-9 h-9 rounded-xl bg-white/60 border border-white/70 flex items-center justify-center shadow-sm"><Icon className="w-4 h-4" /></div></div></div>;
}

/** @param {any} props */
function JobDetail({ job, previewOnline, onApprove, onReject, busy }) {
  const candidate = job.output?.candidate_glb;
  const qaReady = job.output?.validation_ready;
  const reference = job.output?.reference_path || job.input?.reference_path;
  const leftReference = job.output?.left_reference_path || job.input?.left_reference_path;
  const backReference = job.output?.back_reference_path || job.input?.back_reference_path;
  const rightReference = job.output?.right_reference_path || job.input?.right_reference_path;
  const multiview = Boolean(job.output?.multiview || (leftReference && backReference && rightReference));
  const jobCosts = job.costs || [];
  return <div className="mt-4 space-y-4">
    <div className="grid grid-cols-2 gap-2"><Mini label="Statut" value={STATUS_LABELS[job.status] || job.status} /><Mini label="Étape" value={formatAvatarStage(job.current_stage)} /><Mini label="Coût" value={euro(job.cost_total_eur)} /><Mini label="Génération" value={multiview ? `Multivue · seed ${job.output?.seed || job.input?.seed || 2182026}` : 'Monovue'} /></div>
    {candidate && previewOnline && <Avatar3DViewer src={avatarFactory.candidateUrl(job.id)} title={`${job.character_id} · candidat 3D`} />}
    {candidate && !previewOnline && <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 flex gap-2"><Rotate3D className="w-4 h-4 shrink-0" /><span>Le candidat existe, mais le service Preview 8793 n’est pas connecté.</span></div>}
    {reference && <div className="rounded-xl bg-muted/50 p-3 text-xs"><p className="font-semibold">Référence utilisée</p><p className="text-muted-foreground mt-1 break-all">{reference}</p></div>}
    {backReference && <div className="rounded-xl bg-muted/50 p-3 text-xs"><p className="font-semibold">Vue arrière utilisée</p><p className="text-muted-foreground mt-1 break-all">{backReference}</p></div>}
    {leftReference && <div className="rounded-xl bg-muted/50 p-3 text-xs"><p className="font-semibold">Vue gauche utilisée</p><p className="text-muted-foreground mt-1 break-all">{leftReference}</p></div>}
    {rightReference && <div className="rounded-xl bg-muted/50 p-3 text-xs"><p className="font-semibold">Vue droite utilisée</p><p className="text-muted-foreground mt-1 break-all">{rightReference}</p></div>}
    {candidate && <div className="rounded-xl bg-muted/50 p-3 text-xs"><p className="font-semibold">Candidat local</p><p className="text-muted-foreground mt-1 break-all">{candidate}</p><p className={`mt-2 font-medium ${qaReady ? 'text-emerald-600' : 'text-amber-600'}`}>{qaReady ? 'QA automatique réussie' : 'QA en attente'}</p></div>}
    {job.error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-700 p-3 text-xs"><p className="font-semibold">Production arrêtée au contrôle qualité</p><p className="mt-1">{formatAvatarFactoryError(job.error)}</p><details className="mt-2"><summary className="cursor-pointer font-medium">Voir le détail technique</summary><p className="mt-1 break-words opacity-80">{job.error}</p></details></div>}
    {job.status === 'awaiting_approval' && <div className="grid grid-cols-2 gap-2"><button onClick={onReject} disabled={Boolean(busy)} className="h-10 rounded-xl border border-red-500/30 text-red-700 text-sm font-semibold flex items-center justify-center gap-2"><XCircle className="w-4 h-4" />Refuser</button><button onClick={onApprove} disabled={Boolean(busy)} className="h-10 rounded-xl bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20">{busy === 'approve' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}Valider</button></div>}
    <div><p className="text-xs font-semibold text-muted-foreground mb-2">Événements récents</p><div className="space-y-2 max-h-48 overflow-y-auto">{(job.events || []).slice(0, 20).map(event => <div key={event.id} className="rounded-lg bg-muted/50 px-3 py-2"><div className="flex justify-between gap-2"><span className="text-xs font-medium">{event.stage || 'orchestrateur'}</span><span className="text-[10px] text-muted-foreground">{new Date(event.created_at).toLocaleTimeString('fr-BE')}</span></div><p className={`text-xs mt-1 ${event.level === 'error' ? 'text-red-600' : 'text-muted-foreground'}`}>{event.message}</p></div>)}</div></div>
    <div><p className="text-xs font-semibold text-muted-foreground mb-2">Coûts du job</p>{jobCosts.length ? <div className="space-y-1">{jobCosts.map(cost => <div key={cost.id} className="flex justify-between text-xs border-b border-border/50 py-1.5"><span>{cost.category}</span><span>{euro(cost.cost_eur)}</span></div>)}</div> : <p className="text-xs text-muted-foreground">Aucun coût enregistré.</p>}</div>
  </div>;
}

/** @param {any} props */
function ProductionProgress({ job, prominent = false, compact = false }) {
  const progress = getAvatarProductionProgress(job);
  const colors = {
    active: 'bg-blue-500', approval: 'bg-amber-500', success: 'bg-emerald-500', error: 'bg-red-500', queued: 'bg-slate-400',
  };
  const textColors = {
    active: 'text-blue-700', approval: 'text-amber-700', success: 'text-emerald-700', error: 'text-red-700', queued: 'text-slate-600',
  };
  const bar = <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-label={`Avancement de ${job.character_id || 'la production'}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress.percent}><div className={`h-full rounded-full transition-all duration-700 ${colors[progress.tone]}`} style={{ width: `${progress.percent}%` }} /></div>;

  if (compact) return <div className="mt-2 space-y-1"><div className="flex items-center justify-between gap-2 text-[10px]"><span className="text-muted-foreground truncate">{progress.label}</span><span className={`font-bold ${textColors[progress.tone]}`}>{progress.percent}%</span></div>{bar}</div>;

  return <section className={`rounded-2xl border p-4 sm:p-5 ${progress.tone === 'error' ? 'border-red-500/20 bg-red-500/[0.06]' : 'border-border/70 bg-card/80'} ${prominent ? 'shadow-sm' : ''}`}>
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
      <div><p className={`text-xs font-bold uppercase tracking-[0.12em] ${textColors[progress.tone]}`}>{progress.title}</p><p className="font-semibold mt-1">{job.character_id || 'Avatar'} · {progress.label}</p></div>
      <div className="text-left sm:text-right"><p className={`text-2xl font-bold ${textColors[progress.tone]}`}>{progress.percent}%</p><p className="text-[11px] text-muted-foreground">Étape {progress.step}</p></div>
    </div>
    {bar}
    <div className="flex flex-wrap justify-between gap-2 mt-2 text-[11px] text-muted-foreground"><span>Progression par étapes réelles, sans estimation du temps restant</span>{job.updated_at && <span>Mis à jour {new Date(job.updated_at).toLocaleString('fr-BE')}</span>}</div>
    {job.error && <p className="mt-3 text-xs font-medium text-red-700">{formatAvatarFactoryError(job.error)}</p>}
  </section>;
}

/** @param {any} props */
function Mini({ label, value }) { return <div className="rounded-xl bg-muted/50 p-3"><p className="text-[10px] uppercase text-muted-foreground font-semibold">{label}</p><p className="text-sm font-semibold mt-1 truncate">{value}</p></div>; }
