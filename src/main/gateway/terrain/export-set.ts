/*
 * The terrain export as the app ships it: one call writes the whole set
 * for a seed into a folder, both vertical-datum variants included, so
 * nobody has to choose a datum before VBS Geo has shown which one it
 * assumes (it ignores the GeoTIFF's vertical tag; the lab imports both
 * and keeps the one whose coastline lands on VBS4's water line).
 *
 *   seed-<n>-elevation-egm96.tif      mean-sea-level heights (EPSG:5773)
 *   seed-<n>-elevation-egm96.json     the grid's metadata
 *   seed-<n>-elevation-ellipsoid.tif  + anchor.geoidOffsetM, WGS 84 (EPSG:4979)
 *   seed-<n>-elevation-ellipsoid.json
 *   seed-<n>-canopy.tif               canopy density 0..1, same grid
 *
 * Shared by the Live Ops EXPORT TERRAIN button, the live_export_terrain
 * MCP tool, the self-check and the command line (export-cli / the
 * installed exe's --terrain-export). Plain node: no Electron here.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateGatewayConfig } from "../config.js";
import type { LocalFrameAnchor } from "../geo/localframe.js";
import { exportTerrain, type TerrainExportMeta } from "./export.js";
import type { VerticalDatum } from "./geotiff.js";

export const SEED_MAX = 4294967295;
export const VERTICAL_DATUMS: readonly VerticalDatum[] = ["egm96", "ellipsoid"];

export interface TerrainExportFile {
  /** Absolute path of the file written. */
  path: string;
  layer: "elevation" | "elevation-metadata" | "canopy";
  vdatum?: VerticalDatum;
  bytes: number;
}

export interface TerrainExportSetResult {
  ok: true;
  seed: number;
  dir: string;
  anchor: LocalFrameAnchor;
  files: TerrainExportFile[];
  meta: Partial<Record<VerticalDatum, TerrainExportMeta>>;
  /** Advisory: the files are written, but something is usually a mistake. */
  warnings: string[];
}

export type TerrainExportRequestCheck =
  | { ok: true; seed: number; anchor: LocalFrameAnchor }
  | { ok: false; error: string };

/**
 * Check a seed and an anchor the way the gateway config does (same ranges,
 * unknown keys refused by path). The anchor may be partial: missing keys
 * take the gateway defaults (0).
 */
export function validateTerrainExportRequest(seed: unknown, anchor: unknown): TerrainExportRequestCheck {
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > SEED_MAX) {
    return { ok: false, error: `seed must be an integer in 0..${SEED_MAX}` };
  }
  if (anchor === null || typeof anchor !== "object" || Array.isArray(anchor)) {
    return { ok: false, error: "anchor must be an object with lat0Deg and lon0Deg (degrees)" };
  }
  const { issues, config } = validateGatewayConfig({ anchor });
  if (issues.length > 0) {
    return { ok: false, error: issues.map((i) => `${i.path}: ${i.message}`).join("; ") };
  }
  return { ok: true, seed, anchor: { ...config.anchor } };
}

export function terrainExportFileName(seed: number, layer: "elevation" | "canopy", vdatum?: VerticalDatum, ext = "tif"): string {
  return layer === "canopy" ? `seed-${seed}-canopy.${ext}` : `seed-${seed}-elevation-${vdatum}.${ext}`;
}

/** Warnings for an export that is about to run (none means nothing to flag). */
export function terrainExportWarnings(anchor: LocalFrameAnchor, vdatums: readonly VerticalDatum[]): string[] {
  const out: string[] = [];
  if (anchor.lat0Deg === 0 && anchor.lon0Deg === 0) {
    out.push("anchor is 0°, 0° (the Gulf of Guinea): set anchor.lat0Deg and anchor.lon0Deg to your AO");
  }
  if (vdatums.includes("ellipsoid") && anchor.geoidOffsetM === 0) {
    out.push(
      "anchor.geoidOffsetM is 0, so the ellipsoid file equals the egm96 file: set it to the EGM96 geoid undulation at the anchor",
    );
  }
  return out;
}

/**
 * Write the export set for `seed` into `dir` (created if needed). Files
 * are written whole, elevation before canopy; an existing set for the
 * same seed is overwritten. Throws on an I/O error.
 */
export function writeTerrainExportSet(
  seed: number,
  anchor: LocalFrameAnchor,
  dir: string,
  opts: { vdatums?: readonly VerticalDatum[] } = {},
): TerrainExportSetResult {
  const vdatums = opts.vdatums ?? VERTICAL_DATUMS;
  if (vdatums.length === 0) throw new Error("no vertical datum selected");
  mkdirSync(dir, { recursive: true });
  const files: TerrainExportFile[] = [];
  const meta: Partial<Record<VerticalDatum, TerrainExportMeta>> = {};
  let canopy: Uint8Array | null = null;
  for (const vdatum of vdatums) {
    const r = exportTerrain(seed, anchor, { vdatum });
    const tif = path.join(dir, terrainExportFileName(seed, "elevation", vdatum));
    const json = path.join(dir, terrainExportFileName(seed, "elevation", vdatum, "json"));
    writeFileSync(tif, r.elevationTif);
    files.push({ path: tif, layer: "elevation", vdatum, bytes: r.elevationTif.byteLength });
    const text = JSON.stringify(r.meta, null, 2) + "\n";
    writeFileSync(json, text);
    files.push({ path: json, layer: "elevation-metadata", vdatum, bytes: Buffer.byteLength(text) });
    meta[vdatum] = r.meta;
    canopy ??= r.canopyTif; // identical for every datum: a density, not a height
  }
  const canopyPath = path.join(dir, terrainExportFileName(seed, "canopy"));
  writeFileSync(canopyPath, canopy!);
  files.push({ path: canopyPath, layer: "canopy", bytes: canopy!.byteLength });
  return { ok: true, seed, dir, anchor: { ...anchor }, files, meta, warnings: terrainExportWarnings(anchor, vdatums) };
}
