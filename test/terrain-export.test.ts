/*
 * Terrain export: GeoTIFF structure (single-band Float32, uncompressed,
 * nodata), geographic PixelIsArea georeferencing whose pixel centres are
 * exactly the sim posts under the gateway's own local-frame mapping,
 * the two vertical-datum variants, value fidelity against the engine's
 * sampler, raw negatives, canopy range, and the rotated-anchor path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, canopyAt, elevAt } from "fpv-sim-mcp/engine";
import { exportTerrain } from "../src/main/gateway/terrain/export.js";
import { LocalFrame } from "../src/main/gateway/geo/localframe.js";

const SEED = 20260719;
const WORLD = 4000;
const SPACING = WORLD / 199;
const DEG = Math.PI / 180;
const anchor = { lat0Deg: 21.35, lon0Deg: -157.95, h0M: 0, rotationDeg: 0, geoidOffsetM: 0 };

/* ------------------------- a tiny TIFF reader ------------------------- */

type Tag = { type: number; values: number[]; text?: string };

function readTiff(bytes: Uint8Array): { tags: Map<number, Tag>; pixels: (tags: Map<number, Tag>) => Float32Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(bytes[0], 0x49);
  assert.equal(bytes[1], 0x49);
  assert.equal(view.getUint16(2, true), 42);
  const ifd = view.getUint32(4, true);
  const n = view.getUint16(ifd, true);
  const sizes: Record<number, number> = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const tags = new Map<number, Tag>();
  let lastTag = -1;
  for (let i = 0; i < n; i++) {
    const at = ifd + 2 + i * 12;
    const tag = view.getUint16(at, true);
    assert.ok(tag > lastTag, `tags ascending (${tag} after ${lastTag})`);
    lastTag = tag;
    const type = view.getUint16(at + 2, true);
    const count = view.getUint32(at + 4, true);
    const size = sizes[type]!;
    const off = count * size > 4 ? view.getUint32(at + 8, true) : at + 8;
    const values: number[] = [];
    for (let k = 0; k < count; k++) {
      if (type === 2) values.push(bytes[off + k]!);
      else if (type === 3) values.push(view.getUint16(off + k * 2, true));
      else if (type === 4) values.push(view.getUint32(off + k * 4, true));
      else values.push(view.getFloat64(off + k * 8, true));
    }
    const t: Tag = { type, values };
    if (type === 2) t.text = String.fromCharCode(...values.slice(0, -1));
    tags.set(tag, t);
  }
  assert.equal(view.getUint32(ifd + 2 + n * 12, true), 0, "single IFD");
  const pixels = (t: Map<number, Tag>) => {
    const off = t.get(273)!.values[0]!;
    const count = t.get(279)!.values[0]! / 4;
    const out = new Float32Array(count);
    for (let k = 0; k < count; k++) out[k] = view.getFloat32(off + k * 4, true);
    return out;
  };
  return { tags, pixels };
}

/** GeoKeyDirectory → map of key id → SHORT value or ASCII text. */
function geoKeys(tags: Map<number, Tag>): Map<number, number | string> {
  const dir = tags.get(34735)!.values;
  const ascii = tags.get(34737)!.text!;
  assert.deepEqual(dir.slice(0, 3), [1, 1, 1], "GeoTIFF 1.1 key directory header");
  const out = new Map<number, number | string>();
  let last = -1;
  for (let i = 0; i < dir[3]!; i++) {
    const [id, loc, count, value] = dir.slice(4 + i * 4, 8 + i * 4) as [number, number, number, number];
    assert.ok(id > last, "geokeys ascending");
    last = id;
    if (loc === 0) out.set(id, value);
    else if (loc === 34737) out.set(id, ascii.substring(value, value + count - 1));
    else assert.fail(`unexpected key location ${loc}`);
  }
  return out;
}

const result = exportTerrain(SEED, anchor);
const elev = readTiff(result.elevationTif);
const elevPixels = elev.pixels(elev.tags);
const world = buildWorld(SEED, WORLD);
const frame = new LocalFrame(anchor);

test("tiff structure: 200x200 single-band Float32, uncompressed, one strip, nodata -9999", () => {
  const t = elev.tags;
  assert.equal(t.get(256)!.values[0], 200);
  assert.equal(t.get(257)!.values[0], 200);
  assert.deepEqual(t.get(258)!.values, [32]);
  assert.equal(t.get(259)!.values[0], 1);
  assert.equal(t.get(277)!.values[0], 1);
  assert.equal(t.get(278)!.values[0], 200);
  assert.equal(t.get(279)!.values[0], 200 * 200 * 4);
  assert.equal(t.get(284)!.values[0], 1);
  assert.deepEqual(t.get(339)!.values, [3]);
  assert.equal(t.get(42113)!.text, "-9999");
  assert.equal(t.get(273)!.values[0]! + t.get(279)!.values[0]!, result.elevationTif.length, "pixels end the file");
  assert.equal(elevPixels.length, 40000);
  assert.ok(t.get(42112)!.text!.includes('<Item name="FPV_SIM_SEED">20260719</Item>'));
});

