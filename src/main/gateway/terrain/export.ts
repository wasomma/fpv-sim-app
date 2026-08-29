/*
 * Terrain export: a seed's procedural heightfield as a georeferenced
 * Esri ASCII Grid (.asc + .prj), for import into external tools (VBS
 * Geo's DEM import path) so their terrain correlates with the
 * engagement. A canopy-density raster (0..1) exports alongside as a
 * reference layer for manual vegetation work.
 *
 * Grid truth (from the engine): 200x200 nodes ACROSS the 4000 m box —
 * node-registered posts at spacing 4000/199 ≈ 20.1005 m, gy=0 at the
 * SOUTH edge. .asc rows run north to south, so rows are written in
 * reverse gy order, and the node registration is expressed with
 * xllcenter/yllcenter. Elevations export RAW, negatives included: the
 * sim treats z=0 as sea level, so the importing tool should set its
 * water level at elevation 0 — clamping here would fabricate flat
 * coastal shelves.
 *
 * CRS: with rotationDeg 0 (the terrain-correlation-friendly choice) the
 * grid is north-aligned; the .prj carries the UTM zone auto-derived
 * from the anchor longitude, and xll/yll come from the anchor via the
 * same flat-geodetic mapping entities use — DEM and ESPDUs stay
 * consistent by construction. Non-zero rotation exports a bilinearly
 * resampled north-aligned grid over the rotated box.
 */

import { buildWorld, canopyAt, elevAt } from "fpv-sim-mcp/engine";
import type { LocalFrameAnchor } from "../geo/localframe.js";

const WORLD_M = 4000;
const RES = 200;

export interface TerrainExportResult {
  asc: string;
  canopyAsc: string;
  prj: string;
  meta: {
    seed: number;
    cols: number;
    rows: number;
    cellsizeM: number;
    utmZone: number;
    hemisphere: "N" | "S";
    xllcenter: number;
    yllcenter: number;
  };
}

/* Transverse Mercator forward (spherical-series Krüger, WGS-84), enough
   for placing a 4 km inset: sub-meter against reference implementations
   in the covered zones. */
function utmForward(latDeg: number, lonDeg: number, zone: number): { easting: number; northing: number } {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const lon0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const T = Math.tan(lat) ** 2;
  const C = ep2 * Math.cos(lat) ** 2;
  const A = Math.cos(lat) * (lon - lon0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * lat -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * lat) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * lat) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * lat));
  const easting =
    k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let northing =
    k0 *
    (M +
      N *
        Math.tan(lat) *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (latDeg < 0) northing += 10000000;
  return { easting, northing };
}

export function utmZoneFor(lonDeg: number): number {
  return Math.min(60, Math.max(1, Math.floor((lonDeg + 180) / 6) + 1));
}

function gridToAsc(
  values: (gx: number, gy: number) => number,
  xll: number,
  yll: number,
  cellsize: number,
  digits: number,
): string {
  const lines: string[] = [
    `ncols ${RES}`,
    `nrows ${RES}`,
    `xllcenter ${xll.toFixed(3)}`,
    `yllcenter ${yll.toFixed(3)}`,
    `cellsize ${cellsize.toFixed(12)}`,
    "NODATA_value -9999",
  ];
  for (let gy = RES - 1; gy >= 0; gy--) {
    const row: string[] = [];
    for (let gx = 0; gx < RES; gx++) row.push(values(gx, gy).toFixed(digits));
    lines.push(row.join(" "));
  }
  return lines.join("\n") + "\n";
}

export function exportTerrain(seed: number, anchor: LocalFrameAnchor): TerrainExportResult {
  const world = buildWorld(seed, WORLD_M);
  const spacing = WORLD_M / (RES - 1);
  const zone = utmZoneFor(anchor.lon0Deg);
  const hemisphere: "N" | "S" = anchor.lat0Deg < 0 ? "S" : "N";
  const origin = utmForward(anchor.lat0Deg, anchor.lon0Deg, zone);

  const rotated = Math.abs(anchor.rotationDeg % 360) > 1e-9;
  const r = (anchor.rotationDeg * Math.PI) / 180;
  // Sample the grid: unrotated boxes read posts directly; a rotated
  // anchor samples the north-aligned grid back through the rotation.
  const sample = (fn: (x: number, y: number) => number) => (gx: number, gy: number) => {
    if (!rotated) return fn(gx * spacing, gy * spacing);
    const E = gx * spacing;
    const N = gy * spacing;
    const x = E * Math.cos(r) - N * Math.sin(r);
    const y = N * Math.cos(r) + E * Math.sin(r);
    if (x < 0 || x > WORLD_M || y < 0 || y > WORLD_M) return -9999;
    return fn(x, y);
  };

  const asc = gridToAsc(
    sample((x, y) => elevAt(world, x, y) + anchor.h0M + anchor.geoidOffsetM),
    origin.easting,
    origin.northing,
    spacing,
    2,
  );
  const canopyAsc = gridToAsc(sample((x, y) => canopyAt(world, x, y)), origin.easting, origin.northing, spacing, 3);

  const central = (zone - 1) * 6 - 180 + 3;
  const prj =
    `PROJCS["WGS 84 / UTM zone ${zone}${hemisphere}",GEOGCS["WGS 84",DATUM["WGS_1984",` +
    `SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],` +
    `PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",${central}],` +
    `PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],` +
    `PARAMETER["false_northing",${hemisphere === "S" ? 10000000 : 0}],UNIT["metre",1]]`;

  return {
    asc,
    canopyAsc,
    prj,
    meta: {
      seed,
      cols: RES,
      rows: RES,
      cellsizeM: spacing,
      utmZone: zone,
      hemisphere,
      xllcenter: origin.easting,
      yllcenter: origin.northing,
    },
  };
}
