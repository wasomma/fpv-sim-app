/*
 * External track store: remote Entity State PDUs, keyed site:app:entity,
 * dead-reckoned (linear part only, capped) between updates so the
 * overlay moves smoothly at render rate, expired after a silence
 * window. Strictly display-side — nothing here can reach the engine.
 */

import type { OverlayTrack } from "../../../shared/gateway-slot.js";
import type { LocalFrame } from "../geo/localframe.js";
import { disEulerToNed } from "../geo/orientation.js";
import { ecefToGeodetic } from "../geo/wgs84.js";
import type { EspduModel } from "../types.js";

const WORLD_M = 4000;
const EXTRAPOLATE_CAP_S = 5;

interface StoredTrack {
  key: string;
  marking: string;
  forceId: number;
  location: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  headingRad: number | null;
  spdMps: number;
  rxWallMs: number;
}

export class TrackStore {
  private readonly tracks = new Map<string, StoredTrack>();
  private readonly frame: LocalFrame;
  private readonly timeoutS: number;
  private readonly extrapolate: boolean;

  constructor(frame: LocalFrame, timeoutS: number, extrapolate: boolean) {
    this.frame = frame;
    this.timeoutS = timeoutS;
    this.extrapolate = extrapolate;
  }

  upsert(pdu: EspduModel, nowMs: number): void {
    const key = `${pdu.entityId.site}:${pdu.entityId.app}:${pdu.entityId.entity}`;
    const geo = ecefToGeodetic(pdu.location);
    const ned = disEulerToNed(pdu.orientation, geo.latRad, geo.lonRad);
    const spd = Math.hypot(pdu.linearVelocity.x, pdu.linearVelocity.y, pdu.linearVelocity.z);
    this.tracks.set(key, {
      key,
      marking: pdu.marking,
      forceId: pdu.forceId,
      location: pdu.location,
      velocity: pdu.drAlgorithm === 1 ? { x: 0, y: 0, z: 0 } : pdu.linearVelocity,
      headingRad: spd > 0.5 ? ned.psiNed : null,
      spdMps: spd,
      rxWallMs: nowMs,
    });
  }

  snapshot(nowMs: number): OverlayTrack[] {
    const out: OverlayTrack[] = [];
    for (const [key, t] of this.tracks) {
      const ageS = (nowMs - t.rxWallMs) / 1000;
      if (ageS > this.timeoutS) {
        this.tracks.delete(key);
        continue;
      }
      const dt = this.extrapolate ? Math.min(ageS, EXTRAPOLATE_CAP_S) : 0;
      const ecef = {
        x: t.location.x + t.velocity.x * dt,
        y: t.location.y + t.velocity.y * dt,
        z: t.location.z + t.velocity.z * dt,
      };
      const local = this.frame.ecefToLocal(ecef);
      const outside = local.x < 0 || local.x > WORLD_M || local.y < 0 || local.y > WORLD_M;
      out.push({
        key,
        marking: t.marking,
        forceId: t.forceId,
        x: local.x,
        y: local.y,
        aglM: null,
        hdgRad: t.headingRad === null ? null : t.headingRad - this.frame.rotationRad,
        spdMps: t.spdMps,
        outsideWorld: outside,
        lastRxMs: t.rxWallMs,
      });
    }
    return out;
  }

  get count(): number {
    return this.tracks.size;
  }
}
