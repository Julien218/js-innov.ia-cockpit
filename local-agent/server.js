import http from 'node:http';
import { createMusicMotionService } from './music-motion-service.mjs';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { appendFile, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.LOCAL_AGENT_PORT || 8787);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:4b';
const TOKEN = String(process.env.LOCAL_AGENT_TOKEN || '').trim();
const VERSION = '1.5.0';
const MAX_BODY = 5 * 1024 * 1024;
const approvals = new Map();
const runs = new Map();
const execOptions = { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 };
const ALLOWED_ORIGINS = new Set(['https://cockpit.jsinnovia.com']);
const ALLOWED_HTTP_HOSTS = new Set(String(process.env.LOCAL_AGENT_ALLOWED_HTTP_HOSTS || 'jsinnovia.com,www.jsinnovia.com,assurances-dour.be,www.assurances-dour.be,letourdedour.com,www.letourdedour.com').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));

const configuredRoots = String(process.env.LOCAL_AGENT_ALLOWED_ROOTS || '').split(path.delimiter).map((v) => v.trim()).filter(Boolean);
const defaultRoots = ['Downloads', 'Documents', 'Videos'].map((name) => path.join(os.homedir(), name)).filter(existsSync);
const ALLOWED_ROOTS = [...new Set((configuredRoots.length ? configuredRoots : defaultRoots).map((v) => path.resolve(v)))];
const logDir = process.env.LOCAL_AGENT_LOG_DIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'JS-InnovIA', 'AI-Factory');
mkdirSync(logDir, { recursive: true });
const runLogPath = path.join(logDir, 'tool-runs.jsonl');
const telemetrySessionId = crypto.randomUUID();
const telemetrySamples = [];
const TELEMETRY_INTERVAL_MS = Math.max(2000, Number(process.env.LOCAL_TELEMETRY_INTERVAL_MS || 5000));
const TELEMETRY_MAX_SAMPLES = Math.max(120, Number(process.env.LOCAL_TELEMETRY_MAX_SAMPLES || 4320));
const LOCAL_POWER_CEILING_WATTS = Math.max(1, Number(process.env.LOCAL_AI_POWER_WATTS || 180));
let previousCpuTimes = null;

function comfyUiLaunchSpec() {
  const installRoot = process.env.COMFYUI_INSTALL_ROOT || path.join(os.homedir(), 'AppData', 'Local', 'Comfy-Desktop', 'ComfyUI-Installs', 'Comfyui');
  const sharedRoot = process.env.COMFYUI_SHARED_ROOT || path.join(os.homedir(), 'AppData', 'Local', 'Comfy-Desktop', 'ComfyUI-Shared');
  const python = path.join(installRoot, 'ComfyUI', '.venv', 'Scripts', 'python.exe');
  const main = path.join(installRoot, 'ComfyUI', 'main.py');
  const modelConfig = path.join(os.homedir(), 'AppData', 'Roaming', 'Comfy Desktop', 'shared_model_paths.yaml');
  if (!existsSync(python) || !existsSync(main)) return null;
  return {
    command: python,
    cwd: installRoot,
    args: ['-s', main, '--feature-flag', 'show_signin_button=true', '--enable-manager', '--extra-model-paths-config', modelConfig, '--input-directory', path.join(sharedRoot, 'input'), '--output-directory', path.join(sharedRoot, 'output')],
  };
}

async function ensureComfyUi() {
  if (process.platform !== 'win32' || process.env.COMFYUI_AUTOSTART === '0') return { started: false, reason: 'disabled' };
  try {
    const response = await fetch('http://127.0.0.1:8188/system_stats', { signal: AbortSignal.timeout(1200) });
    if (response.ok) return { started: false, reason: 'already_online' };
  } catch {}
  const spec = comfyUiLaunchSpec();
  if (!spec) return { started: false, reason: 'not_installed' };
  const childEnv = { ...process.env };
  delete childEnv.SSLKEYLOGFILE;
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: childEnv, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return { started: true, pid: child.pid };
}

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.has(origin) || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin || '');
}

function headersFor(req) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin',
  };
  if (isAllowedOrigin(req.headers.origin)) headers['Access-Control-Allow-Origin'] = req.headers.origin;
  return headers;
}

function send(req, res, status, payload) {
  res.writeHead(status, headersFor(req));
  res.end(JSON.stringify(payload));
}

async function readJson(req, maxBody = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBody) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function pathInsideAllowedRoot(input) {
  const resolved = path.resolve(String(input || ''));
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  return ALLOWED_ROOTS.some((candidate) => {
    const root = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
    return normalized === root || normalized.startsWith(`${root}${path.sep}`);
  }) ? resolved : null;
}

async function recordRun(run) {
  if (!run.telemetry) {
    const runtimeSeconds = run.started_at && run.completed_at
      ? Math.max(0, (Date.parse(run.completed_at) - Date.parse(run.started_at)) / 1000)
      : 0;
    run.telemetry = telemetrySummary(run.started_at, run.completed_at, runtimeSeconds);
  }
  runs.set(run.id, run);
  if (runs.size > 200) runs.delete(runs.keys().next().value);
  await appendFile(runLogPath, `${JSON.stringify(run)}\n`, 'utf8').catch(() => {});
  return run;
}

async function commandStatus(command) {
  try {
    const { stdout, stderr } = await execFileAsync(command, ['-version'], execOptions);
    return { online: true, version: String(stdout || stderr || '').split(/\r?\n/)[0].slice(0, 240) };
  } catch (error) {
    return { online: false, error: error.code === 'ENOENT' ? 'not_installed' : String(error.message).slice(0, 240) };
  }
}

function cpuTimes() {
  return os.cpus().reduce((result, cpu) => {
    result.idle += Number(cpu.times?.idle || 0);
    result.total += Object.values(cpu.times || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    return result;
  }, { idle: 0, total: 0 });
}

function cpuUtilizationPercent(current) {
  if (!previousCpuTimes) {
    previousCpuTimes = current;
    return null;
  }
  const total = current.total - previousCpuTimes.total;
  const idle = current.idle - previousCpuTimes.idle;
  previousCpuTimes = current;
  if (!(total > 0)) return null;
  return Number((Math.max(0, Math.min(1, 1 - idle / total)) * 100).toFixed(2));
}

async function readNvidiaTelemetry() {
  try {
    const fields = 'name,utilization.gpu,memory.used,memory.total,power.draw,power.limit';
    const { stdout } = await execFileAsync('nvidia-smi', [`--query-gpu=${fields}`, '--format=csv,noheader,nounits'], {
      ...execOptions,
      timeout: 3000,
    });
    const devices = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, utilization, memoryUsed, memoryTotal, powerDraw, powerLimit] = line.split(',').map((value) => value.trim());
      const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
      return {
        name: name || 'NVIDIA GPU',
        utilization_percent: numeric(utilization),
        memory_used_mib: numeric(memoryUsed),
        memory_total_mib: numeric(memoryTotal),
        power_draw_watts: numeric(powerDraw),
        power_limit_watts: numeric(powerLimit),
        power_sensor: numeric(powerDraw) !== null ? 'nvidia_smi_instantaneous' : 'unavailable',
      };
    });
    return devices;
  } catch {
    return [];
  }
}

