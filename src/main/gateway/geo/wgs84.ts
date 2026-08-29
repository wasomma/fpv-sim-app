/*
 * WGS-84 ellipsoid conversions: a = 6378137 m, f = 1/298.257223563,
 * e2 = f(2-f). Angles radians, lengths meters, ECEF axes per DIS
 * (X toward 0N 0E, Z toward the north pole). ecefToGeodetic must
 * converge to |dLat| < 1e-13 rad within 15 iterations and must not
 * produce NaN on the polar axis (horizontal distance ~ 0, where
 * longitude is undefined and reported as 0).
 */

import type { Vec3 } from "../types.js";

export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export interface Geodetic {
  latRad: number;
  lonRad: number;
  h: number;
}

export function geodeticToEcef(latRad: number, lonRad: number, h: number): Vec3 {
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (n + h) * cosLat * Math.cos(lonRad),
    y: (n + h) * cosLat * Math.sin(lonRad),
    z: (n * (1 - WGS84_E2) + h) * sinLat,
  };
}

export function ecefToGeodetic(p: Vec3): Geodetic {
  const rho = Math.hypot(p.x, p.y);
  const b = WGS84_A * (1 - WGS84_F);
  if (rho < 1e-9) {
    return {
      latRad: p.z >= 0 ? Math.PI / 2 : -Math.PI / 2,
      lonRad: 0,
      h: Math.abs(p.z) - b,
    };
  }
  const lonRad = Math.atan2(p.y, p.x);
  // Bowring's parametric-latitude start, then fixed-point on (lat, h).
  const ePrime2 = WGS84_E2 / (1 - WGS84_E2);
  const beta = Math.atan2(p.z * WGS84_A, rho * b);
  const sinBeta = Math.sin(beta);
  const cosBeta = Math.cos(beta);
  let lat = Math.atan2(
    p.z + ePrime2 * b * sinBeta * sinBeta * sinBeta,
    rho - WGS84_E2 * WGS84_A * cosBeta * cosBeta * cosBeta,
  );
  for (let i = 0; i < 15; i++) {
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    // rho/cos(lat) degrades near the poles; switch to the Z-based form.
    const h = Math.abs(cosLat) > 1e-6 ? rho / cosLat - n : p.z / sinLat - n * (1 - WGS84_E2);
    const next = Math.atan2(p.z, rho * (1 - (WGS84_E2 * n) / (n + h)));
    const converged = Math.abs(next - lat) < 1e-13;
    lat = next;
    if (converged) break;
  }
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const h = Math.abs(cosLat) > 1e-6 ? rho / cosLat - n : p.z / sinLat - n * (1 - WGS84_E2);
  return { latRad: lat, lonRad, h };
}

/** Unit East/North/Up at (lat, lon), expressed in ECEF. */
export function enuBasis(latRad: number, lonRad: number): { e: Vec3; n: Vec3; u: Vec3 } {
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);
  return {
    e: { x: -sinLon, y: cosLon, z: 0 },
    n: { x: -sinLat * cosLon, y: -sinLat * sinLon, z: cosLat },
    u: { x: cosLat * cosLon, y: cosLat * sinLon, z: sinLat },
  };
}

export function enuToEcefVector(
  latRad: number,
  lonRad: number,
  vE: number,
  vN: number,
  vU: number,
): Vec3 {
  const { e, n, u } = enuBasis(latRad, lonRad);
  return {
    x: vE * e.x + vN * n.x + vU * u.x,
    y: vE * e.y + vN * n.y + vU * u.y,
    z: vE * e.z + vN * n.z + vU * u.z,
  };
}
