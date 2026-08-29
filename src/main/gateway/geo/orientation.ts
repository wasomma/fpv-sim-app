/*
 * DIS orientation: the 3-2-1 (yaw-pitch-roll) Euler set that rotates
 * the ECEF axes into body axes. NED is the local geodetic
 * north-east-down frame at the entity's position; all rotation matrices
 * here are passive (coordinate-transform) DCMs, R_ned->body =
 * Rx(phi) Ry(theta) Rz(psi). Extraction is singular at |pitch| = 90 deg
 * (gimbal lock, e.g. heading true north at 0N 0E puts body-x on ECEF
 * +Z): there roll is folded to 0 and yaw absorbs the coupled angle, so
 * nedEulerToDis / disEulerToNed still round-trip through the lock.
 * Public surface is exactly the three functions below.
 */

import type { DisEuler } from "../types.js";

type Mat3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

function matMul3(a: Mat3, b: Mat3): Mat3 {
  const el = (i: 0 | 1 | 2, j: 0 | 1 | 2): number =>
    a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return [
    [el(0, 0), el(0, 1), el(0, 2)],
    [el(1, 0), el(1, 1), el(1, 2)],
    [el(2, 0), el(2, 1), el(2, 2)],
  ];
}

function transpose(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

function rotX(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [1, 0, 0],
    [0, c, s],
    [0, -s, c],
  ];
}

function rotY(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [c, 0, -s],
    [0, 1, 0],
    [s, 0, c],
  ];
}

function rotZ(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [c, s, 0],
    [-s, c, 0],
    [0, 0, 1],
  ];
}

/** Rows are the NED unit vectors n, e, d expressed in ECEF. */
function ecefToNed(latRad: number, lonRad: number): Mat3 {
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);
  return [
    [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    [-sinLon, cosLon, 0],
    [-cosLat * cosLon, -cosLat * sinLon, -sinLat],
  ];
}

/** 3-2-1 DCM: Rx(phi) Ry(theta) Rz(psi). */
function zyx(psi: number, theta: number, phi: number): Mat3 {
  return matMul3(matMul3(rotX(phi), rotY(theta)), rotZ(psi));
}

/*
 * Inverse of zyx(). At |sin(theta)| = 1 the DCM collapses to
 *   row1 = [-sin(phi+psi), cos(phi+psi), 0]   (theta = -pi/2)
 *   row1 = [ sin(phi-psi), cos(phi-psi), 0]   (theta = +pi/2)
 * so only the coupled angle is observable: report phi = 0 and put it
 * all in psi. The naive atan2(m01, m00) is atan2(+-0, +-0) there and
 * returns sign-of-zero garbage (e.g. pi), which would NOT reconstruct
 * the matrix.
 */
function extractZyx(m: Mat3): { psi: number; theta: number; phi: number } {
  const sinTheta = Math.min(1, Math.max(-1, -m[0][2]));
  if (sinTheta >= 1 - 1e-12) {
    return { psi: -Math.atan2(m[1][0], m[1][1]), theta: Math.PI / 2, phi: 0 };
  }
  if (sinTheta <= -1 + 1e-12) {
    return { psi: Math.atan2(-m[1][0], m[1][1]), theta: -Math.PI / 2, phi: 0 };
  }
  return {
    psi: Math.atan2(m[0][1], m[0][0]),
    theta: Math.asin(sinTheta),
    phi: Math.atan2(m[1][2], m[2][2]),
  };
}

export function nedEulerToDis(
  psiNed: number,
  thetaNed: number,
  phiNed: number,
  latRad: number,
  lonRad: number,
): DisEuler {
  // M = R_ned->body . R_ecef->ned maps ECEF -> body.
  const m = matMul3(zyx(psiNed, thetaNed, phiNed), ecefToNed(latRad, lonRad));
  return extractZyx(m);
}

export function disEulerToNed(
  disEuler: DisEuler,
  latRad: number,
  lonRad: number,
): { psiNed: number; thetaNed: number; phiNed: number } {
  const m = zyx(disEuler.psi, disEuler.theta, disEuler.phi); // ECEF -> body
  const rNedToBody = matMul3(m, transpose(ecefToNed(latRad, lonRad)));
  const out = extractZyx(rNedToBody);
  return { psiNed: out.psi, thetaNed: out.theta, phiNed: out.phi };
}

const STANDARD_GRAVITY = 9.80665;
const MAX_BANK = (35 * Math.PI) / 180;

/**
 * NED attitude from the sim's kinematics: yaw = heading (north = 0,
 * clockwise), pitch from climb vs horizontal speed, roll = coordinated
 * turn bank clamped to +-35 deg. Below 0.5 m/s horizontal the wings
 * stay level (pitch/roll from near-zero velocity would be noise).
 */
export function synthesizeAttitude(input: {
  hdgRad: number;
  spdMps: number;
  vUp: number;
  turnRateRps: number;
}): { psiNed: number; thetaNed: number; phiNed: number } {
  const psiNed = input.hdgRad;
  if (input.spdMps < 0.5) {
    return { psiNed, thetaNed: 0, phiNed: 0 };
  }
  const thetaNed = Math.atan2(input.vUp, input.spdMps);
  const bank = Math.atan((input.turnRateRps * input.spdMps) / STANDARD_GRAVITY);
  const phiNed = Math.max(-MAX_BANK, Math.min(MAX_BANK, bank));
  return { psiNed, thetaNed, phiNed };
}
