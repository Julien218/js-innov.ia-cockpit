const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  notify: (title, body) => ipcRenderer.send("notify", { title, body }),
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
  downloadUpdate: () => ipcRenderer.send("download-update"),
  onUpdateAvailable: (callback) => {
    ipcRenderer.on("update-available", (event, data) => callback(data));
  },
  videoLocal: {
    status: () => ipcRenderer.invoke("video-local-status"),
    queue: ({ workflow, clientId }) => ipcRenderer.invoke("video-local-queue", { workflow, clientId }),
    history: (promptId) => ipcRenderer.invoke("video-local-history", promptId),
    batchQueue: (payload) => ipcRenderer.invoke("video-local-batch-queue", payload),
    batchStatus: (batchId) => ipcRenderer.invoke("video-local-batch-status", batchId),
    batchList: () => ipcRenderer.invoke("video-local-batch-list"),
    batchCancel: (batchId) => ipcRenderer.invoke("video-local-batch-cancel", batchId),

    interrupt: () => ipcRenderer.invoke("video-local-interrupt"),
    uploadImage: ({ name, dataUrl }) => ipcRenderer.invoke("video-local-upload-image", { name, dataUrl }),
    finalize: ({ bytes, metadata }) => ipcRenderer.invoke("video-local-finalize", { bytes, metadata }),
    openOutputFolder: () => ipcRenderer.invoke("video-local-open-output"),
  },
});