function estimateSystemPower({ cpuPercent, gpuDevices }) {
  const gpuMeasured = gpuDevices.reduce((sum, device) => sum + Math.max(0, Number(device.power_draw_watts || 0)), 0);
  const gpuUtil = gpuDevices.length
    ? gpuDevices.reduce((sum, device) => sum + Math.max(0, Number(device.utilization_percent || 0)), 0) / gpuDevices.length
    : 0;
  if (gpuMeasured > 0) {
    const baseAndCpu = 35 + (Math.max(0, Number(cpuPercent || 0)) / 100) * 65;
    return {
      watts: Number(Math.min(LOCAL_POWER_CEILING_WATTS * 1.25, Math.max(LOCAL_POWER_CEILING_WATTS * 0.25, baseAndCpu + gpuMeasured)).toFixed(2)),
      method: 'gpu_sensor_plus_cpu_system_estimate',
    };
  }
  const loadFactor = Math.max(0.25, Math.min(1, 0.25 + (Math.max(0, Number(cpuPercent || 0)) / 100) * 0.35 + (gpuUtil / 100) * 0.4));
  return {
    watts: Number((LOCAL_POWER_CEILING_WATTS * loadFactor).toFixed(2)),
    method: 'configured_ceiling_load_estimate',
  };
}

async function collectTelemetrySnapshot() {
  const cpus = os.cpus();
  const cpuPercent = cpuUtilizationPercent(cpuTimes());
  const gpuDevices = await readNvidiaTelemetry();
  const power = estimateSystemPower({ cpuPercent, gpuDevices });
  const totalMemory = os.totalmem();
  const usedMemory = Math.max(0, totalMemory - os.freemem());
  const snapshot = {
    id: crypto.randomUUID(),
    session_id: telemetrySessionId,
    captured_at: new Date().toISOString(),
    platform: process.platform,
    hostname: os.hostname(),
    cpu: {
      model: cpus[0]?.model || 'inconnu',
      logical_cores: cpus.length,
      utilization_percent: cpuPercent,
    },
    memory: {
      used_bytes: usedMemory,
      total_bytes: totalMemory,
      utilization_percent: totalMemory > 0 ? Number((usedMemory / totalMemory * 100).toFixed(2)) : null,
    },
    gpu: { devices: gpuDevices },
    power: {
      estimated_system_watts: power.watts,
      configured_ceiling_watts: LOCAL_POWER_CEILING_WATTS,
      method: power.method,
      evidence_status: 'estimated',
      note: 'La puissance GPU est lue par capteur lorsqu’elle est disponible; la consommation électrique totale du PC reste estimée sans compteur physique.',
    },
  };
  telemetrySamples.push(snapshot);
  if (telemetrySamples.length > TELEMETRY_MAX_SAMPLES) telemetrySamples.splice(0, telemetrySamples.length - TELEMETRY_MAX_SAMPLES);
  return snapshot;
}

function average(values) {
  const usable = values.filter((value) => value !== null && value !== undefined && value !== '').map(Number).filter(Number.isFinite);
  return usable.length ? Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(2)) : null;
}

function summarizeTelemetrySamples(samples = [], options = {}) {
  const selected = samples.filter(Boolean);
  const startedAt = options.startedAt || selected[0]?.captured_at || null;
  const completedAt = options.completedAt || selected[selected.length - 1]?.captured_at || null;
  const explicitSeconds = Number(options.runtimeSeconds || 0);
  const derivedSeconds = startedAt && completedAt ? Math.max(0, (Date.parse(completedAt) - Date.parse(startedAt)) / 1000) : 0;
  const runtimeSeconds = explicitSeconds > 0 ? explicitSeconds : derivedSeconds;
  const gpuDevices = selected.flatMap((sample) => sample.gpu?.devices || []);
  const first = selected[0] || null;
  return {
    summary_id: `local-telemetry:${telemetrySessionId}:${crypto.randomUUID()}`,
    session_id: telemetrySessionId,
    started_at: startedAt,
    completed_at: completedAt,
    runtime_seconds: Number(runtimeSeconds.toFixed(3)),
    sample_count: selected.length,
    sampling_interval_seconds: TELEMETRY_INTERVAL_MS / 1000,
    cpu: {
      model: first?.cpu?.model || null,
      logical_cores: first?.cpu?.logical_cores || null,
      average_utilization_percent: average(selected.map((sample) => sample.cpu?.utilization_percent)),
    },
    memory: {
      total_bytes: first?.memory?.total_bytes || null,
      average_utilization_percent: average(selected.map((sample) => sample.memory?.utilization_percent)),
    },
    gpu: {
      names: [...new Set(gpuDevices.map((device) => device.name).filter(Boolean))],
      average_utilization_percent: average(gpuDevices.map((device) => device.utilization_percent)),
      average_power_draw_watts: average(gpuDevices.map((device) => device.power_draw_watts)),
      power_sensor: gpuDevices.some((device) => device.power_sensor === 'nvidia_smi_instantaneous') ? 'nvidia_smi_instantaneous' : 'unavailable',
    },
    power: {
      average_estimated_system_watts: average(selected.map((sample) => sample.power?.estimated_system_watts)),
      configured_ceiling_watts: first?.power?.configured_ceiling_watts || LOCAL_POWER_CEILING_WATTS,
      methods: [...new Set(selected.map((sample) => sample.power?.method).filter(Boolean))],
      evidence_status: 'estimated',
    },
    evidence_status: 'estimated',
  };
}

