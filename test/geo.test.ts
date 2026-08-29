/*
 * Georeferencing contract: WGS-84 known answers, round-trip closure of
 * ecef<->geodetic and local<->ecef, the flat-geodetic frame's rotation
 * sense (rotationDeg = azimuth of local +y, clockwise from true north),
 * and DIS 3-2-1 Euler extraction including the gimbal-lock fold.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { geodeticToEcef, ecefToGeodetic } from "../src/main/gateway/geo/wgs84.js";
import { LocalFrame } from "../src/main/gateway/geo/localframe.js";
import {
  nedEulerToDis,
  disEulerToNed,
  synthesizeAttitude,
} from "../src/main/gateway/geo/orientation.js";

const DEG = Math.PI / 180;
const wrapPi = (x: number): number => Math.atan2(Math.sin(x), Math.cos(x));

test("geodeticToEcef known answers", () => {
  const equator = geodeticToEcef(0, 0, 0);
  assert.ok(Math.abs(equator.x - 6378137) < 1e-6);
  assert.ok(Math.abs(equator.y) < 1e-6);
  assert.ok(Math.abs(equator.z) < 1e-6);

  // At the pole Z = b = a(1 - f) = 6356752.3142... (semi-minor axis).
  const pole = geodeticToEcef(90 * DEG, 0, 0);
  assert.ok(Math.abs(pole.x) < 1e-3);
  assert.ok(Math.abs(pole.y) < 1e-3);
  assert.ok(Math.abs(pole.z - 6356752.3142) < 1e-3);
});

test("geodetic <-> ecef round trip over the grid", () => {
  const lats = [-75, -45, -10, 0, 10, 45, 75];
  const lons = [-170, -90, 0, 90, 170];
  const hs = [-100, 0, 1000, 10000];
  for (const latDeg of lats) {
    for (const lonDeg of lons) {
      for (const h of hs) {
        const lat = latDeg * DEG;
        const lon = lonDeg * DEG;
        const p = geodeticToEcef(lat, lon, h);
        const g = ecefToGeodetic(p);
        const tag = `${latDeg},${lonDeg},${h}`;
        assert.ok(Math.abs(g.latRad - lat) < 1e-9, `lat ${tag}: ${g.latRad - lat}`);
        assert.ok(Math.abs(g.lonRad - lon) < 1e-9, `lon ${tag}: ${g.lonRad - lon}`);
        assert.ok(Math.abs(g.h - h) < 1e-3, `h ${tag}: ${g.h - h}`);
        const p2 = geodeticToEcef(g.latRad, g.lonRad, g.h);
        assert.ok(Math.abs(p2.x - p.x) < 1e-3, `x ${tag}`);
        assert.ok(Math.abs(p2.y - p.y) < 1e-3, `y ${tag}`);
        assert.ok(Math.abs(p2.z - p.z) < 1e-3, `z ${tag}`);
      }
    }
  }
});

test("ecefToGeodetic handles the polar axis without NaN", () => {
  const b = 6378137 * (1 - 1 / 298.257223563);
  const north = ecefToGeodetic({ x: 0, y: 0, z: b });
  assert.ok(Math.abs(north.latRad - Math.PI / 2) < 1e-12);
  assert.ok(Number.isFinite(north.lonRad));
  assert.ok(Math.abs(north.h) < 1e-6);
  const south = ecefToGeodetic({ x: 0, y: 0, z: -(b + 5000) });
  assert.ok(Math.abs(south.latRad + Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(south.h - 5000) < 1e-6);
});

test("LocalFrame round trip across the box", () => {
  const points: Array<[number, number]> = [
    [0, 0],
    [4000, 0],
    [0, 4000],
    [4000, 4000],
    [2000, 2000],
    [1234.5, 3456.25],
    [250, 3750],
  ];
  for (const lat0Deg of [0, 37.5, -21]) {
    for (const lon0Deg of [0, 145.7]) {
      for (const rotationDeg of [0, 37]) {
        const frame = new LocalFrame({
          lat0Deg,
          lon0Deg,
          h0M: 120,
          rotationDeg,
          geoidOffsetM: -17.25,
        });
        for (const [x, y] of points) {
          for (const z of [0, 500]) {
            const back = frame.ecefToLocal(frame.localToEcef(x, y, z));
            const tag = `anchor ${lat0Deg},${lon0Deg} rot ${rotationDeg} pt ${x},${y},${z}`;
            assert.ok(Math.abs(back.x - x) < 1e-3, `x ${tag}: ${back.x - x}`);
            assert.ok(Math.abs(back.y - y) < 1e-3, `y ${tag}: ${back.y - y}`);
            assert.ok(Math.abs(back.z - z) < 1e-3, `z ${tag}: ${back.z - z}`);
          }
        }
      }
    }
  }
});

test("rotation 90 deg maps local +y to true east", () => {
  const frame = new LocalFrame({ lat0Deg: 0, lon0Deg: 0, h0M: 0, rotationDeg: 90, geoidOffsetM: 0 });
  const g = frame.localToGeodetic(0, 1000, 0);
  // 1000 m east at the equator: dLon = 1000 / N0, N0(0) = a exactly.
  assert.ok(g.lonRad > 1e-4, "must shift east");
  assert.ok(Math.abs(g.lonRad - 1000 / 6378137) < 1e-12);
  assert.ok(Math.abs(g.latRad) < 1e-12, `lat moved: ${g.latRad}`);
});

test("DIS Euler known answer at 0N 0E heading north, level", () => {
  /*
   * Hand derivation. At (0N, 0E) the NED axes expressed in ECEF are
   * n = (0,0,1), e = (0,1,0), d = (-1,0,0). Heading north and level
   * means R_ned->body = I, so M = R_ecef->ned = [[0,0,1],[0,1,0],
   * [-1,0,0]]: body-x IS ECEF +Z. Then sin(thetaDis) = -M[0][2] = -1,
   * theta = asin(-1) = -pi/2 — exact gimbal lock. There M[0][0] and
   * M[0][1] are both zero, so psi = atan2(M[0][1], M[0][0]) is
   * undefined (sign-of-zero noise can return pi, which does NOT
   * reconstruct M). The extraction folds roll to 0 and takes yaw from
   * row 1 = [-sin(phi+psi), cos(phi+psi), 0] = [0, 1, 0]:
   * psi = atan2(-M[1][0], M[1][1]) = atan2(0, 1) = 0.
   * Expected DIS Euler: psi = 0, theta = -pi/2, phi = 0, exactly.
   */
  const dis = nedEulerToDis(0, 0, 0, 0, 0);
  assert.equal(Math.abs(dis.psi), 0);
  assert.equal(dis.theta, -Math.PI / 2);
  assert.equal(Math.abs(dis.phi), 0);

  const back = disEulerToNed(dis, 0, 0);
  assert.ok(Math.abs(wrapPi(back.psiNed - 0)) < 1e-9);
  assert.ok(Math.abs(back.thetaNed) < 1e-9);
  assert.ok(Math.abs(back.phiNed) < 1e-9);
});

