/*
 * fpv-sim-app — Electron main entry.
 *
 * Phase 1 scope: serve the vendored fpv-sim UIs from the app:// origin,
 * seed the per-user results store, provide the shell landing window, and
 * a --self-check mode for CI. Later phases add the MCP host, live
 * session host (utilityProcess), studies runners, and the DIS gateway.
 */

import { BrowserWindow, app, ipcMain } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";
import { installAppProtocol, registerAppScheme } from "./protocol.js";
import { engineRoot, pinsFile } from "./paths.js";
import { seedResultsIfEmpty } from "./results.js";
import { isSelfCheck, selfCheckAndExit } from "./self-check.js";
import { cancelStudy, startStudy, studyStatus, type StudyStartOpts } from "./studies/study-runner.js";
import { createShellWindow, openAppPanel, openUiWindow } from "./windows.js";

registerAppScheme();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win !== undefined) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    installAppProtocol();
    const seeding = seedResultsIfEmpty();
    if (seeding.seeded) console.log(`results store seeded at ${seeding.dir}`);

    ipcMain.handle("open-ui-window", (_event, args: unknown) => {
      const a = (args ?? {}) as { page?: unknown; seed?: unknown; mode?: unknown; play?: unknown };
      const page = typeof a.page === "string" ? a.page : "";
      const win = openUiWindow(page, {
        seed: typeof a.seed === "number" ? a.seed : undefined,
        mode: typeof a.mode === "string" ? a.mode : undefined,
        play: a.play === true,
      });
      return win !== null;
    });

    ipcMain.handle("open-app-panel", (_event, name: unknown) => {
      return openAppPanel(typeof name === "string" ? name : "") !== null;
    });

    ipcMain.handle("app-info", () => {
      let pins: unknown = null;
      try {
        pins = JSON.parse(readFileSync(pinsFile(), "utf8"));
      } catch {
        /* vendor step not run yet */
      }
      let engineVersion = "unknown";
      try {
        // The dependency's exports map blocks specifier access to its
        // package.json — read it by filesystem path instead.
        engineVersion = (
          JSON.parse(readFileSync(path.join(engineRoot(), "package.json"), "utf8")) as { version: string }
        ).version;
      } catch {
        /* dependency not installed */
      }
      return {
        appVersion: app.getVersion(),
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        engineVersion,
        pins,
      };
    });

    ipcMain.handle("study-start", (_event, opts: unknown) => startStudy(opts as StudyStartOpts));
    ipcMain.handle("study-cancel", () => cancelStudy());
    ipcMain.handle("study-status", () => studyStatus());

    if (isSelfCheck()) {
      await selfCheckAndExit();
      return;
    }
    createShellWindow();
  });

  app.on("window-all-closed", () => {
    // Self-check opens and destroys hidden windows between steps; quitting
    // here would end the run after the first one.
    if (!isSelfCheck()) app.quit();
  });
}
