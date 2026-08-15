const { app, BrowserWindow, shell, ipcMain, Notification, Tray, Menu, nativeImage } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");

let mainWindow = null;
let tray = null;
let splashTimer = null;
let updateAvailable = null;
let updateDownloaded = false;
let localAgentStartPromise = null;
let localAgentStatus = { status: "checking", message: "Démarrage de l’IA locale…" };

const LOCAL_AGENT_HEALTH_URL = "http://127.0.0.1:8787/health";

// ── Helper: vérifier qu'une fenêtre est toujours vivante ────────────────────
function isAlive(win) {
  return win && !win.isDestroyed();
}

// ── Mise à jour automatique depuis les releases GitHub ──────────────────────
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

// ── IA locale — démarrage silencieux et non bloquant ───────────────────────
function sendLocalAgentStatus(status, message) {
  localAgentStatus = { status, message };
  if (isAlive(mainWindow)) mainWindow.webContents.send("local-agent-status", localAgentStatus);
}

function isLocalAgentReady(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const request = http.get(LOCAL_AGENT_HEALTH_URL, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(timeoutMs, () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

function resolveLocalAgentFile() {
  const documents = app.getPath("documents");
  const candidates = [
    process.env.JSINNOVIA_LOCAL_AGENT_FILE,
    path.join(documents, "JS-Innov.IA", "local-agent", "server.mjs"),
    path.join(documents, "Codex", "2026-08-06", "referenced-chatgpt-conversation-this-is-an-2", "local-agent", "server.mjs"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function resolveNodeExecutable() {
  const candidates = [
    process.env.JSINNOVIA_NODE_EXE,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "nodejs", "node.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "nodejs", "node.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "node.exe";
}

async function waitForLocalAgent(attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isLocalAgentReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function startLocalAgent() {
  if (localAgentStartPromise) return localAgentStartPromise;
  localAgentStartPromise = (async () => {
    sendLocalAgentStatus("checking", "Connexion à l’IA locale…");
    if (await isLocalAgentReady()) {
      sendLocalAgentStatus("ready", "IA locale opérationnelle");
      return true;
    }

    const agentFile = resolveLocalAgentFile();
    if (!agentFile) {
      sendLocalAgentStatus("unavailable", "Agent IA local introuvable — le Cockpit reste accessible en ligne");
      return false;
    }

    try {
      const child = spawn(resolveNodeExecutable(), ["--use-system-ca", agentFile], {
        cwd: path.dirname(agentFile),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", (error) => {
        console.log("Local agent launch error:", error.message);
      });
      child.unref();
    } catch (error) {
      console.log("Local agent launch error:", error.message);
      sendLocalAgentStatus("unavailable", "L’IA locale n’a pas pu démarrer — le Cockpit reste accessible en ligne");
      return false;
    }

    if (await waitForLocalAgent()) {
      sendLocalAgentStatus("ready", "IA locale opérationnelle");
      return true;
    }
    sendLocalAgentStatus("unavailable", "L’IA locale ne répond pas — nouvelle tentative au prochain démarrage");
    return false;
  })();
  return localAgentStartPromise;
}

function sendUpdateEvent(channel, payload) {
  if (isAlive(mainWindow)) mainWindow.webContents.send(channel, payload);
}

function refreshTrayMenu() {
  if (!tray) return;
  const updateLabel = updateDownloaded
    ? `Installer la mise à jour ${updateAvailable?.version || ""}`.trim()
    : updateAvailable
      ? `Téléchargement de ${updateAvailable.version}…`
      : "Vérifier les mises à jour";
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Ouvrir le Cockpit", click: () => { if (isAlive(mainWindow)) mainWindow.show(); else createWindow().show(); } },
    { type: "separator" },
    { label: updateLabel, click: installOrCheckForUpdate },
    { type: "separator" },
    { label: "Quitter", click: () => app.quit() },
  ]));
}

function checkForUpdates(silent = true) {
  if (!app.isPackaged) {
    if (!silent) notify("JS-Innov.IA Cockpit", "Les mises à jour automatiques sont actives dans la version installée.");
    return Promise.resolve();
  }
  return autoUpdater.checkForUpdates().then((result) => {
    if (!result?.updateInfo && !silent) notify("JS-Innov.IA Cockpit", "Votre application est à jour.");
  }).catch((error) => {
    console.log("Update check error:", error.message);
    if (!silent) notify("Mise à jour indisponible", "Le cockpit réessaiera automatiquement au prochain démarrage.");
  });
}

function installOrCheckForUpdate() {
  if (updateDownloaded) return autoUpdater.quitAndInstall(false, true);
  return checkForUpdates(false);
}

autoUpdater.on("update-available", (info) => {
  updateAvailable = info;
  updateDownloaded = false;
  refreshTrayMenu();
  notify("Mise à jour JS-Innov.IA", `La version ${info.version} se télécharge en arrière-plan.`);
  sendUpdateEvent("update-available", info);
});

autoUpdater.on("download-progress", (progress) => {
  sendUpdateEvent("update-progress", { percent: Math.round(progress.percent || 0) });
});

autoUpdater.on("update-downloaded", (info) => {
  updateAvailable = info;
  updateDownloaded = true;
  refreshTrayMenu();
  notify("Mise à jour prête", `La version ${info.version} sera installée automatiquement à la fermeture du cockpit.`);
  sendUpdateEvent("update-downloaded", info);
});

autoUpdater.on("error", (error) => {
  console.log("Auto update error:", error.message);
  sendUpdateEvent("update-error", { message: "La mise à jour sera retentée au prochain démarrage." });
});

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
    tray.setToolTip("JS-Innov.IA Cockpit");
    refreshTrayMenu();
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
  installOrCheckForUpdate();
});

ipcMain.on("install-update", () => {
  if (updateDownloaded) autoUpdater.quitAndInstall(false, true);
});

// ── Boot ────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Ne bloque jamais l’ouverture du Cockpit pendant le démarrage de l’agent.
  startLocalAgent().catch((error) => console.log("Local agent startup error:", error.message));
  const splash = createSplash();
  const win = createWindow();

  win.webContents.on("did-finish-load", () => {
    sendLocalAgentStatus(localAgentStatus.status, localAgentStatus.message);
    if (splashTimer) clearTimeout(splashTimer);
    splashTimer = setTimeout(() => {
      splashTimer = null;
      if (isAlive(splash)) splash.close();
      if (isAlive(win)) {
        win.show();
        if (os.platform() !== "darwin") createTray();
        // Vérifier les mises à jour 3s après le démarrage (silencieux)
        setTimeout(() => checkForUpdates(true), 3000);
      }
    }, 1200);
  });

  win.webContents.on("did-fail-load", () => {
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

