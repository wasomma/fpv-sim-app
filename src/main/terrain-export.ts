/*
 * Terrain export as the main process offers it to the Live Ops panel,
 * the MCP tool and the self-check: resolve what the caller left out (the
 * anchor from the staged gateway config, the folder from the profile)
 * and write the set. The writer itself is gateway/terrain/export-set.ts.
 */

import path from "node:path";
import { terrainDir } from "./paths.js";
import { liveStagedAnchor } from "./sessions/session-manager.js";
import {
  validateTerrainExportRequest,
  writeTerrainExportSet,
  type TerrainExportSetResult,
} from "./gateway/terrain/export-set.js";
import type { LocalFrameAnchor } from "./gateway/geo/localframe.js";

export interface TerrainExportRequest {
  seed: unknown;
  /** Anchor to use instead of the staged gateway config's (partial allowed). */
  anchor?: unknown;
  /** Absolute folder; default the profile's terrain folder. */
  dir?: unknown;
}

export type TerrainExportOutcome = TerrainExportSetResult | { ok: false; error: string };

export const NO_STAGED_ANCHOR =
  "no gateway config staged; the terrain's place on Earth comes from its anchor, so STAGE one first";

export function resolveTerrainExport(
  req: TerrainExportRequest,
): { ok: true; seed: number; anchor: LocalFrameAnchor; dir: string } | { ok: false; error: string } {
  const anchor = req.anchor ?? liveStagedAnchor();
  if (anchor === null || anchor === undefined) return { ok: false, error: NO_STAGED_ANCHOR };
  const check = validateTerrainExportRequest(req.seed, anchor);
  if (!check.ok) return check;
  let dir = terrainDir();
  if (req.dir !== undefined && req.dir !== null) {
    if (typeof req.dir !== "string" || req.dir.trim() === "") return { ok: false, error: "dir must be a folder path" };
    if (!path.isAbsolute(req.dir)) return { ok: false, error: "dir must be an absolute folder path" };
    dir = path.normalize(req.dir);
  }
  return { ok: true, seed: check.seed, anchor: check.anchor, dir };
}

export function exportTerrainSet(req: TerrainExportRequest): TerrainExportOutcome {
  const r = resolveTerrainExport(req);
  if (!r.ok) return r;
  try {
    return writeTerrainExportSet(r.seed, r.anchor, r.dir);
  } catch (err) {
    return { ok: false, error: `export failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
