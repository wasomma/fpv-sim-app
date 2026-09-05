/*
 * Per-user app settings (%APPDATA%/fpv-sim-app/settings.json).
 *
 * The MCP bearer token is generated on first load and persists until
 * regenerated from the MCP panel. The `ui` bag holds renderer-owned state
 * (last-used inputs, last staged gateway text, window bounds); writes to
 * it are debounced because they arrive on every keystroke and every
 * window move. Shape and migration live in settings-schema.ts.
 */

import { app } from "electron";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type AppSettings, normalizeSettings, validateUiEntry } from "./settings-schema.js";

export type { AppSettings };

const SAVE_DEBOUNCE_MS = 250;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

let cached: AppSettings | null = null;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function getSettings(): AppSettings {
  if (cached !== null) return cached;
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(settingsPath(), "utf8"));
  } catch {
    /* first run */
  }
  const { settings, changed } = normalizeSettings(raw, newToken);
  cached = settings;
  if (changed) saveSettings(cached);
  return cached;
}

function writeNow(): void {
  if (cached === null) return;
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(cached, null, 2) + "\n");
  dirty = false;
}

/** Write immediately (used for the MCP port/token, which the host reads on restart). */
export function saveSettings(next: AppSettings): void {
  cached = next;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  writeNow();
}

/** Coalesce a burst of `ui` writes into one disk write. */
export function saveSettingsSoon(): void {
  dirty = true;
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    if (dirty) writeNow();
  }, SAVE_DEBOUNCE_MS);
}

/** Flush a pending debounced write (called from before-quit). */
export function flushSettings(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (dirty) writeNow();
}

/** One entry of the renderer-owned `ui` bag, or null when unset. */
export function getUi(key: string): unknown {
  const v = getSettings().ui[key];
  return v === undefined ? null : v;
}

/** Replace (or, with null, delete) one `ui` entry. Validated and debounced. */
export function setUi(key: string, value: unknown): { ok: boolean; error?: string } {
  const check = validateUiEntry(key, value);
  if (!check.ok) return { ok: false, error: check.error };
  const s = getSettings();
  if (check.value === null) delete s.ui[key];
  else s.ui[key] = check.value;
  saveSettingsSoon();
  return { ok: true };
}

export function regenerateMcpToken(): string {
  const s = getSettings();
  s.mcp.token = newToken();
  saveSettings(s);
  return s.mcp.token;
}

export function setMcpPort(port: number): void {
  const s = getSettings();
  s.mcp.port = port;
  saveSettings(s);
}
