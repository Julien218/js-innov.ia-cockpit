const { app, BrowserWindow, shell, ipcMain, Notification, Tray, Menu } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const https = require("https");
const { execFile } = require("child_process");
const crypto = require("crypto");
const { createWebAssistant } = require("./web-assistant.cjs");
const { formatComfyErrorBody } = require("./comfy-error.cjs");
const { routeJarvis } = require("./elynea-tool-router.cjs");
const { createJarvisExecutor } = require("./elynea-jarvis-executor.cjs");

let mainWindow = null;
let tray = null;
let splashTimer = null;
let offlineFallbackActive = false;
let remoteRenderRecoveryAttempts = 0;
const REMOTE_COCKPIT_URL = "https://cockpit.jsinnovia.com";
const OFFLINE_COCKPIT_URL = "http://127.0.0.1:8790";
const OFFLINE_STORAGE_KEYS = ["cockpit_session_user", "nova_local_task_snapshot_v1", "agent_chat_messages", "agent_conversation_id", "agent_tts_enabled"];
let offlineStorageHydrated = false;
const webAssistant = createWebAssistant({ app, getParentWindow: () => mainWindow });

function offlineSessionPath() {
  return path.join(app.getPath("userData"), "offline-session.json");
}

async function captureOfflineSession(win) {
  if (!isAlive(win) || !win.webContents.getURL().startsWith(REMOTE_COCKPIT_URL)) return;
  try {
    const snapshot = await win.webContents.executeJavaScript(`Object.fromEntries(${JSON.stringify(OFFLINE_STORAGE_KEYS)}.map((key) => [key, localStorage.getItem(key)]).filter(([, value]) => value !== null))`);
    fs.writeFileSync(offlineSessionPath(), JSON.stringify(snapshot), "utf8");
    console.log("Session Cockpit préparée pour le mode hors ligne.");
  } catch (error) {
    console.log(`Sauvegarde de session hors ligne ignorée: ${error.message}`);
  }
}

async function hydrateOfflineSession(win) {
  if (offlineStorageHydrated || !isAlive(win) || !win.webContents.getURL().startsWith(OFFLINE_COCKPIT_URL)) return;
  offlineStorageHydrated = true;
  try {
    const snapshot = JSON.parse(fs.readFileSync(offlineSessionPath(), "utf8"));
    await win.webContents.executeJavaScript(`for (const [key, value] of Object.entries(${JSON.stringify(snapshot)})) { if (typeof value === 'string') localStorage.setItem(key, value); }`);
    win.webContents.reload();
  } catch (error) {
    console.log(`Aucune session hors ligne à restaurer: ${error.message}`);
  }
}

// ── Version actuelle de l'app ────────────────────────────────────────────────
const APP_VERSION = app.getVersion();

const LOCAL_AGENT_PORTS = [8788, 8787];
const LOCAL_AGENT_TOKEN = String(process.env.LOCAL_AGENT_TOKEN || "").trim();

function trustedCockpitCaller(event) {
  const caller = String(event.senderFrame?.url || event.sender?.getURL?.() || "");
  return caller.startsWith(REMOTE_COCKPIT_URL) || caller.startsWith(OFFLINE_COCKPIT_URL);
}

