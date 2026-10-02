/*
 * Run mode from argv, in one electron-free place so the window manager
 * and the entry point can consult it without importing the headless
 * drivers (which import the window manager).
 */

export function isSelfCheck(): boolean {
  return process.argv.includes("--self-check");
}

export function isScreenshots(): boolean {
  return process.argv.some((a) => a === "--screenshots" || a.startsWith("--screenshots="));
}

/** `FPV Sim.exe --terrain-export ...`: write the terrain set and exit, no window. */
export function isTerrainExportCli(): boolean {
  return process.argv.includes("--terrain-export");
}

/** Headless runs never persist window bounds and never show a dialog. */
export function isHeadless(): boolean {
  return isSelfCheck() || isScreenshots() || isTerrainExportCli();
}
