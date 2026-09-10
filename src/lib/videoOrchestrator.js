const MODE_KEY = 'jsinnovia.video.mode';
const WORKFLOW_PREFIX = 'jsinnovia.video.workflow.';
const MODE_EVENT = 'jsinnovia:video-mode';

export const VIDEO_MODES = Object.freeze({ LOCAL: 'local', API: 'api' });

function hasWindow() {
  return typeof window !== 'undefined';
}

export function getVideoMode() {
  if (!hasWindow()) return VIDEO_MODES.LOCAL;
  const saved = window.localStorage.getItem(MODE_KEY);
  return saved === VIDEO_MODES.API ? VIDEO_MODES.API : VIDEO_MODES.LOCAL;
}

export function setVideoMode(mode) {
  const normalized = mode === VIDEO_MODES.API ? VIDEO_MODES.API : VIDEO_MODES.LOCAL;
  if (!hasWindow()) return normalized;
  window.localStorage.setItem(MODE_KEY, normalized);
  window.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: { mode: normalized } }));
  return normalized;
}

export function subscribeVideoMode(callback) {
  if (!hasWindow()) return () => {};
  const handler = (event) => callback(event?.detail?.mode || getVideoMode());
  const storageHandler = (event) => {
    if (event.key === MODE_KEY) callback(getVideoMode());
  };
  window.addEventListener(MODE_EVENT, handler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(MODE_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function saveLocalWorkflow(kind, workflow) {
  if (!hasWindow()) return;
  if (!workflow || typeof workflow !== 'object') throw new Error('Workflow ComfyUI invalide.');
  window.localStorage.setItem(`${WORKFLOW_PREFIX}${kind}`, JSON.stringify(workflow));
}

export function loadLocalWorkflow(kind) {
  if (!hasWindow()) return null;
  const raw = window.localStorage.getItem(`${WORKFLOW_PREFIX}${kind}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function removeLocalWorkflow(kind) {
  if (!hasWindow()) return;
  window.localStorage.removeItem(`${WORKFLOW_PREFIX}${kind}`);
}

export function hasDesktopVideoBridge() {
  return Boolean(hasWindow() && window.electronAPI?.videoLocal);
}

function bridge() {
  if (!hasDesktopVideoBridge()) {
    throw new Error('Le mode LOCAL nécessite l’application desktop JS-Innov.IA pour joindre ComfyUI en toute sécurité.');
  }
  return window.electronAPI.videoLocal;
}

export async function getLocalVideoStatus() {
  if (!hasDesktopVideoBridge()) {
    return {
      available: false,
      comfyui: { online: false },
      ffmpeg: { online: false },
      reason: 'desktop_bridge_unavailable',
    };
  }
  return bridge().status();
}

export async function uploadLocalImage(file) {
  if (!(file instanceof File)) throw new Error('Image locale invalide.');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  });
  return bridge().uploadImage({ name: file.name, dataUrl });
}

export async function queueLocalWorkflow(workflow, clientId = undefined) {
  if (!workflow || typeof workflow !== 'object') throw new Error('Workflow ComfyUI API manquant.');
  return bridge().queue({ workflow, clientId });
}

export async function queueLocalVideoBatch(payload = {}) {
  if (!Array.isArray(payload.jobs) || payload.jobs.length === 0) throw new Error('Lot vidéo local vide.');
  if (payload.jobs.length > 32) throw new Error('Un lot local est limité à 32 vidéos.');
  if (typeof bridge().batchQueue !== 'function') {
    throw new Error('Mets à jour l’application desktop JS-Innov.IA pour activer la production locale par lots.');
  }
  return bridge().batchQueue(payload);
}

export async function getLocalVideoBatchStatus(batchId) {
  if (!batchId) throw new Error('Identifiant de lot vidéo manquant.');
  if (typeof bridge().batchStatus !== 'function') {
    throw new Error('Le suivi des lots nécessite la dernière application desktop JS-Innov.IA.');
  }
  return bridge().batchStatus(batchId);
}

export async function listLocalVideoBatches() {
  if (typeof bridge().batchList !== 'function') return { batches: [], maxJobs: 32 };
  return bridge().batchList();
}

export async function cancelLocalVideoBatch(batchId) {
  if (!batchId) throw new Error('Identifiant de lot vidéo manquant.');
  if (typeof bridge().batchCancel !== 'function') {
    throw new Error('L’annulation des lots nécessite la dernière application desktop JS-Innov.IA.');
  }
  return bridge().batchCancel(batchId);
}

export async function createLocalReviewVideo(batchId) {
  if (!batchId) throw new Error('Identifiant de lot vidéo manquant.');
  if (typeof bridge().createReview !== 'function') {
    throw new Error('Le montage comparatif nécessite la dernière application desktop JS-Innov.IA.');
  }
  return bridge().createReview(batchId);
}

export async function publishLocalVideoChoice(batchId, position) {
  if (!batchId) throw new Error('Identifiant de lot vidéo manquant.');
  if (![1, 2, 3].includes(Number(position))) throw new Error('Choisis la proposition 1, 2 ou 3.');
  if (typeof bridge().publishChoice !== 'function') {
    throw new Error('L’export écran géant nécessite la dernière application desktop JS-Innov.IA.');
  }
  return bridge().publishChoice({ batchId, position: Number(position) });
}

export async function openLocalGeneratedFolder(generatedPath) {
  if (!generatedPath) throw new Error('Chemin de production manquant.');
  if (typeof bridge().openGeneratedFolder !== 'function') {
    throw new Error('La dernière application desktop JS-Innov.IA est nécessaire.');
  }
  return bridge().openGeneratedFolder(generatedPath);
}

export async function openLocalReviewFolder(reviewPath) {
  if (!reviewPath) throw new Error('Chemin du montage de validation manquant.');
  if (typeof bridge().openReviewFolder !== 'function') {
    throw new Error('La dernière application desktop JS-Innov.IA est nécessaire.');
  }
  return bridge().openReviewFolder(reviewPath);
}

export async function getLocalHistory(promptId) {
  if (!promptId) throw new Error('promptId manquant.');
  return bridge().history(promptId);
}

export async function interruptLocalGeneration() {
  return bridge().interrupt();
}

export async function openLocalOutputFolder() {
  return bridge().openOutputFolder();
}

export function h3FramesFromSeconds(seconds = 5) {
  const target = Math.max(1, Number(seconds) || 5) * 24;
  const k = Math.max(0, Math.ceil((target - 5) / 17));
  return 17 * k + 5;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function eachApiNode(workflow, callback) {
  if (!workflow || typeof workflow !== 'object') return;
  if (Array.isArray(workflow.nodes)) {
    throw new Error('Ce fichier est un workflow UI. Dans ComfyUI, utilise “Save (API Format)” / “Exporter API” puis réimporte-le ici.');
  }
  Object.entries(workflow).forEach(([id, node]) => {
    if (node && typeof node === 'object' && node.class_type && node.inputs) callback(node, id);
  });
}

export function prepareH3Workflow(baseWorkflow, options = {}) {
  const {
    prompt = '',
    width = 608,
    height = 352,
    seconds = 5,
    seed = Math.floor(Math.random() * 0xffffffff),
    firstFrameName = '',
  } = options;
  const workflow = clone(baseWorkflow);
  const length = h3FramesFromSeconds(seconds);
  let h3NodeSeen = false;
  let imageNodeSeen = false;

  eachApiNode(workflow, (node) => {
    const type = String(node.class_type || '');
    const inputs = node.inputs || {};

    if (type === 'MiniMaxH3ImageToVideo' || type.includes('MiniMaxH3ImageToVideo')) {
      h3NodeSeen = true;
      if ('prompt' in inputs) inputs.prompt = prompt;
      if ('width' in inputs) inputs.width = Number(width);
      if ('height' in inputs) inputs.height = Number(height);
      if ('length' in inputs) inputs.length = length;
    }

    if (type === 'LoadImage' && firstFrameName && !imageNodeSeen) {
      inputs.image = firstFrameName;
      imageNodeSeen = true;
    }

    if (type === 'RandomNoise' && 'noise_seed' in inputs) inputs.noise_seed = Number(seed);
    if (type === 'KSampler' && 'seed' in inputs) inputs.seed = Number(seed);

    if (type === 'UNETLoader' && 'unet_name' in inputs && !String(inputs.unet_name || '').trim()) {
      inputs.unet_name = 'minimax_h3_fl2va_pruned_int8_convrot.safetensors';
    }
    if (type === 'CLIPLoader' && 'clip_name' in inputs) {
      if (!String(inputs.clip_name || '').trim()) inputs.clip_name = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors';
      if ('type' in inputs) inputs.type = 'minimax';
    }
    if (type === 'VAELoader' && 'vae_name' in inputs && !String(inputs.vae_name || '').trim()) {
      inputs.vae_name = 'minimax_h3_video_vae_fp16.safetensors';
    }
    if ((type.includes('LoraLoader') || type.includes('LoRA')) && 'lora_name' in inputs && !String(inputs.lora_name || '').trim()) {
      inputs.lora_name = 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors';
    }
  });

  if (!h3NodeSeen) {
    throw new Error('Le workflow API ne contient pas le nœud local MiniMaxH3ImageToVideo. Exporte le template H3 LOCAL, pas le nœud API MiniMax.');
  }
  if (firstFrameName && !imageNodeSeen) {
    throw new Error('Image chargée mais aucun nœud LoadImage trouvé dans le workflow I2V.');
  }
  return workflow;
}

export function extractComfyOutputs(historyPayload, promptId) {
  const history = historyPayload?.[promptId] || historyPayload?.history?.[promptId] || historyPayload;
  const outputs = history?.outputs || {};
  const files = [];
  Object.values(outputs).forEach((nodeOutput) => {
    ['videos', 'gifs', 'images', 'audio'].forEach((key) => {
      const values = nodeOutput?.[key];
      if (!Array.isArray(values)) return;
      values.forEach((item) => {
        if (item?.filename) files.push({ kind: key, ...item });
      });
    });
  });
  return files;
}

export async function waitForLocalGeneration(promptId, { timeoutMs = 45 * 60 * 1000, intervalMs = 2000, onProgress } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const history = await getLocalHistory(promptId);
    const outputs = extractComfyOutputs(history, promptId);
    if (outputs.length) return { history, outputs };
    if (typeof onProgress === 'function') onProgress({ elapsedMs: Date.now() - startedAt });
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('La génération locale n’a pas terminé avant le délai de sécurité.');
}

export function buildVideoPromptLocally(videoProject = {}, sourceProject = {}) {
  const clips = videoProject?.clips || [];
  const bpm = Number(sourceProject?.bpm || 120);
  const duration = clips.reduce((sum, clip) => sum + Number(clip.duration || 4), 0);
  const theme = sourceProject?.visual_theme || 'premium cinematic';
  const artist = sourceProject?.artist_name || videoProject?.title || 'subject';
  return [
    `Create a polished ${duration || 5}-second video for ${artist}.`,
    `Visual direction: ${theme}.`,
    `Rhythm: ${bpm} BPM; keep motion and cuts musically coherent.`,
    'Use natural motion, stable identity, controlled camera movement, professional lighting and clean transitions.',
    sourceProject?.creative_notes ? `Creative notes: ${sourceProject.creative_notes}` : '',
  ].filter(Boolean).join(' ');
}

export function buildLocalMontagePlan(videoProject = {}, sourceProject = {}, strategy = 'tempo_sync_editor') {
  const bpm = Math.max(30, Number(sourceProject?.bpm || 120));
  const beat = 60 / bpm;
  const transitions = bpm >= 135 ? ['flash', 'slide', 'glitch'] : bpm >= 100 ? ['slide', 'zoom', 'fade'] : ['fade', 'blur', 'zoom'];
  const clips = (videoProject?.clips || []).map((clip, index) => {
    const original = Math.max(beat, Number(clip.duration || 4));
    const beats = Math.max(1, Math.round(original / beat));
    const snapped = Math.round(beats * beat * 1000) / 1000;
    const withinFivePercent = Math.abs(snapped - original) / original <= 0.05;
    return {
      ...clip,
      duration: strategy === 'tempo_sync_editor' && !withinFivePercent ? snapped : original,
      transition: clip.transition || transitions[index % transitions.length],
    };
  });
  return {
    clips,
    bpm,
    beatDuration: beat,
    summary: `Plan local calculé sur ${bpm} BPM (${beat.toFixed(3)} s/beat) pour ${clips.length} clip(s). Aucun LLM/API externe utilisé.`,
  };
}