function localAgentRequest(port, pathname, { method = "GET", json, body, contentType, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = json !== undefined ? Buffer.from(JSON.stringify(json)) : body;
    const headers = {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(contentType ? { "Content-Type": contentType } : {}),
      ...(payload ? { "Content-Length": payload.length } : {}),
      ...(LOCAL_AGENT_TOKEN ? { Authorization: `Bearer ${LOCAL_AGENT_TOKEN}` } : {}),
    };
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; }
        catch {
          reject(new Error(`Agent local ${port} : réponse non JSON (HTTP ${res.statusCode}).`));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(data.error || data.message || `Agent local ${port} : HTTP ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
    });
    req.on("timeout", () => req.destroy(new Error(`Agent local ${port} : délai dépassé.`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function transcribeLocalVoiceBytes(bytes, mimeType = "audio/webm") {
  const audio = Buffer.isBuffer(bytes)
    ? bytes
    : bytes instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(bytes))
      : Buffer.from(bytes || []);
  if (!audio.length) throw new Error("Enregistrement micro vide.");
  if (audio.length > 12 * 1024 * 1024) throw new Error("Enregistrement micro trop volumineux.");

  const failures = [];
  for (const port of LOCAL_AGENT_PORTS) {
    try {
      const health = await localAgentRequest(port, "/health", { timeoutMs: 3000 });
      if (!health?.ok) throw new Error("agent non prêt");
      const capabilities = await localAgentRequest(port, "/api/music-motion/production/capabilities", { timeoutMs: 25000 });
      if (capabilities?.transcription !== true) {
        throw new Error("Whisper local n’est pas installé ou n’est pas détecté");
      }

      const extension = String(mimeType || "").includes("ogg") ? "ogg" : "webm";
      const asset = await localAgentRequest(
        port,
        `/api/music-motion/production/assets?name=${encodeURIComponent(`elynea-voice-${Date.now()}.${extension}`)}`,
        { method: "POST", body: audio, contentType: mimeType || "audio/webm", timeoutMs: 30000 },
      );
      if (!asset?.id) throw new Error("identifiant audio absent");

      let job = await localAgentRequest(port, "/api/music-motion/production/jobs", {
        method: "POST",
        json: { type: "analyze", audio_id: asset.id, instrumental: false },
        timeoutMs: 30000,
      });
      if (!job?.id) throw new Error("tâche de transcription absente");

      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        if (job.status === "completed") {
          const transcript = String(job.result?.transcription?.transcript || "").trim();
          if (!transcript) throw new Error("Whisper n’a détecté aucune parole exploitable");
          return {
            transcript,
            endpoint: `http://127.0.0.1:${port}`,
            device: job.result?.transcription?.device || null,
            fallbackUsed: Boolean(job.result?.transcription?.fallback_used),
          };
        }
        if (job.status === "failed" || job.status === "cancelled") {
          throw new Error(job.error || `transcription ${job.status}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        job = await localAgentRequest(
          port,
          `/api/music-motion/production/jobs/${encodeURIComponent(job.id)}`,
          { timeoutMs: 15000 },
        );
      }
      throw new Error("délai de transcription dépassé");
    } catch (error) {
      failures.push(`${port}: ${String(error?.message || error)}`);
    }
  }
  throw new Error(`Elynea locale injoignable. ${failures.join(" | ")}`);
}

// ── Local Video Bridge — loopback uniquement ────────────────────────────────
const COMFYUI_HOST = "127.0.0.1";
const COMFYUI_PORT = Number(process.env.JSINNOVIA_COMFYUI_PORT || 8188);

function comfyRequest(pathname, { method = "GET", json, body, headers = {}, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = json !== undefined ? Buffer.from(JSON.stringify(json)) : body;
    const req = http.request({
      host: COMFYUI_HOST,
      port: COMFYUI_PORT,
      path: pathname,
      method,
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(payload ? { "Content-Length": payload.length } : {}),
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed = raw;
        try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { /* texte brut */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const detail = formatComfyErrorBody(parsed);
        reject(new Error(`ComfyUI HTTP ${res.statusCode} (${method} ${pathname}): ${detail || "erreur inconnue"}`));
      });
    });
    req.on("timeout", () => req.destroy(new Error("ComfyUI timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function workflowNodeEntries(workflow) {
  return Object.entries(workflow || {}).filter(([, node]) => (
    node
    && typeof node === "object"
    && typeof node.class_type === "string"
    && node.inputs
    && typeof node.inputs === "object"
  ));
}

async function validateComfyWorkflow(workflow) {
  const entries = workflowNodeEntries(workflow);
  if (!entries.length) throw new Error("Workflow ComfyUI API vide ou invalide.");

  const objectInfo = await comfyRequest("/object_info", { timeoutMs: 15000 });
  const available = new Set(Object.keys(objectInfo && typeof objectInfo === "object" ? objectInfo : {}));
  const missing = [...new Set(entries.map(([, node]) => node.class_type))].filter((type) => {
    if (available.has(type)) return false;
    return !/minimax.*h3|h3.*minimax/i.test(type)
      || ![...available].some((name) => name === type || name.includes(type) || type.includes(name));
  });
  if (missing.length) {
    throw new Error(
      `Workflow incompatible avec ComfyUI : nœud(s) absent(s) ${missing.join(", ")}. `
      + "Installe le nœud H3 requis puis réimporte le workflow au format API.",
    );
  }
  return { nodeTypes: [...new Set(entries.map(([, node]) => node.class_type))] };
}

function commandAvailable(command, args = ["--version"]) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 4000 }, (error, stdout, stderr) => {
      resolve({
        online: !error,
        version: !error ? String(stdout || stderr || "").split(/\r?\n/)[0].trim() : "",
        error: error ? error.message : "",
      });
    });
  });
}

function videoProvenanceCore() {
  const location = app.isPackaged
    ? path.join(process.resourcesPath, "video-provenance-core.cjs")
    : path.join(__dirname, "..", "server-video-provenance-core.cjs");
  return require(location);
}

function execFileStrict(command, args, timeout = 20 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`${command}: ${String(stderr || error.message).slice(0, 4000)}`));
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function comfyOutputCandidates() {
  return [
    process.env.JSINNOVIA_COMFYUI_OUTPUT_DIR,
    path.join(os.homedir(), "AI", "ComfyUI_windows_portable", "ComfyUI_windows_portable", "ComfyUI", "output"),
    path.join(os.homedir(), "ComfyUI_windows_portable", "ComfyUI", "output"),
    path.join(os.homedir(), "ComfyUI", "output"),
    path.join(os.homedir(), "AppData", "Local", "Comfy-Desktop", "ComfyUI-Shared", "output"),
  ].filter(Boolean);
}

function comfyInputCandidates() {
  return [
    process.env.JSINNOVIA_COMFYUI_INPUT_DIR,
    path.join(os.homedir(), "AI", "ComfyUI_windows_portable", "ComfyUI_windows_portable", "ComfyUI", "input"),
    path.join(os.homedir(), "ComfyUI_windows_portable", "ComfyUI", "input"),
    path.join(os.homedir(), "ComfyUI", "input"),
    path.join(os.homedir(), "AppData", "Local", "Comfy-Desktop", "ComfyUI-Shared", "input"),
  ].filter(Boolean);
}

function safeLocalName(value, fallback = "A-Classer") {
  const cleaned = String(value || "").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function resolveComfyOutputFile(output = {}) {
  const filename = String(output.filename || "");
  if (!filename) throw new Error("Sortie ComfyUI sans nom de fichier.");
  const subfolder = String(output.subfolder || "");
  for (const rootCandidate of comfyOutputCandidates()) {
    const root = path.resolve(rootCandidate);
    const candidate = path.resolve(root, subfolder, filename);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Fichier ComfyUI introuvable: ${filename}. Configure JSINNOVIA_COMFYUI_OUTPUT_DIR si nécessaire.`);
}

function resolveComfyInputFile(filename) {
  const name = String(filename || "");
  if (!name) return "";
  for (const rootCandidate of comfyInputCandidates()) {
    const root = path.resolve(rootCandidate);
    const candidate = path.resolve(root, name);
    if (!candidate.startsWith(`${root}${path.sep}`)) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return "";
}

function reviewDrawtext(label, size = 82) {
  return `drawtext=${videoProvenanceCore().drawtextFontOption()}text='${label}':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=(h-text_h)/2`;
}

async function createLocalReviewVideo(batch) {
  await refreshLocalVideoBatch(batch);
  const completed = batch.jobs
    .filter((job) => job.status === "completed")
    .slice(0, 3);
  if (completed.length < 3) throw new Error("Les trois premières propositions doivent être terminées.");

  const videoPaths = completed.map((job) => {
    const output = job.outputs.find((item) => item.kind === "videos")
      || job.outputs.find((item) => item.kind === "gifs")
      || job.outputs[0];
    return resolveComfyOutputFile(output);
  });

  const outputFolder = path.join(
    app.getPath("videos"),
    "JS-Innov.IA",
    "Validations",
    safeLocalName(batch.clientName),
    safeLocalName(batch.campaignName, "Ecran-geant"),
  );
  fs.mkdirSync(outputFolder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(outputFolder, `${safeLocalName(batch.clientName)}-3-propositions-${stamp}.mp4`);

  const args = [
    "-y",
    "-f", "lavfi", "-t", "3", "-i", "color=c=0x081426:s=1920x1080:r=25",
    "-f", "lavfi", "-t", "1.5", "-i", "color=c=0x081426:s=1920x1080:r=25",
    "-t", "8", "-i", videoPaths[0],
    "-f", "lavfi", "-t", "1.5", "-i", "color=c=0x081426:s=1920x1080:r=25",
    "-t", "8", "-i", videoPaths[1],
    "-f", "lavfi", "-t", "1.5", "-i", "color=c=0x081426:s=1920x1080:r=25",
    "-t", "8", "-i", videoPaths[2],
    "-f", "lavfi", "-t", "4", "-i", "color=c=0x081426:s=1920x1080:r=25",
    "-filter_complex",
    [
      `[0:v]${reviewDrawtext("3 PROPOSITIONS VISUELLES", 76)},format=yuv420p[v0]`,
      `[1:v]${reviewDrawtext("PROPOSITION 1")},format=yuv420p[v1]`,
      "[2:v]trim=duration=8,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,fps=25,format=yuv420p[v2]",
      `[3:v]${reviewDrawtext("PROPOSITION 2")},format=yuv420p[v3]`,
      "[4:v]trim=duration=8,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,fps=25,format=yuv420p[v4]",
      `[5:v]${reviewDrawtext("PROPOSITION 3")},format=yuv420p[v5]`,
      "[6:v]trim=duration=8,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,fps=25,format=yuv420p[v6]",
      `[7:v]${reviewDrawtext("CHOISISSEZ 1\\, 2 OU 3", 72)},format=yuv420p[v7]`,
      "[v0][v1][v2][v3][v4][v5][v6][v7]concat=n=8:v=1:a=0[outv]",
    ].join(";"),
    "-map", "[outv]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-r", "25", "-movflags", "+faststart",
    "-metadata", `title=Validation 3 propositions - ${batch.clientName || "Client"}`,
    "-metadata", "artist=JS-Innov.IA",
    "-metadata", "comment=Production locale cockpit; choix client 1, 2 ou 3",
    outputPath,
  ];
  await execFileStrict("ffmpeg", args, 30 * 60 * 1000);
  batch.review = {
    status: "ready",
    duration: 35.5,
    outputPath,
    createdAt: new Date().toISOString(),
    sourceJobIds: completed.map((job) => job.id),
    metadata: { creator: "JS-Innov.IA", workflow: "local-signage-review-v1" },
  };
  batch.updatedAt = new Date().toISOString();
  saveLocalVideoBatches();
  return { success: true, batchId: batch.id, ...batch.review };
}

ipcMain.handle("video-local-status", async () => {
  let comfyui = { online: false };
  let h3 = { available: false, requiredNode: "MiniMaxH3ImageToVideo", detectedPartnerNodes: [] };
  try {
    const stats = await comfyRequest("/system_stats", { timeoutMs: 3000 });
    comfyui = { online: true, stats };
    try {
      const nodes = await comfyRequest("/object_info", { timeoutMs: 15000 });
      const names = Object.keys(nodes && typeof nodes === "object" ? nodes : {});
      h3 = {
        available: names.some((name) => name === "MiniMaxH3ImageToVideo" || name.includes("MiniMaxH3ImageToVideo")),
        requiredNode: "MiniMaxH3ImageToVideo",
        detectedPartnerNodes: names.filter((name) => /minimax|hailuo/i.test(name) && !/MiniMaxH3ImageToVideo/.test(name)).slice(0, 20),
      };
    } catch (error) {
      h3 = { ...h3, error: error.message };
    }
  } catch (error) {
    comfyui = { online: false, error: error.message };
  }
  const ffmpeg = await commandAvailable("ffmpeg", ["-version"]);
  return { available: comfyui.online && ffmpeg.online && h3.available, comfyui, ffmpeg, h3, qualification: loadLocalVideoQualification(), endpoint: `http://${COMFYUI_HOST}:${COMFYUI_PORT}` };
});

ipcMain.handle("video-local-queue", async (_event, payload = {}) => {
  const workflow = payload.workflow;
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw new Error("Workflow ComfyUI API invalide.");
  }
  await validateComfyWorkflow(workflow);
  return comfyRequest("/prompt", {
    method: "POST",
    json: {
      prompt: workflow,
      client_id: String(payload.clientId || "jsinnovia-cockpit"),
    },
    timeoutMs: 15000,
  });
});

const MAX_LOCAL_VIDEO_BATCH = 32;
const localVideoBatches = new Map();
let localVideoBatchesLoaded = false;

function localVideoBatchStorePath() {
  return path.join(app.getPath("userData"), "local-video-batches.json");
}

function localVideoQualificationPath() {
  return path.join(app.getPath("userData"), "local-video-qualification.json");
}

function loadLocalVideoQualification() {
  try {
    const record = JSON.parse(fs.readFileSync(localVideoQualificationPath(), "utf8"));
    return record?.qualified === true ? record : { qualified: false };
  } catch (_) {
    return { qualified: false };
  }
}

function qualifyLocalVideoFactory(batch) {
  if (loadLocalVideoQualification().qualified) return;
  const firstThree = batch.jobs.slice(0, 3);
  if (firstThree.length !== 3 || !firstThree.every((job) => job.status === "completed" && Number(job.runtimeSeconds || 0) > 0)) return;
  fs.writeFileSync(localVideoQualificationPath(), JSON.stringify({
    qualified: true,
    qualifiedAt: new Date().toISOString(),
    batchId: batch.id,
    promptIds: firstThree.map((job) => job.promptId),
  }, null, 2), "utf8");
}

function loadLocalVideoBatches() {
  if (localVideoBatchesLoaded) return;
  localVideoBatchesLoaded = true;
  try {
    const records = JSON.parse(fs.readFileSync(localVideoBatchStorePath(), "utf8"));
    if (Array.isArray(records)) {
      records.forEach((batch) => {
        if (batch?.id && Array.isArray(batch.jobs)) localVideoBatches.set(batch.id, batch);
      });
    }
  } catch (_) { /* premier démarrage */ }
}

function saveLocalVideoBatches() {
  fs.writeFileSync(localVideoBatchStorePath(), JSON.stringify([...localVideoBatches.values()], null, 2), "utf8");
}

function comfyQueuePromptIds(items = []) {
  return new Set(items.map((item) => String(Array.isArray(item) ? item[1] : item?.prompt_id || "")).filter(Boolean));
}

async function queueNextLocalVideoJob(batch) {
  if (batch.jobs.some((job) => ["queueing", "queued", "running"].includes(job.status))) return;
  let record = batch.jobs.find((job) => job.status === "waiting");
  while (record) {
    record.status = "queueing";
    record.attempts = Number(record.attempts || 0) + 1;
    saveLocalVideoBatches();
    try {
      await validateComfyWorkflow(record.workflow);
      const queued = await comfyRequest("/prompt", {
        method: "POST",
        json: {
          prompt: record.workflow,
          client_id: String(record.clientId || "jsinnovia-signage-factory"),
        },
        timeoutMs: 15000,
      });
      record.promptId = String(queued?.prompt_id || queued?.promptId || "");
      if (!record.promptId) throw new Error("ComfyUI n’a pas retourné de prompt_id.");
      record.status = "queued";
      record.queuedAt = new Date().toISOString();
      batch.status = "running";
      batch.updatedAt = new Date().toISOString();
      saveLocalVideoBatches();
      return;
    } catch (error) {
      record.status = "failed";
      record.error = String(error.message || error).slice(0, 1000);
      record.completedAt = new Date().toISOString();
      record = batch.jobs.find((job) => job.status === "waiting");
    }
  }
}

async function refreshLocalVideoBatch(batch) {
  let queue = { queue_running: [], queue_pending: [] };
  try { queue = await comfyRequest("/queue", { timeoutMs: 10000 }); } catch (_) { /* historique encore exploitable */ }
  const running = comfyQueuePromptIds(queue.queue_running);
  const pending = comfyQueuePromptIds(queue.queue_pending);

  await Promise.all(batch.jobs.map(async (job) => {
    if (!job.promptId || ["failed", "cancelled", "completed"].includes(job.status)) return;
    try {
      const history = await comfyRequest(`/history/${encodeURIComponent(job.promptId)}`, { timeoutMs: 10000 });
      const result = videoProvenanceCore().parseComfyHistoryState(history, job.promptId);
      if (result.completed) {
        job.status = "completed";
        job.outputs = result.files;
        job.executionStartedAt = result.startedAt || job.executionStartedAt || null;
        job.completedAt = result.completedAt || new Date().toISOString();
        job.runtimeSeconds = result.runtimeSeconds || job.runtimeSeconds || null;
      } else if (result.failed) {
        job.status = "failed";
        job.error = result.error || "La génération ComfyUI a échoué.";
        job.executionStartedAt = result.startedAt || job.executionStartedAt || null;
        job.completedAt = result.completedAt || new Date().toISOString();
        job.runtimeSeconds = result.runtimeSeconds || job.runtimeSeconds || null;
      } else if (running.has(job.promptId)) {
        job.status = "running";
      } else if (pending.has(job.promptId)) {
        job.status = "queued";
      } else if (["queued", "running"].includes(job.status) && Date.now() - new Date(job.queuedAt || 0).getTime() > 30_000) {
        if (Number(job.attempts || 0) < 2) {
          job.status = "waiting";
          job.promptId = "";
          job.error = "File ComfyUI perdue après redémarrage; reprise automatique.";
        } else {
          job.status = "failed";
          job.error = "La file ComfyUI a disparu après deux tentatives.";
          job.completedAt = new Date().toISOString();
        }
      }
    } catch (error) {
      job.lastError = String(error.message || error).slice(0, 500);
    }
  }));

  await queueNextLocalVideoJob(batch);
  const terminal = batch.jobs.filter((job) => ["completed", "failed", "cancelled"].includes(job.status)).length;
  batch.progress = batch.jobs.length ? Math.round((terminal / batch.jobs.length) * 100) : 0;
  batch.status = terminal === batch.jobs.length ? "completed" : "running";
  if (batch.status === "completed") qualifyLocalVideoFactory(batch);
  batch.updatedAt = new Date().toISOString();
  saveLocalVideoBatches();
  return batch;
}

ipcMain.handle("video-local-batch-queue", async (_event, payload = {}) => {
  loadLocalVideoBatches();
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  if (!jobs.length) throw new Error("Ajoute au moins une vidéo au lot local.");
  if (jobs.length > MAX_LOCAL_VIDEO_BATCH) throw new Error(`Maximum ${MAX_LOCAL_VIDEO_BATCH} vidéos par lot local.`);
  if (jobs.length > 3 && !loadLocalVideoQualification().qualified) {
    throw new Error("Le Dell doit d’abord réussir un lot réel de trois vidéos avant d’autoriser jusqu’à 32 productions.");
  }

  const batchId = String(payload.batchId || `batch-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`);
  if (localVideoBatches.has(batchId)) throw new Error("Cet identifiant de lot existe déjà.");
  const batch = {
    id: batchId,
    title: String(payload.title || "Production écran géant"),
    clientName: String(payload.clientName || ""),
    clientId: String(payload.clientId || ""),
    projectId: String(payload.projectId || ""),
    costCenterId: String(payload.costCenterId || ""),
    campaignName: String(payload.campaignName || ""),
    sector: String(payload.sector || ""),
    usageRights: String(payload.usageRights || ""),
    rightsConfirmed: payload.rightsConfirmed === true,
    status: "queueing",
    progress: 0,
    concurrency: 1,
    maxJobs: MAX_LOCAL_VIDEO_BATCH,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jobs: [],
  };
  localVideoBatches.set(batchId, batch);
  saveLocalVideoBatches();

  for (let index = 0; index < jobs.length; index += 1) {
    const source = jobs[index] || {};
    const record = {
      id: String(source.id || `video-${index + 1}`),
      title: String(source.title || `Vidéo ${index + 1}`),
      prompt: String(source.prompt || ""),
      metadata: source.metadata && typeof source.metadata === "object" ? source.metadata : {},
      workflow: source.workflow,
      clientId: String(source.clientId || "jsinnovia-signage-factory"),
      status: "waiting",
      position: index + 1,
      promptId: "",
      attempts: 0,
      outputs: [],
    };
    batch.jobs.push(record);
    if (!source.workflow || typeof source.workflow !== "object" || Array.isArray(source.workflow)) {
      record.status = "failed";
      record.error = "Workflow ComfyUI API invalide.";
      record.completedAt = new Date().toISOString();
    }
    batch.updatedAt = new Date().toISOString();
    saveLocalVideoBatches();
  }

  await queueNextLocalVideoJob(batch);
  batch.status = batch.jobs.every((job) => ["completed", "failed", "cancelled"].includes(job.status)) ? "completed" : "running";
  saveLocalVideoBatches();
  return refreshLocalVideoBatch(batch);
});

ipcMain.handle("video-local-batch-status", async (_event, batchId) => {
  loadLocalVideoBatches();
  const batch = localVideoBatches.get(String(batchId || ""));
  if (!batch) throw new Error("Lot vidéo local introuvable.");
  return refreshLocalVideoBatch(batch);
});

ipcMain.handle("video-local-batch-list", async () => {
  loadLocalVideoBatches();
  const batches = [...localVideoBatches.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { batches: batches.slice(0, 50), maxJobs: MAX_LOCAL_VIDEO_BATCH };
});

ipcMain.handle("video-local-batch-cancel", async (_event, batchId) => {
  loadLocalVideoBatches();
  const batch = localVideoBatches.get(String(batchId || ""));
  if (!batch) throw new Error("Lot vidéo local introuvable.");
  const ids = batch.jobs.filter((job) => ["queueing", "queued", "running"].includes(job.status) && job.promptId).map((job) => job.promptId);
  try { await comfyRequest("/interrupt", { method: "POST", json: {}, timeoutMs: 5000 }); } catch (_) {}
  if (ids.length) {
    try { await comfyRequest("/queue", { method: "POST", json: { delete: ids }, timeoutMs: 10000 }); } catch (_) {}
  }
  batch.jobs.forEach((job) => {
    if (["waiting", "queueing", "queued", "running"].includes(job.status)) {
      job.status = "cancelled";
      job.completedAt = new Date().toISOString();
    }
  });
  batch.status = "cancelled";
  batch.progress = 100;
  batch.updatedAt = new Date().toISOString();
  saveLocalVideoBatches();
  return batch;
});

ipcMain.handle("video-local-history", async (_event, promptId) => {
  const id = encodeURIComponent(String(promptId || ""));
  if (!id) throw new Error("promptId manquant.");
  return comfyRequest(`/history/${id}`, { timeoutMs: 10000 });
});

ipcMain.handle("video-local-interrupt", async () => {
  return comfyRequest("/interrupt", { method: "POST", json: {}, timeoutMs: 5000 });
});

ipcMain.handle("video-local-upload-image", async (_event, payload = {}) => {
  const name = path.basename(String(payload.name || "input.png")).replace(/[^a-zA-Z0-9._-]/g, "_");
  const match = String(payload.dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("Image locale invalide ou format non supporté.");
  const mime = match[1];
  const file = Buffer.from(match[2], "base64");
  if (file.length > 50 * 1024 * 1024) throw new Error("Image trop volumineuse (50 MB max).");

  const boundary = `----JSInnovIA${Date.now().toString(16)}`;
  const parts = [];
  const push = (value) => parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  push(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`);
  push(file);
  push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput`);
  push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue`);
  push(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat(parts);

  return comfyRequest("/upload/image", {
    method: "POST",
    body,
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    timeoutMs: 30000,
  });
});

async function publishLocalVideoChoice(batch, position) {
  await refreshLocalVideoBatch(batch);
  const selectedPosition = Math.max(1, Math.min(3, Number(position) || 1));
  const job = batch.jobs[selectedPosition - 1];
  if (!job || job.status !== "completed") throw new Error(`La proposition ${selectedPosition} n’est pas terminée.`);
  const sourceOutput = job.outputs.find((item) => item.kind === "videos")
    || job.outputs.find((item) => item.kind === "gifs")
    || job.outputs[0];
  const sourcePath = resolveComfyOutputFile(sourceOutput);
  const logoPath = resolveComfyInputFile(job.metadata?.firstFrameName);
  const clientLabel = batch.clientName || job.metadata?.clientName || "CLIENT";
  const phoneLabel = job.metadata?.phone || "";
  if (!phoneLabel) throw new Error("Le numéro de téléphone exact est obligatoire pour l’écran final.");
  if (!batch.clientId) throw new Error("Le client Cockpit est obligatoire pour la traçabilité comptable.");

  const outputFolder = path.join(
    app.getPath("videos"),
    "JS-Innov.IA",
    "Ecran-geant",
    safeLocalName(batch.clientName),
    safeLocalName(batch.campaignName, "Campagne"),
  );
  fs.mkdirSync(outputFolder, { recursive: true });
  const core = videoProvenanceCore();
  const now = new Date();
  const metadata = core.buildVideoMetadata({
    clientId: batch.clientId,
    client: batch.clientName,
    campaign: batch.campaignName,
    campaignId: batch.id,
    creationDate: now.toISOString().slice(0, 10),
    validationDate: now.toISOString(),
    version: "v01",
    durationSeconds: 8,
    width: 1920,
    height: 1080,
    resolutionLabel: "1080p",
    prompt: job.prompt,
    sourceMedia: [job.metadata?.firstFrameName, path.basename(sourcePath)].filter(Boolean),
    sector: batch.sector || job.metadata?.services || "activité locale",
    usageRights: batch.usageRights,
    rightsConfirmed: batch.rightsConfirmed === true,
    exportParameters: { codec: "H.264", pixelFormat: "yuv420p", fps: 25 },
  });
  const outputPath = path.join(outputFolder, metadata.filename);
  const jsonPath = outputPath.replace(/\.mp4$/i, ".json");
  const args = core.buildSignageMasterArgs({ sourcePath, logoPath, outputPath, metadata, clientLabel, phoneLabel });
  await execFileStrict("ffmpeg", args, 30 * 60 * 1000);
  const probeResult = await execFileStrict("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", outputPath], 60_000);
  const probe = JSON.parse(probeResult.stdout);
  const verification = core.verifyProbe(probe, metadata);
  if (!verification.ok) {
    try { fs.unlinkSync(outputPath); } catch (_) {}
    throw new Error(`Vérification du master refusée: ${[...verification.missing, ...verification.mismatches].join(", ")}`);
  }
  const finalBuffer = fs.readFileSync(outputPath);
  const sha256 = crypto.createHash("sha256").update(finalBuffer).digest("hex");
  const sidecar = core.buildSidecar(metadata, { sha256, probe, verification });
  sidecar.production = {
    batchId: batch.id,
    jobId: job.id,
    promptId: job.promptId,
    selectedPosition,
    runtimeSeconds: job.runtimeSeconds || null,
    costCenterId: batch.costCenterId || null,
    projectId: batch.projectId || null,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
  batch.publication = {
    status: "ready",
    selectedPosition,
    outputPath,
    duration: 8,
    width: 1920,
    height: 1080,
    fps: 25,
    createdAt: new Date().toISOString(),
    jsonPath,
    sha256,
    uniqueId: metadata.uniqueId,
    accounting: {
      status: job.runtimeSeconds > 0 ? "pending" : "blocked",
      reason: job.runtimeSeconds > 0 ? null : "runtime_comfyui_missing",
      runtimeSeconds: job.runtimeSeconds || null,
      externalRef: `local-video:${batch.id}:${job.id}`,
    },
    metadata: { ...metadata, phone: job.metadata?.phone || "", workflow: "local-signage-publish-v2" },
  };
  batch.updatedAt = new Date().toISOString();
  saveLocalVideoBatches();
  return { success: true, batchId: batch.id, ...batch.publication };
}

ipcMain.handle("video-local-batch-review", async (_event, batchId) => {
  loadLocalVideoBatches();
  const batch = localVideoBatches.get(String(batchId || ""));
  if (!batch) throw new Error("Lot vidéo local introuvable.");
  return createLocalReviewVideo(batch);
});

ipcMain.handle("video-local-batch-publish", async (_event, payload = {}) => {
  loadLocalVideoBatches();
  const batch = localVideoBatches.get(String(payload.batchId || ""));
  if (!batch) throw new Error("Lot vidéo local introuvable.");
  return publishLocalVideoChoice(batch, payload.position);
});

ipcMain.handle("video-local-generated-open-folder", async (_event, generatedPath) => {
  const root = path.resolve(app.getPath("videos"), "JS-Innov.IA");
  const candidate = path.resolve(String(generatedPath || ""));
  if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error("Chemin de production refusé.");
  const folder = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() ? candidate : path.dirname(candidate);
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
  return { ok: true, folder };
});

ipcMain.handle("video-local-review-open-folder", async (_event, reviewPath) => {
  const root = path.resolve(app.getPath("videos"), "JS-Innov.IA", "Validations");
  const candidate = path.resolve(String(reviewPath || ""));
  if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error("Chemin de validation refusé.");
  const folder = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() ? candidate : path.dirname(candidate);
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
  return { ok: true, folder };
});

ipcMain.handle("video-local-open-output", async () => {
  const folder = comfyOutputCandidates().find((candidate) => fs.existsSync(candidate));
  if (!folder) throw new Error("Dossier output ComfyUI introuvable. Configure JSINNOVIA_COMFYUI_OUTPUT_DIR si nécessaire.");
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
  return { ok: true, folder };
});

ipcMain.handle("video-local-finalize", async (_event, payload = {}) => {
  const source = Buffer.from(payload.bytes || []);
  if (!source.length) throw new Error("Vidéo source vide.");
  if (source.length > 250 * 1024 * 1024) throw new Error("Vidéo trop volumineuse (250 MB max).");
  const core = videoProvenanceCore();
  const metadata = core.buildVideoMetadata(payload.metadata || {});
  const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), "jsinnovia-video-"));
  const sourcePath = path.join(tempFolder, "source-video");
  const tempOutputPath = path.join(tempFolder, metadata.filename);
  const outputFolder = path.join(
    app.getPath("videos"),
    "JS-Innov.IA",
    String(metadata.client || "A_Classer").replace(/[\\/:*?"<>|]/g, "-").trim(),
    String(metadata.campaign || "Campagne").replace(/[\\/:*?"<>|]/g, "-").trim(),
  );
  const outputPath = path.join(outputFolder, metadata.filename);
  const jsonPath = outputPath.replace(/\.mp4$/i, ".json");
  try {
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.writeFileSync(sourcePath, source);
    await execFileStrict("ffmpeg", core.buildFfmpegArgs(sourcePath, tempOutputPath, metadata));
    const probeResult = await execFileStrict("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", tempOutputPath], 60_000);
    const probe = JSON.parse(probeResult.stdout);
    const verification = core.verifyProbe(probe, metadata);
    if (!verification.ok) throw new Error(`Vérification des métadonnées échouée: ${[...verification.missing, ...verification.mismatches].join(", ")}`);
    const finalBuffer = fs.readFileSync(tempOutputPath);
    const sha256 = crypto.createHash("sha256").update(finalBuffer).digest("hex");
    const sidecar = core.buildSidecar(metadata, { sha256, probe, verification });
    fs.copyFileSync(tempOutputPath, outputPath);
    fs.writeFileSync(jsonPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
    return {
      success: true,
      finalized: true,
      verified: true,
      storage: "windows-local",
      fileName: metadata.filename,
      localVideoPath: outputPath,
      sidecarPath: jsonPath,
      sha256,
      uniqueId: metadata.uniqueId,
      rightsConfirmed: metadata.rightsConfirmed,
      journalId: `video-provenance-local-${crypto.randomUUID()}`,
    };
  } finally {
    fs.rmSync(tempFolder, { recursive: true, force: true });
  }
});

// ── Helper: vérifier qu'une fenêtre est toujours vivante ────────────────────
function isAlive(win) {
  return win && !win.isDestroyed();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function inspectRemoteCockpitDocument(win) {
  if (!isAlive(win) || !win.webContents.getURL().startsWith(REMOTE_COCKPIT_URL)) {
    return { healthy: true, skipped: true };
  }

  // Laisser React monter son arbre après le chargement du document principal.
  await wait(1400);
  if (!isAlive(win)) return { healthy: false, reason: "window_closed" };

  try {
    const state = await win.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('#root');
      const bodyText = String(document.body?.innerText || '').slice(0, 1800);
      const contentType = String(document.contentType || '').toLowerCase();
      const sourceLike = !root?.childElementCount && (
        bodyText.includes('data-sonner-toaster')
        || bodyText.includes('"@context"')
        || bodyText.includes('--toast-icon-margin')
        || bodyText.includes('<!doctype html')
        || bodyText.includes('<html')
      );
      return {
        contentType,
        readyState: document.readyState,
        rootExists: Boolean(root),
        rootChildCount: root?.childElementCount || 0,
        sourceLike,
        bodyTextLength: bodyText.length,
      };
    })()`, true);

    const htmlDocument = /^(text\/html|application\/xhtml\+xml)/i.test(state?.contentType || "");
    return {
      ...state,
      healthy: Boolean(htmlDocument && state?.rootExists && state?.rootChildCount > 0 && !state?.sourceLike),
      reason: !htmlDocument
        ? `unexpected_content_type:${state?.contentType || "unknown"}`
        : !state?.rootExists
          ? "react_root_missing"
          : state?.rootChildCount <= 0
            ? "react_root_empty"
            : state?.sourceLike
              ? "raw_source_rendered"
              : null,
    };
  } catch (error) {
    return { healthy: false, reason: `inspection_failed:${error.message}` };
  }
}

async function recoverInvalidRemoteRender(win, state) {
  if (!isAlive(win)) return;

  if (remoteRenderRecoveryAttempts < 1) {
    remoteRenderRecoveryAttempts += 1;
    console.log(`Cockpit distant mal rendu (${state?.reason || "unknown"}), purge du cache renderer et nouvelle tentative.`);
    try {
      await win.webContents.session.clearCache();
      await win.webContents.session.clearStorageData({
        storages: ["serviceworkers", "cachestorage"],
      });
    } catch (error) {
      console.log(`Purge renderer ignorée: ${error.message}`);
    }
    if (isAlive(win)) win.webContents.reloadIgnoringCache();
    return;
  }

  offlineFallbackActive = true;
  console.log(`Cockpit distant toujours invalide (${state?.reason || "unknown"}), bascule vers le mode hors ligne.`);
  if (isAlive(win)) win.loadURL(OFFLINE_COCKPIT_URL);
}

// ── Vérifier les mises à jour Electron sans téléchargement manuel ────────────
function checkForUpdates(silent = true) {
  if (!app.isPackaged) {
    if (!silent) console.log("[desktop] update check skipped outside packaged app");
    return;
  }

  autoUpdater.checkForUpdates().catch((error) => {
    console.log("[desktop] manual update check failed:", error.message);
    if (!silent && Notification.isSupported()) {
      new Notification({
        title: "JS-Innov.IA Cockpit",
        body: "La vérification de mise à jour a échoué. Elle sera retentée automatiquement.",
      }).show();
    }
  });
}

// Compatibilité avec l'ancien bouton renderer : electron-updater télécharge
// automatiquement la version détectée (autoDownload=true dans bootstrap.js).
function downloadUpdate() {
  checkForUpdates(false);
}

// ── Splash screen ───────────────────────────────────────────────────────────
function createSplash() {
  const splash = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    center: true,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false },
    backgroundColor: "#0B0B0F",
  });
  splash.loadFile(path.join(__dirname, "splash.html"));
  return splash;
}