function telemetrySummary(startedAt, completedAt, runtimeSeconds = 0) {
  const startMs = Number.isFinite(Date.parse(startedAt)) ? Date.parse(startedAt) : 0;
  const endMs = Number.isFinite(Date.parse(completedAt)) ? Date.parse(completedAt) : Date.now();
  const selected = telemetrySamples.filter((sample) => {
    const captured = Date.parse(sample.captured_at);
    return captured >= startMs && captured <= endMs;
  });
  const fallback = selected.length ? selected : telemetrySamples.slice(-1);
  return summarizeTelemetrySamples(fallback, { startedAt: startedAt || fallback[0]?.captured_at, completedAt: completedAt || fallback[fallback.length - 1]?.captured_at, runtimeSeconds });
}

async function currentTelemetrySnapshot() {
  const latest = telemetrySamples[telemetrySamples.length - 1];
  if (!latest || Date.now() - Date.parse(latest.captured_at) >= TELEMETRY_INTERVAL_MS) return collectTelemetrySnapshot();
  return latest;
}

async function executeTool(tool, args = {}) {
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let command;
  let commandArgs;

  if (tool === 'ffmpeg_version') {
    command = 'ffmpeg'; commandArgs = ['-version'];
  } else if (tool === 'comfyui_health') {
    return fetchRun({ id, tool, startedAt, url: 'http://127.0.0.1:8188/system_stats', timeout: 5000, includeJson: true });
  } else if (tool === 'avatar_factory_status') {
    try {
      const response = await fetch('http://127.0.0.1:8791/jobs', { signal: AbortSignal.timeout(5000) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      const latest = Array.isArray(payload.jobs) ? payload.jobs[0] : null;
      let detail = latest;
      if (latest?.id) {
        const detailResponse = await fetch(`http://127.0.0.1:8791/jobs/${encodeURIComponent(latest.id)}`, { signal: AbortSignal.timeout(5000) });
        if (detailResponse.ok) detail = await detailResponse.json();
      }
      return recordRun({ id, tool, started_at: startedAt, completed_at: new Date().toISOString(), success: true, exit_code: 0, target: 'http://127.0.0.1:8791/jobs', output: JSON.stringify({ online: true, jobs_count: Array.isArray(payload.jobs) ? payload.jobs.length : 0, latest: detail || null }) });
    } catch (error) {
      return recordRun({ id, tool, started_at: startedAt, completed_at: new Date().toISOString(), success: false, exit_code: 1, target: 'http://127.0.0.1:8791/jobs', output: JSON.stringify({ online: false, error: String(error.message || error) }) });
    }
  } else if (tool === 'http_diagnose') {
    let target;
    try { target = new URL(String(args.url || '')); } catch { throw Object.assign(new Error('invalid_url'), { status: 400 }); }
    if (!['http:', 'https:'].includes(target.protocol) || !ALLOWED_HTTP_HOSTS.has(target.hostname.toLowerCase()) || target.username || target.password) throw Object.assign(new Error('http_target_not_allowed'), { status: 403 });
    target.hash = '';
    return fetchRun({ id, tool, startedAt, url: target.toString(), timeout: 10000 });
  } else if (tool === 'find_local_workflows') {
    const matches = await findLocalWorkflows();
    return recordRun({ id, tool, started_at: startedAt, completed_at: new Date().toISOString(), success: true, exit_code: 0, target: ALLOWED_ROOTS, output: JSON.stringify({ count: matches.length, matches }) });
  } else if (tool === 'workflow_documentation_audit') {
    const candidates = await findNamedFiles('WORKFLOWS_LOCAUX.md');
    const documents = [];
    for (const file of candidates) {
      const content = await readFile(file, 'utf8').catch(() => '');
      documents.push({
        path: file,
        bytes: Buffer.byteLength(content),
        sha256: content ? crypto.createHash('sha256').update(content).digest('hex') : null,
        measured_state: /État du moteur local|Etat du moteur local/i.test(content),
        remaining_work: /Travail encore nécessaire|Travail encore necessaire/i.test(content),
        evidence_ids: [...content.matchAll(/`([a-f0-9]{8}-[a-f0-9-]{27,})`/gi)].map((match) => match[1]),
      });
    }
    const valid = documents.some((document) => document.bytes > 0 && document.measured_state && document.remaining_work);
    return recordRun({ id, tool, started_at: startedAt, completed_at: new Date().toISOString(), success: valid, exit_code: valid ? 0 : 1, target: candidates, output: JSON.stringify({ count: documents.length, valid, documents }) });
  } else if (tool === 'video_pipeline_audit') {
    const report = await auditVideoPipeline();
    return recordRun({ id, tool, started_at: startedAt, completed_at: new Date().toISOString(), success: true, exit_code: 0, target: 'local_video_pipeline', output: JSON.stringify(report) });
  } else if (tool === 'ffprobe_file') {
    const file = pathInsideAllowedRoot(args.path);
    if (!file) throw Object.assign(new Error('path_not_allowed'), { status: 403 });
    if (!(await stat(file).catch(() => null))?.isFile()) throw Object.assign(new Error('file_not_found'), { status: 404 });
    command = 'ffprobe'; commandArgs = ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file];
  } else if (tool === 'list_directory') {
    const directory = pathInsideAllowedRoot(args.path);
    if (!directory) throw Object.assign(new Error('path_not_allowed'), { status: 403 });
    if (!(await stat(directory).catch(() => null))?.isDirectory()) throw Object.assign(new Error('directory_not_found'), { status: 404 });
    const entries = (await readdir(directory, { withFileTypes: true })).slice(0, 200).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other' }));
    return recordRun({ id, tool, started_at: startedAt, completed_at: new Date().toISOString(), success: true, exit_code: 0, target: directory, output: JSON.stringify(entries) });
  } else {
    throw Object.assign(new Error('tool_not_allowed'), { status: 400 });
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, commandArgs, execOptions);
    return recordRun({ id, tool, started_at: startedAt, completed_at: new Date().toISOString(), success: true, exit_code: 0, command: [command, ...commandArgs].join(' '), output: String(stdout || stderr || '').slice(0, 20000) });
  } catch (error) {
    return recordRun({ id, tool, started_at: startedAt, completed_at: new Date().toISOString(), success: false, exit_code: Number.isInteger(error.code) ? error.code : null, command: [command, ...commandArgs].join(' '), output: String(error.stdout || error.stderr || error.message || '').slice(0, 20000) });
  }
}

async function ollama(prompt, model = DEFAULT_MODEL) {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt, stream: false, think: false }), signal: AbortSignal.timeout(120000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `Ollama ${response.status}`);
  return String(payload.response || '').trim();
}


