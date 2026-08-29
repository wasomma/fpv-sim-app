/*
 * Preload for the app's own panels only (app://app/...). The vendored
 * upstream pages load with no preload at all. Plain CJS on purpose:
 * sandboxed preloads do not support ESM.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fpvApp", {
  openWindow: (page, opts) => ipcRenderer.invoke("open-ui-window", { page, ...(opts || {}) }),
  info: () => ipcRenderer.invoke("app-info"),
});