// ── Fenêtre principale ──────────────────────────────────────────────────────
function createWindow() {
  offlineFallbackActive = false;
  remoteRenderRecoveryAttempts = 0;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    frame: true,
    title: "JS-Innov.IA Cockpit",
    icon: path.join(__dirname, "icon.png"),
    titleBarStyle: os.platform() === "win32" ? "default" : "hiddenInset",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: true,
    },
    backgroundColor: "#0B0B0F",
    show: false,
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();
  mainWindow.loadURL(REMOTE_COCKPIT_URL);

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (splashTimer) {
      clearTimeout(splashTimer);
      splashTimer = null;
    }
  });

  return mainWindow;
}

// ── Tray icon ───────────────────────────────────────────────────────────────
function createTray() {
  try {
    tray = new Tray(path.join(__dirname, "icon.png"));
    const menu = Menu.buildFromTemplate([
      { label: "Ouvrir le Cockpit", click: () => { if (isAlive(mainWindow)) mainWindow.show(); else createWindow().show(); } },
      { type: "separator" },
      {
        label: "Vérifier les mises à jour",
        click: () => checkForUpdates(false),
      },
      { type: "separator" },
      { label: "Quitter", click: () => app.quit() },
    ]);
    tray.setToolTip("JS-Innov.IA Cockpit");
    tray.setContextMenu(menu);
    tray.on("double-click", () => { if (isAlive(mainWindow)) mainWindow.show(); else createWindow().show(); });
  } catch(e) { console.log("Tray non disponible:", e.message); }
}

