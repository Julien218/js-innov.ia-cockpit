const { app, session, Notification, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

let updaterStarted = false;
let localAgentProcess = null;
let localAgentPort = null;
let localAgentMisses = 0;
let localAgentSpawnedAt = 0;
let localAgentRestartTimer = null;
let localAgentWatchdogTimer = null;
let offlineWebServer = null;
let elyneaDesktopProcess = null;
let shuttingDown = false;

const OFFLINE_WEB_PORT = 8790;
// 8788 est désormais prioritaire pour l'agent Elynea actuel. 8787 reste la
// compatibilité historique afin de ne pas casser une ancienne installation.
const LOCAL_AGENT_PRIMARY_PORT = 8788;
const LOCAL_AGENT_FALLBACK_PORT = 8787;
const LOCAL_AGENT_WATCHDOG_MS = 15_000;
const LOCAL_AGENT_STARTUP_GRACE_MS = 25_000;
const LOCAL_AGENT_MAX_MISSES = 3;
const MUSIC_MOTION_CONTRACT_VERSION = 2;

const TRUSTED_AUDIO_ORIGINS = new Set([
  'https://cockpit.jsinnovia.com',
  `http://127.0.0.1:${OFFLINE_WEB_PORT}`,
]);

function normalizeOrigin(value) {
  try { return new URL(String(value || '')).origin; }
  catch { return ''; }
}

function configureMicrophonePermissions() {
  const ses = session.defaultSession;
  const trustedAudioRequest = (permission, origin, details = {}) => {
    if (!TRUSTED_AUDIO_ORIGINS.has(normalizeOrigin(origin))) return false;
    if (permission === 'speaker-selection') return true;
    if (permission !== 'media') return false;
    const mediaTypes = Array.isArray(details.mediaTypes)
      ? details.mediaTypes
      : details.mediaType
        ? [details.mediaType]
        : [];
    return mediaTypes.length === 0 || (mediaTypes.includes('audio') && !mediaTypes.includes('video'));
  };

  ses.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    const requestingUrl = details.requestingUrl || webContents?.getURL?.() || '';
    callback(trustedAudioRequest(permission, requestingUrl, details));
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details = {}) => (
    trustedAudioRequest(permission, requestingOrigin || webContents?.getURL?.() || '', details)
  ));

  console.log('[desktop] microphone and speaker-selection permissions restricted to Elynea Cockpit audio origins');
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function startBundledOfflineCockpit() {
  const webRoot = app.isPackaged
    ? path.join(process.resourcesPath, "offline-web")
    : path.join(__dirname, "..", "dist");
  const indexPath = path.join(webRoot, "index.html");
  if (!fs.existsSync(indexPath)) {
    console.log(`[desktop] offline Cockpit missing: ${indexPath}`);
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    offlineWebServer = http.createServer((request, response) => {
      let pathname = "/";
      try { pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${OFFLINE_WEB_PORT}`).pathname); } catch {}
      const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const candidate = path.resolve(webRoot, requested);
      const insideRoot = candidate === webRoot || candidate.startsWith(`${webRoot}${path.sep}`);
      const filePath = insideRoot && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : indexPath;
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      fs.createReadStream(filePath).pipe(response);
    });
    offlineWebServer.once("error", (error) => {
      console.log(`[desktop] offline Cockpit server unavailable: ${error.message}`);
      resolve(error.code === "EADDRINUSE");
    });
    offlineWebServer.listen(OFFLINE_WEB_PORT, "127.0.0.1", () => {
      console.log(`[desktop] offline Cockpit ready on 127.0.0.1:${OFFLINE_WEB_PORT}`);
      resolve(true);
    });
  });
}

function localHttpJson(port, route, timeout = 1_500, headers = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = http.get({ host: "127.0.0.1", port, path: route, timeout, headers }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (raw.length < 64_000) raw += chunk;
      });
      response.on("end", () => {
        let payload = {};
        try { payload = raw ? JSON.parse(raw) : {}; } catch {}
        finish({
          online: response.statusCode === 200,
          statusCode: response.statusCode,
          payload,
          port,
          route,
        });
      });
    });
    request.on("timeout", () => {
      request.destroy();
      finish({ online: false, error: "timeout", port, route });
    });
    request.on("error", (error) => finish({ online: false, error: error.code || error.message, port, route }));
  });
}

function localAgentHealth(port, timeout = 1_500) {
  return localHttpJson(port, "/health", timeout).then((result) => ({
    ...result,
    online: result.online && result.payload?.ok !== false,
  }));
}

function localMusicMotionCapabilities(port, timeout = 1_500) {
  const token = String(process.env.LOCAL_AGENT_TOKEN || "").trim();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return localHttpJson(port, "/api/music-motion/production/capabilities", timeout, headers);
}

async function localAgentCompatibility(port, timeout = 1_500) {
  const [health, capabilities] = await Promise.all([
    localAgentHealth(port, timeout),
    localMusicMotionCapabilities(port, timeout),
  ]);
  const contractVersion = Number(capabilities.payload?.version || 0);
  return {
    port,
    health,
    capabilities,
    compatible: Boolean(
      health.online &&
      capabilities.online &&
      contractVersion >= MUSIC_MOTION_CONTRACT_VERSION
    ),
    contractVersion,
  };
}

function portListening(port, timeout = 700) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function processAlive(child = localAgentProcess) {
  return Boolean(child && !child.killed && child.exitCode === null);
}

async function selectLocalAgentPort() {
  if (localAgentPort) return localAgentPort;

  const primary = await localAgentCompatibility(LOCAL_AGENT_PRIMARY_PORT);
  if (primary.compatible) {
    localAgentPort = LOCAL_AGENT_PRIMARY_PORT;
    return localAgentPort;
  }

  const fallback = await localAgentCompatibility(LOCAL_AGENT_FALLBACK_PORT);
  if (fallback.compatible) {
    localAgentPort = LOCAL_AGENT_FALLBACK_PORT;
    return localAgentPort;
  }

  // Aucun agent compatible : démarrer le binaire embarqué sur un port réellement libre.
  // 8788 est préféré pour éviter qu'une installation historique 8787 masque la version courante.
  if (!(await portListening(LOCAL_AGENT_PRIMARY_PORT))) {
    localAgentPort = LOCAL_AGENT_PRIMARY_PORT;
    return localAgentPort;
  }
  if (!(await portListening(LOCAL_AGENT_FALLBACK_PORT))) {
    localAgentPort = LOCAL_AGENT_FALLBACK_PORT;
    return localAgentPort;
  }

  throw new Error(
    "Les ports 8787 et 8788 sont occupés par des agents non compatibles avec Music Motion v2. " +
    "Lancer repair-music-motion-windows.ps1 pour inventorier et corriger les anciennes versions."
  );
}

function localAgentServerPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "local-agent", "server.js")
    : path.join(__dirname, "..", "local-agent", "server.js");
}

function scheduleLocalAgentRestart(reason, delay = 2_500) {
  if (shuttingDown || localAgentRestartTimer) return;
  console.log(`[desktop] Elynea Local Tools restart scheduled (${reason})`);
  localAgentRestartTimer = setTimeout(() => {
    localAgentRestartTimer = null;
    startBundledLocalAgent({ force: true }).catch((error) => {
      console.log("[desktop] Elynea Local Tools restart failed:", error.message);
      scheduleLocalAgentRestart("retry_after_failure", 5_000);
    });
  }, delay);
  localAgentRestartTimer.unref?.();
}

async function startBundledLocalAgent({ force = false } = {}) {
  if (shuttingDown) return false;
  const port = await selectLocalAgentPort();
  const compatibility = await localAgentCompatibility(port);
  if (compatibility.compatible) {
    localAgentMisses = 0;
    console.log(
      `[desktop] Elynea Local Tools online on 127.0.0.1:${port} ` +
      `(agent v${compatibility.health.payload?.agent?.version || "unknown"}, Music Motion v${compatibility.contractVersion})`
    );
    return true;
  }

  if (await portListening(port)) {
    throw new Error(`Port local ${port} occupé par un service incompatible avec Music Motion v2.`);
  }

  if (processAlive()) {
    const withinStartupGrace = Date.now() - localAgentSpawnedAt < LOCAL_AGENT_STARTUP_GRACE_MS;
    if (!force || withinStartupGrace) return false;
    const previous = localAgentProcess;
    localAgentProcess = null;
    try { previous.kill(); } catch {}
  }

  const serverPath = localAgentServerPath();
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Agent local introuvable: ${serverPath}`);
  }

  const child = spawn(process.execPath, [serverPath], {
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", LOCAL_AGENT_PORT: String(port) },
  });
  localAgentProcess = child;
  localAgentSpawnedAt = Date.now();
  localAgentMisses = 0;

  child.once("error", (error) => {
    if (localAgentProcess === child) localAgentProcess = null;
    console.log(`[desktop] Elynea Local Tools process error: ${error.message}`);
    scheduleLocalAgentRestart("process_error");
  });
  child.once("exit", (code, signal) => {
    if (localAgentProcess === child) localAgentProcess = null;
    if (shuttingDown) return;
    console.log(`[desktop] Elynea Local Tools exited (code=${code ?? "null"}, signal=${signal || "none"})`);
    scheduleLocalAgentRestart("process_exit");
  });
  child.unref();
  console.log(`[desktop] Elynea Local Tools starting on 127.0.0.1:${port}`);
  return true;
}

async function checkBundledLocalAgent() {
  if (shuttingDown) return;
  const port = await selectLocalAgentPort();
  const compatibility = await localAgentCompatibility(port, 2_500);
  if (compatibility.compatible) {
    if (localAgentMisses) console.log(`[desktop] Elynea Local Tools recovered on 127.0.0.1:${port}`);
    localAgentMisses = 0;
    return;
  }

  if (!processAlive()) {
    scheduleLocalAgentRestart("watchdog_process_absent", 500);
    return;
  }
  if (Date.now() - localAgentSpawnedAt < LOCAL_AGENT_STARTUP_GRACE_MS) return;

  localAgentMisses += 1;
  console.log(`[desktop] Elynea Local Tools compatibility miss ${localAgentMisses}/${LOCAL_AGENT_MAX_MISSES} on port ${port}`);
  if (localAgentMisses < LOCAL_AGENT_MAX_MISSES) return;

  const unresponsive = localAgentProcess;
  localAgentProcess = null;
  localAgentMisses = 0;
  try { unresponsive.kill(); } catch {}
  scheduleLocalAgentRestart("watchdog_incompatible_or_unresponsive", 500);
}

function startLocalAgentWatchdog() {
  if (localAgentWatchdogTimer) return;
  localAgentWatchdogTimer = setInterval(() => {
    checkBundledLocalAgent().catch((error) => {
      console.log("[desktop] Elynea Local Tools watchdog error:", error.message);
    });
  }, LOCAL_AGENT_WATCHDOG_MS);
  localAgentWatchdogTimer.unref?.();
  setTimeout(() => {
    checkBundledLocalAgent().catch((error) => console.log("[desktop] Elynea Local Tools initial check failed:", error.message));
  }, 5_000).unref?.();
}

function bundledElyneaDesktopDir() {
  if (!app.isPackaged) return null;
  return path.join(process.resourcesPath, "elynea-desktop");
}

function installedElyneaDesktopDir() {
  return path.join(app.getPath("userData"), "ElyneaDesktop", app.getVersion());
}

function terminateExistingElyneaDesktop() {
  if (process.platform !== "win32") return Promise.resolve();
  return new Promise((resolve) => {
    execFile(
      "taskkill",
      ["/IM", "ElyneaDesktop.exe", "/T", "/F"],
      { windowsHide: true, timeout: 5_000 },
      () => resolve(),
    );
  });
}

async function startBundledElyneaDesktop() {
  if (process.platform !== "win32" || !app.isPackaged || shuttingDown) return false;

  const source = bundledElyneaDesktopDir();
  const sourceExe = source && path.join(source, "ElyneaDesktop.exe");
  if (!source || !fs.existsSync(sourceExe)) {
    console.log("[desktop] Elynea QML companion not bundled; Cockpit fallback remains available");
    return false;
  }

  const target = installedElyneaDesktopDir();
  const targetExe = path.join(target, "ElyneaDesktop.exe");

  try {
    if (!fs.existsSync(targetExe)) {
      fs.mkdirSync(target, { recursive: true });
      fs.cpSync(source, target, { recursive: true, force: true });
    }

    await terminateExistingElyneaDesktop();

    const child = spawn(targetExe, ["--minimized"], {
      cwd: target,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    elyneaDesktopProcess = child;
    child.once("exit", () => {
      if (elyneaDesktopProcess === child) elyneaDesktopProcess = null;
    });
    child.unref();
    console.log(`[desktop] Elynea QML companion started from ${targetExe}`);
    return true;
  } catch (error) {
    console.log("[desktop] Elynea QML companion start failed:", error.message);
    return false;
  }
}

app.on("before-quit", () => {
  shuttingDown = true;
  if (localAgentRestartTimer) clearTimeout(localAgentRestartTimer);
  if (localAgentWatchdogTimer) clearInterval(localAgentWatchdogTimer);
  if (localAgentProcess && !localAgentProcess.killed) localAgentProcess.kill();
  if (offlineWebServer) offlineWebServer.close();
});

function notify(title, body) {
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title, body }).show();
  } catch (_) {
    // Les notifications ne doivent jamais bloquer le démarrage.
  }
}

function enableWindowsStartup() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
    });
    console.log("[desktop] Windows startup enabled");
  } catch (error) {
    console.log("[desktop] Windows startup setup failed:", error.message);
  }
}

