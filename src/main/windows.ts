/*
 * Window construction and navigation policy.
 *
 * The three vendored upstream pages need zero Node access, so their
 * windows are fully sandboxed with no preload at all. Only the app's own
 * panels (app://app/...) get the contextBridge preload. Navigation and
 * window.open stay inside app://ui/ (the dashboard's WATCH links open the
 * sim in a new window); external http(s) links go to the default browser.
 *
 * Every window has a kind. The kind decides default and minimum size,
 * the paint-before-load color, whether a second open focuses the existing
 * window (panels, launcher, dashboard) or adds another (sim, viewer3d —
 * different seeds side by side), and where its bounds are remembered.
 * Headless runs (self-check, screenshots) get fresh windows at default
 * sizes and never write bounds.
 */

import { BrowserWindow, screen, shell } from "electron";
import { isHeadless } from "./mode.js";
import { devWindowIcon, preloadPath } from "./paths.js";
import { getUi, setUi } from "./settings.js";
import { type SavedBounds, fitBounds, isSavedBounds, titleForUiUrl, uiKindForUrl } from "./window-layout.js";

export type WindowKind = "shell" | "studies" | "mcp" | "live-ops" | "sim" | "dashboard" | "viewer3d";

interface KindSpec {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  /** Painted before the page loads; matches each page's own ground so nothing flashes. */
  background: string;
  /** One window at a time: a second open focuses the first. */
  single: boolean;
  title: string;
}

// One ground for every page: the upstream pages' --bg, which the app's
// own panels adopt in src/renderer/shared/app.css.
const PAGE_BG = "#0b0e10";

const SPEC: Record<WindowKind, KindSpec> = {
  shell: { width: 860, height: 640, minWidth: 640, minHeight: 480, background: PAGE_BG, single: true, title: "FPV Sim" },
  studies: { width: 1100, height: 780, minWidth: 720, minHeight: 520, background: PAGE_BG, single: true, title: "Studies — FPV Sim" },
  mcp: { width: 1100, height: 780, minWidth: 720, minHeight: 520, background: PAGE_BG, single: true, title: "MCP Endpoint — FPV Sim" },
  "live-ops": { width: 1100, height: 780, minWidth: 720, minHeight: 520, background: PAGE_BG, single: true, title: "Live Ops — FPV Sim" },
  sim: { width: 1440, height: 920, minWidth: 960, minHeight: 640, background: PAGE_BG, single: false, title: "Simulation — FPV Sim" },
  dashboard: { width: 1440, height: 920, minWidth: 960, minHeight: 640, background: PAGE_BG, single: true, title: "Dashboard — FPV Sim" },
  viewer3d: { width: 1440, height: 920, minWidth: 960, minHeight: 640, background: PAGE_BG, single: false, title: "3D Viewer — FPV Sim" },
};

const UI_PAGES: Record<string, string> = {
  sim: "index.html",
  dashboard: "dashboard.html",
  viewer3d: "viewer3d.html",
};

const APP_PANELS = new Set<WindowKind>(["studies", "mcp", "live-ops"]);

export interface OpenOpts {
  show?: boolean;
  backgroundThrottling?: boolean;
  /** Always construct a new window, even for single-instance kinds. */
  fresh?: boolean;
}

/* ------------------------------------------------------------------ */
/* navigation                                                          */

function applyNavPolicy(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("app://ui/")) {
      openAppUrl(url);
      return { action: "deny" }; // we opened it ourselves with the right prefs
    }
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://")) {
      event.preventDefault();
      if (url.startsWith("https://") || url.startsWith("http://")) {
        void shell.openExternal(url);
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* remembered bounds                                                   */

const BOUNDS_DEBOUNCE_MS = 400;

function savedBoundsFor(kind: WindowKind): SavedBounds | undefined {
  const all = getUi("windows");
  if (typeof all !== "object" || all === null) return undefined;
  const b = (all as Record<string, unknown>)[kind];
  return isSavedBounds(b) ? b : undefined;
}

function rememberBounds(win: BrowserWindow, kind: WindowKind): void {
  const write = (): void => {
    if (win.isDestroyed()) return;
    const n = win.getNormalBounds();
    const rec: SavedBounds = { x: n.x, y: n.y, width: n.width, height: n.height, maximized: win.isMaximized() };
    const all = getUi("windows");
    const next: Record<string, unknown> = typeof all === "object" && all !== null ? { ...(all as Record<string, unknown>) } : {};
    next[kind] = rec;
    setUi("windows", next);
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const soon = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      write();
    }, BOUNDS_DEBOUNCE_MS);
  };
  win.on("resize", soon);
  win.on("move", soon);
  win.on("maximize", soon);
  win.on("unmaximize", soon);
  win.on("close", () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    write();
  });
}

/* ------------------------------------------------------------------ */
/* construction                                                        */

const single = new Map<WindowKind, BrowserWindow>();

