const { contextBridge, ipcRenderer } = require("electron");

// Expose API sécurisée au renderer (cockpit React)
contextBridge.exposeInMainWorld("electronAPI", {
  // Envoyer une notification Windows native
  notify: (title, body) => ipcRenderer.send("notify", { title, body }),
  // Version de lapp
  version: () => process.env.npm_package_version || "1.0.0",
  // Plateforme
  platform: () => process.platform,
});

