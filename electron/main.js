const { app, BrowserWindow, shell, ipcMain, Notification, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const os = require("os");

let mainWindow = null;
let tray = null;
let splashTimer = null;

// ── Helper: vérifier qu'une fenêtre est toujours vivante ────────────────────
function isAlive(win) {
  return win && !win.isDestroyed();
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

  // ── Nettoyer la référence quand la fenêtre est fermée ──
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

// ── Boot ────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const splash = createSplash();
  const win = createWindow();

  win.webContents.on("did-finish-load", () => {
    // Annuler tout timer précédent pour éviter les callbacks orphelins
    if (splashTimer) clearTimeout(splashTimer);
    splashTimer = setTimeout(() => {
      splashTimer = null;
      // Vérifier que les objets sont toujours vivants avant d'agir
      if (isAlive(splash)) splash.close();
      if (isAlive(win)) {
        win.show();
        if (os.platform() !== "darwin") createTray();
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
  // Nettoyer les timers avant de quitter
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  if (process.platform !== "darwin") app.quit();
});

// ── Nettoyage global à la fermeture ─────────────────────────────────────────
app.on("before-quit", () => {
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  tray = null;
  mainWindow = null;
});