function audioExtension(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('webm')) return 'webm';
  return 'm4a';
}

function parseJsonDocument(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const candidates = [
    text.replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/i, '').trim(),
    text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1),
  ];
  for (const candidate of candidates) {
    if (!candidate || !candidate.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function normalizeMusicMotionPlan(plan, body = {}) {
  if (!plan || typeof plan !== 'object') return null;
  const sections = Array.isArray(plan.sections) ? plan.sections : [];
  return {
    visual_theme: String(plan.visual_theme || body.visual_theme || 'premium cinematic JS-Innov.IA'),
    dance_decision: ['required', 'optional', 'none'].includes(plan.dance_decision)
      ? plan.dance_decision
      : (body.dance_allowed === false ? 'none' : 'optional'),
    master_choreography: plan.master_choreography && typeof plan.master_choreography === 'object'
      ? {
          enabled: Boolean(plan.master_choreography.enabled),
          gestures: Array.isArray(plan.master_choreography.gestures)
            ? plan.master_choreography.gestures.map((item) => String(item).slice(0, 280)).slice(0, 6)
            : [],
          rule: String(plan.master_choreography.rule || '').slice(0, 1000),
        }
      : { enabled: false, gestures: [], rule: '' },
    sections: sections.slice(0, 40).map((section, index) => ({
      id: String(section.id || 'local-scene-' + (index + 1)),
      type: String(section.type || 'scene').slice(0, 40),
      label: String(section.label || 'Scène ' + (index + 1)).slice(0, 160),
      start: Math.max(0, Number(section.start) || 0),
      end: Math.max(0, Number(section.end) || 0),
      dance: Boolean(section.dance),
      motion: String(section.motion || '').slice(0, 1200),
      prompt: String(section.prompt || '').slice(0, 4000),
    })),
  };
}

async function analyzeMusicMotion(body = {}) {
  const rawDataUrl = String(body.audio_data_url || '');
  const match = rawDataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) throw Object.assign(new Error('audio_data_url_invalid'), { status: 400 });

  const mimeType = match[1].toLowerCase();
  const audioBuffer = Buffer.from(match[2], 'base64');
  const maxAudioBytes = 14 * 1024 * 1024;
  if (!audioBuffer.length) throw Object.assign(new Error('audio_empty'), { status: 400 });
  if (audioBuffer.length > maxAudioBytes) throw Object.assign(new Error('audio_too_large'), { status: 413 });

  const workDir = path.join(os.tmpdir(), 'JS-InnovIA', 'MusicMotion');
  mkdirSync(workDir, { recursive: true });
  const audioPath = path.join(workDir, crypto.randomUUID() + '.' + audioExtension(mimeType));
  await writeFile(audioPath, audioBuffer);

  try {
    const python = process.env.MUSIC_MOTION_PYTHON || process.env.PYTHON || 'python';
    const script = path.join(path.dirname(process.argv[1] || '.'), 'music_motion_analyzer.py');
    let lowLevel;
    try {
      const result = await execFileAsync(
        python,
        [script, audioPath],
        { windowsHide: true, timeout: 20 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
      );
      lowLevel = parseJsonDocument(result.stdout) || {
        ok: false,
        error_code: 'analyzer_invalid_json',
        warnings: ['Le script audio local n’a pas renvoyé de JSON exploitable.'],
      };
    } catch (error) {
      throw Object.assign(new Error('local_audio_analyzer_unavailable'), {
        status: 503,
        details: String(error.stderr || error.message || '').slice(0, 1200),
      });
    }

    const warnings = Array.isArray(lowLevel.warnings) ? [...lowLevel.warnings] : [];
    let plan = null;
    let llm = { available: false, model: DEFAULT_MODEL };

    if (lowLevel.transcript) {
      const analysisPrompt = [
        'Tu es le directeur artistique local de JS-Innov.IA.',
        'Retourne uniquement un objet JSON valide, sans markdown.',
        'Analyse le transcript et les timecodes fournis pour proposer une mise en scène synchronisée.',
        'Le mode peut être auto, dance, cinematic, advertising ou custom.',
        'Si dance_allowed=false, dance_decision doit être none.',
        'En mode auto, active la danse seulement si le refrain et la demande le justifient.',
        'Si la danse est activée, invente au maximum trois gestes simples et répète exactement cette séquence à chaque refrain.',
        'Ne transforme jamais le personnage de référence et ne change pas son identité.',
        'Schéma obligatoire: {"visual_theme":"string","dance_decision":"required|optional|none","master_choreography":{"enabled":true,"gestures":["..."],"rule":"..."},"sections":[{"id":"...","type":"intro|couplet|refrain|pont|outro|scene","label":"...","start":0,"end":1,"dance":false,"motion":"...","prompt":"..."}]}',
        'Projet: ' + JSON.stringify({
          mode: body.mode || 'auto',
          dance_allowed: body.dance_allowed !== false,
          duration_seconds: body.duration_seconds || null,
          brief: String(body.brief || '').slice(0, 5000),
          visual_theme: body.visual_theme || null,
        }),
        'Transcript: ' + String(lowLevel.transcript).slice(0, 18000),
        'Segments Whisper: ' + JSON.stringify(lowLevel.segments || []).slice(0, 18000),
      ].join('\n\n');

      try {
        const rawPlan = await ollama(analysisPrompt, body.model || DEFAULT_MODEL);
        plan = normalizeMusicMotionPlan(parseJsonDocument(rawPlan), body);
        llm = { available: Boolean(plan), model: body.model || DEFAULT_MODEL };
        if (!plan) warnings.push('Ollama a répondu, mais son JSON de réalisation n’était pas exploitable.');
      } catch (error) {
        warnings.push('Ollama n’a pas pu produire le plan créatif : ' + String(error.message || error).slice(0, 300));
      }
    } else {
      warnings.push('Aucun transcript exploitable : la timeline générique reste à valider manuellement.');
    }

    return {
      ok: true,
      source: 'local-agent',
      audio: {
        name: String(body.audio_name || '').slice(0, 240),
        mime_type: mimeType,
        bytes: audioBuffer.length,
        duration_seconds: Number(body.duration_seconds) || lowLevel.duration_seconds || null,
      },
      transcription: lowLevel,
      creative_plan: plan,
      llm,
      warnings,
    };
  } finally {
    await unlink(audioPath).catch(() => {});
  }
}

function requestedTools(message) {
  const text = String(message || '');
  const requests = [];
  const add = (tool, args = {}) => { if (!requests.some((item) => item.tool === tool && JSON.stringify(item.args) === JSON.stringify(args))) requests.push({ tool, args }); };
  if (/ffmpeg\s+-version|version\s+(?:de\s+)?ffmpeg|teste?.*ffmpeg/i.test(text)) add('ffmpeg_version');
  if (/(?:recherche|trouve|recense|localise|v[eé]rifie).*(?:workflow|minimax\s*h3)|(?:workflow|minimax\s*h3).*(?:local|dossier|fichier)/i.test(text)) add('find_local_workflows');
  if (/(?:comfyui|port\s*8188).*(?:[eé]tat|sant[eé]|status|disponible|en ligne|diagnostic|contr[oô]le)|(?:[eé]tat|sant[eé]|status|diagnostic|contr[oô]le).*(?:comfyui|8188)/i.test(text)) add('comfyui_health');
  if (/(?:avatar factory|avatar js.?innov.?ia|port\s*8791).*(?:[eé]tat|status|termin[eé]|finalis[eé]|contr[oô]le|v[eé]rifie)|(?:contr[oô]le|v[eé]rifie).*(?:avatar factory|avatar js.?innov.?ia|8791)/i.test(text)) add('avatar_factory_status');
  const explicitUrl = text.match(/https?:\/\/[^\s<>)]+/i)?.[0]?.replace(/[.,;!?]+$/, '');
  const managedDomain = text.match(/\b(?:www\.)?(?:jsinnovia\.com|assurances-dour\.be|letourdedour\.com)\b/i)?.[0];
  if (/(?:https?|tls|api|site|domaine).*(?:diagnostic|teste?|v[eé]rifie|contr[oô]le)|(?:diagnostic|teste?|v[eé]rifie|contr[oô]le).*(?:https?|tls|api|site|domaine)/i.test(text) && (explicitUrl || managedDomain)) add('http_diagnose', { url: explicitUrl || `https://${managedDomain}` });
  const localPath = text.match(/["“](.+?)["”]/)?.[1] || text.match(/([A-Za-z]:\\[^\r\n]+)/)?.[1];
  if (/ffprobe|m[eé]tadonn[eé]es?|analyse.*(?:vid[eé]o|fichier)/i.test(text) && localPath) add('ffprobe_file', { path: localPath.trim() });
  if (/(?:liste|contenu).*(?:dossier|fichiers?)/i.test(text) && localPath) add('list_directory', { path: localPath.trim() });
  return requests;
}

function requestedTool(message) {
  return requestedTools(message)[0] || null;
}

function requestsTaskList(message) {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const mentionsTasks = /\b(?:taches?|travail)\b/.test(text);
  const asksForList = /\b(?:quel(?:le)?s?|quoi)\b/.test(text);
  const mentionsPending = /(?:non\s+(?:effectue|termine)|a\s+(?:effectuer|faire)|en\s+cours|rest|effectuer|faire|pending)/.test(text);
  return mentionsTasks && (asksForList || mentionsPending);
}

async function fetchRun({ id, tool, startedAt, url, timeout = 8000, includeJson = false }) {
  const started = Date.now();
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': `Elynea-Local-Tools/${VERSION}` } });
    const successful = response.ok || (response.status >= 300 && response.status < 400);
    const details = { url, status: response.status, status_text: response.statusText, location: response.headers.get('location'), content_type: response.headers.get('content-type'), duration_ms: Date.now() - started };
    if (includeJson) {
      const payload = await response.json().catch(() => null);
      if (payload) {
        details.comfyui_version = payload.system?.comfyui_version || null;
        details.python_version = payload.system?.python_version || null;
        details.devices = Array.isArray(payload.devices) ? payload.devices.map((device) => ({ name: device.name, type: device.type, vram_total: device.vram_total, vram_free: device.vram_free })) : [];
      }
    }
    const output = JSON.stringify(details);
    return recordRun({ id, tool, started_at: startedAt, completed_at: new Date().toISOString(), success: successful, exit_code: successful ? 0 : 1, target: url, output });
  } catch (error) {
    return recordRun({ id, tool, started_at: startedAt, completed_at: new Date().toISOString(), success: false, exit_code: 1, target: url, output: JSON.stringify({ url, error: String(error.message || error), cause: String(error.cause?.code || error.cause?.message || ''), duration_ms: Date.now() - started }) });
  }
}

