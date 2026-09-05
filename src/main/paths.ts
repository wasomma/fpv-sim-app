/*
 * Central path resolution — the one place that knows where things live in
 * dev vs packaged builds. Everything read at runtime by the protocol
 * handler or child processes ships as plain files (extraResources), never
 * inside the asar archive.
 */

import { app } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)); // dist/src/main
export const appRoot = path.resolve(here, "..", "..", "..");

function resourceRoot(): string {
  return app.isPackaged ? process.resourcesPath : path.join(appRoot, "build", "resources");
}

/** Vendored fpv-sim UI files (index.html, dashboard.html, viewer3d.html, scripts/, results/). */
export function uiRoot(): string {
  return path.join(resourceRoot(), "ui");
}

/** The app's own renderer pages (shell, later Live Ops / Studies / MCP panels). */
export function rendererRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "renderer") : path.join(appRoot, "src", "renderer");
}

/** Provenance pins written by scripts/vendor-ui.mjs. */
export function pinsFile(): string {
  return path.join(resourceRoot(), "upstream-pins.json");
}

/** Writable per-user results store the dashboard reads (app://ui/results/*). */
export function resultsDir(): string {
  return path.join(app.getPath("userData"), "results");
}

/** Window icon for dev runs; packaged windows inherit the exe's embedded icon. */
export function devWindowIcon(): string | null {
  return app.isPackaged ? null : path.join(appRoot, "assets", "icon", "icon.ico");
}

/**
 * The user manual as a single PDF, or null when this build carries none.
 * Packaged builds ship it in extraResources (npm run dist builds it
 * first); a dev checkout has one after `npm run manual:pdf`.
 */
export function manualPdf(): string | null {
  const file = app.isPackaged
    ? path.join(process.resourcesPath, "manual", "fpv-sim-manual.pdf")
    : path.join(appRoot, "docs", "manual", "fpv-sim-manual.pdf");
  return existsSync(file) ? file : null;
}

/** Preload script for the app's own panels (plain CJS, not compiled). */
export function preloadPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "preload", "index.cjs")
    : path.join(appRoot, "src", "preload", "index.cjs");
}

/**
 * Root of the fpv-sim-mcp package (engine + fixtures). Child runners get
 * it via FPV_SIM_MCP; sweep-utils appends dist/src/engine/index.js.
 * Packaged builds ship a plain-file copy in extraResources.
 */
export function engineRoot(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "engine");
  return path.join(appRoot, "node_modules", "fpv-sim-mcp");
}

/** App-owned child runner scripts (.mjs, not compiled by tsc). */
export function runnersDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "runners")
    : path.join(appRoot, "src", "main", "studies");
}