test("NED <-> DIS Euler round trip, 300 seeded states", () => {
  // LCG (Numerical Recipes constants); no Math.random so failures repro.
  let s = 20260829 >>> 0;
  const rand = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 300; i++) {
    const lat = (rand() * 2 - 1) * 1.45;
    const lon = (rand() * 2 - 1) * Math.PI;
    const state = {
      hdgRad: rand() * 2 * Math.PI,
      spdMps: rand() * 60,
      vUp: (rand() * 2 - 1) * 15,
      turnRateRps: (rand() * 2 - 1) * 0.6,
    };
    const ned = synthesizeAttitude(state);
    const dis = nedEulerToDis(ned.psiNed, ned.thetaNed, ned.phiNed, lat, lon);
    const back = disEulerToNed(dis, lat, lon);
    const tag = `case ${i}`;
    assert.ok(Math.abs(wrapPi(back.psiNed - ned.psiNed)) < 1e-9, `psi ${tag}`);
    assert.ok(Math.abs(back.thetaNed - ned.thetaNed) < 1e-9, `theta ${tag}`);
    assert.ok(Math.abs(back.phiNed - ned.phiNed) < 1e-9, `phi ${tag}`);
  }
});

test("north velocity at 0N 0E is ECEF +Z", () => {
  const frame = new LocalFrame({ lat0Deg: 0, lon0Deg: 0, h0M: 0, rotationDeg: 0, geoidOffsetM: 0 });
  const g = frame.localToGeodetic(0, 0, 0);
  const v = frame.localVelocityToEcef(0, 10, 0, g.latRad, g.lonRad);
  assert.ok(Math.abs(v.x) < 1e-6);
  assert.ok(Math.abs(v.y) < 1e-6);
  assert.ok(Math.abs(v.z - 10) < 1e-6);
});
