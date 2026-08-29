/*
 * Sim local frame (x east-ish, y north-ish, z up, meters, origin at the
 * box's southwest corner) <-> Earth. This is deliberately a
 * FLAT-GEODETIC mapping, not a tangent-plane ENU: latitude/longitude
 * vary linearly with the rotated local offsets at the anchor's constant
 * curvature radii (meridian M0, prime-vertical N0), so DEM export and
 * entity positions stay exactly consistent by construction. The
 * constant-radii approximation costs < 2 cm across +/-4 km at
 * mid-latitudes. rotationDeg is the azimuth of local +y, degrees
 * clockwise from true north; h0M is the ellipsoidal height of local
 * z = 0; geoidOffsetM is added to h. The anchor must not sit at a pole
 * (config clamps |lat0Deg| <= 89.9).
 */

import type { Vec3 } from "../types.js";
import {
  WGS84_A,
  WGS84_E2,
  type Geodetic,
  geodeticToEcef,
  ecefToGeodetic,
  enuToEcefVector,
} from "./wgs84.js";

/** Structurally matches GatewayConfig["anchor"]. */
export interface LocalFrameAnchor {
  lat0Deg: number;
  lon0Deg: number;
  h0M: number;
  rotationDeg: number;
  geoidOffsetM: number;
}

const DEG = Math.PI / 180;

export class LocalFrame {
  private readonly lat0: number;
  private readonly lon0: number;
  /** h0M + geoidOffsetM: added to local z to get ellipsoidal h. */
  private readonly hBase: number;
  private readonly cosR: number;
  private readonly sinR: number;
  /** Meridian radius at the anchor: a(1-e2)/(1-e2 sin^2 lat0)^1.5. */
  private readonly m0: number;
  /** N0 cos(lat0), the meters-per-radian-of-longitude scale. */
  private readonly n0CosLat0: number;
  /** Azimuth of local +y, radians clockwise from true north. */
  readonly rotationRad: number;

  constructor(anchor: LocalFrameAnchor) {
    this.lat0 = anchor.lat0Deg * DEG;
    this.lon0 = anchor.lon0Deg * DEG;
    this.hBase = anchor.h0M + anchor.geoidOffsetM;
    const r = anchor.rotationDeg * DEG;
    this.rotationRad = r;
    this.cosR = Math.cos(r);
    this.sinR = Math.sin(r);
    const sinLat0 = Math.sin(this.lat0);
    const w2 = 1 - WGS84_E2 * sinLat0 * sinLat0;
    this.m0 = (WGS84_A * (1 - WGS84_E2)) / (w2 * Math.sqrt(w2));
    this.n0CosLat0 = (WGS84_A / Math.sqrt(w2)) * Math.cos(this.lat0);
  }

  localToGeodetic(x: number, y: number, z: number): Geodetic {
    const east = x * this.cosR + y * this.sinR;
    const north = y * this.cosR - x * this.sinR;
    return {
      latRad: this.lat0 + north / this.m0,
      lonRad: this.lon0 + east / this.n0CosLat0,
      h: this.hBase + z,
    };
  }

  localToEcef(x: number, y: number, z: number): Vec3 {
    const g = this.localToGeodetic(x, y, z);
    return geodeticToEcef(g.latRad, g.lonRad, g.h);
  }

  /** Exact inverse of localToGeodetic. */
  geodeticToLocal(latRad: number, lonRad: number, h: number): Vec3 {
    const north = (latRad - this.lat0) * this.m0;
    const east = (lonRad - this.lon0) * this.n0CosLat0;
    return {
      x: east * this.cosR - north * this.sinR,
      y: north * this.cosR + east * this.sinR,
      z: h - this.hBase,
    };
  }

  ecefToLocal(p: Vec3): Vec3 {
    const g = ecefToGeodetic(p);
    return this.geodeticToLocal(g.latRad, g.lonRad, g.h);
  }

  /**
   * Local (vx, vy, vz) m/s -> ECEF m/s. The ENU basis is taken at the
   * entity's own geodetic position, not the anchor's.
   */
  localVelocityToEcef(vx: number, vy: number, vz: number, atLatRad: number, atLonRad: number): Vec3 {
    const vE = vx * this.cosR + vy * this.sinR;
    const vN = vy * this.cosR - vx * this.sinR;
    return enuToEcefVector(atLatRad, atLonRad, vE, vN, vz);
  }
}
