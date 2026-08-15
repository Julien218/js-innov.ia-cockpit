import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COCKPIT_URL = String(process.env.COCKPIT_URL || 'https://olivier-signage-cockpit-production.up.railway.app').replace(/\/$/, '');
const GATEWAY_TOKEN = String(process.env.GATEWAY_TOKEN || '');
const APP_VERSION = '0.2.0-pilot';
const SNAPSHOT_INTERVAL_MS = Math.max(2000, Number(process.env.SNAPSHOT_INTERVAL_SECONDS || 5) * 1000);
const HEARTBEAT_INTERVAL_MS = Math.max(10000, Number(process.env.HEARTBEAT_INTERVAL_SECONDS || 30) * 1000);
const RECORDING_ENABLED = String(process.env.RECORDING_ENABLED || 'false') === 'true';
const RECORDING_DURATION = Math.min(300, Math.max(10, Number(process.env.RECORDING_DURATION_SECONDS || 60)));
const RECORDING_INTERVAL_MS = Math.max(RECORDING_DURATION * 1000, Number(process.env.RECORDING_INTERVAL_SECONDS || 300) * 1000);

function localConfiguration() {
  try {
    const cameras = JSON.parse(process.env.CAMERA_CONFIG_JSON || '[]');
    return new Map(cameras.filter(camera => camera?.key && camera?.rtspUrl).map(camera => [String(camera.key), String(camera.rtspUrl)]));
  } catch {
    throw new Error('CAMERA_CONFIG_JSON invalide');
  }
}

function redactCameraSecrets(value) {
  return String(value || '')
    .replace(/rtsp:\/\/[^@\s]+@/gi, 'rtsp://***@')
    .replace(/([?&](?:token|password|pass)=)[^&\s]+/gi, '$1***')
    .slice(-300);
}

const localCameras = localConfiguration();
let assignedCameras = [];
let stopped = false;

function runFfmpeg(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let errorText = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', chunk => { errorText = (errorText + chunk.toString()).slice(-2000); });
    child.once('error', error => { clearTimeout(timer); reject(new Error(`FFmpeg indisponible: ${error.message}`)); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Capture caméra impossible (FFmpeg ${code}): ${redactCameraSecrets(errorText)}`));
    });
  });
}

async function request(path, options = {}) {
  const response = await fetch(`${COCKPIT_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${GATEWAY_TOKEN}`, ...(options.headers || {}) },
    signal: AbortSignal.timeout(options.timeout || 120000)
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
  if (!response.ok) throw new Error(body.error || `Cockpit HTTP ${response.status}`);
  return body;
}

async function captureSnapshot(camera, rtspUrl) {
  const work = await mkdtemp(join(tmpdir(), 'pixelium-camera-'));
  const output = join(work, 'snapshot.jpg');
  try {
    await runFfmpeg(['-hide_banner','-loglevel','error','-rtsp_transport','tcp','-i',rtspUrl,'-frames:v','1','-vf','scale=1280:-2','-q:v','4','-y',output], 20000);
    const body = await readFile(output);
    await request(`/api/signage/gateway/cameras/${encodeURIComponent(camera.id)}/snapshot`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body, timeout: 30000 });
    return true;
  } finally { await rm(work, { recursive: true, force: true }); }
}

async function captureRecording(camera, rtspUrl) {
  const work = await mkdtemp(join(tmpdir(), 'pixelium-recording-'));
  const output = join(work, 'recording.mp4');
  const startedAt = new Date().toISOString();
  try {
    await runFfmpeg(['-hide_banner','-loglevel','error','-rtsp_transport','tcp','-i',rtspUrl,'-t',String(RECORDING_DURATION),'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-y',output], (RECORDING_DURATION + 30) * 1000);
    const body = await readFile(output);
    await request(`/api/signage/gateway/cameras/${encodeURIComponent(camera.id)}/recordings?startedAt=${encodeURIComponent(startedAt)}&durationSeconds=${RECORDING_DURATION}`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body, timeout: 180000 });
  } finally { await rm(work, { recursive: true, force: true }); }
}

async function heartbeat() {
  const states = assignedCameras.map(camera => ({ id: camera.id, online: localCameras.has(camera.local_stream_key) }));
  const result = await request('/api/signage/gateway/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appVersion: APP_VERSION, diagnostics: { hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || 'gateway', configuredCameras: localCameras.size }, cameras: states }), timeout: 30000 });
  assignedCameras = Array.isArray(result.cameras) ? result.cameras : [];
}

async function snapshotCycle() {
  for (const camera of assignedCameras) {
    const rtspUrl = localCameras.get(camera.local_stream_key);
    if (!rtspUrl) continue;
    await captureSnapshot(camera, rtspUrl).catch(error => console.error(`[camera ${camera.id}] ${error.message}`));
  }
}

async function recordingCycle() {
  if (!RECORDING_ENABLED) return;
  for (const camera of assignedCameras) {
    const rtspUrl = localCameras.get(camera.local_stream_key);
    if (!rtspUrl) continue;
    await captureRecording(camera, rtspUrl).catch(error => console.error(`[recording ${camera.id}] ${error.message}`));
  }
}

async function loop(task, interval) {
  while (!stopped) {
    const started = Date.now();
    await task().catch(error => console.error(error.message));
    await new Promise(resolve => setTimeout(resolve, Math.max(500, interval - (Date.now() - started))));
  }
}

if (!GATEWAY_TOKEN) throw new Error('GATEWAY_TOKEN manquant');
if (!localCameras.size) console.warn('Aucune caméra locale configurée dans CAMERA_CONFIG_JSON');
process.on('SIGINT', () => { stopped = true; });
process.on('SIGTERM', () => { stopped = true; });
await heartbeat();
await Promise.all([loop(heartbeat, HEARTBEAT_INTERVAL_MS), loop(snapshotCycle, SNAPSHOT_INTERVAL_MS), loop(recordingCycle, RECORDING_INTERVAL_MS)]);

