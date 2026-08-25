import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Cpu,
  FileJson,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import {
  cancelLocalVideoBatch,
  createLocalReviewVideo,
  getLocalVideoBatchStatus,
  getLocalVideoStatus,
  listLocalVideoBatches,
  loadLocalWorkflow,
  openLocalGeneratedFolder,
  openLocalOutputFolder,
  openLocalReviewFolder,
  prepareH3Workflow,
  publishLocalVideoChoice,
  queueLocalVideoBatch,
  saveLocalWorkflow,
  uploadLocalImage,
} from '@/lib/videoOrchestrator';
import { getLocalTelemetrySummary } from '../lib/localTelemetry';
import {
  MAX_LOCAL_VIDEO_BATCH,
  SIGNAGE_GENERATION_SIZE,
  SIGNAGE_VIDEO_SECONDS,
  buildReviewTimeline,
  createFactoryJobId,
  createThreeSignageConcepts,
  normalizeLocalBatchJobs,
  summarizeLocalBatch,
} from '@/lib/signageVideoFactory';

const WORKFLOW_KIND = 'h3-i2v';

async function fetchJson(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}

function emptyJob(index) {
  return {
    id: createFactoryJobId('video', index),
    position: index + 1,
    title: `Vidéo ${index + 1}`,
    directionLabel: 'Personnalisée',
    prompt: '',
    seconds: SIGNAGE_VIDEO_SECONDS,
    width: SIGNAGE_GENERATION_SIZE.width,
    height: SIGNAGE_GENERATION_SIZE.height,
    seed: Math.floor(Math.random() * 0xffffffff),
    status: 'draft',
  };
}

function statusTone(status) {
  if (status === 'completed') return 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20';
  if (status === 'failed') return 'text-red-600 bg-red-500/10 border-red-500/20';
  if (status === 'running') return 'text-blue-600 bg-blue-500/10 border-blue-500/20';
  if (status === 'cancelled') return 'text-muted-foreground bg-muted border-border';
  return 'text-amber-600 bg-amber-500/10 border-amber-500/20';
}

