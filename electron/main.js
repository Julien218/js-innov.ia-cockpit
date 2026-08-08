const { app, BrowserWindow, shell, ipcMain, Notification, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const os = require("os");
const https = require("https");

let mainWindow = null;
let tray = null;
let splashTimer = null;
let updateAvailable = null;

// ── Version actuelle de l'app ────────────────────────────────────────────────
const APP_VERSION = "1.0.16";

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
