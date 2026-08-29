/*
 * Dead-reckoning mirror: replicates, per entity, the extrapolation a
 * REMOTE receiver runs from our last published ESPDU, so threshold
 * checks compare against what the network believes rather than what we
 * last sent. Wall-clock time drives extrapolation (DIS receivers live in
 * wall time); the publisher already expresses velocities in the
 * wall-apparent frame at accelerated session speeds.
 *
 * DRM 1 (Static): holds. DRM 2 (FPW): position + v*dt, orientation
 * fixed. DRM 4 (RVW): same linear part (we publish zero acceleration);
 * orientation propagates by the body yaw rate only — a deliberate
 * simplification adequate for threshold estimation of slow multirotors,
 * noted here rather than hidden.
 */

import type { DisEuler, Vec3 } from "../types.js";

export interface PublishedState {
  atWallMs: number;
  algorithm: number;
  location: Vec3;
  velocity: Vec3;
  orientation: DisEuler;
  angularVelocity: Vec3;
  appearance: number;
}

const wrapPi = (a: number): number => {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x < -Math.PI) x += 2 * Math.PI;
  return x;
};

export class DrMirror {
  private last: PublishedState | null = null;

  record(state: PublishedState): void {
    this.last = state;
  }

  get published(): PublishedState | null {
    return this.last;
  }

  predict(nowMs: number): { location: Vec3; orientation: DisEuler } | null {
    if (this.last === null) return null;
    const s = this.last;
    if (s.algorithm === 1) {
      return { location: s.location, orientation: s.orientation };
    }
    const dt = Math.max(0, (nowMs - s.atWallMs) / 1000);
    const location: Vec3 = {
      x: s.location.x + s.velocity.x * dt,
      y: s.location.y + s.velocity.y * dt,
      z: s.location.z + s.velocity.z * dt,
    };
    const orientation: DisEuler =
      s.algorithm === 4
        ? { psi: s.orientation.psi + s.angularVelocity.z * dt, theta: s.orientation.theta, phi: s.orientation.phi }
        : s.orientation;
    return { location, orientation };
  }

  /** Remote's extrapolation error vs truth exceeds a threshold? */
  exceeds(
    truth: { location: Vec3; orientation: DisEuler },
    posThresholdM: number,
    oriThresholdRad: number,
    nowMs: number,
  ): boolean {
    const p = this.predict(nowMs);
    if (p === null) return true;
    const dx = p.location.x - truth.location.x;
    const dy = p.location.y - truth.location.y;
    const dz = p.location.z - truth.location.z;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > posThresholdM) return true;
    const dPsi = Math.abs(wrapPi(p.orientation.psi - truth.orientation.psi));
    const dTheta = Math.abs(wrapPi(p.orientation.theta - truth.orientation.theta));
    const dPhi = Math.abs(wrapPi(p.orientation.phi - truth.orientation.phi));
    return Math.max(dPsi, dTheta, dPhi) > oriThresholdRad;
  }

  heartbeatDue(nowMs: number, heartbeatS: number): boolean {
    if (this.last === null) return true;
    return nowMs - this.last.atWallMs >= heartbeatS * 1000;
  }

  appearanceChanged(appearance: number): boolean {
    return this.last === null || this.last.appearance !== appearance;
  }
}