async function findLocalWorkflows() {
  const matches = [];
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.cache']);
  async function visit(directory, depth) {
    if (depth > 5 || matches.length >= 200) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (matches.length >= 200) break;
      if (ignored.has(entry.name.toLowerCase())) continue;
      const fullPath = path.join(directory, entry.name);
      const normalized = fullPath.toLowerCase();
      if (entry.isDirectory()) {
        if (/comfyui|minimax/.test(entry.name.toLowerCase())) matches.push({ path: fullPath, type: 'directory' });
        await visit(fullPath, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json') && /comfyui|minimax/.test(normalized) && !/(?:secret|credential|token|oauth)/.test(entry.name.toLowerCase())) {
        matches.push({ path: fullPath, type: 'workflow_json' });
      }
    }
  }
  for (const root of ALLOWED_ROOTS) await visit(root, 0);
  return matches;
}

async function findNamedFiles(fileName) {
  const matches = [];
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.cache']);
  async function visit(directory, depth) {
    if (depth > 6 || matches.length >= 50) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (matches.length >= 50 || ignored.has(entry.name.toLowerCase())) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) matches.push(fullPath);
    }
  }
  for (const root of ALLOWED_ROOTS) await visit(root, 0);
  return matches;
}

async function auditVideoPipeline() {
  const matches = (await findLocalWorkflows()).filter((item) => item.type === 'workflow_json');
  const files = [];
  const requiredNodeTypes = new Set();
  for (const match of matches) {
    try {
      const payload = JSON.parse(await readFile(match.path, 'utf8'));
      const nodeTypes = Array.isArray(payload?.nodes)
        ? payload.nodes.map((node) => node?.type).filter(Boolean)
        : Object.values(payload || {}).map((node) => node?.class_type).filter(Boolean);
      nodeTypes.forEach((type) => requiredNodeTypes.add(String(type)));
      files.push({ path: match.path, valid_json: true, node_types: [...new Set(nodeTypes.map(String))] });
    } catch (error) {
      files.push({ path: match.path, valid_json: false, error: String(error.message || error).slice(0, 300) });
    }
  }

  let comfy = { online: false, node_type_count: 0, missing_node_types: [...requiredNodeTypes] };
  try {
    const [statsResponse, objectInfoResponse] = await Promise.all([
      fetch('http://127.0.0.1:8188/system_stats', { signal: AbortSignal.timeout(8000) }),
      fetch('http://127.0.0.1:8188/object_info', { signal: AbortSignal.timeout(15000) }),
    ]);
    const stats = await statsResponse.json().catch(() => ({}));
    const objectInfo = await objectInfoResponse.json().catch(() => ({}));
    const available = new Set(Object.keys(objectInfo || {}));
    comfy = {
      online: statsResponse.ok && objectInfoResponse.ok,
      version: stats?.system?.comfyui_version || null,
      node_type_count: available.size,
      missing_node_types: [...requiredNodeTypes].filter((type) => !available.has(type)),
    };
  } catch (error) {
    comfy.error = String(error.message || error).slice(0, 300);
  }
  const [ffmpeg, ffprobe] = await Promise.all([commandStatus('ffmpeg'), commandStatus('ffprobe')]);
  return {
    checked_at: new Date().toISOString(),
    scope: ['workflow_discovery', 'json_parse', 'comfyui_health', 'node_compatibility', 'ffmpeg_export', 'ffprobe_validation'],
    workflow_files: files,
    workflow_count: files.length,
    invalid_json_count: files.filter((file) => !file.valid_json).length,
    required_node_types: [...requiredNodeTypes],
    comfyui: comfy,
    ffmpeg,
    ffprobe,
    generation_queued: false,
    output_file_created: false,
    non_destructive: true,
    uncovered: ['interactive_editor_ui', 'real_generation_queue', 'rendered_output_quality', 'automatic_publication'],
  };
}

