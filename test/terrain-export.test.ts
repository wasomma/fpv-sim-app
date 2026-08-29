/*
 * Terrain export: header math (node registration, 4000/199 spacing, row
 * order), value fidelity against the engine's own sampler, raw
 * negatives, canopy range, and UTM zone derivation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, elevAt } from "fpv-sim-mcp/engine";
import { exportTerrain, utmZoneFor } from "../src/main/gateway/terrain/export.js";

const SEED = 20260719;
const anchor = { lat0Deg: 21.35, lon0Deg: -157.95, h0M: 0, rotationDeg: 0, geoidOffsetM: 0 };
const result = exportTerrain(SEED, anchor);
const lines = result.asc.trimEnd().split("\n");

test("asc header: node-registered 200x200 grid at 4000/199 spacing", () => {
  assert.equal(lines[0], "ncols 200");
  assert.equal(lines[1], "nrows 200");
  assert.ok(lines[2]!.startsWith("xllcenter "));
  assert.ok(lines[3]!.startsWith("yllcenter "));
  const cellsize = Number(lines[4]!.split(" ")[1]);
  assert.ok(Math.abs(cellsize - 4000 / 199) < 1e-9, `cellsize ${cellsize}`);
  assert.equal(lines[5], "NODATA_value -9999");
  assert.equal(lines.length, 6 + 200);
});

test("row order is north-to-south and values match the engine sampler", () => {
  const world = buildWorld(SEED, 4000);
  const spacing = 4000 / 199;
  const firstRow = lines[6]!.split(" ").map(Number);
  const lastRow = lines[6 + 199]!.split(" ").map(Number);
  // First data row = gy 199 (north edge); last = gy 0 (south edge).
  assert.ok(Math.abs(firstRow[0]! - elevAt(world, 0, 199 * spacing)) < 0.01, "NW corner");
  assert.ok(Math.abs(lastRow[0]! - elevAt(world, 0, 0)) < 0.01, "SW corner");
  assert.ok(Math.abs(firstRow[199]! - elevAt(world, 199 * spacing, 199 * spacing)) < 0.01, "NE corner");
});

test("negative elevations export raw (water is real seabed)", () => {
  const values = lines.slice(6).flatMap((l) => l.split(" ").map(Number));
  assert.ok(values.some((v) => v < 0), "the coastal seed has sub-sea-level posts");
  assert.ok(values.every((v) => v > -60 && v < 400), "values inside the generator's plausible range");
});

test("canopy raster is 0..1 with the same georeferencing", () => {
  const canopyLines = result.canopyAsc.trimEnd().split("\n");
  assert.equal(canopyLines[2], lines[2]);
  assert.equal(canopyLines[3], lines[3]);
  const values = canopyLines.slice(6).flatMap((l) => l.split(" ").map(Number));
  assert.ok(values.every((v) => v >= 0 && v <= 1));
  assert.ok(values.some((v) => v > 0.5), "jungle seed has dense canopy");
});

test("UTM zone derivation and prj content", () => {
  assert.equal(utmZoneFor(-157.95), 4);
  assert.equal(utmZoneFor(0.1), 31);
  assert.equal(utmZoneFor(-0.1), 30);
  assert.equal(result.meta.utmZone, 4);
  assert.ok(result.prj.includes('UTM zone 4N') && result.prj.includes('"central_meridian",-159'));
});

test("h0M offsets exported elevations", () => {
  const shifted = exportTerrain(SEED, { ...anchor, h0M: 100 });
  const a = Number(lines[6]!.split(" ")[0]);
  const b = Number(shifted.asc.trimEnd().split("\n")[6]!.split(" ")[0]);
  assert.ok(Math.abs(b - a - 100) < 0.01);
});
