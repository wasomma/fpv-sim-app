/*
 * terrain-export CLI:
 *   npm run terrain-export -- --seed=20260719 --lat=21.35 --lon=-157.95 \
 *     [--geoid=<N>] [--vdatum=egm96|ellipsoid] [--h0=0] [--rotation=0] [--out=./export]
 * (use --key=value: node's parseArgs reads a bare negative number as a flag)
 *
 * Writes seed-<n>-elevation-<vdatum>.tif (+ .json meta) and
 * seed-<n>-canopy.tif: Float32 GeoTIFFs in geographic WGS 84 (EPSG:4326)
 * for VBS Geo's DEM import. Plain node, no Electron required.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { exportTerrain, type VerticalDatum } from "./export.js";

const { values: args } = parseArgs({
  options: {
    seed: { type: "string" },
    lat: { type: "string" },
    lon: { type: "string" },
    h0: { type: "string", default: "0" },
    rotation: { type: "string", default: "0" },
    geoid: { type: "string", default: "0" },
    vdatum: { type: "string", default: "egm96" },
    out: { type: "string", default: "./export" },
  },
});

const seed = Number(args.seed);
const lat = Number(args.lat);
const lon = Number(args.lon);
const vdatum = args.vdatum as VerticalDatum;
if (!Number.isInteger(seed) || seed < 0 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error(
    "Required: --seed <int> --lat <deg> --lon <deg>  (optional --geoid --vdatum=egm96|ellipsoid --h0 --rotation --out)",
  );
  process.exit(1);
}
if (vdatum !== "egm96" && vdatum !== "ellipsoid") {
  console.error(`--vdatum must be egm96 or ellipsoid (got ${args.vdatum})`);
  process.exit(1);
}
if (vdatum === "ellipsoid" && Number(args.geoid) === 0) {
  console.warn(
    "warning: --vdatum=ellipsoid with --geoid=0 writes the same heights as egm96; pass the EGM96 undulation at the anchor",
  );
}

const result = exportTerrain(
  seed,
  {
    lat0Deg: lat,
    lon0Deg: lon,
    h0M: Number(args.h0),
    rotationDeg: Number(args.rotation),
    geoidOffsetM: Number(args.geoid),
  },
  { vdatum },
);

mkdirSync(args.out!, { recursive: true });
const base = path.join(args.out!, `seed-${seed}`);
const elevationPath = `${base}-elevation-${vdatum}.tif`;
writeFileSync(elevationPath, result.elevationTif);
writeFileSync(`${base}-elevation-${vdatum}.json`, JSON.stringify(result.meta, null, 2) + "\n");
writeFileSync(`${base}-canopy.tif`, result.canopyTif);

const m = result.meta;
console.log(
  `wrote ${elevationPath} (+canopy.tif, .json): ${m.cols}x${m.rows} @ ${m.cellsizeM.toFixed(4)} m, ` +
    `EPSG:4326 pixels ${m.pixelSizeDeg.lon.toFixed(7)}° x ${m.pixelSizeDeg.lat.toFixed(7)}°, ` +
    `heights ${m.verticalDatum} (${m.verticalCrs}), offset ${m.verticalOffsetM >= 0 ? "+" : ""}${m.verticalOffsetM.toFixed(2)} m`,
);
console.log(
  "VBS Geo: import as-is. VBS4's ocean is mean sea level and the sim's zero is sea level: keep the vdatum variant " +
    "whose coastline lands on the water line. Run the gateway with anchor.geoidOffsetM = the EGM96 undulation at the anchor.",
);