function taskSnapshotResponse(snapshot) {
  const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
  const syncedAt = snapshot?.synced_at ? ` (synchronisée le ${snapshot.synced_at})` : '';
  if (!tasks.length) {
    return `Aucune liste de tâches n’est disponible dans la copie locale${syncedAt}. Reconnectez brièvement le Cockpit pour la synchroniser, puis cette liste restera consultable hors connexion.`;
  }
  const pending = tasks.filter((task) => !['terminee', 'terminée', 'completed', 'done', 'annulee', 'annulée', 'cancelled'].includes(String(task.statut || task.status || '').toLowerCase()));
  if (!pending.length) return `La copie locale${syncedAt} ne contient aucune tâche restant à effectuer.`;
  const lines = pending.slice(0, 50).map((task, index) => {
    const title = String(task.titre || task.title || task.nom || `Tâche ${index + 1}`).trim();
    const status = String(task.statut || task.status || 'à faire').trim();
    const priority = String(task.priorite || task.priority || '').trim();
    return `${index + 1}. ${title} — statut: ${status}${priority ? ` — priorité: ${priority}` : ''}`;
  });
  return `Tâches restant à effectuer d’après la copie locale${syncedAt} :\n\n${lines.join('\n')}`;
}

function requestsTaskAnalysis(message) {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(?:analyse|regroupe|classe|priorise)\b/.test(text) && /\btaches?\b/.test(text);
}

