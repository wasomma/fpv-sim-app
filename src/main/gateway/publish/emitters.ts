/*
 * Emitter state machines: one per RF source (each GCS C2 uplink, each
 * drone video downlink). The engine exposes boolean-per-tick keying; the
 * FSM turns that into EE PDU triggers — an update on every keyed↔unkeyed
 * edge, a heartbeat while keyed, and a final zero-beam EE at unkey. RF
 * numbers are notional config values (the engine has no link budget).
 */

import type { EmitterCfg } from "../config.js";
import type { EmitterSystemModel } from "../types.js";

export type EmitterTrigger = "key-on" | "key-off" | "heartbeat";

export class EmitterFsm {
  private keyed = false;
  private lastSentMs = 0;
  private everReported = false;

  update(keyedNow: boolean, nowMs: number, heartbeatS: number): EmitterTrigger | null {
    if (keyedNow !== this.keyed) {
      this.keyed = keyedNow;
      this.lastSentMs = nowMs;
      this.everReported = true;
      return keyedNow ? "key-on" : "key-off";
    }
    if (this.keyed && nowMs - this.lastSentMs >= heartbeatS * 1000) {
      this.lastSentMs = nowMs;
      return "heartbeat";
    }
    return null;
  }

  get isKeyed(): boolean {
    return this.keyed;
  }

  /** Emitter death (entity destroyed): force one final unkey if needed. */
  silence(nowMs: number): EmitterTrigger | null {
    if (this.keyed) {
      this.keyed = false;
      this.lastSentMs = nowMs;
      return "key-off";
    }
    return null;
  }
}

/** One omnidirectional beam while keyed; zero beams when silent. */
export function buildEmitterSystem(cfg: EmitterCfg, emitterIdNumber: number, keyed: boolean): EmitterSystemModel {
  return {
    emitterName: cfg.emitterName,
    emitterFunction: cfg.function,
    emitterIdNumber,
    location: { x: 0, y: 0, z: 0 },
    beams: keyed
      ? [
          {
            beamIdNumber: 1,
            parameterIndex: 0,
            frequencyHz: cfg.freqHz,
            frequencyRangeHz: cfg.bandwidthHz,
            erpDbm: cfg.erpDbm,
            prfHz: 0,
            pulseWidthUs: 0,
            azimuthCenterRad: 0,
            azimuthSweepRad: Math.PI,
            elevationCenterRad: 0,
            elevationSweepRad: Math.PI / 2,
            sweepSync: 0,
            beamFunction: 0,
            highDensityTrackJam: 0,
            jammingModeSequence: 0,
          },
        ]
      : [],
  };
}