// ── IPC — Notifications ─────────────────────────────────────────────────────
ipcMain.on("notify", (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title: title || "JS-Innov.IA", body: body || "" }).show();
  }
});

// ── IPC — transcription micro Elynea via le processus Electron ──────────────
ipcMain.handle("elynea-local-voice-transcribe", async (event, payload = {}) => {
  if (!trustedCockpitCaller(event)) {
    throw new Error("Appel micro refusé hors du Cockpit JS-Innov.IA.");
  }
  return transcribeLocalVoiceBytes(payload.bytes, payload.mimeType);
});

// ── IPC — tâches web authentifiées Elynea, limitées aux recettes autorisées ──
ipcMain.handle("elynea-web-assistant-execute", async (event, task = {}) => {
  const caller = String(event.senderFrame?.url || event.sender?.getURL?.() || "");
  if (!caller.startsWith(`${REMOTE_COCKPIT_URL}/`) && !caller.startsWith(`${OFFLINE_COCKPIT_URL}/`)) {
    throw new Error("Appel refusé hors du Cockpit JS-Innov.IA.");
  }
  return webAssistant.execute(task);
});

// Compatibilité transitoire : ancien renderer NOVA -> runtime Elynea.
ipcMain.handle("nova-web-assistant-execute", async (event, task = {}) => {
  const caller = String(event.senderFrame?.url || event.sender?.getURL?.() || "");
  if (!caller.startsWith(`${REMOTE_COCKPIT_URL}/`) && !caller.startsWith(`${OFFLINE_COCKPIT_URL}/`)) {
    throw new Error("Appel refusé hors du Cockpit JS-Innov.IA.");
  }
  return webAssistant.execute(task);
});

