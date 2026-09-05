/*
 * settings.json shape and normalization. Electron-free so the migration
 * and the guards are unit-testable.
 *
 * v1 (0.1.0–0.2.1):  { mcp: { port, token } }
 * v2:                { version: 2, mcp: { port, token }, ui: { <key>: <json> } }
 *
 * `ui` is a bag of per-panel state the renderers own (last-used inputs,
 * the last staged gateway text, window bounds). Main treats every entry
 * as opaque JSON: it only enforces the key pattern and a size cap, and
 * it preserves entries and top-level keys it does not understand so a
 * newer build's settings survive a downgrade.
 */

export const SETTINGS_VERSION = 2;
export const DEFAULT_MCP_PORT = 8765;
export const MIN_TOKEN_LENGTH = 16;

/** Renderer-chosen keys: short, lowercase-led identifiers. */
export const UI_KEY_RE = /^[a-z][A-Za-z0-9-]{0,31}$/;
/** Serialized size cap per `ui` entry. */
export const UI_VALUE_LIMIT = 64 * 1024;

export interface AppSettings {
  version: number;
  mcp: {
    port: number;
    token: string;
  };
  ui: Record<string, unknown>;
  [extra: string]: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isValidPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port >= 1024 && port <= 65535;
}

/**
 * Check one `ui` entry. Returns a JSON round-tripped copy so callers store
 * plain data (no prototypes, no functions, no undefined holes).
 * A null/undefined value means "delete" and is accepted as-is.
 */
export function validateUiEntry(
  key: unknown,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (typeof key !== "string" || !UI_KEY_RE.test(key)) {
    return { ok: false, error: "ui key must match ^[a-z][A-Za-z0-9-]{0,31}$" };
  }
  if (value === null || value === undefined) return { ok: true, value: null };
  let text: string;
  try {
    text = JSON.stringify(value) as string | undefined as string;
  } catch {
    return { ok: false, error: "ui value is not serializable" };
  }
  if (typeof text !== "string") return { ok: false, error: "ui value is not serializable" };
  if (text.length > UI_VALUE_LIMIT) return { ok: false, error: `ui value exceeds ${UI_VALUE_LIMIT} bytes` };
  return { ok: true, value: JSON.parse(text) as unknown };
}

/**
 * Turn whatever was on disk into a valid v2 settings object.
 * `changed` is true when the result should be written back (migration,
 * repaired values, pruned entries, first run).
 */
export function normalizeSettings(
  raw: unknown,
  mintToken: () => string,
): { settings: AppSettings; changed: boolean } {
  const src = isRecord(raw) ? raw : {};
  let changed = !isRecord(raw);

  const mcpRaw = isRecord(src.mcp) ? src.mcp : {};
  const port = isValidPort(mcpRaw.port) ? mcpRaw.port : DEFAULT_MCP_PORT;
  const token =
    typeof mcpRaw.token === "string" && mcpRaw.token.length >= MIN_TOKEN_LENGTH ? mcpRaw.token : mintToken();
  if (port !== mcpRaw.port || token !== mcpRaw.token) changed = true;

  const ui: Record<string, unknown> = {};
  if (isRecord(src.ui)) {
    for (const [key, value] of Object.entries(src.ui)) {
      const check = validateUiEntry(key, value);
      if (check.ok && check.value !== null) ui[key] = check.value;
      else changed = true;
    }
  } else if (src.ui !== undefined) {
    changed = true;
  }

  if (src.version !== SETTINGS_VERSION) changed = true;

  const settings: AppSettings = { ...src, version: SETTINGS_VERSION, mcp: { port, token }, ui };
  return { settings, changed };
}
