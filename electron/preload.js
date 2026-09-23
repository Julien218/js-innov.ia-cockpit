const { contextBridge, ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("electron-cockpit");
  document.body?.classList.add("electron-cockpit");
});

contextBridge.exposeInMainWorld("electronAPI", {
  notify: (title, body) => ipcRenderer.send("notify", { title, body }),
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
  downloadUpdate: () => ipcRenderer.send("download-update"),
  windowControls: {
    minimize: () => ipcRenderer.send("window-minimize"),
    toggleMaximize: () => ipcRenderer.send("window-toggle-maximize"),
    close: () => ipcRenderer.send("window-close"),
  },
  webAssistant: {
    execute: (task) => ipcRenderer.invoke("nova-web-assistant-execute", task),
  },
  localVoice: {
    transcribe: ({ bytes, mimeType }) => ipcRenderer.invoke("elynea-local-voice-transcribe", { bytes, mimeType }),
  },
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
    createReview: (batchId) => ipcRenderer.invoke("video-local-batch-review", batchId),
    publishChoice: (payload) => ipcRenderer.invoke("video-local-batch-publish", payload),
    openGeneratedFolder: (generatedPath) => ipcRenderer.invoke("video-local-generated-open-folder", generatedPath),
    openReviewFolder: (reviewPath) => ipcRenderer.invoke("video-local-review-open-folder", reviewPath),

    interrupt: () => ipcRenderer.invoke("video-local-interrupt"),
    uploadImage: ({ name, dataUrl }) => ipcRenderer.invoke("video-local-upload-image", { name, dataUrl }),
    finalize: ({ bytes, metadata }) => ipcRenderer.invoke("video-local-finalize", { bytes, metadata }),
    openOutputFolder: () => ipcRenderer.invoke("video-local-open-output"),
  },
});