test("georeferencing: EPSG:4326 PixelIsArea grid whose pixel centres are the sim posts", () => {
  const scale = elev.tags.get(33550)!.values;
  const tie = elev.tags.get(33922)!.values;
  const dLon = SPACING / frame.metersPerRadLon / DEG;
  const dLat = SPACING / frame.metersPerRadLat / DEG;
  assert.ok(Math.abs(scale[0]! - dLon) < 1e-15 && Math.abs(scale[1]! - dLat) < 1e-15 && scale[2] === 0);
  assert.ok(Math.abs(dLon * frame.metersPerRadLon * DEG - SPACING) < 1e-9, "pixel is one post wide on the ground");
  assert.ok(dLon > dLat, "degrees of longitude are shorter than degrees of latitude here");
  assert.deepEqual(tie.slice(0, 3), [0, 0, 0]);
  // Tiepoint = NW corner of the NW pixel: half a pixel outside the (0, 199) post.
  assert.ok(Math.abs(tie[3]! - (anchor.lon0Deg - dLon / 2)) < 1e-12);
  assert.ok(Math.abs(tie[4]! - (anchor.lat0Deg + 199 * dLat + dLat / 2)) < 1e-12);
  // Pixel centres coincide with where the ESPDU mapping puts each post.
  for (const [gx, gy] of [
    [0, 0],
    [199, 199],
    [57, 120],
    [199, 0],
  ] as const) {
    const centreLon = tie[3]! + (gx + 0.5) * scale[0]!;
    const centreLat = tie[4]! - (199 - gy + 0.5) * scale[1]!;
    const g = frame.localToGeodetic(gx * SPACING, gy * SPACING, 0);
    assert.ok(Math.abs(centreLon - g.lonRad / DEG) < 1e-10, `post ${gx},${gy} lon`);
    assert.ok(Math.abs(centreLat - g.latRad / DEG) < 1e-10, `post ${gx},${gy} lat`);
  }
  assert.equal(result.meta.crs, "EPSG:4326");
  assert.ok(Math.abs(result.meta.bounds.westDeg - tie[3]!) < 1e-12);
  assert.ok(Math.abs(result.meta.bounds.northDeg - tie[4]!) < 1e-12);
  assert.ok(Math.abs(result.meta.bounds.eastDeg - (tie[3]! + 200 * scale[0]!)) < 1e-12);
  assert.ok(Math.abs(result.meta.bounds.southDeg - (tie[4]! - 200 * scale[1]!)) < 1e-12);
});

test("egm96 default: geokeys declare WGS 84 + EGM96 height; values are raw sim metres, north row first", () => {
  const keys = geoKeys(elev.tags);
  assert.equal(keys.get(1024), 2, "geographic model");
  assert.equal(keys.get(1025), 1, "PixelIsArea");
  assert.equal(keys.get(2048), 4326);
  assert.equal(keys.get(2054), 9102);
  assert.equal(keys.get(4096), 5773, "EGM96 height");
  assert.equal(keys.get(4099), 9001);
  assert.equal(keys.get(2049), "WGS 84");
  assert.equal(result.meta.verticalDatum, "egm96");
  assert.equal(result.meta.verticalCrs, "EPSG:5773");
  assert.equal(result.meta.verticalOffsetM, 0);
  // Row 0 = gy 199 (north edge); last row = gy 0 (south edge).
  const at = (gx: number, gy: number) => elevPixels[(199 - gy) * 200 + gx]!;
  assert.ok(Math.abs(at(0, 199) - elevAt(world, 0, 199 * SPACING)) < 1e-3, "NW corner");
  assert.ok(Math.abs(at(0, 0) - elevAt(world, 0, 0)) < 1e-3, "SW corner");
  assert.ok(Math.abs(at(199, 199) - elevAt(world, 199 * SPACING, 199 * SPACING)) < 1e-3, "NE corner");
  assert.ok(Math.abs(at(123, 45) - elevAt(world, 123 * SPACING, 45 * SPACING)) < 1e-3, "interior");
});

test("negative elevations export raw (water is real seabed); no nodata in an unrotated box", () => {
  const values = Array.from(elevPixels);
  assert.ok(values.some((v) => v < 0), "the coastal seed has sub-sea-level posts");
  assert.ok(values.every((v) => v > -60 && v < 400), "values inside the generator's plausible range");
  assert.ok(!values.includes(-9999));
});

