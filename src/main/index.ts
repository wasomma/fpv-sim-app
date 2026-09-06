/*
 * fpv-sim-app — Electron main entry.
 *
 * Phase 1 scope: serve the vendored fpv-sim UIs from the app:// origin,
 * seed the per-user results store, provide the shell landing window, and
 * a --self-check mode for CI. Later phases add the MCP host, live
 * session host (utilityProcess), studies runners, and the DIS gateway.
 */

import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { appInfo } from "./app-info.js";
import { DEFAULT_GATEWAY_CONFIG, validateGatewayConfig } from "./gateway/config.js";
import { GATEWAY_FORM_SECTIONS } from "./gateway/form-schema.js";
import { GATEWAY_PRESETS } from "./gateway/presets.js";
import { installAppMenu, openHelp } from "./menu.js";
import { isHelpTarget } from "./menu-spec.js";
import { installAppProtocol, registerAppScheme } from "./protocol.js";
import { resultsDir, uiRoot } from "./paths.js";
import {
  isDatasetFileName,
  listResults,
  registerDatasetFile,
  relabelDataset,
  removeDataset,
  restoreBundled,
} from "./results-manifest.js";
import { mcpHostStatus, restartMcpHost, setServerExtender, startMcpHost } from "./mcp/host.js";
import { registerLiveTools } from "./mcp/live-tools.js";
import { seedResultsIfEmpty } from "./results.js";
import { buildStrip } from "./status-strip.js";
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
import { flushSettings, getSettings, getUi, regenerateMcpToken, setMcpPort, setUi } from "./settings.js";
import { isHeadless, isScreenshots, isSelfCheck } from "./mode.js";
import { prepareScreenshotsBoot, screenshotsAndExit } from "./screenshots.js";
import { selfCheckAndExit } from "./self-check.js";
import {
  loadOverridesSchema,
  overridesSchemaPayload,
  overridesSchemaState,
  validateOverridesText,
} from "./studies/overrides-schema.js";
import { cancelStudy, startStudy, studyStatus, type StudyStartOpts } from "./studies/study-runner.js";
import { createShellWindow, openAppPanel, openUiWindow, reloadDashboardWindows, showShellWindow } from "./windows.js";

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
    // Launching the app again is how the launcher comes back after it was
    // closed while a sim or panel window stayed open.
    showShellWindow();
  });

  app.whenReady().then(async () => {
    installAppProtocol();
    installAppMenu();
    const seeding = seedResultsIfEmpty();
    if (seeding.seeded) console.log(`results store seeded at ${seeding.dir}`);
    // Before any run can start: study-start and live-start validate
    // override keys synchronously against this schema.
    await loadOverridesSchema();

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
      if (name === "shell") {
        showShellWindow();
        return true;
      }
      return openAppPanel(typeof name === "string" ? name : "") !== null;
    });

    ipcMain.handle("app-info", () => appInfo());

    // The launcher's status strip: what the three services are doing,
    // already formatted (status-strip.ts) so the panel only paints it.
    ipcMain.handle("app-status", () => {
      const s = studyStatus();
      const last =
        s.last === null
          ? null
          : { descr: s.last.descr, code: s.last.code, startedAtMs: s.last.startedAtMs, endedAtMs: s.last.endedAtMs };
      return buildStrip(
        { running: s.running, descr: s.descr, startedAtMs: s.startedAtMs, last },
        liveStatus(),
        mcpHostStatus(),
        Date.now(),
      );
    });

    // Help → the same places the Help menu goes.
    ipcMain.handle("open-help", (_event, target: unknown) =>
      isHelpTarget(target) ? openHelp(target) : { ok: false, opened: "", error: "unknown help target" },
    );

    // Renderer-owned persisted state; main only validates key and size.
    ipcMain.handle("ui-get", (_event, key: unknown) => (typeof key === "string" ? getUi(key) : null));
    ipcMain.handle("ui-set", (_event, args: unknown) => {
      const a = (args ?? {}) as { key?: unknown; value?: unknown };
      if (typeof a.key !== "string") return { ok: false, error: "key must be a string" };
      return setUi(a.key, a.value);
    });

    // Native confirm for destructive or long actions. Headless runs answer
    // yes without a dialog: there is nobody to click and nothing to protect.
    ipcMain.handle("ui-confirm", async (event, args: unknown) => {
      if (isHeadless()) return true;
      const a = (args ?? {}) as { message?: unknown; detail?: unknown; confirmLabel?: unknown; cancelLabel?: unknown };
      const options: Electron.MessageBoxOptions = {
        type: "question",
        title: "FPV Sim",
        message: typeof a.message === "string" ? a.message : "Are you sure?",
        buttons: [
          typeof a.confirmLabel === "string" ? a.confirmLabel : "OK",
          typeof a.cancelLabel === "string" ? a.cancelLabel : "Cancel",
        ],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      };
      if (typeof a.detail === "string") options.detail = a.detail;
      const win = BrowserWindow.fromWebContents(event.sender);
      const { response } = win !== null ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      return response === 0;
    });

    ipcMain.handle("study-start", (_event, opts: unknown) => startStudy(opts as StudyStartOpts));
    ipcMain.handle("study-cancel", () => cancelStudy());
    ipcMain.handle("study-status", () => studyStatus());
    // The engine's parameter table (for the panel's reference) and live
    // validation of the overrides text as it is typed.
    ipcMain.handle("study-schema", () => ({ ...overridesSchemaState(), payload: overridesSchemaPayload() }));
    ipcMain.handle("study-validate-overrides", (_event, text: unknown) =>
      validateOverridesText(typeof text === "string" ? text : ""),
    );
    // Reveal a dataset the runner wrote; only plain file names inside the
    // results store are accepted.
    ipcMain.handle("study-reveal", (_event, args: unknown) => {
      const file = (args as { file?: unknown } | null)?.file;
      if (typeof file !== "string" || file === "" || /[\\/]/.test(file) || file === "." || file === "..") {
        return { ok: false, error: "not a dataset file name" };
      }
      const full = path.join(resultsDir(), file);
      if (!existsSync(full)) return { ok: false, error: `${file} is not in the results folder` };
      shell.showItemInFolder(full);
      return { ok: true };
    });
    ipcMain.handle("results-open-folder", async () => {
      const err = await shell.openPath(resultsDir());
      return err === "" ? { ok: true } : { ok: false, error: err };
    });

    /*
     * Dataset management (the Studies panel's DATASETS box). Mutations
     * are refused while a run is active: the runner rewrites the
     * manifest when it finishes, and two writers would lose one edit.
     * Every successful mutation reloads any open dashboard, which reads
     * the manifest once at load.
     */
    const vendoredResults = (): string => path.join(uiRoot(), "results");
    const manifestBusy = (): { ok: false; error: string } | null =>
      studyStatus().running
        ? { ok: false, error: "a run is active and updates the manifest when it finishes — try again then" }
        : null;
    const fileArg = (args: unknown): unknown => (args as { file?: unknown } | null)?.file;
    const reloadingDashboards = <T extends { ok: boolean }>(r: T): T | (T & { reloaded: number }) =>
      r.ok ? { ...r, reloaded: reloadDashboardWindows() } : r;

    ipcMain.handle("results-list", () => listResults(resultsDir(), vendoredResults()));
    ipcMain.handle("results-delete", (_event, args: unknown) => {
      return manifestBusy() ?? reloadingDashboards(removeDataset(resultsDir(), fileArg(args)));
    });
    ipcMain.handle("results-relabel", (_event, args: unknown) => {
      const label = (args as { label?: unknown } | null)?.label;
      return manifestBusy() ?? reloadingDashboards(relabelDataset(resultsDir(), fileArg(args), label));
    });
    ipcMain.handle("results-register", (_event, args: unknown) => {
      return manifestBusy() ?? reloadingDashboards(registerDatasetFile(resultsDir(), fileArg(args)));
    });
    ipcMain.handle("results-restore", (_event, args: unknown) => {
      return manifestBusy() ?? reloadingDashboards(restoreBundled(resultsDir(), vendoredResults(), fileArg(args)));
    });
    // Copy a dataset file wherever the save dialog points. Headless runs
    // have nowhere to show the dialog, so they are refused outright.
    ipcMain.handle("results-export", async (event, args: unknown) => {
      const file = fileArg(args);
      if (!isDatasetFileName(file)) return { ok: false, error: "not a dataset file name" };
      const full = path.join(resultsDir(), file);
      if (!existsSync(full)) return { ok: false, error: `${file} is not in the results folder` };
      if (isHeadless()) return { ok: false, error: "EXPORT opens a save dialog, which a headless run cannot show" };
      const opts: Electron.SaveDialogOptions = {
        title: "Export dataset",
        defaultPath: file,
        filters: [{ name: "JSON dataset", extensions: ["json"] }],
      };
      const win = BrowserWindow.fromWebContents(event.sender);
      const picked = win !== null ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (picked.canceled || picked.filePath === undefined || picked.filePath === "") return { ok: true, to: null };
      try {
        copyFileSync(full, picked.filePath);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      return { ok: true, to: picked.filePath };
    });

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
        token, // so the panel can mask it in the displayed snippets
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
    ipcMain.handle("live-gateway-presets", () => GATEWAY_PRESETS);
    // The FORM view of the GATEWAY box: the field table plus the defaults
    // it diffs against, and a validate-only pass with STAGE's exact verdict.
    ipcMain.handle("live-gateway-form", () => ({ sections: GATEWAY_FORM_SECTIONS, defaults: DEFAULT_GATEWAY_CONFIG }));
    ipcMain.handle("live-gateway-check", (_event, cfg: unknown) => {
      const { issues } = validateGatewayConfig(cfg);
      return { ok: issues.length === 0, issues };
    });

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

  /*
   * Quit guard. A study child process and a live session die with the
   * app, so closing the last window (or quitting) while one is active asks
   * first. Never in headless mode: there is nobody to answer, and the
   * drivers exit through app.exit() anyway.
   */
  let quitConfirmed = false;
  let quitPrompt: Promise<void> | null = null;

  function busyDescription(): string | null {
    const parts: string[] = [];
    const s = studyStatus();
    if (s.running) parts.push(`the ${s.descr ?? "study"} run`);
    const l = liveStatus();
    if (l.state === "running" || l.state === "paused") {
      parts.push(`live session ${l.sessionId ?? ""} (${l.state})`);
    }
    return parts.length === 0 ? null : parts.join(" and ");
  }

  function requestQuit(): Promise<void> {
    if (quitPrompt !== null) return quitPrompt;
    quitPrompt = (async () => {
      const busy = busyDescription();
      if (quitConfirmed || busy === null) {
        quitConfirmed = true;
        app.quit();
        return;
      }
      const { response } = await dialog.showMessageBox({
        type: "question",
        title: "FPV Sim",
        message: "A run is still active",
        detail:
          `Quitting now stops ${busy}. A cancelled study writes no dataset; ` +
          "a stopped live session ends for every DIS receiver as well.",
        buttons: ["Cancel run and quit", "Keep running"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (response !== 0) {
        showShellWindow(); // the last window may be gone; leave the user one
        return;
      }
      cancelStudy();
      await liveStop().catch(() => undefined);
      quitConfirmed = true;
      app.quit();
    })().finally(() => {
      quitPrompt = null;
    });
    return quitPrompt;
  }

  // Windows is ending the user session (logoff/shutdown): never hold it up
  // with a dialog. The event arrives per window.
  app.on("browser-window-created", (_event, win) => {
    win.on("session-end", () => {
      quitConfirmed = true;
    });
  });

  app.on("before-quit", (event) => {
    // Debounced `ui` writes must not be lost to a quit in the same 250 ms.
    flushSettings();
    if (quitConfirmed || isHeadless() || busyDescription() === null) return;
    event.preventDefault();
    void requestQuit();
  });

  app.on("window-all-closed", () => {
    // Self-check and screenshot mode open and destroy windows between steps;
    // quitting here would end the run after the first one.
    if (isHeadless()) return;
    void requestQuit();
  });
}
