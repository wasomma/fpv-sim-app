/*
 * The narrow contract between the app shell and an interop gateway module.
 *
 * The session host calls onTick() synchronously after every 0.1 s engine
 * step with a frozen, read-only projection of engine state. A gateway
 * implementation (the DIS module; later perhaps a native HLA federate)
 * derives everything else itself — velocity, attitude, dead-reckoning
 * mirrors — so the engine is never written to and never asked for an RNG
 * draw. Inbound traffic surfaces only as OverlayTrack snapshots for the
 * Live Ops map; nothing flows from the network into the engine.
 */

export type Side = "BLUFOR" | "OPFOR";
export type EntityKind = "drone" | "gcs" | "df_node";

export interface TickEntity {
  id: string;
  side: Side;
  kind: EntityKind;
  /** Tactical airframes carry STRIKE or HUNTER; orbit drones omit it. */
  role?: "STRIKE" | "HUNTER";
  x: number;
  y: number;
  /** Height above ground, meters. Ground entities omit it (they sit on terrain). */
  aglM?: number;
  /** Sim-MSL height, meters: max(ground, 0) + AGL (engine convention). */
  zM?: number;
  /** Heading, radians, north = 0, clockwise positive (engine convention). */
  hdgRad?: number;
  spdMps?: number;
  state?: string;
  battPct?: number;
  launched?: boolean;
  downed?: boolean;
  destroyed?: boolean;
  /** GCS C2 uplink keyed this tick. */
  transmitting?: boolean;
  /** FPV video downlink keyed this tick. */
  videoOn?: boolean;
}

export interface TickView {
  /** Sim time, seconds (= tick * 0.1). */
  t: number;
  tick: number;
  mode: "orbit" | "tactical";
  phase: string;
  entities: TickEntity[];
  /** Per-side solved fix estimate on the ENEMY GCS, if any. */
  fixes: Record<Side, { x: number; y: number; cepM: number } | null>;
  winner?: Side;
  stalemate?: boolean;
  objective?: { x: number; y: number; r: number; name: string };
  /** Events appended since the previous view (engine's typed event stream). */
  eventsTail: { t: number; side: string; text: string }[];
}

export interface SessionInfo {
  sessionId: string;
  seed: number;
  mode: "orbit" | "tactical";
  /** Digest of config overrides for display/status; the gateway never needs the values. */
  overridesDigest: string;
  /** Wall-clock ms when the session started. */
  startedAtMs: number;
  /** Current pacer speed factor (wall-apparent kinematics scale by this). */
  speed: number;
}

export interface GatewayStatus {
  enabled: boolean;
  state: "idle" | "configured" | "running" | "stopped" | "error";
  detail?: string;
  lastError?: string;
  tx?: Record<string, number>;
  rx?: Record<string, number>;
  peers?: { addr: string; lastSeenMs: number; pduCount: number }[];
  externalTracks?: number;
}

export interface OverlayTrack {
  key: string;
  marking: string;
  forceId: number;
  x: number;
  y: number;
  aglM: number | null;
  hdgRad: number | null;
  spdMps: number | null;
  outsideWorld: boolean;
  lastRxMs: number;
}

export interface GatewaySlot {
  configure(cfg: unknown): GatewayStatus;
  onSessionStart(info: SessionInfo): void;
  /** Called synchronously after every engine tick. Must not throw. */
  onTick(view: TickView): void;
  /** Pacer speed changed mid-session (wall-apparent kinematics rescale). */
  onSpeedChange?(speed: number): void;
  /** Pacer paused/resumed (drives Stop-Freeze/Start-Resume when configured). */
  onPause?(): void;
  onResume?(): void;
  onSessionEnd(reason: string): void;
  status(): GatewayStatus;
  onOverlay(cb: (tracks: OverlayTrack[]) => void): () => void;
  shutdown(): Promise<void>;
}

/** No-op implementation so the shell is complete without a gateway module. */
export class NullGateway implements GatewaySlot {
  configure(): GatewayStatus {
    return this.status();
  }
  onSessionStart(): void {}
  onTick(): void {}
  onSessionEnd(): void {}
  status(): GatewayStatus {
    return { enabled: false, state: "idle", detail: "no gateway module configured" };
  }
  onOverlay(): () => void {
    return () => {};
  }
  async shutdown(): Promise<void> {}
}
