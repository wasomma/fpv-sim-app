/*
 * Terrain export: a seed's procedural heightfield as a georeferenced
 * GeoTIFF for VBS Geo's DEM import, so VBS4's terrain correlates with
 * the engagement. A canopy-density raster (0..1) exports alongside as a
 * reference layer for manual vegetation work.
 *
 * Format: single-band Float32 GeoTIFF in geographic WGS 84 (EPSG:4326),
 * which is what VBS Geo accepts (it reads neither Esri ASCII Grid nor a
 * projected CRS). The vertical datum is explicit and selectable: VBS Geo
 * ignores the GeoTIFF vertical tag and assumes either EGM96 or the
 * ellipsoid without documenting which, so the lab imports both variants
 * and keeps the one whose coastline lands on VBS4's water line (VBS4's
 * ocean sits at mean sea level and cannot be moved). TerraTools and
 * Mantle do read the tag.
 *
 * Grid truth (from the engine): 200x200 nodes ACROSS the 4000 m box,
 * node-registered posts at spacing 4000/199 ≈ 20.1005 m, gy=0 at the
 * SOUTH edge. The gateway's local frame is flat-geodetic (latitude and
 * longitude vary linearly with sim y and x), so with rotationDeg 0 the
 * posts already form a regular lat/lon grid: each pixel is one post,
 * 20.1 m on the ground each way, and its centre is exactly where the
 * DIS stream puts that sim point. No resampling, no projection, hence
 * no grid-convergence skew (the former UTM export followed UTM grid
 * north and drifted 27 to 39 m from the entities at the far edges of the
 * box at the example anchor). Rows run north to south; the raster is
 * PixelIsArea, so the tiepoint sits half a pixel outside the SW post.
 * A rotated anchor samples a north-aligned geographic grid covering the
 * whole rotated box through the inverse mapping; pixels outside the box
 * are nodata.
 *
 * Heights: sim z = 0 is sea level. --vdatum egm96 (default) writes
 * z + h0M as EGM96 (mean sea level) heights; --vdatum ellipsoid also adds
 * geoidOffsetM, the EGM96 undulation at the anchor, and declares WGS 84
 * ellipsoidal heights. Negatives export raw: they are real seabed.
 */

import { buildWorld, canopyAt, elevAt } from "fpv-sim-mcp/engine";
import { LocalFrame, type LocalFrameAnchor } from "../geo/localframe.js";
import { VERTICAL_CRS, type VerticalDatum, writeFloat32GeoTiff } from "./geotiff.js";

export type { VerticalDatum } from "./geotiff.js";

const WORLD_M = 4000;
const RES = 200;
const NODATA = -9999;
const DEG = Math.PI / 180;

export interface TerrainExportOptions {
  /** Vertical datum of the elevation raster. Default egm96. */
  vdatum?: VerticalDatum;
}

export interface TerrainExportMeta {
  seed: number;
  cols: number;
  rows: number;
  /** Post spacing on the ground, metres (4000/199). */
  cellsizeM: number;
  crs: "EPSG:4326";
  verticalDatum: VerticalDatum;
  verticalCrs: string;
  /** Metres added to every sim elevation in this file. */
  verticalOffsetM: number;
  pixelSizeDeg: { lon: number; lat: number };
  /** Outer edges of the raster (PixelIsArea), degrees. */
  bounds: { westDeg: number; southDeg: number; eastDeg: number; northDeg: number };
  nodata: number;
  anchor: LocalFrameAnchor;
}

export interface TerrainExportResult {
  elevationTif: Uint8Array;
  canopyTif: Uint8Array;
  meta: TerrainExportMeta;
}

