const { app, BrowserWindow, shell, ipcMain, Notification, Tray, Menu } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const https = require("https");
const { execFile } = require("child_process");
const crypto = require("crypto");

let mainWindow = null;
let tray = null;
let splashTimer = null;
let updateAvailable = null;
let offlineFallbackActive = false;
const OFFLINE_COCKPIT_URL = "http://127.0.0.1:8790";
const OFFLINE_STORAGE_KEYS = ["cockpit_session_user", "nova_local_task_snapshot_v1", "agent_chat_messages", "agent_conversation_id", "agent_tts_enabled"];
let offlineStorageHydrated = false;

function offlineSessionPath() {
  return path.join(app.getPath("userData"), "offline-session.json");
}

async function captureOfflineSession(win) {
  if (!isAlive(win) || !win.webContents.getURL().startsWith("https://cockpit.jsinnovia.com")) return;
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
        const detail = typeof parsed === "object" ? parsed?.error || parsed?.message || JSON.stringify(parsed) : parsed;
        reject(new Error(`ComfyUI HTTP ${res.statusCode}: ${detail || "erreur inconnue"}`));
      });
    });
    req.on("timeout", () => req.destroy(new Error("ComfyUI timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
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
  ].filter(Boolean);
}

ipcMain.handle("video-local-status", async () => {
  let comfyui = { online: false };
  try {
    const stats = await comfyRequest("/system_stats", { timeoutMs: 3000 });
    comfyui = { online: true, stats };
  } catch (error) {
    comfyui = { online: false, error: error.message };
  }
  const ffmpeg = await commandAvailable("ffmpeg", ["-version"]);
  return { available: comfyui.online, comfyui, ffmpeg, endpoint: `http://${COMFYUI_HOST}:${COMFYUI_PORT}` };
});

ipcMain.handle("video-local-queue", async (_event, payload = {}) => {
  const workflow = payload.workflow;
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw new Error("Workflow ComfyUI API invalide.");
  }
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

function comfyHistoryOutputs(payload, promptId) {
  const history = payload?.[promptId] || payload?.history?.[promptId] || payload || {};
  const outputs = history?.outputs || {};
  const files = [];
  Object.values(outputs).forEach((nodeOutput) => {
    ["videos", "gifs", "images", "audio"].forEach((kind) => {
      const values = nodeOutput?.[kind];
      if (Array.isArray(values)) values.forEach((item) => {
        if (item?.filename) files.push({ kind, ...item });
      });
    });
  });
  return { files, completed: files.length > 0 || history?.status?.completed === true };
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
      const result = comfyHistoryOutputs(history, job.promptId);
      if (result.completed) {
        job.status = "completed";
        job.outputs = result.files;
        job.completedAt = new Date().toISOString();
      } else if (running.has(job.promptId)) {
        job.status = "running";
      } else if (pending.has(job.promptId)) {
        job.status = "queued";
      }
    } catch (error) {
      job.lastError = String(error.message || error).slice(0, 500);
    }
  }));

  const terminal = batch.jobs.filter((job) => ["completed", "failed", "cancelled"].includes(job.status)).length;
  batch.progress = batch.jobs.length ? Math.round((terminal / batch.jobs.length) * 100) : 0;
  batch.status = terminal === batch.jobs.length ? "completed" : "running";
  batch.updatedAt = new Date().toISOString();
  saveLocalVideoBatches();
  return batch;
}

