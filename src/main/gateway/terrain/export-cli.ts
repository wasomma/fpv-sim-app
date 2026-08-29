/*
 * terrain-export CLI:
 *   npm run terrain-export -- --seed=20260719 --lat=21.35 --lon=-157.95 \
 *     [--h0=0] [--rotation=0] [--geoid=0] [--out=./export]
 * (use --key=value: node's parseArgs reads a bare negative number as a flag)
 *
 * Writes seed-<n>-elevation.asc/.prj, seed-<n>-canopy.asc/.prj and a
 * meta JSON. Plain node — no Electron required.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { exportTerrain } from "./export.js";

const { values: args } = parseArgs({
  options: {
    seed: { type: "string" },
    lat: { type: "string" },
    lon: { type: "string" },
    h0: { type: "string", default: "0" },
    rotation: { type: "string", default: "0" },
    geoid: { type: "string", default: "0" },
    out: { type: "string", default: "./export" },
  },
});

const seed = Number(args.seed);
const lat = Number(args.lat);
const lon = Number(args.lon);
if (!Number.isInteger(seed) || seed < 0 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error("Required: --seed <int> --lat <deg> --lon <deg>  (optional --h0 --rotation --geoid --out)");
  process.exit(1);
}

const result = exportTerrain(seed, {
  lat0Deg: lat,
  lon0Deg: lon,
  h0M: Number(args.h0),
  rotationDeg: Number(args.rotation),
  geoidOffsetM: Number(args.geoid),
});

mkdirSync(args.out!, { recursive: true });
const base = path.join(args.out!, `seed-${seed}`);
writeFileSync(`${base}-elevation.asc`, result.asc);
writeFileSync(`${base}-elevation.prj`, result.prj);
writeFileSync(`${base}-canopy.asc`, result.canopyAsc);
writeFileSync(`${base}-canopy.prj`, result.prj);
writeFileSync(`${base}-meta.json`, JSON.stringify(result.meta, null, 2) + "\n");

console.log(
  `wrote ${base}-elevation.asc (+canopy, .prj, meta): ${result.meta.cols}x${result.meta.rows} @ ` +
    `${result.meta.cellsizeM.toFixed(4)} m, UTM ${result.meta.utmZone}${result.meta.hemisphere}, ` +
    `llcenter ${result.meta.xllcenter.toFixed(1)}, ${result.meta.yllcenter.toFixed(1)}`,
);
console.log("Import note: set the consuming tool's water level at elevation 0 — negatives are real seabed.");
