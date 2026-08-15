const { app, BrowserWindow, shell, ipcMain, Notification, Tray, Menu, nativeImage } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const os = require("os");

let mainWindow = null;
let tray = null;
let splashTimer = null;
let updateAvailable = null;
let updateDownloaded = false;

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
  const splash = createSplash();
  const win = createWindow();

  win.webContents.on("did-finish-load", () => {
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