function track(kind: WindowKind, win: BrowserWindow): void {
  single.set(kind, win);
  win.on("closed", () => {
    if (single.get(kind) === win) single.delete(kind);
  });
}

/** Bring an existing single-instance window forward, or null if there is none. */
export function focusExisting(kind: WindowKind): BrowserWindow | null {
  const win = single.get(kind);
  if (win === undefined || win.isDestroyed()) return null;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  return win;
}

function makeWindow(kind: WindowKind, opts: OpenOpts, preload: string | null): BrowserWindow {
  const spec = SPEC[kind];
  const headless = isHeadless();
  const saved = headless ? undefined : savedBoundsFor(kind);
  const displays = screen.getAllDisplays().map((d) => d.workArea);
  const placement = fitBounds(saved, displays, screen.getPrimaryDisplay().workArea, spec);
  const icon = devWindowIcon();
  const win = new BrowserWindow({
    ...(icon !== null ? { icon } : {}),
    ...(placement.x !== undefined && placement.y !== undefined ? { x: placement.x, y: placement.y } : {}),
    width: placement.width,
    height: placement.height,
    minWidth: Math.min(spec.minWidth, placement.width),
    minHeight: Math.min(spec.minHeight, placement.height),
    show: opts.show ?? true,
    autoHideMenuBar: true,
    backgroundColor: spec.background,
    title: spec.title,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      ...(preload !== null ? { preload } : {}),
      // Hidden windows throttle requestAnimationFrame, which drives the
      // sim page's own loop — the self-check turns throttling off.
      backgroundThrottling: opts.backgroundThrottling ?? true,
    },
  });
  if (placement.maximized && !headless) win.maximize();
  applyNavPolicy(win);
  if (!headless) rememberBounds(win, kind);
  if (spec.single && !headless && opts.fresh !== true) track(kind, win);
  return win;
}

/** Upstream pages carry no useful <title>; name the window after its URL (seed, mode). */
function titleFromUrl(win: BrowserWindow): void {
  const apply = (): void => {
    if (!win.isDestroyed()) win.setTitle(titleForUiUrl(win.webContents.getURL()));
  };
  win.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    apply();
  });
  win.webContents.on("did-finish-load", apply);
  win.webContents.on("did-navigate-in-page", apply);
}

/** Open any app://ui/ URL (deep links from the dashboard's WATCH arrive here). */
export function openAppUrl(url: string, opts: OpenOpts = {}): BrowserWindow {
  const kind = uiKindForUrl(url) ?? "sim";
  const win = makeWindow(kind, opts, null);
  titleFromUrl(win);
  void win.loadURL(url);
  return win;
}

/** Open one of the vendored upstream pages with validated deep-link params. */
export function openUiWindow(
  page: string,
  opts: { seed?: number; mode?: string; play?: boolean } & OpenOpts = {},
): BrowserWindow | null {
  const file = UI_PAGES[page];
  if (file === undefined) return null;
  if (page === "dashboard" && opts.fresh !== true) {
    // WATCH navigates a dashboard window to the sim in place; only a
    // window still showing the dashboard counts as "the dashboard".
    const existing = single.get("dashboard");
    if (existing !== undefined && !existing.isDestroyed()) {
      if (existing.webContents.getURL().startsWith("app://ui/dashboard.html")) return focusExisting("dashboard");
      single.delete("dashboard");
    }
  }
  const params = new URLSearchParams();
  if (opts.seed !== undefined && Number.isInteger(opts.seed) && opts.seed >= 0 && opts.seed <= 4294967295) {
    params.set("seed", String(opts.seed));
  }
  if (opts.mode === "tactical") params.set("mode", "tactical");
  if (opts.play === true) params.set("play", "1");
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return openAppUrl(`app://ui/${file}${query}`, opts);
}

/** Open (or focus) one of the app's own panel pages (preload + contextBridge). */
export function openAppPanel(name: string, opts: OpenOpts = {}): BrowserWindow | null {
  if (!APP_PANELS.has(name as WindowKind)) return null;
  const kind = name as WindowKind;
  if (opts.fresh !== true) {
    const existing = focusExisting(kind);
    if (existing !== null) return existing;
  }
  const win = makeWindow(kind, opts, preloadPath());
  void win.loadURL(`app://app/${name}/index.html`);
  return win;
}

/** Always construct a launcher window (the headless drivers use this). */
export function createShellWindow(opts: OpenOpts = {}): BrowserWindow {
  const win = makeWindow("shell", opts, preloadPath());
  void win.loadURL("app://app/shell/index.html");
  return win;
}

/** Focus the launcher if it is open, else create it. */
export function showShellWindow(): BrowserWindow {
  return focusExisting("shell") ?? createShellWindow();
}

/** Reload every window currently showing the dashboard so a new dataset appears. */
export function reloadDashboardWindows(): number {
  let n = 0;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (win.webContents.getURL().startsWith("app://ui/dashboard.html")) {
      win.webContents.reload();
      n++;
    }
  }
  return n;
}
