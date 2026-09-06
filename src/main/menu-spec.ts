/*
 * What the application menu offers, without Electron: the window
 * entries with their accelerators, the help links, and the version line
 * the About box and the launcher footer both show. Unit-tested; menu.ts
 * turns it into a Menu.
 */

export type MenuWindowKind = "shell" | "sim" | "dashboard" | "viewer3d" | "studies" | "mcp" | "live-ops";

export interface WindowEntry {
  kind: MenuWindowKind;
  label: string;
  accelerator: string;
}

/** File menu, in order: the launcher, then the six tiles as they appear on it. */
export const WINDOW_ENTRIES: readonly WindowEntry[] = [
  { kind: "shell", label: "Launcher", accelerator: "CmdOrCtrl+0" },
  { kind: "sim", label: "Simulation", accelerator: "CmdOrCtrl+1" },
  { kind: "dashboard", label: "Dashboard", accelerator: "CmdOrCtrl+2" },
  { kind: "viewer3d", label: "3D Viewer", accelerator: "CmdOrCtrl+3" },
  { kind: "studies", label: "Studies", accelerator: "CmdOrCtrl+4" },
  { kind: "mcp", label: "MCP Endpoint", accelerator: "CmdOrCtrl+5" },
  { kind: "live-ops", label: "Live Ops", accelerator: "CmdOrCtrl+6" },
];

export type OtherAccelerator =
  | "reload"
  | "devtools"
  | "zoomIn"
  | "zoomOut"
  | "resetZoom"
  | "fullscreen"
  | "manual"
  | "close"
  | "quit";

/** Every accelerator the menu binds outside the window entries (kept unique against them). */
export const OTHER_ACCELERATORS: Readonly<Record<OtherAccelerator, string>> = {
  reload: "CmdOrCtrl+R",
  devtools: "CmdOrCtrl+Shift+I",
  zoomIn: "CmdOrCtrl+=",
  zoomOut: "CmdOrCtrl+-",
  // Ctrl+0 opens the launcher, and Ctrl+Shift+0 is claimed by Windows itself
  // as a keyboard-layout hotkey (Input Method Hot Keys entry 00000104), so an
  // app never sees it. Numpad 0 is what VS Code uses for the same reason.
  resetZoom: "CmdOrCtrl+num0",
  fullscreen: "F11",
  manual: "F1",
  close: "CmdOrCtrl+W",
  quit: "CmdOrCtrl+Q",
};

export const REPO_URL = "https://github.com/wasomma/fpv-sim-app";

export type HelpTarget = "manual" | "changelog" | "issues";

export const HELP_URLS: Readonly<Record<HelpTarget, string>> = {
  manual: `${REPO_URL}/blob/main/docs/manual/README.md`,
  changelog: `${REPO_URL}/blob/main/CHANGELOG.md`,
  issues: `${REPO_URL}/issues`,
};

export function isHelpTarget(v: unknown): v is HelpTarget {
  return v === "manual" || v === "changelog" || v === "issues";
}

export interface VersionFacts {
  appVersion: string;
  engineVersion: string;
  electron: string;
  node: string;
  chrome: string;
  pins: unknown;
}

/** The launcher footer line, exactly as users are asked to quote it. */
export function versionLine(f: VersionFacts): string {
  const commit = (f.pins as { fpv_sim_commit?: unknown } | null)?.fpv_sim_commit;
  const pin = typeof commit === "string" && commit.length >= 7 ? commit.slice(0, 7) : "unvendored";
  return (
    `app ${f.appVersion} · engine fpv-sim-mcp ${f.engineVersion} · ui pin ${pin}` +
    ` · electron ${f.electron} · node ${f.node} · chrome ${f.chrome}`
  );
}
