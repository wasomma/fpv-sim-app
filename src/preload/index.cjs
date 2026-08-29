/*
 * Preload for the app's own panels only (app://app/...). The vendored
 * upstream pages load with no preload at all. Plain CJS on purpose:
 * sandboxed preloads do not support ESM.
 */

const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("fpvApp", {
  openWindow: (page, opts) => ipcRenderer.invoke("open-ui-window", { page, ...(opts || {}) }),
  openPanel: (name) => ipcRenderer.invoke("open-app-panel", name),
  info: () => ipcRenderer.invoke("app-info"),
  studies: {
    start: (opts) => ipcRenderer.invoke("study-start", opts),
    cancel: () => ipcRenderer.invoke("study-cancel"),
    status: () => ipcRenderer.invoke("study-status"),
    onOutput: (cb) => subscribe("study-output", cb),
    onDone: (cb) => subscribe("study-done", cb),
  },
});