async function refreshWebRuntime() {
  try {
    // Le Cockpit desktop charge l'application distante. On vide uniquement le cache
    // HTTP afin que tous les modules prennent la dernière version au prochain démarrage,
    // sans toucher aux cookies, sessions ou données locales de l'utilisateur.
    await session.defaultSession.clearCache();
    // Un service worker ou CacheStorage corrompu peut faire afficher le HTML/CSS brut
    // dans Electron alors que le site est correct dans Chrome. On purge uniquement
    // ces caches de rendu, sans supprimer cookies, localStorage ni session utilisateur.
    await session.defaultSession.clearStorageData({
      storages: ["serviceworkers", "cachestorage"],
    });
  } catch (error) {
    console.log("[desktop] cache refresh skipped:", error.message);
  }
}

function startAutoUpdater() {
  if (updaterStarted || !app.isPackaged) return;
  updaterStarted = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    console.log("[desktop] checking for update");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[desktop] update available: ${info?.version || "unknown"}`);
    notify(
      "Mise à jour JS-Innov.IA",
      `Version ${info?.version || "nouvelle"} détectée. Téléchargement automatique…`,
    );
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[desktop] application up to date");
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Number(progress?.percent || 0).toFixed(1);
    console.log(`[desktop] update download ${percent}%`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[desktop] update downloaded: ${info?.version || "unknown"}`);
    notify(
      "Mise à jour prête",
      "Le Cockpit va redémarrer automatiquement pour installer la nouvelle version.",
    );

    // Installation globale au démarrage : aucun module ne doit gérer son propre reload.
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        console.log("[desktop] update install error:", error.message);
      }
    }, 2500);
  });

  autoUpdater.on("error", (error) => {
    // Une panne GitHub/Internet ne doit jamais empêcher l'ouverture du Cockpit.
    console.log("[desktop] auto-update error:", error?.message || error);
  });

  autoUpdater.checkForUpdates().catch((error) => {
    console.log("[desktop] update check failed:", error.message);
  });
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  console.log("[desktop] Une instance du Cockpit est déjà active.");
  app.quit();
} else {
  app.on("second-instance", () => {
    const existingWindow = BrowserWindow
      .getAllWindows()
      .find((window) => !window.isDestroyed());

    if (!existingWindow) return;
    if (existingWindow.isMinimized()) existingWindow.restore();
    existingWindow.show();
    existingWindow.focus();
  });
}

app.whenReady().then(async () => {
  if (!singleInstanceLock) return;
  app.setName('JS-Innov.IA Cockpit');
  if (process.platform === 'win32') app.setAppUserModelId('com.jsinnovia.cockpit');
  configureMicrophonePermissions();
  enableWindowsStartup();
  await startBundledLocalAgent().catch((error) => {
    console.log("[desktop] Elynea Local Tools initial start failed:", error.message);
    notify("Elynea locale à réparer", error.message);
    return false;
  });
  startLocalAgentWatchdog();
  await startBundledElyneaDesktop().catch((error) => {
    console.log("[desktop] Elynea QML companion bootstrap failed:", error.message);
    return false;
  });
  await startBundledOfflineCockpit();
  await refreshWebRuntime();

  // On charge l'application historique seulement après le nettoyage du cache HTTP,
  // afin que le premier loadURL() récupère le dernier Cockpit déployé.
  require("./main.js");

  // Laisse la fenêtre commencer à se charger puis lance la vérification Electron.
  setTimeout(startAutoUpdater, 1500);
});