// ── IPC — Elynea Jarvis Tool Router ─────────────────────────────────────────
async function detectJarvisCapabilities() {
  const state = {
    localAgent: { online: false, port: null },
    comfyui: { online: false, port: COMFYUI_PORT },
    github: { online: Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN) },
    railway: { online: Boolean(process.env.RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN) },
    supabase: { online: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) },
  };
  for (const port of LOCAL_AGENT_PORTS) {
    try {
      const health = await localAgentRequest(port, "/health", { timeoutMs: 1200 });
      if (health?.ok) { state.localAgent = { online: true, port }; break; }
    } catch (_) { /* capability offline */ }
  }
  try {
    await comfyRequest("/system_stats", { timeoutMs: 1200 });
    state.comfyui.online = true;
  } catch (_) { /* capability offline */ }
  return state;
}

function appendJarvisAudit(entry) {
  try {
    const folder = path.join(app.getPath("userData"), "elynea-audit");
    fs.mkdirSync(folder, { recursive: true });
    fs.appendFileSync(path.join(folder, "jarvis-actions.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, "utf8");
  } catch (error) {
    console.log(`Journal Elynea ignoré: ${error.message}`);
  }
}

const jarvisExecutor = createJarvisExecutor({
  routeJarvis,
  detectCapabilities: detectJarvisCapabilities,
  executeWeb: (task) => webAssistant.execute(task),
  localAgentRequest,
  comfyRequest,
  audit: appendJarvisAudit,
});

ipcMain.handle("elynea-tool-capabilities", async (event) => {
  if (!trustedCockpitCaller(event)) throw new Error("Lecture des capacités refusée hors du Cockpit JS-Innov.IA.");
  return { ok: true, capabilities: await detectJarvisCapabilities() };
});

ipcMain.handle("elynea-tool-route", async (event, task = {}) => {
  if (!trustedCockpitCaller(event)) throw new Error("Appel Tool Router refusé hors du Cockpit JS-Innov.IA.");
  const capabilities = await detectJarvisCapabilities();
  const route = routeJarvis(task, capabilities);
  return { ok: true, route, capabilities, requiresConfirmation: route.confirmation === true };
});

ipcMain.handle("elynea-jarvis-execute", async (event, payload = {}) => {
  if (!trustedCockpitCaller(event)) throw new Error("Exécution Jarvis refusée hors du Cockpit JS-Innov.IA.");
  return jarvisExecutor.execute(payload.task || {}, { confirmed: payload.confirmed === true });
});

// ── IPC — Check for updates (from renderer) ─────────────────────────────────
ipcMain.on("check-for-updates", () => {
  checkForUpdates(false);
});

ipcMain.on("download-update", () => {
  downloadUpdate();
});

// ── Boot ────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const splash = createSplash();
  const win = createWindow();

  win.webContents.on("did-finish-load", async () => {
    const currentUrl = win.webContents.getURL();

    if (currentUrl.startsWith(REMOTE_COCKPIT_URL)) {
      const renderState = await inspectRemoteCockpitDocument(win);
      if (!renderState.healthy) {
        await recoverInvalidRemoteRender(win, renderState);
        return;
      }
      remoteRenderRecoveryAttempts = 0;
      setTimeout(() => captureOfflineSession(win), 5000);
    } else if (currentUrl.startsWith(OFFLINE_COCKPIT_URL)) {
      hydrateOfflineSession(win);
    }

    if (splashTimer) clearTimeout(splashTimer);
    splashTimer = setTimeout(() => {
      splashTimer = null;
      if (isAlive(splash)) splash.close();
      if (isAlive(win)) {
        win.show();
        if (os.platform() !== "darwin") createTray();
      }
    }, 1200);
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame !== false && !offlineFallbackActive && !String(validatedURL || "").startsWith(OFFLINE_COCKPIT_URL)) {
      offlineFallbackActive = true;
      console.log(`Cockpit distant indisponible (${errorCode}: ${errorDescription}), ouverture du mode hors ligne.`);
      win.loadURL(OFFLINE_COCKPIT_URL);
      return;
    }
    if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
    if (isAlive(splash)) splash.close();
    if (isAlive(win)) win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  tray = null;
  mainWindow = null;
});