test("ellipsoid variant: WGS 84 3D geokey, geoid offset added; h0M adds in both", () => {
  const a = { ...anchor, h0M: 2, geoidOffsetM: 17.5 };
  const msl = exportTerrain(SEED, a);
  const ell = exportTerrain(SEED, a, { vdatum: "ellipsoid" });
  const mslPx = readTiff(msl.elevationTif);
  const ellPx = readTiff(ell.elevationTif);
  const m = mslPx.pixels(mslPx.tags);
  const e = ellPx.pixels(ellPx.tags);
  assert.ok(Math.abs(m[0]! - elevPixels[0]! - 2) < 1e-3, "egm96 carries h0M only");
  assert.ok(Math.abs(e[0]! - elevPixels[0]! - 19.5) < 1e-3, "ellipsoid carries h0M + geoidOffsetM");
  const keys = geoKeys(ellPx.tags);
  assert.equal(keys.get(2048), 4979, "WGS 84 3D");
  assert.equal(keys.has(4096), false, "no vertical key with ellipsoidal heights");
  assert.equal(ell.meta.verticalDatum, "ellipsoid");
  assert.equal(ell.meta.verticalCrs, "EPSG:4979");
  assert.equal(ell.meta.verticalOffsetM, 19.5);
  assert.equal(msl.meta.verticalOffsetM, 2);
  // Same grid either way.
  assert.deepEqual(ellPx.tags.get(33922)!.values, mslPx.tags.get(33922)!.values);
  assert.ok(ellPx.tags.get(42112)!.text!.includes("ellipsoidal"));
});

test("canopy raster is 0..1 on the same georeferencing", () => {
  const c = readTiff(result.canopyTif);
  assert.deepEqual(c.tags.get(33550)!.values, elev.tags.get(33550)!.values);
  assert.deepEqual(c.tags.get(33922)!.values, elev.tags.get(33922)!.values);
  const keys = geoKeys(c.tags);
  assert.equal(keys.get(1024), 2);
  assert.equal(keys.get(1025), 1);
  assert.equal(keys.get(2048), 4326);
  assert.equal(keys.has(4096), false, "a density carries no vertical datum");
  assert.ok(String(keys.get(1026)).endsWith("WGS 84 (EPSG:4326)"));
  const values = Array.from(c.pixels(c.tags));
  assert.ok(values.every((v) => v >= 0 && v <= 1));
  assert.ok(values.some((v) => v > 0.5), "jungle seed has dense canopy");
  assert.ok(Math.abs(values[199 * 200 + 0]! - canopyAt(world, 0, 0)) < 1e-6, "SW corner matches the sampler");
});

test("rotated anchor: north-aligned grid covers the whole box, nodata outside, engine values inside", () => {
  const a = { ...anchor, rotationDeg: 30 };
  const r = exportTerrain(SEED, a);
  const f = new LocalFrame(a);
  const t = readTiff(r.elevationTif);
  const cols = t.tags.get(256)!.values[0]!;
  const rows = t.tags.get(257)!.values[0]!;
  assert.ok(cols > 200 && rows > 200, `rotated extent ${cols}x${rows}`);
  assert.equal(r.meta.cols, cols);
  const px = t.pixels(t.tags);
  const tie = t.tags.get(33922)!.values;
  const scale = t.tags.get(33550)!.values;
  // Every box corner lies inside the raster's outer edges.
  for (const [x, y] of [
    [0, 0],
    [WORLD, 0],
    [0, WORLD],
    [WORLD, WORLD],
  ]) {
    const g = f.localToGeodetic(x!, y!, 0);
    const lon = g.lonRad / DEG;
    const lat = g.latRad / DEG;
    assert.ok(lon >= r.meta.bounds.westDeg && lon <= r.meta.bounds.eastDeg, "corner inside east-west");
    assert.ok(lat >= r.meta.bounds.southDeg && lat <= r.meta.bounds.northDeg, "corner inside north-south");
  }
  // The raster's own corners fall outside the rotated box.
  assert.equal(px[0], -9999);
  assert.equal(px[cols - 1], -9999);
  assert.equal(px[(rows - 1) * cols], -9999);
  assert.equal(px[rows * cols - 1], -9999);
  // Every finite pixel equals the engine at the local point under its centre.
  let inside = 0;
  for (let row = 0; row < rows; row += 7) {
    for (let col = 0; col < cols; col += 7) {
      const v = px[row * cols + col]!;
      const lon = (tie[3]! + (col + 0.5) * scale[0]!) * DEG;
      const lat = (tie[4]! - (row + 0.5) * scale[1]!) * DEG;
      const p = f.geodeticToLocal(lat, lon, 0);
      const inBox = p.x >= -1e-6 && p.x <= WORLD + 1e-6 && p.y >= -1e-6 && p.y <= WORLD + 1e-6;
      if (!inBox) assert.equal(v, -9999);
      else {
        inside++;
        assert.ok(Math.abs(v - elevAt(world, p.x, p.y)) < 1e-3, `pixel ${col},${row}`);
      }
    }
  }
  assert.ok(inside > 300, `sampled ${inside} in-box pixels`);
});
