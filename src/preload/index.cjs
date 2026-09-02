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
  mcp: {
    status: () => ipcRenderer.invoke("mcp-status"),
    health: () => ipcRenderer.invoke("mcp-health"),
    snippets: () => ipcRenderer.invoke("mcp-snippets"),
    setPort: (port) => ipcRenderer.invoke("mcp-set-port", port),
    regenerateToken: () => ipcRenderer.invoke("mcp-regenerate-token"),
  },
  live: {
    start: (opts) => ipcRenderer.invoke("live-start", opts),
    stop: () => ipcRenderer.invoke("live-stop"),
    pause: () => ipcRenderer.invoke("live-pause"),
    resume: () => ipcRenderer.invoke("live-resume"),
    setSpeed: (speed) => ipcRenderer.invoke("live-set-speed", speed),
    status: () => ipcRenderer.invoke("live-status"),
    snapshot: (eventsAfter) => ipcRenderer.invoke("live-snapshot", eventsAfter),
    configureGateway: (cfg) => ipcRenderer.invoke("live-configure-gateway", cfg),
    gatewayStatus: () => ipcRenderer.invoke("live-gateway-status"),
    onSnapshot: (cb) => subscribe("live-snapshot", cb),
    onEnded: (cb) => subscribe("live-ended", cb),
  },
});