ipcMain.handle("video-local-batch-queue", async (_event, payload = {}) => {
  loadLocalVideoBatches();
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  if (!jobs.length) throw new Error("Ajoute au moins une vidéo au lot local.");
  if (jobs.length > MAX_LOCAL_VIDEO_BATCH) throw new Error(`Maximum ${MAX_LOCAL_VIDEO_BATCH} vidéos par lot local.`);

  const batchId = String(payload.batchId || `batch-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`);
  if (localVideoBatches.has(batchId)) throw new Error("Cet identifiant de lot existe déjà.");
  const batch = {
    id: batchId,
    title: String(payload.title || "Production écran géant"),
    clientName: String(payload.clientName || ""),
    campaignName: String(payload.campaignName || ""),
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
      status: "queueing",
      position: index + 1,
      promptId: "",
      outputs: [],
    };
    batch.jobs.push(record);
    try {
      if (!source.workflow || typeof source.workflow !== "object" || Array.isArray(source.workflow)) {
        throw new Error("Workflow ComfyUI API invalide.");
      }
      const queued = await comfyRequest("/prompt", {
        method: "POST",
        json: {
          prompt: source.workflow,
          client_id: String(source.clientId || "jsinnovia-signage-factory"),
        },
        timeoutMs: 15000,
      });
      record.promptId = String(queued?.prompt_id || queued?.promptId || "");
      if (!record.promptId) throw new Error("ComfyUI n’a pas retourné de prompt_id.");
      record.status = "queued";
      record.queuedAt = new Date().toISOString();
    } catch (error) {
      record.status = "failed";
      record.error = String(error.message || error).slice(0, 1000);
      record.completedAt = new Date().toISOString();
    }
    batch.updatedAt = new Date().toISOString();
    saveLocalVideoBatches();
  }

  batch.status = batch.jobs.some((job) => ["queued", "running"].includes(job.status)) ? "running" : "completed";
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
    if (["queueing", "queued", "running"].includes(job.status)) {
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

// ── Vérifier les mises à jour via l'API cockpit ──────────────────────────────
function checkForUpdates(silent = true) {
  const options = {
    hostname: "cockpit.jsinnovia.com",
    path: "/api/version",
    method: "GET",
    headers: { "User-Agent": "jsinnovia-cockpit-electron" },
  };

  const req = https.request(options, (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      try {
        const result = JSON.parse(data);
        if (result.success && result.latest) {
          const latestVersion = result.latest.version.replace(/^v/, "");
          if (isNewerVersion(latestVersion, APP_VERSION)) {
            updateAvailable = result.latest;
            if (Notification.isSupported()) {
              new Notification({
                title: "Mise à jour disponible — JS-Innov.IA Cockpit",
                body: `Version ${latestVersion} disponible. Cliquez pour télécharger.`,
              }).show();
            }
            if (!silent && isAlive(mainWindow)) {
              mainWindow.webContents.send("update-available", updateAvailable);
            }
          } else if (!silent) {
            if (Notification.isSupported()) {
              new Notification({
                title: "JS-Innov.IA Cockpit",
                body: "Votre application est à jour.",
              }).show();
            }
          }
        }
      } catch (e) {
        console.log("Update check error:", e.message);
      }
    });
  });
  req.on("error", (e) => console.log("Update check error:", e.message));
  req.end();
}

// ── Comparer les versions (semver simple) ───────────────────────────────────
function isNewerVersion(latest, current) {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lv = l[i] || 0;
    const cv = c[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

// ── Ouvrir le lien de téléchargement ─────────────────────────────────────────
function downloadUpdate() {
  if (updateAvailable && updateAvailable.downloadUrl) {
    shell.openExternal(updateAvailable.downloadUrl);
  } else {
    shell.openExternal("https://github.com/Julien218/js-innov.ia-cockpit/releases/latest");
  }
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
  mainWindow.loadURL("https://cockpit.jsinnovia.com");

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
        label: updateAvailable ? `Mise à jour ${updateAvailable.version} disponible` : "Vérifier les mises à jour",
        click: () => {
          if (updateAvailable) {
            downloadUpdate();
          } else {
            checkForUpdates(false);
          }
        }
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

  win.webContents.on("did-finish-load", () => {
    if (win.webContents.getURL().startsWith(OFFLINE_COCKPIT_URL)) {
      hydrateOfflineSession(win);
    } else {
      setTimeout(() => captureOfflineSession(win), 5000);
    }
    if (splashTimer) clearTimeout(splashTimer);
    splashTimer = setTimeout(() => {
      splashTimer = null;
      if (isAlive(splash)) splash.close();
      if (isAlive(win)) {
        win.show();
        if (os.platform() !== "darwin") createTray();
        setTimeout(() => checkForUpdates(true), 3000);
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
