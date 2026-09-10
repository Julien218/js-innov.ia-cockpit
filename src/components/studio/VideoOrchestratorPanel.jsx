import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Cpu,
  FileJson,
  FolderOpen,
  ImagePlus,
  Loader2,
  Play,
  RefreshCw,
  Scissors,
  Square,
  Upload,
} from 'lucide-react';
import {
  VIDEO_MODES,
  extractComfyOutputs,
  getLocalVideoStatus,
  getVideoMode,
  interruptLocalGeneration,
  loadLocalWorkflow,
  openLocalOutputFolder,
  prepareH3Workflow,
  queueLocalWorkflow,
  saveLocalWorkflow,
  subscribeVideoMode,
  uploadLocalImage,
  waitForLocalGeneration,
} from '@/lib/videoOrchestrator';

const WORKFLOW_KIND = 'h3-i2v';

function formatElapsed(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(sec / 60);
  return `${min}:${String(sec % 60).padStart(2, '0')}`;
}

export default function VideoOrchestratorPanel({ vp, onOptimizeMontage }) {
  const [mode, setMode] = useState(getVideoMode);
  const [status, setStatus] = useState(null);
  const [workflow, setWorkflow] = useState(() => loadLocalWorkflow(WORKFLOW_KIND));
  const [prompt, setPrompt] = useState(vp?.ai_prompt || '');
  const [firstFrame, setFirstFrame] = useState(null);
  const [seconds, setSeconds] = useState(5);
  const [width, setWidth] = useState(608);
  const [height, setHeight] = useState(352);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [running, setRunning] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [promptId, setPromptId] = useState('');
  const [outputs, setOutputs] = useState([]);
  const [notice, setNotice] = useState(null);

  useEffect(() => subscribeVideoMode(setMode), []);

  useEffect(() => {
    if (vp?.ai_prompt && !prompt) setPrompt(vp.ai_prompt);
  }, [vp?.ai_prompt, prompt]);

  const refresh = async () => {
    if (mode !== VIDEO_MODES.LOCAL) return;
    try {
      setStatus(await getLocalVideoStatus());
    } catch (error) {
      setStatus({ available: false, comfyui: { online: false }, error: error.message });
    }
  };

  useEffect(() => {
    refresh();
  }, [mode]);

  const localReady = Boolean(status?.comfyui?.online && status?.h3?.available);
  const systemLabel = useMemo(() => {
    if (mode === VIDEO_MODES.API) return 'API externe autorisée';
    if (!status) return 'Vérification du moteur local…';
    if (!status.comfyui?.online) return 'ComfyUI local hors ligne';
    if (!status.h3?.available) return 'Nœud H3 non détecté';
    return 'ComfyUI local connecté';
  }, [mode, status, localReady]);

  const importWorkflow = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      prepareH3Workflow(parsed, { prompt: 'validation', width, height, seconds, seed });
      saveLocalWorkflow(WORKFLOW_KIND, parsed);
      setWorkflow(parsed);
      setNotice({ type: 'success', text: 'Workflow H3 LOCAL mémorisé sur ce PC.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    }
  };

  const generate = async () => {
    setNotice(null);
    setOutputs([]);
    if (mode !== VIDEO_MODES.LOCAL) {
      setNotice({
        type: 'info',
        text: 'Mode API actif : le Cockpit laisse les générateurs externes existants prendre la main. Bascule sur LOCAL pour utiliser H3/ComfyUI sur ce PC.',
      });
      return;
    }
    if (!status?.comfyui?.online) {
      setNotice({ type: 'error', text: 'ComfyUI local est hors ligne. Démarre ComfyUI puis actualise.' });
      return;
    }
    if (!status?.h3?.available) {
      setNotice({ type: 'error', text: 'Le nœud MiniMaxH3ImageToVideo n’est pas détecté dans ComfyUI.' });
      return;
    }
    if (!workflow) {
      setNotice({ type: 'error', text: 'Importe une fois le workflow H3 au format API depuis ComfyUI.' });
      return;
    }
    if (!prompt.trim()) {
      setNotice({ type: 'error', text: 'Ajoute un prompt vidéo.' });
      return;
    }

    setRunning(true);
    setElapsed(0);
    try {
      let firstFrameName = '';
      if (firstFrame) {
        const uploaded = await uploadLocalImage(firstFrame);
        firstFrameName = uploaded?.name || uploaded?.filename || firstFrame.name;
      }
      const prepared = prepareH3Workflow(workflow, {
        prompt: prompt.trim(),
        width,
        height,
        seconds,
        seed,
        firstFrameName,
      });
      const queued = await queueLocalWorkflow(prepared);
      const id = queued?.prompt_id || queued?.promptId;
      if (!id) throw new Error('ComfyUI n’a pas retourné de prompt_id.');
      setPromptId(id);
      const result = await waitForLocalGeneration(id, {
        onProgress: ({ elapsedMs }) => setElapsed(elapsedMs),
      });
      const found = result.outputs?.length ? result.outputs : extractComfyOutputs(result.history, id);
      setOutputs(found);
      setNotice({
        type: 'success',
        text: `Génération locale terminée${found.length ? ` — ${found.length} fichier(s) produit(s)` : ''}.`,
      });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setRunning(false);
    }
  };

  const stop = async () => {
    try {
      await interruptLocalGeneration();
      setNotice({ type: 'info', text: 'Interruption envoyée à ComfyUI.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    }
  };

  const openOutputFolder = async () => {
    try {
      await openLocalOutputFolder();
      setNotice({ type: 'success', text: 'Le dossier output local est ouvert.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    }
  };

  const optimizeMontage = async () => {
    if (!onOptimizeMontage) return;
    setOptimizing(true);
    setNotice(null);
    try {
      const result = await onOptimizeMontage();
      setNotice({ type: 'success', text: result?.summary || 'Montage optimisé localement.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <div className="p-5 space-y-4 max-w-5xl">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-foreground">Agent Vidéo Orchestrator</h3>
            <p className="text-xs text-muted-foreground">Génération H3 · montage local · routage LOCAL/API</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-3 py-1.5 rounded-full border ${
            mode === VIDEO_MODES.LOCAL && localReady
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
              : 'border-border text-muted-foreground'
          }`}>
            {systemLabel}
          </span>
          {mode === VIDEO_MODES.LOCAL && (
            <button onClick={refresh} className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground" title="Actualiser">
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      </div>

      {mode === VIDEO_MODES.LOCAL && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">ComfyUI</p>
            <p className={`mt-1 text-sm font-semibold ${localReady ? 'text-emerald-600' : 'text-red-500'}`}>
              {localReady ? 'Connecté · 127.0.0.1:8188' : 'Hors ligne'}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">FFmpeg</p>
            <p className={`mt-1 text-sm font-semibold ${status?.ffmpeg?.online ? 'text-emerald-600' : 'text-muted-foreground'}`}>
              {status?.ffmpeg?.online ? 'Disponible' : 'Optionnel / non détecté'}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Workflow H3</p>
            <p className={`mt-1 text-sm font-semibold ${workflow && status?.h3?.available ? 'text-emerald-600' : 'text-amber-600'}`}>
              {workflow && status?.h3?.available ? 'Prêt' : workflow ? 'Nœud H3 non détecté' : 'À importer une fois'}
            </p>
          </div>
        </div>
      )}

      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          notice.type === 'error'
            ? 'border-red-500/30 bg-red-500/10 text-red-600'
            : notice.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
              : 'border-blue-500/30 bg-blue-500/10 text-blue-600'
        }`}>
          {notice.text}
        </div>
      )}

      {mode === VIDEO_MODES.LOCAL ? (
        <>
          <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2"><Cpu size={15} /> MiniMax H3 local</h4>
                <p className="text-xs text-muted-foreground mt-1">T2V si aucune image n’est choisie · I2V si une première image est fournie.</p>
              </div>
              <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-xs hover:border-primary/50">
                <FileJson size={14} />
                {workflow ? 'Remplacer workflow API' : 'Importer workflow API H3'}
                <input type="file" accept="application/json,.json" onChange={importWorkflow} className="hidden" />
              </label>
            </div>

            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              placeholder="Décris la scène, les mouvements caméra et l’audio…"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            />

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <label className="text-xs text-muted-foreground">
                Largeur
                <input type="number" step="32" value={width} onChange={(e) => setWidth(Number(e.target.value))} className="mt-1 w-full h-9 rounded-lg border border-border bg-background px-2 text-foreground" />
              </label>
              <label className="text-xs text-muted-foreground">
                Hauteur
                <input type="number" step="32" value={height} onChange={(e) => setHeight(Number(e.target.value))} className="mt-1 w-full h-9 rounded-lg border border-border bg-background px-2 text-foreground" />
              </label>
              <label className="text-xs text-muted-foreground">
                Durée
                <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="mt-1 w-full h-9 rounded-lg border border-border bg-background px-2 text-foreground">
                  <option value={5}>5 s</option>
                  <option value={10}>10 s</option>
                  <option value={15}>15 s</option>
                </select>
              </label>
              <label className="text-xs text-muted-foreground lg:col-span-2">
                Seed
                <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} className="mt-1 w-full h-9 rounded-lg border border-border bg-background px-2 text-foreground" />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-xs hover:border-primary/50">
                <ImagePlus size={14} />
                {firstFrame ? firstFrame.name : 'Ajouter première image (I2V)'}
                <input type="file" accept="image/*" onChange={(e) => setFirstFrame(e.target.files?.[0] || null)} className="hidden" />
              </label>
              {firstFrame && (
                <button onClick={() => setFirstFrame(null)} className="text-xs text-muted-foreground hover:text-foreground">Retirer l’image</button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={generate}
                disabled={running || !localReady}
                className="btn-gold px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                {running ? `Génération locale · ${formatElapsed(elapsed)}` : 'Générer en LOCAL'}
              </button>
              {running && (
                <button onClick={stop} className="px-3 py-2 rounded-xl border border-red-500/30 text-red-600 text-sm flex items-center gap-2">
                  <Square size={13} /> Stop
                </button>
              )}
              <button onClick={openOutputFolder} className="px-3 py-2 rounded-xl border border-border text-sm flex items-center gap-2 text-muted-foreground hover:text-foreground">
                <FolderOpen size={14} /> Dossier output
              </button>
              {onOptimizeMontage && (
                <button
                  onClick={optimizeMontage}
                  disabled={optimizing}
                  className="px-3 py-2 rounded-xl border border-border text-sm flex items-center gap-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {optimizing ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
                  Optimiser montage LOCAL
                </button>
              )}
            </div>

            {promptId && <p className="text-[11px] text-muted-foreground break-all">Job ComfyUI : {promptId}</p>}
          </div>

          {outputs.length > 0 && (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-2 text-emerald-600 text-sm font-semibold mb-2">
                <CheckCircle2 size={16} /> Fichiers générés localement
              </div>
              <div className="space-y-1">
                {outputs.map((output, index) => (
                  <p key={`${output.filename}-${index}`} className="text-xs text-muted-foreground break-all">
                    {output.filename}{output.subfolder ? ` · ${output.subfolder}` : ''}
                  </p>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-5">
          <div className="flex items-center gap-2 text-sky-600 font-semibold text-sm"><Upload size={15} /> Routage API</div>
          <p className="text-sm text-muted-foreground mt-2">
            Le mode LOCAL est désactivé. Les fonctions vidéo existantes peuvent utiliser leurs fournisseurs API habituels. Aucune requête n’est envoyée à ComfyUI tant que ce mode reste actif.
          </p>
        </div>
      )}
    </div>
  );
}
