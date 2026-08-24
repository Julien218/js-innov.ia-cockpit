const { app, session, Notification } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");

let updaterStarted = false;
let localAgentProcess = null;

function localAgentOnline(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 800 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("timeout", () => { request.destroy(); resolve(false); });
    request.on("error", () => resolve(false));
  });
}

async function startBundledLocalAgent() {
  const legacyOnline = await localAgentOnline(8787);
  const port = legacyOnline ? 8788 : 8787;
  if (await localAgentOnline(port)) return;
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, "local-agent", "server.js")
    : path.join(__dirname, "..", "local-agent", "server.js");
  localAgentProcess = spawn(process.execPath, [serverPath], {
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", LOCAL_AGENT_PORT: String(port) },
  });
  localAgentProcess.unref();
  console.log(`[desktop] NOVA Local Tools starting on 127.0.0.1:${port}`);
}

app.on("before-quit", () => {
  if (localAgentProcess && !localAgentProcess.killed) localAgentProcess.kill();
});

function notify(title, body) {
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title, body }).show();
  } catch (_) {
    // Les notifications ne doivent jamais bloquer le démarrage.
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
  await startBundledLocalAgent();
  await refreshWebRuntime();

  // On charge l'application historique seulement après le nettoyage du cache HTTP,
  // afin que le premier loadURL() récupère le dernier Cockpit déployé.
  require("./main.js");

  // Laisse la fenêtre commencer à se charger puis lance la vérification Electron.
  setTimeout(startAutoUpdater, 1500);
});
