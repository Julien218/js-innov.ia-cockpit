const { app, session, Notification } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

let updaterStarted = false;
let localAgentProcess = null;
let localAgentPort = null;
let localAgentMisses = 0;
let localAgentSpawnedAt = 0;
let localAgentRestartTimer = null;
let localAgentWatchdogTimer = null;
let offlineWebServer = null;
let shuttingDown = false;

const OFFLINE_WEB_PORT = 8790;
const LOCAL_AGENT_PRIMARY_PORT = 8787;
const LOCAL_AGENT_FALLBACK_PORT = 8788;
const LOCAL_AGENT_WATCHDOG_MS = 15_000;
const LOCAL_AGENT_STARTUP_GRACE_MS = 25_000;
const LOCAL_AGENT_MAX_MISSES = 3;

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

function localAgentHealth(port, timeout = 1_500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = http.get({ host: "127.0.0.1", port, path: "/health", timeout }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (raw.length < 32_768) raw += chunk;
      });
      response.on("end", () => {
        let payload = {};
        try { payload = raw ? JSON.parse(raw) : {}; } catch {}
        finish({
          online: response.statusCode === 200 && payload?.ok !== false,
          statusCode: response.statusCode,
          payload,
          port,
        });
      });
    });
    request.on("timeout", () => {
      request.destroy();
      finish({ online: false, error: "timeout", port });
    });
    request.on("error", (error) => finish({ online: false, error: error.code || error.message, port }));
  });
}

function localAgentOnline(port) {
  return localAgentHealth(port).then((result) => result.online);
}

function processAlive(child = localAgentProcess) {
  return Boolean(child && !child.killed && child.exitCode === null);
}

async function selectLocalAgentPort() {
  if (localAgentPort) return localAgentPort;

  // Les versions historiques peuvent déjà occuper 8787. Le binaire courant est
  // alors lancé sur 8788 afin de ne pas dépendre d'un agent ancien non maîtrisé.
  if (await localAgentOnline(LOCAL_AGENT_FALLBACK_PORT)) {
    localAgentPort = LOCAL_AGENT_FALLBACK_PORT;
    return localAgentPort;
  }
  localAgentPort = await localAgentOnline(LOCAL_AGENT_PRIMARY_PORT)
    ? LOCAL_AGENT_FALLBACK_PORT
    : LOCAL_AGENT_PRIMARY_PORT;
  return localAgentPort;
}

function localAgentServerPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "local-agent", "server.js")
    : path.join(__dirname, "..", "local-agent", "server.js");
}

function scheduleLocalAgentRestart(reason, delay = 2_500) {
  if (shuttingDown || localAgentRestartTimer) return;
  console.log(`[desktop] NOVA Local Tools restart scheduled (${reason})`);
  localAgentRestartTimer = setTimeout(() => {
    localAgentRestartTimer = null;
    startBundledLocalAgent({ force: true }).catch((error) => {
      console.log("[desktop] NOVA Local Tools restart failed:", error.message);
      scheduleLocalAgentRestart("retry_after_failure", 5_000);
    });
  }, delay);
  localAgentRestartTimer.unref?.();
}

async function startBundledLocalAgent({ force = false } = {}) {
  if (shuttingDown) return false;
  const port = await selectLocalAgentPort();
  const health = await localAgentHealth(port);
  if (health.online) {
    localAgentMisses = 0;
    console.log(`[desktop] NOVA Local Tools online on 127.0.0.1:${port} (v${health.payload?.agent?.version || "unknown"})`);
    return true;
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
    console.log(`[desktop] NOVA Local Tools process error: ${error.message}`);
    scheduleLocalAgentRestart("process_error");
  });
  child.once("exit", (code, signal) => {
    if (localAgentProcess === child) localAgentProcess = null;
    if (shuttingDown) return;
    console.log(`[desktop] NOVA Local Tools exited (code=${code ?? "null"}, signal=${signal || "none"})`);
    scheduleLocalAgentRestart("process_exit");
  });
  child.unref();
  console.log(`[desktop] NOVA Local Tools starting on 127.0.0.1:${port}`);
  return true;
}

async function checkBundledLocalAgent() {
  if (shuttingDown) return;
  const port = await selectLocalAgentPort();
  const health = await localAgentHealth(port, 2_500);
  if (health.online) {
    if (localAgentMisses) console.log(`[desktop] NOVA Local Tools recovered on 127.0.0.1:${port}`);
    localAgentMisses = 0;
    return;
  }

  if (!processAlive()) {
    scheduleLocalAgentRestart("watchdog_process_absent", 500);
    return;
  }
  if (Date.now() - localAgentSpawnedAt < LOCAL_AGENT_STARTUP_GRACE_MS) return;

  localAgentMisses += 1;
  console.log(`[desktop] NOVA Local Tools health miss ${localAgentMisses}/${LOCAL_AGENT_MAX_MISSES} on port ${port}`);
  if (localAgentMisses < LOCAL_AGENT_MAX_MISSES) return;

  const unresponsive = localAgentProcess;
  localAgentProcess = null;
  localAgentMisses = 0;
  try { unresponsive.kill(); } catch {}
  scheduleLocalAgentRestart("watchdog_unresponsive", 500);
}

function startLocalAgentWatchdog() {
  if (localAgentWatchdogTimer) return;
  localAgentWatchdogTimer = setInterval(() => {
    checkBundledLocalAgent().catch((error) => {
      console.log("[desktop] NOVA Local Tools watchdog error:", error.message);
    });
  }, LOCAL_AGENT_WATCHDOG_MS);
  localAgentWatchdogTimer.unref?.();
  setTimeout(() => {
    checkBundledLocalAgent().catch((error) => console.log("[desktop] NOVA Local Tools initial check failed:", error.message));
  }, 5_000).unref?.();
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

app.whenReady().then(async () => {
  enableWindowsStartup();
  await startBundledLocalAgent();
  startLocalAgentWatchdog();
  await startBundledOfflineCockpit();
  await refreshWebRuntime();

  // On charge l'application historique seulement après le nettoyage du cache HTTP,
  // afin que le premier loadURL() récupère le dernier Cockpit déployé.
  require("./main.js");

  // Laisse la fenêtre commencer à se charger puis lance la vérification Electron.
  setTimeout(startAutoUpdater, 1500);
});