export function exportTerrain(
  seed: number,
  anchor: LocalFrameAnchor,
  opts: TerrainExportOptions = {},
): TerrainExportResult {
  const vdatum = opts.vdatum ?? "egm96";
  const world = buildWorld(seed, WORLD_M);
  const frame = new LocalFrame(anchor);
  const spacing = WORLD_M / (RES - 1);
  const pixelLatDeg = spacing / frame.metersPerRadLat / DEG;
  const pixelLonDeg = spacing / frame.metersPerRadLon / DEG;
  const rotated = Math.abs(anchor.rotationDeg % 360) > 1e-9;

  // Grid: pixel centres. Column 0 / bottom row sit at (west0, south0).
  let cols = RES;
  let rows = RES;
  let west0 = anchor.lon0Deg;
  let south0 = anchor.lat0Deg;
  if (rotated) {
    const corners = [
      [0, 0],
      [WORLD_M, 0],
      [0, WORLD_M],
      [WORLD_M, WORLD_M],
    ].map(([x, y]) => frame.localToGeodetic(x!, y!, 0));
    const lons = corners.map((c) => c.lonRad / DEG);
    const lats = corners.map((c) => c.latRad / DEG);
    west0 = Math.min(...lons);
    south0 = Math.min(...lats);
    cols = Math.ceil((Math.max(...lons) - west0) / pixelLonDeg - 1e-9) + 1;
    rows = Math.ceil((Math.max(...lats) - south0) / pixelLatDeg - 1e-9) + 1;
  }

  /** Sim-local point under the centre of (col, rowFromSouth), or null outside the box. */
  const localAt = (col: number, rowFromSouth: number): { x: number; y: number } | null => {
    if (!rotated) return { x: col * spacing, y: rowFromSouth * spacing };
    const lonRad = (west0 + col * pixelLonDeg) * DEG;
    const latRad = (south0 + rowFromSouth * pixelLatDeg) * DEG;
    const p = frame.geodeticToLocal(latRad, lonRad, 0);
    const eps = 1e-6;
    if (p.x < -eps || p.x > WORLD_M + eps || p.y < -eps || p.y > WORLD_M + eps) return null;
    return { x: p.x, y: p.y };
  };

  const verticalOffsetM = anchor.h0M + (vdatum === "ellipsoid" ? anchor.geoidOffsetM : 0);
  const raster = (fn: (x: number, y: number) => number): Float32Array => {
    const out = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const rowFromSouth = rows - 1 - r; // row 0 is the north edge
      for (let c = 0; c < cols; c++) {
        const p = localAt(c, rowFromSouth);
        out[r * cols + c] = p ? fn(p.x, p.y) : NODATA;
      }
    }
    return out;
  };
  const elevation = raster((x, y) => elevAt(world, x, y) + verticalOffsetM);
  const canopy = raster((x, y) => canopyAt(world, x, y));

  const westDeg = west0 - pixelLonDeg / 2;
  const northDeg = south0 + (rows - 1) * pixelLatDeg + pixelLatDeg / 2;
  const bounds = {
    westDeg,
    southDeg: south0 - pixelLatDeg / 2,
    eastDeg: west0 + (cols - 1) * pixelLonDeg + pixelLonDeg / 2,
    northDeg,
  };
  const vertical = VERTICAL_CRS[vdatum];
  const common = { westDeg, northDeg, pixelLonDeg, pixelLatDeg, nodata: NODATA };
  const metadata = {
    SOURCE: "fpv-sim-app terrain-export (notional terrain, unclassified)",
    FPV_SIM_SEED: String(seed),
    ANCHOR_LAT0_DEG: String(anchor.lat0Deg),
    ANCHOR_LON0_DEG: String(anchor.lon0Deg),
    ANCHOR_ROTATION_DEG: String(anchor.rotationDeg),
    POST_SPACING_M: spacing.toFixed(6),
  };
  const elevationTif = writeFloat32GeoTiff(cols, rows, elevation, {
    ...common,
    vdatum,
    metadata: {
      ...metadata,
      LAYER: "elevation",
      VERTICAL_DATUM: `${vertical.label} (EPSG:${vertical.epsg})`,
      VERTICAL_OFFSET_M: verticalOffsetM.toFixed(3),
    },
  });
  const canopyTif = writeFloat32GeoTiff(cols, rows, canopy, {
    ...common,
    vdatum: "none", // a density, not a height
    metadata: { ...metadata, LAYER: "canopy density 0..1" },
  });

  return {
    elevationTif,
    canopyTif,
    meta: {
      seed,
      cols,
      rows,
      cellsizeM: spacing,
      crs: "EPSG:4326",
      verticalDatum: vdatum,
      verticalCrs: `EPSG:${vertical.epsg}`,
      verticalOffsetM,
      pixelSizeDeg: { lon: pixelLonDeg, lat: pixelLatDeg },
      bounds,
      nodata: NODATA,
      anchor: { ...anchor },
    },
  };
}
