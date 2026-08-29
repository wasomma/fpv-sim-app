/* Shared helpers for the app's node tests (run from dist/test). */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/** Package root of the installed fpv-sim-mcp dependency. */
export function mcpRoot(): string {
  // Resolves to <root>/dist/src/engine/index.js; the exports map blocks
  // subpath access to package.json and fixtures, so walk up instead.
  const engineIndex = require.resolve("fpv-sim-mcp/engine");
  return path.resolve(path.dirname(engineIndex), "..", "..", "..");
}

/** Repo root (dist/test -> ../..). */
export function appRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}
