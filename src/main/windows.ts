/*
 * Window construction and navigation policy.
 *
 * The three vendored upstream pages need zero Node access, so their
 * windows are fully sandboxed with no preload at all. Only the app's own
 * panels (app://app/...) get the contextBridge preload. Navigation and
 * window.open stay inside app://ui/ (the dashboard's WATCH links open the
 * sim in a new window); external http(s) links go to the default browser.
 */

import { BrowserWindow, shell } from "electron";
import { preloadPath } from "./paths.js";

const UI_PAGES: Record<string, string> = {
  sim: "index.html",
  dashboard: "dashboard.html",
  viewer3d: "viewer3d.html",
};

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

export function openAppUrl(
  url: string,
  opts: { show?: boolean; backgroundThrottling?: boolean } = {},
): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    show: opts.show ?? true,
    autoHideMenuBar: true,
    backgroundColor: "#10140f",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Hidden windows throttle requestAnimationFrame, which drives the
      // sim page's own loop — the self-check turns throttling off.
      backgroundThrottling: opts.backgroundThrottling ?? true,
    },
  });
  applyNavPolicy(win);
  void win.loadURL(url);
  return win;
}

/** Open one of the vendored upstream pages with validated deep-link params. */
export function openUiWindow(
  page: string,
  opts: { seed?: number; mode?: string; play?: boolean } = {},
): BrowserWindow | null {
  const file = UI_PAGES[page];
  if (file === undefined) return null;
  const params = new URLSearchParams();
  if (opts.seed !== undefined && Number.isInteger(opts.seed) && opts.seed >= 0 && opts.seed <= 4294967295) {
    params.set("seed", String(opts.seed));
  }
  if (opts.mode === "tactical") params.set("mode", "tactical");
  if (opts.play === true) params.set("play", "1");
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return openAppUrl(`app://ui/${file}${query}`);
}

export function createShellWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 860,
    height: 640,
    autoHideMenuBar: true,
    backgroundColor: "#10140f",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath(),
    },
  });
  applyNavPolicy(win);
  void win.loadURL("app://app/shell/index.html");
  return win;
}
