/*
 * Per-user app settings (%APPDATA%/fpv-sim-app/settings.json).
 * The MCP bearer token is generated on first load and persists until
 * regenerated from the MCP panel.
 */

import { app } from "electron";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface AppSettings {
  mcp: {
    port: number;
    token: string;
  };
}

const DEFAULT_PORT = 8765;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

let cached: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (cached !== null) return cached;
  let raw: Partial<AppSettings> = {};
  try {
    raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<AppSettings>;
  } catch {
    /* first run */
  }
  const port = typeof raw.mcp?.port === "number" && raw.mcp.port >= 1024 && raw.mcp.port <= 65535
    ? raw.mcp.port
    : DEFAULT_PORT;
  const token = typeof raw.mcp?.token === "string" && raw.mcp.token.length >= 16 ? raw.mcp.token : newToken();
  cached = { mcp: { port, token } };
  if (raw.mcp?.token !== token || raw.mcp?.port !== port) saveSettings(cached);
  return cached;
}

export function saveSettings(next: AppSettings): void {
  cached = next;
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2) + "\n");
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
