async function readApiJson(response, { label = 'API locale' } = {}) {
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; }
  catch {
    throw new Error(`${label} : réponse non JSON (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `${label} : HTTP ${response.status}`);
  }
  return data;
}

export const LOCAL_VOICE_URLS = ['http://127.0.0.1:8788', 'http://127.0.0.1:8787'];

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function recorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ].find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
}

async function transcribeAt(baseUrl, blob) {
  const name = `elynea-voice-${Date.now()}.webm`;
  const assetResponse = await fetch(`${baseUrl}/api/music-motion/production/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
    signal: AbortSignal.timeout(30000),
  });
  const asset = await readApiJson(assetResponse, { label: 'Whisper local · import audio' });
  if (!asset?.id) throw new Error('Whisper local : identifiant audio absent.');

  const jobResponse = await fetch(`${baseUrl}/api/music-motion/production/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'analyze', audio_id: asset.id, instrumental: false }),
    signal: AbortSignal.timeout(30000),
  });
  let job = await readApiJson(jobResponse, { label: 'Whisper local · démarrage' });
  if (!job?.id) throw new Error('Whisper local : job de transcription absent.');

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (job.status === 'completed') {
      const transcript = String(job.result?.transcription?.transcript || '').trim();
      if (!transcript) throw new Error('Whisper local n’a détecté aucune parole exploitable.');
      return {
        transcript,
        endpoint: baseUrl,
        device: job.result?.transcription?.device || null,
        fallbackUsed: Boolean(job.result?.transcription?.fallback_used),
      };
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(job.error || `Whisper local : transcription ${job.status}.`);
    }
    await sleep(500);
    const pollResponse = await fetch(`${baseUrl}/api/music-motion/production/jobs/${encodeURIComponent(job.id)}`, {
      signal: AbortSignal.timeout(15000),
    });
    job = await readApiJson(pollResponse, { label: 'Whisper local · suivi' });
  }
  throw new Error('Whisper local : délai de transcription dépassé.');
}

export async function transcribeLocalVoiceBlob(blob) {
  if (typeof window !== 'undefined' && window.electronAPI?.localVoice?.transcribe) {
    const buffer = new Uint8Array(await blob.arrayBuffer());
    return window.electronAPI.localVoice.transcribe({
      bytes: buffer,
      mimeType: blob.type || 'audio/webm',
    });
  }

  let lastError = null;
  for (const baseUrl of LOCAL_VOICE_URLS) {
    try {
      return await transcribeAt(baseUrl, blob);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Agent local Whisper indisponible.');
}

export function localMicroSupported() {
  return typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== 'undefined';
}

export function createLocalVoiceRecorder({ onState, onTranscript, onError } = {}) {
  let recorder = null;
  let stream = null;
  let chunks = [];
  let stopping = false;

  const cleanup = () => {
    stream?.getTracks?.().forEach((track) => track.stop());
    stream = null;
    recorder = null;
    chunks = [];
    stopping = false;
  };

  const start = async () => {
    if (!localMicroSupported()) throw new Error('Capture micro locale non supportée par cette WebView.');
    if (recorder && recorder.state !== 'inactive') return;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    chunks = [];
    const mimeType = recorderMimeType();
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = (event) => {
      const error = event?.error || new Error('Erreur de capture micro locale.');
      cleanup();
      onState?.('error');
      onError?.(error);
    };
    recorder.start(250);
    onState?.('recording');
  };

  const stop = async () => {
    if (!recorder || recorder.state === 'inactive' || stopping) return;
    stopping = true;
    const activeRecorder = recorder;
    const activeStream = stream;
    onState?.('transcribing');
    const blob = await new Promise((resolve, reject) => {
      activeRecorder.onstop = () => {
        const value = new Blob(chunks, { type: activeRecorder.mimeType || 'audio/webm' });
        resolve(value);
      };
      activeRecorder.onerror = (event) => reject(event?.error || new Error('Erreur de capture micro locale.'));
      activeRecorder.stop();
      activeStream?.getTracks?.().forEach((track) => track.stop());
    });
    try {
      const result = await transcribeLocalVoiceBlob(blob);
      onTranscript?.(result.transcript, result);
      onState?.('idle');
      return result;
    } catch (error) {
      onState?.('error');
      onError?.(error);
      throw error;
    } finally {
      cleanup();
    }
  };

  const cancel = () => {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch {}
    cleanup();
    onState?.('idle');
  };

  return { start, stop, cancel, get active() { return Boolean(recorder && recorder.state !== 'inactive'); } };
}
