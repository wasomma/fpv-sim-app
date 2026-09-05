/*
 * The application menu. Windows keep autoHideMenuBar (Alt reveals the
 * bar), so what matters day to day are the accelerators: Ctrl+0..6 open
 * or focus the launcher and the six tiles, F1 opens the manual, and the
 * View items are the browser conveniences users expect (reload, zoom,
 * DevTools). Help opens the bundled manual PDF when there is one and the
 * repository copy otherwise; About shows the footer's version line with
 * a Copy button. The shape (labels, accelerators, links) lives in
 * menu-spec.ts so it can be unit-tested without Electron.
 */

import { type BaseWindow, Menu, type MenuItemConstructorOptions, app, clipboard, dialog, shell } from "electron";
import { appInfo } from "./app-info.js";
import { HELP_URLS, type HelpTarget, type MenuWindowKind, OTHER_ACCELERATORS, WINDOW_ENTRIES } from "./menu-spec.js";
import { manualPdf, resultsDir } from "./paths.js";
import { openAppPanel, openUiWindow, showShellWindow } from "./windows.js";

/** Same routes as the launcher tiles: single-instance kinds focus, the rest open anew. */
export function openMenuWindow(kind: MenuWindowKind): void {
  if (kind === "shell") {
    showShellWindow();
    return;
  }
  if (kind === "sim" || kind === "dashboard" || kind === "viewer3d") {
    openUiWindow(kind);
    return;
  }
  openAppPanel(kind);
}

/** The bundled manual PDF if the build carries one, else the repository copy. */
export async function openHelp(target: HelpTarget): Promise<{ ok: boolean; opened: string }> {
  if (target === "manual") {
    const pdf = manualPdf();
    if (pdf !== null) {
      const err = await shell.openPath(pdf);
      if (err === "") return { ok: true, opened: pdf };
      console.error(`could not open ${pdf}: ${err}; opening the web copy instead`);
    }
  }
  await shell.openExternal(HELP_URLS[target]);
  return { ok: true, opened: HELP_URLS[target] };
}

export async function showAbout(parent?: BaseWindow): Promise<void> {
  const info = appInfo();
  const options: Electron.MessageBoxOptions = {
    type: "info",
    title: "About FPV Sim",
    message: `FPV Sim ${info.appVersion}`,
    detail:
      `${info.versionLine}\n\n` +
      "FPV sUAS vs counter-UAS engagement simulation. All data is notional and unclassified.\n" +
      "PolyForm Strict License 1.0.0.",
    buttons: ["Copy version line", "Close"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const { response } = parent !== undefined ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (response === 0) clipboard.writeText(info.versionLine);
}

export function installAppMenu(): void {
  const windows: MenuItemConstructorOptions[] = WINDOW_ENTRIES.map((e) => ({
    label: e.label,
    accelerator: e.accelerator,
    click: () => openMenuWindow(e.kind),
  }));
  const template: MenuItemConstructorOptions[] = [
    {
      label: "&File",
      submenu: [
        ...windows,
        { type: "separator" },
        { label: "Open Results Folder", click: () => void shell.openPath(resultsDir()) },
        { label: "Open Settings Folder", click: () => void shell.openPath(app.getPath("userData")) },
        { type: "separator" },
        { role: "close", accelerator: OTHER_ACCELERATORS.close },
        { role: "quit", accelerator: OTHER_ACCELERATORS.quit },
      ],
    },
    {
      label: "&Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "&View",
      submenu: [
        { role: "reload", accelerator: OTHER_ACCELERATORS.reload },
        { role: "toggleDevTools", accelerator: OTHER_ACCELERATORS.devtools },
        { type: "separator" },
        { role: "zoomIn", accelerator: OTHER_ACCELERATORS.zoomIn },
        { role: "zoomOut", accelerator: OTHER_ACCELERATORS.zoomOut },
        { role: "resetZoom", accelerator: OTHER_ACCELERATORS.resetZoom },
        { type: "separator" },
        { role: "togglefullscreen", accelerator: OTHER_ACCELERATORS.fullscreen },
      ],
    },
    {
      label: "&Help",
      submenu: [
        { label: "User Manual", accelerator: OTHER_ACCELERATORS.manual, click: () => void openHelp("manual") },
        { label: "Changelog", click: () => void openHelp("changelog") },
        { label: "Report a Problem…", click: () => void openHelp("issues") },
        { type: "separator" },
        { label: "About FPV Sim", click: (_item, win) => void showAbout(win) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