function taskGroup(task) {
  const text = `${task.titre || task.title || ''} ${task.description || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/video|comfy|minimax|workflow|api/.test(text)) return 'Vidéo IA et workflows locaux';
  if (/client|facture|societe|asbl|tva/.test(text)) return 'Données clients et facturation';
  if (/avatar|companion|elynea|nova/.test(text)) return 'Assistant et avatar local';
  if (/documentation/.test(text)) return 'Documentation';
  return 'Autres tâches';
}

function normalizedTaskText(task) {
  return `${task.titre || task.title || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonicalTaskKey(task) {
  const text = normalizedTaskText(task);
  if (/ajouter.*completer.*clients?/.test(text)) return 'clients-completer';
  if (/analyser.*factures?/.test(text)) return 'factures-analyser';
  if (/rattachement.*clients?.*(?:sites?|societes?|asbl)/.test(text)) return 'clients-rattachements';
  if (/mise a jour.*synergie dour/.test(text)) return 'synergie-dour-informations';
  if (/minimax h3.*local/.test(text)) return 'video-minimax-h3-local';
  if (/campagne.*tests?.*video ia/.test(text)) return 'video-campagne-tests';
  if (/documentation.*workflows?.*locaux/.test(text)) return 'video-documentation-workflows';
  if (/etat.*api.*video ia/.test(text)) return 'video-api-etat';
  if (/persistance.*workflows?.*video ia/.test(text)) return 'video-workflows-persistance';
  if (/fonctionnalites.*non operationnelles.*video ia/.test(text)) return 'video-fonctionnalites-manquantes';
  return text;
}

function taskAnalysisResponse(snapshot) {
  const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
  if (!tasks.length) return taskSnapshotResponse(snapshot);
  const now = Date.now();
  const active = tasks.filter((task) => !['terminee', 'terminée', 'completed', 'done', 'annulee', 'annulée', 'cancelled'].includes(String(task.statut || task.status || '').toLowerCase()));
  const ranked = active.map((task) => {
    const due = Date.parse(task.date_echeance || task.due_date || '');
    const overdue = Number.isFinite(due) && due < now;
    const group = taskGroup(task);
    return { task, overdue, group, count: 1 };
  });
  const deduplicated = new Map();
  for (const item of ranked) {
    const key = canonicalTaskKey(item.task);
    const existing = deduplicated.get(key);
    if (existing) {
      existing.count += 1;
      existing.overdue ||= item.overdue;
    } else {
      deduplicated.set(key, { ...item });
    }
  }
  const unique = [...deduplicated.values()].sort((a, b) => Number(b.overdue) - Number(a.overdue));
  const grouped = new Map();
  for (const item of unique) grouped.set(item.group, [...(grouped.get(item.group) || []), item]);
  const lines = [];
  let index = 1;
  for (const [group, items] of grouped) {
    lines.push(`\n${group}:`);
    for (const item of items) {
      const title = String(item.task.titre || item.task.title || `Tâche ${index}`).trim();
      lines.push(`${index}. ${title}${item.count > 1 ? ` — ${item.count} occurrences regroupées` : ''}${item.overdue ? ' — EN RETARD' : ''}`);
      index += 1;
    }
  }
  return `Analyse factuelle de ${ranked.length} enregistrement(s) non terminé(s), regroupés en ${unique.length} tâche(s) unique(s).${lines.join('\n')}\n\nExécutions réelles lancées: 0. Aucun tool_run n’a été créé automatiquement. Outils disponibles: ffmpeg_version, ffprobe_file, list_directory, find_local_workflows, comfyui_health et http_diagnose. Les diagnostics doivent être demandés explicitement pour produire un journal vérifiable; aucune tâche n’est marquée terminée sans résultat réel.`;
}

function localTaskPlan(task) {
  const text = `${task?.titre || task?.title || ''} ${task?.description || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/fonctionnalites.*non operationnelles.*(?:video|module video)/.test(text)) return ['find_local_workflows', 'comfyui_health', 'ffmpeg_version'];
  if (/campagne.*tests?.*video ia/.test(text)) return ['video_pipeline_audit'];
  if (/mettre a jour.*documentation.*workflows?.*locaux/.test(text)) return ['workflow_documentation_audit'];
  if (/(achever|finaliser).*(avatar|js innov ia).*local/.test(text)) return ['avatar_factory_status'];
  if (/(achever|finaliser|corriger|modifier)/.test(text)) return null;
  if (/verifi.*(?:workflow|minimax)|absence.*(?:workflow|minimax)/.test(text)) return ['find_local_workflows', 'comfyui_health'];
  if (/control.*(?:persistance|workflow)/.test(text)) return ['find_local_workflows'];
  if (/control.*(?:api video|comfyui|port 8188)/.test(text)) return ['comfyui_health'];
  return null;
}

async function executeLocalTaskAutopilot(snapshot) {
  const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
  const pending = tasks.filter((task) => !['terminee', 'terminée', 'completed', 'done', 'annulee', 'annulée', 'cancelled'].includes(String(task.statut || task.status || '').toLowerCase()));
  const seen = new Set();
  const cache = new Map();
  const taskResults = [];
  for (const task of pending) {
    const key = canonicalTaskKey(task);
    if (seen.has(key)) continue;
    seen.add(key);
    const tools = localTaskPlan(task);
    if (!tools) continue;
    const toolRuns = [];
    for (const tool of tools) {
      if (!cache.has(tool)) cache.set(tool, await executeTool(tool, {}));
      toolRuns.push(cache.get(tool));
    }
    let completed = toolRuns.every((run) => run.success);
    let reason = completed ? null : 'outil_local_en_echec';
    if (tools.includes('avatar_factory_status')) {
      const statusRun = toolRuns.find((run) => run.tool === 'avatar_factory_status');
      let statusPayload = null;
      try { statusPayload = JSON.parse(statusRun?.output || '{}'); } catch {}
      const latestStatus = String(statusPayload?.latest?.status || 'absent').toLowerCase();
      completed = statusRun?.success === true && latestStatus === 'completed';
      reason = completed ? null : `avatar_factory_${latestStatus}`;
    }
    taskResults.push({ task_id: task.id, title: task.titre || task.title, completed, reason, tools, tool_runs: toolRuns.map((run) => ({ id: run.id, tool: run.tool, started_at: run.started_at, completed_at: run.completed_at, success: run.success, exit_code: run.exit_code, output: String(run.output || '').slice(0, 12000) })) });
  }
  return { run_id: `local-autopilot-${crypto.randomUUID()}`, examined: pending.length, executed: taskResults.length, task_results: taskResults };
}

async function health() {
  let ollamaOnline = false;
  let models = [];
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const payload = await response.json();
    ollamaOnline = response.ok;
    models = (payload.models || []).map((item) => item.name);
  } catch {}
  const [ffmpeg, ffprobe] = await Promise.all([commandStatus('ffmpeg'), commandStatus('ffprobe')]);
  return { ok: true, agent: { name: 'Elynea Local Tools', version: VERSION, mode: 'local-first', approvalGate: true }, services: { ollama: { online: ollamaOnline, url: OLLAMA_URL, models }, ffmpeg, ffprobe }, telemetry: await currentTelemetrySnapshot(), tools: [{ name: 'ffmpeg_version', mode: 'read_only', available: ffmpeg.online }, { name: 'ffprobe_file', mode: 'read_only', available: ffprobe.online }, { name: 'list_directory', mode: 'read_only', available: ALLOWED_ROOTS.length > 0 }, { name: 'find_local_workflows', mode: 'read_only', available: ALLOWED_ROOTS.length > 0 }, { name: 'workflow_documentation_audit', mode: 'read_only', available: ALLOWED_ROOTS.length > 0 }, { name: 'video_pipeline_audit', mode: 'read_only', available: ALLOWED_ROOTS.length > 0 }, { name: 'comfyui_health', mode: 'read_only', available: true }, { name: 'avatar_factory_status', mode: 'read_only', available: true }, { name: 'http_diagnose', mode: 'read_only', available: true }], allowed_roots: ALLOWED_ROOTS, allowed_http_hosts: [...ALLOWED_HTTP_HOSTS] };
}

function toolResponse(run) {
  const intro = run.success ? 'Action locale réellement exécutée.' : 'L’action locale a échoué.';
  const raw = String(run.output || '').replace(/```/g, '``\\`');
  return `${intro} Outil: ${run.tool}. Heure: ${run.started_at}. Code de sortie: ${run.exit_code ?? 'indisponible'}. Journal: ${run.id}.\n\nSortie brute:\n\n\u0060\u0060\u0060text\n${raw}\n\u0060\u0060\u0060`;
}

const musicMotionProduction = createMusicMotionService({ root: logDir, send, headersFor, readJson, isAllowedOrigin, ollama });

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(req, res, 204, {});
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const publicReadOnlyPath = url.pathname === '/health' || url.pathname === '/api/telemetry/current' || url.pathname === '/api/telemetry/summary';
    if (TOKEN && !publicReadOnlyPath && req.headers.authorization !== `Bearer ${TOKEN}`) return send(req, res, 401, { ok: false, error: 'unauthorized' });
    if (await musicMotionProduction(req, res, url)) return;
    if (req.method === 'GET' && url.pathname === '/health') return send(req, res, 200, await health());
    if (req.method === 'GET' && url.pathname === '/api/telemetry/current') {
      return send(req, res, 200, { ok: true, telemetry: await currentTelemetrySnapshot() });
    }
    if (req.method === 'GET' && url.pathname === '/api/telemetry/summary') {
      const startedAt = url.searchParams.get('started_at') || null;
      const completedAt = url.searchParams.get('completed_at') || null;
      const runtimeSeconds = Math.max(0, Number(url.searchParams.get('runtime_seconds') || 0));
      return send(req, res, 200, { ok: true, telemetry: telemetrySummary(startedAt, completedAt, runtimeSeconds) });
    }
    if (req.method === 'GET' && url.pathname === '/api/agent/models') return send(req, res, 200, { models: (await health()).services.ollama.models });
    if (req.method === 'GET' && url.pathname === '/api/tools') return send(req, res, 200, await health());
    if (req.method === 'POST' && url.pathname === '/api/music-motion/analyze') {
      const body = await readJson(req, 20 * 1024 * 1024);
      return send(req, res, 200, await analyzeMusicMotion(body));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/tools/runs/')) {
      const run = runs.get(url.pathname.split('/').pop());
      return run ? send(req, res, 200, { ok: true, run }) : send(req, res, 404, { ok: false, error: 'run_not_found' });
    }
    if (req.method === 'POST' && url.pathname === '/api/tools/execute') {
      const body = await readJson(req);
      const run = await executeTool(body.tool, body.args || {});
      return send(req, res, run.success ? 200 : 422, { ok: run.success, run });
    }
    if (req.method === 'POST' && url.pathname === '/api/tasks/autopilot') {
      const body = await readJson(req);
      return send(req, res, 200, { ok: true, ...(await executeLocalTaskAutopilot(body.task_snapshot)) });
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/chat') {
      const body = await readJson(req);
      if (!body.message) return send(req, res, 400, { ok: false, error: 'message_required' });
      const requests = requestedTools(body.message);
      if (requests.length) {
        const toolRuns = [];
        for (const request of requests) toolRuns.push(await executeTool(request.tool, request.args));
        const response = toolRuns.map((run) => toolResponse(run)).join('\n\n---\n\n');
        return send(req, res, 200, { ok: toolRuns.every((run) => run.success), response, tool_run: toolRuns.length === 1 ? toolRuns[0] : undefined, tool_runs: toolRuns });
      }
      if (requestsTaskAnalysis(body.message)) {
        return send(req, res, 200, { ok: true, response: taskAnalysisResponse(body.context?.task_snapshot), mode: 'local', source: 'local_task_analysis', tool_runs: [] });
      }
      if (requestsTaskList(body.message)) {
        return send(req, res, 200, { ok: true, response: taskSnapshotResponse(body.context?.task_snapshot), mode: 'local', source: 'local_task_snapshot' });
      }
      const taskContext = body.context?.task_snapshot
        ? JSON.stringify(body.context.task_snapshot).slice(0, 30000)
        : 'Aucune copie locale de tâches disponible.';
      const recentMediaContext = body.context?.recent_media
        ? JSON.stringify(body.context.recent_media).slice(0, 5000)
        : 'Aucun média récent.';
      const prompt = `${body.system_prompt || 'Tu es Elynea, assistante locale JS-Innov.IA.'}\nOutils réels: ffmpeg_version, ffprobe_file, list_directory, find_local_workflows, workflow_documentation_audit, video_pipeline_audit, comfyui_health, avatar_factory_status, http_diagnose. N’invente jamais une exécution. Ne prétends jamais avoir exécuté un outil sans tool_run réel. Si une tâche exige un outil absent, marque-la bloquée et précise l’outil manquant.\nCopie locale des tâches: ${taskContext}\nMédia récent actif: ${recentMediaContext}. La demande suivante peut concerner ce média; ne dis pas qu’aucun média n’existe quand ce contexte est présent.\nHistorique: ${JSON.stringify(Array.isArray(body.history) ? body.history.slice(-20) : []).slice(0, 20000)}\nUtilisateur: ${String(body.message).slice(0, 4000)}\nElynea:`;
      const response = await ollama(prompt, body.model);
      if (!response) {
        return send(req, res, 200, { ok: true, response: 'Elynea locale n’a produit aucune réponse exploitable. Reformulez la demande ou précisez le fichier, le dossier ou l’action souhaitée.', model: body.model || DEFAULT_MODEL, mode: 'local', empty_model_response: true });
      }
      return send(req, res, 200, { ok: true, response, model: body.model || DEFAULT_MODEL, mode: 'local' });
    }
    if (req.method === 'POST' && url.pathname === '/architect/analyze') {
      const body = await readJson(req);
      if (!body.request) return send(req, res, 400, { ok: false, error: 'request_required' });
      const raw = await ollama(`Tu es Elynea, architecte locale. Analyse sans modifier. Toute écriture exige validation.\n${body.request}\n${JSON.stringify(body.context || {}).slice(0, 20000)}`, body.model);
      let plan; try { plan = JSON.parse(raw); } catch { plan = { summary: raw, tasks: [] }; }
      const id = crypto.randomUUID(); approvals.set(id, { id, status: 'pending', createdAt: new Date().toISOString(), request: body.request, plan });
      return send(req, res, 200, { ok: true, analysisId: id, status: 'pending_validation', plan });
    }
    if (req.method === 'GET' && url.pathname === '/validations') return send(req, res, 200, { ok: true, items: [...approvals.values()] });
    const validation = url.pathname.match(/^\/validations\/([^/]+)\/(approve|reject)$/);
    if (req.method === 'POST' && validation) {
      const item = approvals.get(validation[1]); if (!item) return send(req, res, 404, { ok: false, error: 'not_found' });
      item.status = validation[2] === 'approve' ? 'approved' : 'rejected'; item[`${item.status}At`] = new Date().toISOString();
      return send(req, res, 200, { ok: true, item });
    }
    return send(req, res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    return send(req, res, error.status || 500, { ok: false, error: error.message || 'local_agent_error' });
  }
});

if (process.env.LOCAL_AGENT_NO_LISTEN !== '1') {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Elynea Local Tools v${VERSION} http://127.0.0.1:${PORT}`);
    void collectTelemetrySnapshot();
    const telemetryTimer = setInterval(() => void collectTelemetrySnapshot(), TELEMETRY_INTERVAL_MS);
    telemetryTimer.unref();
    void ensureComfyUi();
  });
}
export { executeTool, pathInsideAllowedRoot, requestedTool, requestedTools, requestsTaskList, taskSnapshotResponse, requestsTaskAnalysis, taskAnalysisResponse, canonicalTaskKey, localTaskPlan, executeLocalTaskAutopilot, auditVideoPipeline, comfyUiLaunchSpec, ensureComfyUi, collectTelemetrySnapshot, summarizeTelemetrySamples, estimateSystemPower, telemetrySummary };
