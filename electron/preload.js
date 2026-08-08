const { contextBridge, ipcRenderer } = require("electron");

// API sécurisée exposée au renderer.
// Les secrets ne sont jamais renvoyés en clair au cockpit web.
contextBridge.exposeInMainWorld("electronAPI", {
  notify: (title, body) => ipcRenderer.send("notify", { title, body }),
  version: () => process.env.npm_package_version || "1.0.0",
  platform: () => process.platform,

  localAgent: {
    getConfig: () => ipcRenderer.invoke("local-agent-config:get"),
    openSettings: () => ipcRenderer.invoke("local-agent-config:open"),
    saveConfig: (payload) => ipcRenderer.invoke("local-agent-config:save", payload),
    clearConfig: () => ipcRenderer.invoke("local-agent-config:clear"),
    testConnection: () => ipcRenderer.invoke("local-agent-config:test"),
  },
});