export default function LocalVideoFactory() {
  const navigate = useNavigate();
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [clients, setClients] = useState([]);
  const [phone, setPhone] = useState('');
  const [services, setServices] = useState('');
  const [sector, setSector] = useState('');
  const [locality, setLocality] = useState('Dour');
  const [brief, setBrief] = useState('');
  const [usageRights, setUsageRights] = useState('Utilisation limitée à la campagne et aux supports validés par le client.');
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [jobs, setJobs] = useState(() => createThreeSignageConcepts({}));
  const [files, setFiles] = useState({});
  const [workflow, setWorkflow] = useState(() => loadLocalWorkflow(WORKFLOW_KIND));
  const [localStatus, setLocalStatus] = useState(null);
  const [batch, setBatch] = useState(null);
  const [starting, setStarting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [publishingPosition, setPublishingPosition] = useState(0);
  const [notice, setNotice] = useState(null);
  const [accountingNotice, setAccountingNotice] = useState(null);
  const costSyncedIds = useRef(new Set());

  const summary = useMemo(() => summarizeLocalBatch(batch || { jobs }), [batch, jobs]);
  const review = useMemo(() => buildReviewTimeline(batch?.jobs || jobs), [batch, jobs]);
  const selectedClient = useMemo(() => clients.find((client) => String(client.id) === String(clientId)), [clients, clientId]);
  const availableCostCenters = selectedClient?.cost_centers || [];
  const effectiveMaxJobs = localStatus?.qualification?.qualified ? MAX_LOCAL_VIDEO_BATCH : 3;

  const syncCompletedCosts = async (currentBatch) => {
    const canonicalClientId = currentBatch?.clientId || clientId;
    if (!canonicalClientId) return;
    const completed = (currentBatch?.jobs || []).filter((job) => job.status === 'completed' && Number(job.runtimeSeconds || 0) > 0);
    for (const job of completed) {
      const externalRef = `local-video:${currentBatch.id}:${job.id}`;
      if (costSyncedIds.current.has(externalRef)) continue;
      try {
        const telemetryResult = await getLocalTelemetrySummary({
          startedAt: job.executionStartedAt || job.startedAt,
          completedAt: job.completedAt,
          runtimeSeconds: Number(job.runtimeSeconds),
        }).catch(() => null);
        const accounting = await fetchJson(`/api/client-costs/clients/${encodeURIComponent(canonicalClientId)}/local-ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runtime_seconds: Number(job.runtimeSeconds),
            model: 'MiniMax H3 local',
            external_ref: externalRef,
            project_id: currentBatch.projectId || null,
            cost_center_id: currentBatch.costCenterId || null,
            description: `${currentBatch.clientName || 'Client'} — ${job.title || 'vidéo écran géant'}`,
            telemetry: telemetryResult?.telemetry || null,
          }),
        });
        costSyncedIds.current.add(externalRef);
        setAccountingNotice({
          type: 'success',
          text: accounting?.calculation?.telemetry_used
            ? 'Durée, CPU, GPU et consommation estimée transmis à AI Cost Control avec la preuve ComfyUI.'
            : 'Durée ComfyUI comptabilisée avec la puissance nominale; la télémétrie Windows était indisponible.',
        });
      } catch (error) {
        setAccountingNotice({ type: 'error', text: `Coût local non comptabilisé : ${error.message}. La vidéo reste exclue de la facturation automatique tant que ce point n’est pas corrigé.` });
      }
    }
  };

  const refreshLocal = async () => {
    try {
      setLocalStatus(await getLocalVideoStatus());
    } catch (error) {
      setLocalStatus({ available: false, comfyui: { online: false }, error: error.message });
    }
  };

  useEffect(() => {
    refreshLocal();
    fetchJson('/api/client-costs/accounting/clients')
      .then((data) => setClients(data.clients || []))
      .catch((error) => setAccountingNotice({ type: 'error', text: `Clients comptables indisponibles : ${error.message}` }));
    listLocalVideoBatches().then(({ batches }) => {
      const active = batches?.find((item) => ['queueing', 'running'].includes(item.status));
      if (active) {
        setBatch(active);
        setClientId(active.clientId || '');
        setClientName(active.clientName || '');
        setCostCenterId(active.costCenterId || '');
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!batch?.id || !['queueing', 'running'].includes(batch.status)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const current = await getLocalVideoBatchStatus(batch.id);
        await syncCompletedCosts(current);
        setBatch(current);
      } catch (error) {
        setNotice({ type: 'error', text: error.message });
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [batch?.id, batch?.status, clientId]);

  const generateConcepts = () => {
    if (!clientId || !clientName.trim() || !phone.trim() || !brief.trim()) {
      setNotice({ type: 'error', text: 'Sélectionne le client Cockpit, puis renseigne le téléphone et la demande.' });
      return;
    }
    setJobs(createThreeSignageConcepts({ clientName, phone, services, locality, brief }));
    setFiles({});
    setBatch(null);
    setNotice({ type: 'success', text: 'Trois directions créatives ont été préparées. Tu peux modifier chaque prompt avant lancement.' });
  };

  const importWorkflow = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      prepareH3Workflow(parsed, { prompt: 'validation', seconds: SIGNAGE_VIDEO_SECONDS, ...SIGNAGE_GENERATION_SIZE });
      saveLocalWorkflow(WORKFLOW_KIND, parsed);
      setWorkflow(parsed);
      setNotice({ type: 'success', text: 'Workflow MiniMax H3 local mémorisé sur ce PC.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    }
  };

  const updateJob = (id, patch) => setJobs((current) => current.map((job) => job.id === id ? { ...job, ...patch } : job));

  const addJob = () => {
    if (jobs.length >= effectiveMaxJobs) {
      setNotice({ type: 'error', text: effectiveMaxJobs === 3 ? 'Le premier lot réel de trois vidéos doit réussir avant de débloquer la capacité de 32.' : `La capacité maximale est de ${MAX_LOCAL_VIDEO_BATCH} vidéos.` });
      return;
    }
    setJobs((current) => [...current, emptyJob(current.length)]);
  };

  const removeJob = (id) => {
    setJobs((current) => current.filter((job) => job.id !== id).map((job, index) => ({ ...job, position: index + 1 })));
    setFiles((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const startBatch = async () => {
    setNotice(null);
    setStarting(true);
    try {
      if (!localStatus?.comfyui?.online) throw new Error('ComfyUI local est hors ligne.');
      if (!localStatus?.ffmpeg?.online) throw new Error('FFmpeg local est indisponible.');
      if (!localStatus?.h3?.available) throw new Error('MiniMax H3 local n’est pas installé dans ComfyUI. Les nœuds MiniMax partenaires/API ne remplacent pas le moteur local requis.');
      if (!clientId) throw new Error('Sélectionne un client Cockpit pour rattacher les coûts de production.');
      if (!workflow) throw new Error('Importe d’abord le workflow MiniMax H3 au format API.');
      if (jobs.some((job) => !job.prompt.trim())) throw new Error('Chaque vidéo doit posséder un prompt.');

      const prepared = [];
      for (const job of jobs) {
        let firstFrameName = '';
        const firstFrame = files[job.id];
        if (firstFrame) {
          const uploaded = await uploadLocalImage(firstFrame);
          firstFrameName = uploaded?.name || uploaded?.filename || firstFrame.name;
        }
        prepared.push({
          id: job.id,
          title: job.title,
          prompt: job.prompt,
          clientId: `signage-${clientName || 'client'}`,
          workflow: prepareH3Workflow(workflow, {
            prompt: job.prompt,
            width: SIGNAGE_GENERATION_SIZE.width,
            height: SIGNAGE_GENERATION_SIZE.height,
            seconds: SIGNAGE_VIDEO_SECONDS,
            seed: job.seed,
            firstFrameName,
          }),
          metadata: {
            firstFrameName,
            position: job.position,
            direction: job.directionLabel,
            clientName,
            phone,
            services,
            locality,
            duration: SIGNAGE_VIDEO_SECONDS,
          },
        });
      }

      const normalized = normalizeLocalBatchJobs(prepared);
      const created = await queueLocalVideoBatch({
        title: `${clientName || 'Client'} — écran géant`,
        clientId,
        clientName,
        costCenterId,
        projectId: availableCostCenters.find((center) => String(center.id) === String(costCenterId))?.product_code || '',
        campaignName: brief.slice(0, 120),
        sector,
        usageRights,
        rightsConfirmed,
        jobs: normalized,
      });
      setBatch(created);
      setNotice({ type: 'success', text: `${normalized.length} vidéo(s) placée(s) dans la file locale. Le GPU les traite une par une.` });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setStarting(false);
    }
  };

  const prepareReview = async () => {
    if (!batch?.id) return;
    setReviewing(true);
    setNotice(null);
    try {
      const result = await createLocalReviewVideo(batch.id);
      setBatch((current) => ({ ...current, review: result }));
      setNotice({ type: 'success', text: 'Le montage comparatif 1 · 2 · 3 est prêt pour la validation client.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setReviewing(false);
    }
  };

  const exportChoice = async (position) => {
    if (!batch?.id) return;
    setPublishingPosition(position);
    setNotice(null);
    try {
      const result = await publishLocalVideoChoice(batch.id, position);
      setBatch((current) => ({ ...current, publication: result }));
      setNotice({ type: 'success', text: `La proposition ${position} est exportée et vérifiée : MP4 8 secondes, métadonnées invisibles et fiche JSON SHA-256 créées.` });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setPublishingPosition(0);
    }
  };

  const cancelBatch = async () => {
    if (!batch?.id) return;
    try {
      setBatch(await cancelLocalVideoBatch(batch.id));
      setNotice({ type: 'info', text: 'Le lot local a été interrompu.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Fabrique vidéo écran géant"
        subtitle="Trois propositions par client · production locale · jusqu’à 32 vidéos"
      />

      <section className="workspace-hero">
        <div className="relative z-10 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="workspace-eyebrow">Production locale JS-Innov.IA®</p>
            <h2 className="text-2xl font-semibold">De la demande au lot ComfyUI en un seul lancement</h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
              Le Cockpit prépare les trois concepts, charge leurs images de départ et alimente une file persistante. ComfyUI exécute un seul rendu à la fois pour protéger la mémoire GPU.
            </p>
          </div>
          <div className={`rounded-xl border px-4 py-3 text-sm ${localStatus?.available ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600' : 'border-amber-500/20 bg-amber-500/10 text-amber-700'}`}>
            <div className="flex items-center gap-2 font-semibold"><Cpu size={16} /> {localStatus?.available ? 'Atelier local prêt' : 'Atelier local incomplet'}</div>
            <p className="mt-1 text-xs">ComfyUI : {localStatus?.comfyui?.online ? 'OK' : 'hors ligne'} · FFmpeg : {localStatus?.ffmpeg?.online ? 'OK' : 'absent'} · MiniMax H3 local : {localStatus?.h3?.available ? 'OK' : 'absent'}</p>
            <p className="mt-1 text-xs">Capacité 32 vidéos : {localStatus?.qualification?.qualified ? 'qualifiée sur ce Dell' : 'verrouillée jusqu’au premier test réel de 3 vidéos'}</p>
            {!localStatus?.h3?.available && localStatus?.comfyui?.online && <p className="mt-1 text-xs">Les nœuds MiniMax en ligne/API détectés ne sont pas utilisés comme moteur local.</p>}
            <button type="button" onClick={refreshLocal} className="mt-1 text-xs underline">Actualiser</button>
          </div>
        </div>
      </section>

      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${notice.type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-600' : notice.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-blue-500/30 bg-blue-500/10 text-blue-600'}`}>
          {notice.text}
        </div>
      )}
      {accountingNotice && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${accountingNotice.type === 'error' ? 'border-amber-500/30 bg-amber-500/10 text-amber-700' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'}`}>
          {accountingNotice.text}
        </div>
      )}

      <section className="workspace-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Demande client</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <select value={clientId} onChange={(e) => {
            const nextId = e.target.value;
            const nextClient = clients.find((client) => String(client.id) === String(nextId));
            setClientId(nextId);
            setClientName(nextClient?.name || '');
            setCostCenterId(nextClient?.cost_centers?.[0]?.id || '');
          }} className="h-10 rounded-lg border border-border bg-background px-3 text-sm">
            <option value="">Client Cockpit obligatoire</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <select value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)} disabled={!clientId} className="h-10 rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-50">
            <option value="">Client uniquement — aucun projet</option>
            {availableCostCenters.map((center) => <option key={center.id} value={center.id}>{center.product_code}</option>)}
          </select>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Téléphone exact" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" />
          <input value={services} onChange={(e) => setServices(e.target.value)} placeholder="Services ou offre" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" />
          <input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Secteur du client" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" />
          <input value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="Localité" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" />
        </div>
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} placeholder="Exemple : Olivier demande une vidéo mettant le logo et le téléphone en évidence…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <textarea value={usageRights} onChange={(e) => setUsageRights(e.target.value)} rows={2} placeholder="Conditions d’utilisation accordées au client" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={rightsConfirmed} onChange={(e) => setRightsConfirmed(e.target.checked)} className="mt-1" />
          <span>Les droits contractuels autorisent l’attribution du copyright JS‑Innov.IA®. Sans cette case, le fichier indiquera automatiquement que les droits restent à vérifier.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={generateConcepts} className="btn-gold rounded-lg px-4 py-2 text-sm flex items-center gap-2"><Sparkles size={15} /> Générer les 3 concepts</button>
          <label className="rounded-lg border border-border px-4 py-2 text-sm flex items-center gap-2 cursor-pointer hover:border-primary/50">
            <FileJson size={15} /> {workflow ? 'Remplacer le workflow H3' : 'Importer le workflow H3'}
            <input type="file" accept=".json,application/json" onChange={importWorkflow} className="hidden" />
          </label>
          <button type="button" onClick={addJob} disabled={jobs.length >= effectiveMaxJobs} className="rounded-lg border border-border px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"><Plus size={15} /> Ajouter une vidéo</button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="workspace-eyebrow">File locale</p>
            <h3 className="font-semibold">{jobs.length} / {effectiveMaxJobs} vidéos</h3>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={openLocalOutputFolder} className="rounded-lg border border-border px-3 py-2 text-sm flex items-center gap-2"><FolderOpen size={14} /> Outputs</button>
            {batch && ['queueing', 'running'].includes(batch.status) && (
              <button type="button" onClick={cancelBatch} className="rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-600 flex items-center gap-2"><Square size={13} /> Arrêter</button>
            )}
            <button type="button" onClick={startBatch} disabled={starting || !jobs.length || Boolean(batch && ['queueing', 'running'].includes(batch.status))} className="btn-gold rounded-lg px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50">
              {starting ? <Loader2 size={15} className="animate-spin" /> : <Clapperboard size={15} />}
              {starting ? 'Préparation…' : 'Lancer la production locale'}
            </button>
          </div>
        </div>

        {batch && (
          <div className="workspace-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Lot {batch.id}</p>
                <p className="text-xs text-muted-foreground">GPU : 1 rendu simultané · progression {summary.progress}%</p>
              </div>
              <button type="button" onClick={async () => {
                const current = await getLocalVideoBatchStatus(batch.id);
                await syncCompletedCosts(current);
                setBatch(current);
              }} className="p-2 rounded-lg border border-border"><RefreshCw size={14} /></button>
            </div>
            <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${summary.progress}%` }} /></div>
          </div>
        )}

        <div className="space-y-3">
          {jobs.map((job, index) => {
            const live = batch?.jobs?.find((item) => item.id === job.id);
            const currentStatus = live?.status || job.status;
            return (
              <article key={job.id} className="workspace-card p-4">
                <div className="flex flex-col gap-3 lg:flex-row">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-semibold text-primary">{index + 1}</div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <input value={job.title} onChange={(e) => updateJob(job.id, { title: e.target.value })} className="min-w-[240px] flex-1 bg-transparent font-semibold outline-none" />
                      <span className={`rounded-full border px-2.5 py-1 text-xs ${statusTone(currentStatus)}`}>{currentStatus}</span>
                      {!batch && jobs.length > 1 && <button type="button" onClick={() => removeJob(job.id)} className="p-1.5 text-muted-foreground hover:text-red-600"><Trash2 size={14} /></button>}
                    </div>
                    <textarea value={job.prompt} onChange={(e) => updateJob(job.id, { prompt: e.target.value })} rows={4} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs leading-relaxed" />
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <label className="cursor-pointer rounded-lg border border-border px-3 py-2 hover:border-primary/50">
                        {files[job.id] ? files[job.id].name : 'Ajouter le visuel de départ'}
                        <input type="file" accept="image/*" onChange={(e) => setFiles((current) => ({ ...current, [job.id]: e.target.files?.[0] || null }))} className="hidden" />
                      </label>
                      <span>{SIGNAGE_VIDEO_SECONDS}s · {SIGNAGE_GENERATION_SIZE.width}×{SIGNAGE_GENERATION_SIZE.height} local → 1920×1080 final</span>
                      {live?.outputs?.length > 0 && <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={13} /> {live.outputs[0].filename}</span>}
                      {live?.error && <span className="text-red-600 flex items-center gap-1"><AlertTriangle size={13} /> {live.error}</span>}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="workspace-card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Validation client</p>
          <p className="text-xs text-muted-foreground">
            {review.ready ? `Les trois premières propositions sont terminées. Montage prévu : ${review.duration}s.` : 'Disponible lorsque les trois premières propositions sont terminées.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!review.ready || reviewing} onClick={prepareReview} className="btn-gold rounded-lg px-4 py-2 text-sm disabled:opacity-50 flex items-center gap-2">
            {reviewing ? <Loader2 size={15} className="animate-spin" /> : <Clapperboard size={15} />}
            {batch?.review?.outputPath ? 'Regénérer le comparatif' : 'Générer le choix 1 · 2 · 3'}
          </button>
          {batch?.review?.outputPath && (
            <>
              <button type="button" onClick={() => openLocalReviewFolder(batch.review.outputPath)} className="rounded-lg border border-border px-4 py-2 text-sm flex items-center gap-2">
                <FolderOpen size={15} /> Ouvrir le montage
              </button>
              <button type="button" onClick={() => navigate('/validations')} className="rounded-lg border border-border px-4 py-2 text-sm">
                Ouvrir les validations
              </button>
              {[1, 2, 3].map((position) => (
                <button key={position} type="button" disabled={publishingPosition > 0} onClick={() => exportChoice(position)} className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm disabled:opacity-50 flex items-center gap-2">
                  {publishingPosition === position && <Loader2 size={14} className="animate-spin" />}
                  Exporter le choix {position}
                </button>
              ))}
            </>
          )}
        </div>
        {batch?.publication?.outputPath && (
          <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-700">
            <p className="font-semibold">Master écran géant prêt : choix {batch.publication.selectedPosition}</p>
            <p className="mt-1 break-all text-xs">{batch.publication.outputPath}</p>
            <p className="mt-1 break-all text-xs">Fiche de preuve : {batch.publication.jsonPath}</p>
            <p className="mt-1 text-xs">SHA-256 : {batch.publication.sha256}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => openLocalGeneratedFolder(batch.publication.outputPath)} className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs flex items-center gap-1">
                <FolderOpen size={13} /> Ouvrir le dossier
              </button>
              <button type="button" onClick={() => navigate('/ecran-geant')} className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs">
                Passer à la diffusion
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
