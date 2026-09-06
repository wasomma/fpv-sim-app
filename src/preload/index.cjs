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
  // The launcher's status strip: {studies, live, mcp: {text, cls}, busy}.
  status: () => ipcRenderer.invoke("app-status"),
  // "manual" | "changelog" | "issues" — the same targets as the Help menu.
  openHelp: (target) => ipcRenderer.invoke("open-help", target),
  ui: {
    // Renderer-owned persisted state (settings.json `ui` bag): last-used
    // inputs, the last staged gateway text, window bounds. Opaque JSON.
    get: (key) => ipcRenderer.invoke("ui-get", key),
    set: (key, value) => ipcRenderer.invoke("ui-set", { key, value }),
    // Native confirm: { message, detail?, confirmLabel?, cancelLabel? } -> boolean.
    // Headless runs answer true without showing anything.
    confirm: (opts) => ipcRenderer.invoke("ui-confirm", opts),
  },
  studies: {
    start: (opts) => ipcRenderer.invoke("study-start", opts),
    cancel: () => ipcRenderer.invoke("study-cancel"),
    status: () => ipcRenderer.invoke("study-status"),
    reveal: (file) => ipcRenderer.invoke("study-reveal", { file }),
    openResultsFolder: () => ipcRenderer.invoke("results-open-folder"),
    schema: () => ipcRenderer.invoke("study-schema"),
    validateOverrides: (text) => ipcRenderer.invoke("study-validate-overrides", text),
    onOutput: (cb) => subscribe("study-output", cb),
    onDone: (cb) => subscribe("study-done", cb),
  },
  results: {
    // The DATASETS box: every manifest entry (with a `missing` flag),
    // .json files the manifest does not list, and the bundled set.
    list: () => ipcRenderer.invoke("results-list"),
    // Mutations are refused while a run is active; each one reloads any
    // open dashboard window and reports how many (`reloaded`).
    remove: (file) => ipcRenderer.invoke("results-delete", { file }),
    relabel: (file, label) => ipcRenderer.invoke("results-relabel", { file, label }),
    register: (file) => ipcRenderer.invoke("results-register", { file }),
    restore: (file) => ipcRenderer.invoke("results-restore", { file }),
    // Native save dialog; { ok: true, to: null } means the user cancelled.
    export: (file) => ipcRenderer.invoke("results-export", { file }),
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
    gatewayPresets: () => ipcRenderer.invoke("live-gateway-presets"),
    onSnapshot: (cb) => subscribe("live-snapshot", cb),
    onEnded: (cb) => subscribe("live-ended", cb),
  },
});
