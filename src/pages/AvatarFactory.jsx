import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Box, CheckCircle2, CircleDollarSign, Cpu, Factory, Image as ImageIcon,
  Loader2, Play, RefreshCw, Rotate3D, ShieldCheck, Sparkles, UploadCloud, WalletCards,
  WandSparkles, XCircle,
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

const SUBJECT_TYPES = [
  { value: 'auto', label: 'Détection automatique' },
  { value: 'person', label: 'Personne / avatar humain' },
  { value: 'animal', label: 'Animal' },
  { value: 'mascot', label: 'Mascotte / personnage' },
  { value: 'object', label: 'Objet / tasse / produit' },
  { value: 'other', label: 'Autre sujet' },
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

function slug(value, fallback = 'avatar') {
  const normalized = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
  return normalized || fallback;
}

function Field({ label, children, hint = null }) {
  return <label className="space-y-1.5 block"><span className="text-xs font-semibold text-muted-foreground">{label}</span>{children}{hint && <span className="block text-[10px] text-muted-foreground">{hint}</span>}</label>;
}

export default function AvatarFactory() {
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState('');
  const previewUrlsRef = useRef(new Set());
  const characterIdEditedRef = useRef(false);
  const inputRefs = { front: useRef(null), left: useRef(null), back: useRef(null), right: useRef(null) };
  const [references, setReferences] = useState({ front: null, left: null, back: null, right: null });
  const [form, setForm] = useState({
    client_id: '', entity_id: '', project_id: '', subject_name: '', subject_type: 'auto', character_id: '',
    reference_path: '', left_reference_path: '', back_reference_path: '', right_reference_path: '',
    billing_policy: 'standard_margin', preset: 'diagnostic', seed: 2182026,
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
      setForm((current) => ({ ...current, billing_policy: 'technical_costs_only' }));
    }
  }, [form.client_id, form.billing_policy]);
  useEffect(() => () => { previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)); }, []);

  const online = Boolean(health.isSuccess && health.data?.ok);
  const uploaderOnline = Boolean(uploadHealth.isSuccess && uploadHealth.data?.ok);
  const previewOnline = Boolean(previewHealth.isSuccess && previewHealth.data?.ok);
  const stationReady = online && uploaderOnline && previewOnline;
  const auxCount = ['left', 'back', 'right'].filter((view) => references[view]?.path).length;
  const viewModeValid = Boolean(references.front?.path) && (auxCount === 0 || auxCount === 3);

  const counts = useMemo(() => {
    const rows = jobs.data?.jobs || [];
    return {
      total: rows.length,
      running: rows.filter((job) => ['queued', 'running', 'queued_after_approval'].includes(job.status)).length,
      approval: rows.filter((job) => job.status === 'awaiting_approval').length,
      failed: rows.filter((job) => ['failed', 'rejected'].includes(job.status)).length,
    };
  }, [jobs.data]);

  const selectedJob = detail.data || (jobs.data?.jobs || []).find((job) => job.id === selectedId) || null;
  const refresh = async () => Promise.all([jobs.refetch(), costs.refetch(), selectedId ? detail.refetch() : Promise.resolve()]);

  const ensureCharacterId = (file) => {
    const id = slug(form.character_id || form.subject_name || file?.name?.replace(/\.[^.]+$/, ''), `avatar-${Date.now()}`);
    if (id !== form.character_id) setForm((current) => ({ ...current, character_id: id }));
    return id;
  };

  const upload = async (view, file) => {
    if (!file) return;
    setNotice(null);
    setBusy(`upload-${view}`);
    try {
      const previous = references[view]?.preview;
      if (previous) { URL.revokeObjectURL(previous); previewUrlsRef.current.delete(previous); }
      const preview = URL.createObjectURL(file);
      previewUrlsRef.current.add(preview);
      const characterId = ensureCharacterId(file);
      const result = await avatarFactory.uploadReference(file, characterId, {
        displayName: form.subject_name || file.name.replace(/\.[^.]+$/, ''),
        subjectType: form.subject_type,
      });
      const key = view === 'front' ? 'reference_path' : `${view}_reference_path`;
      setReferences((current) => ({ ...current, [view]: { path: result.reference_path, preview, result } }));
      setForm((current) => ({ ...current, character_id: characterId, [key]: result.reference_path }));
      setNotice({ type: 'success', text: `${view === 'front' ? 'Référence principale' : `Vue ${view}`} transférée. Le sujet « ${characterId} » est prêt sans manifeste manuel.` });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setBusy('');
    }
  };

  const clearReference = (view) => {
    const previous = references[view]?.preview;
    if (previous) { URL.revokeObjectURL(previous); previewUrlsRef.current.delete(previous); }
    const key = view === 'front' ? 'reference_path' : `${view}_reference_path`;
    setReferences((current) => ({ ...current, [view]: null }));
    setForm((current) => ({ ...current, [key]: '' }));
  };

  const create = async (event) => {
    event.preventDefault();
    setNotice(null);
    if (!references.front?.path) return setNotice({ type: 'error', text: 'Ajoute au minimum une image principale.' });
    if (auxCount > 0 && auxCount < 3) return setNotice({ type: 'error', text: 'Pour le mode multivue, ajoute ensemble les vues gauche, arrière et droite, ou conserve uniquement la vue principale.' });
    if (!form.client_id.trim() || !form.entity_id.trim() || !form.project_id.trim()) {
      return setNotice({ type: 'error', text: 'Client, entité et projet sont obligatoires pour le suivi et les coûts.' });
    }
    setBusy('create');
    try {
      const created = await avatarFactory.createJob({
        ...form,
        character_id: ensureCharacterId(),
        display_name: form.subject_name || form.character_id,
        subject_type: form.subject_type,
        billing_policy: form.client_id.trim().toLowerCase() === 'olivier'
          ? 'technical_costs_only'
          : form.billing_policy,
      });
      setSelectedId(created.id);
      setNotice({ type: 'success', text: `${auxCount === 3 ? 'Production multivue' : 'Production monovue'} lancée : 3D → nettoyage → QA → validation humaine.` });
      await refresh();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setBusy('');
    }
  };

  const approve = async () => {
    setBusy('approve'); setNotice(null);
    try { await avatarFactory.approveJob(selectedId); setNotice({ type: 'success', text: 'Candidat validé.' }); await refresh(); }
    catch (error) { setNotice({ type: 'error', text: error.message }); }
    finally { setBusy(''); }
  };

  const reject = async () => {
    setBusy('reject'); setNotice(null);
    try { await avatarFactory.rejectJob(selectedId, 'Validation visuelle refusée depuis le Cockpit'); setNotice({ type: 'success', text: 'Candidat refusé et conservé dans l’historique.' }); await refresh(); }
    catch (error) { setNotice({ type: 'error', text: error.message }); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(135deg,#07111f_0%,#0b1830_55%,#17143d_100%)] text-white shadow-2xl shadow-primary/10 p-5 sm:p-7">
        <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative flex flex-col xl:flex-row xl:items-end justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 p-3 rounded-2xl bg-white/10 border border-white/10"><Factory className="w-7 h-7 text-cyan-300" /></div>
            <div><div className="flex items-center gap-2 mb-1"><span className="text-[10px] tracking-[0.22em] uppercase text-cyan-300 font-bold">JS-Innov.IA Studio</span><WandSparkles className="w-3.5 h-3.5 text-amber-300" /></div><h1 className="text-2xl sm:text-3xl font-bold">Avatar Factory universelle</h1><p className="text-sm text-white/60 mt-1 max-w-2xl">Personne, animal, mascotte, personnage ou objet : une image suffit, quatre vues améliorent la fidélité. 3D → QA → revue 360° → validation.</p></div>
          </div>
          <div className="flex flex-wrap gap-2"><StatusPill ok={online} label="Agent 8791" /><StatusPill ok={uploaderOnline} label="Upload 8792" /><StatusPill ok={previewOnline} label="Preview 8793" /></div>
        </div>
      </section>

      {!stationReady && <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 flex gap-3"><AlertTriangle className="w-5 h-5 shrink-0" /><div><p className="font-semibold">Connexion locale incomplète</p><p className="mt-1">Les ports NOVA 8787/8788 peuvent être actifs tandis que la station Avatar 8791/8792/8793 est arrêtée. Démarre <code>scripts/start_avatar_factory.ps1</code> dans <code>compagnon-jsinnovia-production</code>.</p></div></div>}
      {notice && <div className={`rounded-xl px-4 py-3 text-sm flex items-center gap-2 border ${notice.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700' : 'bg-red-500/10 border-red-500/20 text-red-700'}`}>{notice.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}{notice.text}</div>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi icon={Sparkles} label="Jobs" value={counts.total} tone="blue" />
        <Kpi icon={Cpu} label="En production" value={counts.running} tone="violet" />
        <Kpi icon={ShieldCheck} label="À valider" value={counts.approval} tone="cyan" />
        <Kpi icon={CircleDollarSign} label="Coût local" value={euro(costs.data?.cost_eur)} tone="gold" />
      </div>

      {selectedJob && <ProductionProgress job={selectedJob} prominent />}

      <div className="grid grid-cols-1 2xl:grid-cols-[1.05fr_.85fr_1.25fr] gap-5 items-start">
        <form onSubmit={create} className="premium-panel p-5 space-y-4">
          <div><h2 className="font-semibold">Nouvelle production</h2><p className="text-xs text-muted-foreground mt-1">Vue principale obligatoire. Les trois vues complémentaires restent optionnelles, mais doivent être fournies ensemble.</p></div>
          <div className="grid sm:grid-cols-2 gap-3">
            {['front', 'back', 'left', 'right'].map((view) => (
              <ReferenceUploader key={view} title={{ front: 'Vue avant · obligatoire', back: 'Vue arrière · optionnelle', left: 'Vue gauche · optionnelle', right: 'Vue droite · optionnelle' }[view]} reference={references[view]} busy={busy === `upload-${view}`} online={uploaderOnline} onBrowse={() => inputRefs[view].current?.click()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) upload(view, file); }} onClear={() => clearReference(view)} />
            ))}
          </div>
          {['front', 'back', 'left', 'right'].map((view) => <input key={view} ref={inputRefs[view]} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(view, file); event.target.value = ''; }} />)}

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nom du sujet"><input className={inputClass} value={form.subject_name} onChange={(event) => { const subjectName = event.target.value; setForm((value) => ({ ...value, subject_name: subjectName, character_id: characterIdEditedRef.current ? value.character_id : slug(subjectName, '') })); }} placeholder="Ex. Canari, chat, tasse…" /></Field>
            <Field label="Type de sujet"><select className={inputClass} value={form.subject_type} onChange={(event) => setForm((value) => ({ ...value, subject_type: event.target.value }))}>{SUBJECT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></Field>
            <Field label="Identifiant technique" hint="Créé automatiquement, modifiable avant le premier envoi."><input className={inputClass} value={form.character_id} onChange={(event) => { const rawId = event.target.value; characterIdEditedRef.current = Boolean(rawId.trim()); setForm((value) => ({ ...value, character_id: rawId.trim() ? slug(rawId, '') : slug(value.subject_name, '') })); }} placeholder="canari-jaune" /></Field>
            <Field label="Client ID"><input className={inputClass} value={form.client_id} onChange={(event) => setForm((value) => ({ ...value, client_id: event.target.value }))} required /></Field>
            <Field label="Société / ASBL / entité"><input className={inputClass} value={form.entity_id} onChange={(event) => setForm((value) => ({ ...value, entity_id: event.target.value }))} required /></Field>
            <Field label="Projet"><input className={inputClass} value={form.project_id} onChange={(event) => setForm((value) => ({ ...value, project_id: event.target.value }))} required /></Field>
          </div>

          <div className={`rounded-xl px-3 py-2 text-xs border ${viewModeValid ? 'border-cyan-500/20 bg-cyan-500/5 text-cyan-700' : 'border-border bg-muted/40 text-muted-foreground'}`}>{references.front?.path ? (auxCount === 3 ? `4/4 vues · multivue · graine ${form.seed}` : auxCount === 0 ? `1/1 vue principale · monovue · graine ${form.seed}` : `${1 + auxCount}/4 vues · complète les trois vues optionnelles ou retire-les`) : '0 vue · ajoute une image principale'}</div>
          <Field label="Qualité"><select className={inputClass} value={form.preset} onChange={(event) => setForm((value) => ({ ...value, preset: event.target.value }))}><option value="diagnostic">Diagnostic 1024 — recommandé 6 Go VRAM</option><option value="production">Production 2048 — si mémoire suffisante</option></select></Field>
          <Field label="Politique de facturation"><select disabled={form.client_id.trim().toLowerCase() === 'olivier'} className={`${inputClass} disabled:opacity-60`} value={form.billing_policy} onChange={(event) => setForm((value) => ({ ...value, billing_policy: event.target.value }))}>{POLICIES.map((policy) => <option key={policy.value} value={policy.value}>{policy.label}</option>)}</select></Field>
          {form.client_id.trim().toLowerCase() === 'olivier' && <p className="text-[11px] text-muted-foreground">Olivier : coûts techniques uniquement, ventilés par entité.</p>}
          <button disabled={!online || !uploaderOnline || !viewModeValid || Boolean(busy)} className="w-full h-11 rounded-xl gradient-primary text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-50">{busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}Lancer la production 3D</button>
        </form>

        <section className="premium-panel p-5 min-w-0">
          <div className="flex items-center justify-between mb-4"><div><h2 className="font-semibold">Productions</h2><p className="text-xs text-muted-foreground">Actualisation automatique</p></div><button type="button" onClick={() => jobs.refetch()} className="p-2 rounded-lg hover:bg-muted"><RefreshCw className="w-4 h-4" /></button></div>
          <div className="space-y-2 max-h-[760px] overflow-y-auto">
            {(jobs.data?.jobs || []).map((job) => <button type="button" key={job.id} onClick={() => setSelectedId(job.id)} className={`w-full text-left rounded-2xl border p-3 transition ${selectedId === job.id ? 'border-primary/40 bg-primary/[0.08]' : 'border-border/70 hover:bg-muted/40'}`}><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold truncate">{job.character_id}</p><span className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${STATUS_CLASS[job.status] || 'bg-muted border-border'}`}>{STATUS_LABELS[job.status] || job.status}</span></div><p className="text-xs text-muted-foreground mt-1 truncate">{job.entity_id} · {job.project_id}</p><ProductionProgress job={job} compact /></button>)}
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
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground border-b"><th className="py-2">Client</th><th>Entité</th><th>Jobs</th><th>Coût réel</th><th>Estimation locale</th></tr></thead><tbody>{(costs.data?.by_entity || []).map((row) => <tr key={`${row.client_id}-${row.entity_id}`} className="border-b border-border/50"><td className="py-3">{row.client_id}</td><td className="font-medium">{row.entity_id}</td><td>{row.jobs}</td><td>{euro(row.cost_eur)}</td><td className="font-semibold">{euro(row.billable_eur)}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

function ReferenceUploader({ title, reference, busy, online, onBrowse, onDrop, onClear }) {
  return <div onDragOver={(event) => event.preventDefault()} onDrop={onDrop} className={`rounded-2xl border-2 border-dashed p-4 transition ${reference ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-primary/20 bg-primary/[0.025]'} ${!online ? 'opacity-60' : ''}`}><p className="text-xs font-semibold mb-2">{title}</p>{reference?.preview ? <div className="space-y-3"><div className="relative rounded-xl overflow-hidden bg-black/5 aspect-square max-h-64"><img src={reference.preview} alt={title} className="w-full h-full object-contain" /><button type="button" onClick={onClear} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 text-white flex items-center justify-center" aria-label="Retirer l’image"><XCircle className="w-4 h-4" /></button></div><button type="button" disabled={busy || !online} onClick={onBrowse} className="w-full h-10 rounded-xl border border-border text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}Remplacer</button></div> : <button type="button" disabled={busy || !online} onClick={onBrowse} className="w-full py-6 flex flex-col items-center justify-center text-center disabled:opacity-50"><div className="w-12 h-12 rounded-2xl gradient-primary text-white flex items-center justify-center mb-3">{busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <ImageIcon className="w-6 h-6" />}</div><p className="text-sm font-semibold">Déposer ou choisir une image</p><p className="text-xs text-muted-foreground mt-1">PNG, JPG/JPEG ou WEBP · max. 12 Mo</p></button>}</div>;
}

function StatusPill({ ok, label }) {
  return <div className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold border backdrop-blur ${ok ? 'bg-emerald-400/10 border-emerald-300/20 text-emerald-200' : 'bg-red-400/10 border-red-300/20 text-red-200'}`}><span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />{label}</div>;
}

function Kpi({ icon: Icon, label, value, tone = 'blue' }) {
  const tones = { blue: 'from-blue-500/15 to-cyan-400/5 text-blue-600', violet: 'from-violet-500/15 to-fuchsia-400/5 text-violet-600', cyan: 'from-cyan-500/15 to-sky-400/5 text-cyan-600', gold: 'from-amber-500/15 to-yellow-300/5 text-amber-600' };
  return <div className={`premium-panel p-4 bg-gradient-to-br ${tones[tone] || tones.blue}`}><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p><p className="text-xl font-bold mt-1">{value}</p></div><div className="w-9 h-9 rounded-xl bg-white/60 border border-white/70 flex items-center justify-center"><Icon className="w-4 h-4" /></div></div></div>;
}

function JobDetail({ job, previewOnline, onApprove, onReject, busy }) {
  const candidate = job.output?.candidate_glb;
  const reference = job.output?.reference_path || job.input?.reference_path;
  const multiview = Boolean(job.output?.multiview || (job.input?.left_reference_path && job.input?.back_reference_path && job.input?.right_reference_path));
  return <div className="mt-4 space-y-4">
    <div className="grid grid-cols-2 gap-2"><Mini label="Statut" value={STATUS_LABELS[job.status] || job.status} /><Mini label="Étape" value={formatAvatarStage(job.current_stage)} /><Mini label="Coût" value={euro(job.cost_total_eur)} /><Mini label="Génération" value={multiview ? `Multivue · seed ${job.output?.seed || job.input?.seed || 2182026}` : 'Monovue'} /></div>
    {candidate && previewOnline && <Avatar3DViewer src={avatarFactory.candidateUrl(job.id)} title={`${job.character_id} · candidat 3D`} />}
    {candidate && !previewOnline && <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 flex gap-2"><Rotate3D className="w-4 h-4 shrink-0" /><span>Le candidat existe, mais Preview 8793 n’est pas connecté.</span></div>}
    {reference && <div className="rounded-xl bg-muted/50 p-3 text-xs"><p className="font-semibold">Référence utilisée</p><p className="text-muted-foreground mt-1 break-all">{reference}</p></div>}
    {job.error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-700 whitespace-pre-wrap">{formatAvatarFactoryError(job.error)}</div>}
    <div className="max-h-52 overflow-y-auto space-y-2">{(job.events || []).map((event) => <div key={event.id} className="rounded-lg border border-border/60 px-3 py-2 text-xs"><span className="font-semibold">{formatAvatarStage(event.stage)}</span><span className="text-muted-foreground"> · {event.message}</span></div>)}</div>
    {job.status === 'awaiting_approval' && <div className="grid grid-cols-2 gap-2"><button type="button" disabled={Boolean(busy)} onClick={onReject} className="h-10 rounded-xl border border-red-500/30 text-red-700 font-semibold disabled:opacity-50">Refuser</button><button type="button" disabled={Boolean(busy)} onClick={onApprove} className="h-10 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-50">Valider et poursuivre</button></div>}
  </div>;
}

function Mini({ label, value }) {
  return <div className="rounded-xl bg-muted/50 p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="text-sm font-semibold mt-1 break-words">{value || '—'}</p></div>;
}

function ProductionProgress({ job, compact = false, prominent = false }) {
  const progress = getAvatarProductionProgress(job);
  return <div className={`${prominent ? 'premium-panel p-4' : compact ? 'mt-2' : ''}`}>{prominent && <p className="text-xs text-muted-foreground mb-2">Progression par étapes réelles, sans estimation du temps restant</p>}<div className="flex items-center justify-between gap-2 text-[11px]"><span className="font-medium">{progress.label}</span><span className="text-muted-foreground">{progress.percent}%</span></div><div className="h-1.5 mt-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-label={`Avancement de ${job.character_id || 'la production'}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress.percent}><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} /></div></div>;
}
