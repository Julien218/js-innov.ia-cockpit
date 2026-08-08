const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  Notification,
  Tray,
  Menu,
  safeStorage,
} = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");

let mainWindow = null;
let tray = null;
let localAgentSettingsWindow = null;

const LOCAL_AGENT_DEFAULT_ENDPOINT = "http://127.0.0.1:8787";
const LOCAL_AGENT_CONFIG_FILE = "local-agent-config.json";

function getLocalAgentConfigPath() {
  return path.join(app.getPath("userData"), LOCAL_AGENT_CONFIG_FILE);
}

function isAllowedLoopbackEndpoint(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
    return ["http:", "https:"].includes(url.protocol) && loopbackHosts.has(host) && !url.username && !url.password;
  } catch (_) {
    return false;
  }
}

function readLocalAgentConfigRaw() {
  const configPath = getLocalAgentConfigPath();
  if (!fs.existsSync(configPath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (error) {
    console.error("[LOCAL AGENT] Configuration illisible:", error.message);
    return null;
  }
}

function decryptLocalAgentKey(config) {
  if (!config?.encryptedKey || !safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(config.encryptedKey, "base64"));
  } catch (error) {
    console.error("[LOCAL AGENT] Déchiffrement impossible:", error.message);
    return "";
  }
}

function getLocalAgentConfigPublic() {
  const config = readLocalAgentConfigRaw();
  const key = decryptLocalAgentKey(config);
  const endpoint = isAllowedLoopbackEndpoint(config?.endpoint)
    ? config.endpoint
    : LOCAL_AGENT_DEFAULT_ENDPOINT;

  return {
    configured: Boolean(key),
    endpoint,
    keyHint: key ? `••••••••${key.slice(-4)}` : "",
    updatedAt: config?.updatedAt || null,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  };
}

function saveLocalAgentConfig({ endpoint, apiKey }) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Le chiffrement système n'est pas disponible sur cet appareil. La clé n'a pas été enregistrée.");
  }

  const normalizedEndpoint = String(endpoint || LOCAL_AGENT_DEFAULT_ENDPOINT).trim();
  if (!isAllowedLoopbackEndpoint(normalizedEndpoint)) {
    throw new Error("L'agent local doit utiliser localhost, 127.0.0.1 ou ::1.");
  }

  const key = String(apiKey || "").trim();
  const existing = readLocalAgentConfigRaw();
  const existingKey = decryptLocalAgentKey(existing);
  const finalKey = key || existingKey;

  if (!finalKey || finalKey.length < 8 || finalKey.length > 512) {
    throw new Error("La clé API de l'agent local est absente ou invalide.");
  }

  const encryptedKey = safeStorage.encryptString(finalKey).toString("base64");
  const payload = {
    version: 1,
    endpoint: normalizedEndpoint.replace(/\/$/, ""),
    encryptedKey,
    updatedAt: new Date().toISOString(),
  };

  const configPath = getLocalAgentConfigPath();
  const tempPath = `${configPath}.tmp`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tempPath, configPath);

  return getLocalAgentConfigPublic();
}

function clearLocalAgentConfig() {
  const configPath = getLocalAgentConfigPath();
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  return getLocalAgentConfigPublic();
}

function isSettingsSender(event) {
  try {
    const senderUrl = new URL(event.senderFrame.url);
    return senderUrl.protocol === "file:" && senderUrl.pathname.endsWith("/agent-settings.html");
  } catch (_) {
    return false;
  }
}

async function testLocalAgentConnection() {
  const config = readLocalAgentConfigRaw();
  const key = decryptLocalAgentKey(config);
  const endpoint = isAllowedLoopbackEndpoint(config?.endpoint)
    ? config.endpoint
    : LOCAL_AGENT_DEFAULT_ENDPOINT;

  if (!key) {
    throw new Error("Aucune clé API locale n'est enregistrée.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/health`, {
      method: "GET",
      headers: {
        "x-agent-key": key,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? "Agent local joignable" : `Agent local répond HTTP ${response.status}`,
      detail: text.slice(0, 300),
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Délai dépassé : agent local non joignable.");
    throw new Error(`Agent local non joignable : ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function createLocalAgentSettingsWindow() {
  if (localAgentSettingsWindow && !localAgentSettingsWindow.isDestroyed()) {
    localAgentSettingsWindow.show();
    localAgentSettingsWindow.focus();
    return localAgentSettingsWindow;
  }

  localAgentSettingsWindow = new BrowserWindow({
    width: 560,
    height: 560,
    minWidth: 520,
    minHeight: 520,
    resizable: false,
    autoHideMenuBar: true,
    title: "Agent local — JS-Innov.IA Cockpit",
    icon: path.join(__dirname, "icon.png"),
    parent: mainWindow || undefined,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: true,
    },
    backgroundColor: "#0B0B0F",
  });

  localAgentSettingsWindow.removeMenu();
  localAgentSettingsWindow.loadFile(path.join(__dirname, "agent-settings.html"));
  localAgentSettingsWindow.on("closed", () => {
    localAgentSettingsWindow = null;
  });

  return localAgentSettingsWindow;
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

  return mainWindow;
}

// ── Tray icon ───────────────────────────────────────────────────────────────
function createTray() {
  try {
    tray = new Tray(path.join(__dirname, "icon.png"));
    const menu = Menu.buildFromTemplate([
      { label: "Ouvrir le Cockpit", click: () => mainWindow && mainWindow.show() },
      {
        label: "Configurer l'agent local",
        click: () => createLocalAgentSettingsWindow(),
      },
      { type: "separator" },
      { label: "Quitter", click: () => app.quit() },
    ]);
    tray.setToolTip("JS-Innov.IA Cockpit");
    tray.setContextMenu(menu);
    tray.on("double-click", () => mainWindow && mainWindow.show());
  } catch (e) {
    console.log("Tray non disponible:", e.message);
  }
}

// ── IPC — Notifications ─────────────────────────────────────────────────────
ipcMain.on("notify", (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title: title || "JS-Innov.IA", body: body || "" }).show();
  }
});

// ── IPC — Configuration chiffrée de l'agent local ───────────────────────────
ipcMain.handle("local-agent-config:get", () => getLocalAgentConfigPublic());

ipcMain.handle("local-agent-config:open", () => {
  createLocalAgentSettingsWindow();
  return { ok: true };
});

ipcMain.handle("local-agent-config:save", (event, payload) => {
  if (!isSettingsSender(event)) throw new Error("Accès refusé à la configuration locale.");
  return saveLocalAgentConfig(payload || {});
});

ipcMain.handle("local-agent-config:clear", (event) => {
  if (!isSettingsSender(event)) throw new Error("Accès refusé à la configuration locale.");
  return clearLocalAgentConfig();
});

ipcMain.handle("local-agent-config:test", (event) => {
  if (!isSettingsSender(event)) throw new Error("Accès refusé à la configuration locale.");
  return testLocalAgentConnection();
});

// ── Boot ────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const splash = createSplash();
  const win = createWindow();

  win.webContents.on("did-finish-load", () => {
    setTimeout(() => {
      splash.close();
      win.show();
      if (os.platform() !== "darwin") createTray();

      // Première installation / clé absente : ouvrir une seule fois le panneau
      // de configuration afin que la clé soit enregistrée dans le coffre chiffré.
      if (!getLocalAgentConfigPublic().configured) {
        createLocalAgentSettingsWindow();
      }
    }, 1200);
  });

  win.webContents.on("did-fail-load", () => {
    splash.close();
    win.show();
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
  if (process.platform !== "darwin") app.quit();
});
