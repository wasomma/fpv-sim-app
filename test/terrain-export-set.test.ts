/*
 * The export set as the app ships it: one call writes both vertical-datum
 * variants with their metadata plus the canopy raster, names them by
 * seed, validates the request the way the gateway config does, warns
 * about the two common mistakes, and reads back through the writer's
 * own reader (which the self-check relies on).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportTerrain } from "../src/main/gateway/terrain/export.js";
import {
  SEED_MAX,
  terrainExportFileName,
  terrainExportWarnings,
  validateTerrainExportRequest,
  writeTerrainExportSet,
} from "../src/main/gateway/terrain/export-set.js";
import { readFloat32GeoTiff } from "../src/main/gateway/terrain/geotiff.js";

const SEED = 20260719;
const anchor = { lat0Deg: 21.35, lon0Deg: -157.95, h0M: 0, rotationDeg: 0, geoidOffsetM: 12.5 };

function scratch(): string {
  return mkdtempSync(path.join(os.tmpdir(), "fpv-terrain-set-"));
}

test("a set is five files named by seed, both datums plus canopy, in the order written", () => {
  const dir = scratch();
  try {
    const r = writeTerrainExportSet(SEED, anchor, path.join(dir, "nested", "out"));
    assert.equal(r.ok, true);
    assert.equal(r.dir, path.join(dir, "nested", "out"));
    assert.deepEqual(
      r.files.map((f) => path.basename(f.path)),
      [
        "seed-20260719-elevation-egm96.tif",
        "seed-20260719-elevation-egm96.json",
        "seed-20260719-elevation-ellipsoid.tif",
        "seed-20260719-elevation-ellipsoid.json",
        "seed-20260719-canopy.tif",
      ],
    );
    assert.deepEqual(
      r.files.map((f) => f.layer),
      ["elevation", "elevation-metadata", "elevation", "elevation-metadata", "canopy"],
    );
    for (const f of r.files) {
      assert.ok(path.isAbsolute(f.path));
      assert.ok(existsSync(f.path), f.path);
      assert.equal(readFileSync(f.path).byteLength, f.bytes);
    }
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.anchor, anchor);
    assert.notEqual(r.anchor, anchor, "the anchor is copied, not shared");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the files are byte-identical to exportTerrain's and the metadata JSON is its meta", () => {
  const dir = scratch();
  try {
    const r = writeTerrainExportSet(SEED, anchor, dir);
    for (const vdatum of ["egm96", "ellipsoid"] as const) {
      const direct = exportTerrain(SEED, anchor, { vdatum });
      assert.deepEqual(readFileSync(path.join(dir, terrainExportFileName(SEED, "elevation", vdatum))), Buffer.from(direct.elevationTif));
      const json = JSON.parse(readFileSync(path.join(dir, terrainExportFileName(SEED, "elevation", vdatum, "json")), "utf8"));
      assert.deepEqual(json, JSON.parse(JSON.stringify(direct.meta)));
      assert.deepEqual(r.meta[vdatum], direct.meta);
      assert.deepEqual(readFileSync(path.join(dir, terrainExportFileName(SEED, "canopy"))), Buffer.from(direct.canopyTif));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the writer's reader recovers grid, CRS tags, nodata and the datum offset", () => {
  const dir = scratch();
  try {
    writeTerrainExportSet(SEED, anchor, dir);
    const egm = readFloat32GeoTiff(readFileSync(path.join(dir, "seed-20260719-elevation-egm96.tif")));
    const ell = readFloat32GeoTiff(readFileSync(path.join(dir, "seed-20260719-elevation-ellipsoid.tif")));
    const canopy = readFloat32GeoTiff(readFileSync(path.join(dir, "seed-20260719-canopy.tif")));
    assert.equal(egm.width, 200);
    assert.equal(egm.height, 200);
    assert.equal(egm.geodeticEpsg, 4326);
    assert.equal(egm.verticalEpsg, 5773);
    assert.equal(ell.geodeticEpsg, 4979, "ellipsoidal heights are WGS 84 3D, carried by the geodetic key");
    assert.equal(ell.verticalEpsg, null);
    assert.equal(canopy.geodeticEpsg, 4326);
    assert.equal(canopy.verticalEpsg, null, "a density declares no vertical CRS");
    assert.equal(egm.nodata, -9999);
    assert.ok(Math.abs(egm.westDeg + egm.pixelLonDeg / 2 - anchor.lon0Deg) < 1e-9, "west edge half a pixel west of the anchor");
    assert.ok(Math.abs(egm.northDeg - egm.pixelLatDeg / 2 - (anchor.lat0Deg + 199 * egm.pixelLatDeg)) < 1e-9);
    let worst = 0;
    for (let i = 0; i < egm.pixels.length; i++) worst = Math.max(worst, Math.abs(ell.pixels[i]! - egm.pixels[i]! - 12.5));
    assert.ok(worst < 1e-3, `variants differ by the geoid offset everywhere (worst ${worst})`);
    assert.ok(canopy.pixels.every((v) => v >= 0 && v <= 1));
    assert.throws(() => readFloat32GeoTiff(new Uint8Array([0x4d, 0x4d, 0, 42])), /little-endian/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--vdatum narrows the set to one elevation variant plus canopy", () => {
  const dir = scratch();
  try {
    const r = writeTerrainExportSet(SEED, anchor, dir, { vdatums: ["ellipsoid"] });
    assert.deepEqual(
      r.files.map((f) => path.basename(f.path)),
      ["seed-20260719-elevation-ellipsoid.tif", "seed-20260719-elevation-ellipsoid.json", "seed-20260719-canopy.tif"],
    );
    assert.equal(r.meta.egm96, undefined);
    assert.throws(() => writeTerrainExportSet(SEED, anchor, dir, { vdatums: [] }), /no vertical datum/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("warnings: the untouched 0,0 anchor and a zero geoid offset with the ellipsoid variant", () => {
  assert.deepEqual(terrainExportWarnings(anchor, ["egm96", "ellipsoid"]), []);
  const zeroGeoid = { ...anchor, geoidOffsetM: 0 };
  assert.match(terrainExportWarnings(zeroGeoid, ["egm96", "ellipsoid"])[0]!, /geoidOffsetM is 0/);
  assert.deepEqual(terrainExportWarnings(zeroGeoid, ["egm96"]), [], "no ellipsoid file, nothing to warn about");
  const gulf = { ...zeroGeoid, lat0Deg: 0, lon0Deg: 0 };
  const w = terrainExportWarnings(gulf, ["egm96", "ellipsoid"]);
  assert.equal(w.length, 2);
  assert.match(w[0]!, /Gulf of Guinea/);
  const dir = scratch();
  try {
    const r = writeTerrainExportSet(SEED, zeroGeoid, dir);
    assert.equal(r.warnings.length, 1);
    assert.deepEqual(
      readFloat32GeoTiff(readFileSync(path.join(dir, "seed-20260719-elevation-egm96.tif"))).pixels,
      readFloat32GeoTiff(readFileSync(path.join(dir, "seed-20260719-elevation-ellipsoid.tif"))).pixels,
      "with geoid 0 the two rasters carry the same heights (only the CRS tags differ)",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("request validation: seed range, anchor shape, gateway ranges, unknown keys, partial anchors", () => {
  const ok = validateTerrainExportRequest(SEED, { lat0Deg: 21.35, lon0Deg: -157.95 });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.anchor, { lat0Deg: 21.35, lon0Deg: -157.95, h0M: 0, rotationDeg: 0, geoidOffsetM: 0 });
  for (const bad of [-1, 1.5, SEED_MAX + 1, "7", NaN, undefined]) {
    const r = validateTerrainExportRequest(bad, anchor);
    assert.equal(r.ok, false, String(bad));
    if (!r.ok) assert.match(r.error, /seed must be an integer/);
  }
  for (const bad of [null, "21.35,-157.95", [21.35, -157.95], undefined]) {
    const r = validateTerrainExportRequest(SEED, bad);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /anchor must be an object/);
  }
  const range = validateTerrainExportRequest(SEED, { lat0Deg: 95, lon0Deg: 0 });
  assert.equal(range.ok, false);
  if (!range.ok) assert.match(range.error, /anchor\.lat0Deg/);
  const typo = validateTerrainExportRequest(SEED, { lat0Deg: 21.35, lon0deg: -157.95 });
  assert.equal(typo.ok, false);
  if (!typo.ok) assert.match(typo.error, /lon0deg/);
  const nan = validateTerrainExportRequest(SEED, { lat0Deg: Number.NaN, lon0Deg: 0 });
  assert.equal(nan.ok, false);
});
