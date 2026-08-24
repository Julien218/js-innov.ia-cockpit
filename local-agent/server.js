import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFile, readdir, stat } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.LOCAL_AGENT_PORT || 8787);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:4b';
const TOKEN = String(process.env.LOCAL_AGENT_TOKEN || '').trim();
const VERSION = '1.1.0';
const MAX_BODY = 5 * 1024 * 1024;
const approvals = new Map();
const runs = new Map();
const execOptions = { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 };
const ALLOWED_ORIGINS = new Set(['https://cockpit.jsinnovia.com']);

const configuredRoots = String(process.env.LOCAL_AGENT_ALLOWED_ROOTS || '').split(path.delimiter).map((v) => v.trim()).filter(Boolean);
const defaultRoots = ['Downloads', 'Documents', 'Videos'].map((name) => path.join(os.homedir(), name)).filter(existsSync);
const ALLOWED_ROOTS = [...new Set((configuredRoots.length ? configuredRoots : defaultRoots).map((v) => path.resolve(v)))];
const logDir = process.env.LOCAL_AGENT_LOG_DIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'JS-InnovIA', 'AI-Factory');
mkdirSync(logDir, { recursive: true });
const runLogPath = path.join(logDir, 'tool-runs.jsonl');

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

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('payload_too_large'), { status: 413 });
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

async function executeTool(tool, args = {}) {
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let command;
  let commandArgs;

  if (tool === 'ffmpeg_version') {
    command = 'ffmpeg'; commandArgs = ['-version'];
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
  const response = await fetch(`${OLLAMA_URL}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt, stream: false }), signal: AbortSignal.timeout(120000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `Ollama ${response.status}`);
  return String(payload.response || '').trim();
}

function requestedTool(message) {
  const text = String(message || '');
  if (/ffmpeg\s+-version|version\s+(?:de\s+)?ffmpeg|teste?.*ffmpeg/i.test(text)) return { tool: 'ffmpeg_version', args: {} };
  const localPath = text.match(/["“](.+?)["”]/)?.[1] || text.match(/([A-Za-z]:\\[^\r\n]+)/)?.[1];
  if (/ffprobe|m[eé]tadonn[eé]es?|analyse.*(?:vid[eé]o|fichier)/i.test(text) && localPath) return { tool: 'ffprobe_file', args: { path: localPath.trim() } };
  if (/(?:liste|contenu).*(?:dossier|fichiers?)/i.test(text) && localPath) return { tool: 'list_directory', args: { path: localPath.trim() } };
  return null;
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
  return { ok: true, agent: { name: 'NOVA Local Tools', version: VERSION, mode: 'local-first', approvalGate: true }, services: { ollama: { online: ollamaOnline, url: OLLAMA_URL, models }, ffmpeg, ffprobe }, tools: [{ name: 'ffmpeg_version', mode: 'read_only', available: ffmpeg.online }, { name: 'ffprobe_file', mode: 'read_only', available: ffprobe.online }, { name: 'list_directory', mode: 'read_only', available: ALLOWED_ROOTS.length > 0 }], allowed_roots: ALLOWED_ROOTS };
}

function toolResponse(run) {
  const intro = run.success ? 'Action locale réellement exécutée.' : 'L’action locale a échoué.';
  return `${intro} Outil: ${run.tool}. Heure: ${run.started_at}. Code de sortie: ${run.exit_code ?? 'indisponible'}. Journal: ${run.id}.\n\nSortie brute:\n${run.output}`;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(req, res, 204, {});
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (TOKEN && url.pathname !== '/health' && req.headers.authorization !== `Bearer ${TOKEN}`) return send(req, res, 401, { ok: false, error: 'unauthorized' });
    if (req.method === 'GET' && url.pathname === '/health') return send(req, res, 200, await health());
    if (req.method === 'GET' && url.pathname === '/api/agent/models') return send(req, res, 200, { models: (await health()).services.ollama.models });
    if (req.method === 'GET' && url.pathname === '/api/tools') return send(req, res, 200, await health());
    if (req.method === 'GET' && url.pathname.startsWith('/api/tools/runs/')) {
      const run = runs.get(url.pathname.split('/').pop());
      return run ? send(req, res, 200, { ok: true, run }) : send(req, res, 404, { ok: false, error: 'run_not_found' });
    }
    if (req.method === 'POST' && url.pathname === '/api/tools/execute') {
      const body = await readJson(req);
      const run = await executeTool(body.tool, body.args || {});
      return send(req, res, run.success ? 200 : 422, { ok: run.success, run });
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/chat') {
      const body = await readJson(req);
      if (!body.message) return send(req, res, 400, { ok: false, error: 'message_required' });
      const request = requestedTool(body.message);
      if (request) {
        const run = await executeTool(request.tool, request.args);
        return send(req, res, 200, { ok: run.success, response: toolResponse(run), tool_run: run });
      }
      const prompt = `${body.system_prompt || 'Tu es NOVA, assistant local JS-Innov.IA.'}\nOutils réels: ffmpeg_version, ffprobe_file, list_directory. N’invente jamais une exécution.\nHistorique: ${JSON.stringify(Array.isArray(body.history) ? body.history.slice(-20) : []).slice(0, 20000)}\nUtilisateur: ${String(body.message).slice(0, 4000)}\nNOVA:`;
      const response = await ollama(prompt, body.model);
      return send(req, res, 200, { ok: true, response, model: body.model || DEFAULT_MODEL, mode: 'local' });
    }
    if (req.method === 'POST' && url.pathname === '/architect/analyze') {
      const body = await readJson(req);
      if (!body.request) return send(req, res, 400, { ok: false, error: 'request_required' });
      const raw = await ollama(`Tu es NOVA architecte locale. Analyse sans modifier. Toute écriture exige validation.\n${body.request}\n${JSON.stringify(body.context || {}).slice(0, 20000)}`, body.model);
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
  server.listen(PORT, '127.0.0.1', () => console.log(`NOVA Local Tools v${VERSION} http://127.0.0.1:${PORT}`));
}
export { executeTool, pathInsideAllowedRoot, requestedTool };
