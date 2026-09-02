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
import { mcpHostStatus, restartMcpHost, setServerExtender, startMcpHost } from "./mcp/host.js";
import { registerLiveTools } from "./mcp/live-tools.js";
import { seedResultsIfEmpty } from "./results.js";
import {
  liveConfigureGateway,
  liveGatewayStatus,
  livePause,
  liveResume,
  liveSetSpeed,
  liveSnapshot,
  liveStart,
  liveStatus,
  liveStop,
  type LiveStartOpts,
} from "./sessions/session-manager.js";
import { getSettings, regenerateMcpToken, setMcpPort } from "./settings.js";
import { isScreenshots, prepareScreenshotsBoot, screenshotsAndExit } from "./screenshots.js";
import { isSelfCheck, selfCheckAndExit } from "./self-check.js";
import { cancelStudy, startStudy, studyStatus, type StudyStartOpts } from "./studies/study-runner.js";
import { createShellWindow, openAppPanel, openUiWindow } from "./windows.js";

// Screenshot mode redirects userData to a scratch dir; it must happen before
// the single-instance lock (derived from userData) and before anything reads
// settings or the results store.
if (isScreenshots()) prepareScreenshotsBoot();

registerAppScheme();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  /*
   * A second normal launch just focuses the running window (see the
   * "second-instance" handler below), and quitting is the right answer.
   * A headless run must not do that: app.quit() here exits 0 having done
   * nothing, so `npm run self-check` reports success without running a
   * single check. Fail loudly instead, the way screenshot mode already
   * does when it finds the MCP port taken.
   *
   * Screenshot mode redirects userData above and so derives its own lock;
   * it is covered here only so that a future change which stops doing that
   * surfaces as an error rather than a vacuous pass.
   */
  const headlessMode = isSelfCheck() ? "SELF-CHECK" : isScreenshots() ? "SCREENSHOTS" : null;
  if (headlessMode !== null) {
    console.error(
      `${headlessMode} abort: another FPV Sim instance holds the single-instance lock. ` +
        "Close it and retry.",
    );
    app.exit(1);
  } else {
    app.quit();
  }
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

    ipcMain.handle("mcp-status", () => mcpHostStatus());
    ipcMain.handle("mcp-health", async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${mcpHostStatus().port}/healthz`);
        return r.ok;
      } catch {
        return false;
      }
    });
    ipcMain.handle("mcp-snippets", () => {
      const { port, token } = getSettings().mcp;
      const url = `http://127.0.0.1:${port}/mcp`;
      return {
        cli: `claude mcp add --transport http fpv-sim-app ${url} --header "Authorization: Bearer ${token}"`,
        json: JSON.stringify(
          {
            mcpServers: {
              "fpv-sim-app": { type: "http", url, headers: { Authorization: `Bearer ${token}` } },
            },
          },
          null,
          2,
        ),
      };
    });
    ipcMain.handle("mcp-set-port", async (_event, port: unknown) => {
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535) {
        return { ok: false, error: "port must be an integer in 1024..65535" };
      }
      setMcpPort(port);
      return restartMcpHost();
    });
    ipcMain.handle("mcp-regenerate-token", () => {
      regenerateMcpToken();
      return { ok: true };
    });

    ipcMain.handle("live-start", (_event, opts: unknown) => liveStart(opts as LiveStartOpts));
    ipcMain.handle("live-stop", () => liveStop());
    ipcMain.handle("live-pause", () => livePause());
    ipcMain.handle("live-resume", () => liveResume());
    ipcMain.handle("live-set-speed", (_event, speed: unknown) => liveSetSpeed(speed as number));
    ipcMain.handle("live-status", () => liveStatus());
    ipcMain.handle("live-snapshot", (_event, eventsAfter: unknown) =>
      liveSnapshot(typeof eventsAfter === "number" ? eventsAfter : 0),
    );
    ipcMain.handle("live-configure-gateway", (_event, cfg: unknown) => liveConfigureGateway(cfg));
    ipcMain.handle("live-gateway-status", () => liveGatewayStatus());

    setServerExtender((server) => registerLiveTools(server));
    const mcpStart = await startMcpHost();
    if (!mcpStart.ok) console.error(`mcp host failed to start: ${mcpStart.error}`);

    if (isSelfCheck()) {
      await selfCheckAndExit();
      return;
    }
    if (isScreenshots()) {
      await screenshotsAndExit();
      return;
    }
    createShellWindow();
  });

  app.on("window-all-closed", () => {
    // Self-check and screenshot mode open and destroy windows between steps;
    // quitting here would end the run after the first one.
    if (!isSelfCheck() && !isScreenshots()) app.quit();
  });
}
