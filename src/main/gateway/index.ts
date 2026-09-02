/*
 * DisGateway — the GatewaySlot binding for native DIS over UDP.
 *
 * Lifecycle: constructed from a validated config; open() binds sockets;
 * onSessionStart announces (Start/Resume) and begins publishing per
 * tick; the receive path runs the whole time and feeds the overlay
 * track store. Strictly read-only against the engine: state lives in DR
 * mirrors, emitter FSMs, and derived-kinematics history — never in
 * TickViews, which arrive frozen.
 */

import type {
  GatewaySlot,
  GatewayStatus,
  OverlayTrack,
  SessionInfo,
  TickView,
} from "../../shared/gateway-slot.js";
import { encodePdu, decodePdu } from "./codec/factory.js";
import { validateGatewayConfig, type GatewayConfig } from "./config.js";
import { LocalFrame } from "./geo/localframe.js";
import { DisSocket } from "./net/udp.js";
import { IdAllocator } from "./publish/ids.js";
import { Publisher } from "./publish/publisher.js";
import { TrackStore } from "./receive/trackstore.js";
import type { AnyPdu } from "./types.js";

export class DisGateway implements GatewaySlot {
  private cfg: GatewayConfig;
  private frame: LocalFrame;
  private socket: DisSocket | null = null;
  private publisher: Publisher | null = null;
  private tracks: TrackStore | null = null;
  private state: GatewayStatus["state"] = "configured";
  private detail: string | undefined;
  private lastError: string | undefined;
  private overlayCbs = new Set<(tracks: OverlayTrack[]) => void>();
  private overlayTimer: NodeJS.Timeout | null = null;
  private lastView: TickView | null = null;
  private sessionLabel = "";
  private rxIgnored = { exercise: 0, self: 0, malformed: 0, otherTypes: 0 };
  private selfHeard = false;
  private peers = new Map<string, { lastSeenMs: number; pduCount: number }>();

  constructor(rawCfg: unknown) {
    const { config, issues } = validateGatewayConfig(rawCfg);
    this.cfg = config;
    if (issues.length > 0) {
      this.state = "error";
      this.lastError = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    }
    this.frame = new LocalFrame(config.anchor);
  }

  configure(rawCfg: unknown): GatewayStatus {
    const { config, issues } = validateGatewayConfig(rawCfg);
    if (issues.length > 0) {
      this.lastError = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
      this.state = "error";
      return this.status();
    }
    this.cfg = config;
    this.frame = new LocalFrame(config.anchor);
    this.state = "configured";
    this.lastError = undefined;
    return this.status();
  }

  get configIssues(): string | undefined {
    return this.state === "error" ? this.lastError : undefined;
  }

  async open(): Promise<void> {
    this.socket = new DisSocket(this.cfg.network);
    await this.socket.open();
    this.tracks = new TrackStore(this.frame, this.cfg.receive.timeoutS, this.cfg.receive.extrapolate);
    this.socket.onPacket((data, from) => this.onPacket(data, from));
    const ids = new IdAllocator(this.cfg);
    this.publisher = new Publisher(this.cfg, this.frame, ids, (pdu: AnyPdu) => {
      try {
        this.socket?.send(encodePdu(pdu));
      } catch (err) {
        this.lastError = `encode/send: ${(err as Error).message}`;
      }
    });
    this.overlayTimer = setInterval(() => {
      if (this.tracks === null || this.overlayCbs.size === 0) return;
      const snap = this.tracks.snapshot(Date.now());
      for (const cb of this.overlayCbs) cb(snap);
    }, 250);
  }

  private onPacket(data: Buffer, from: string): void {
    if (this.tracks === null) return;
    const decoded = decodePdu(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (!decoded.ok) {
      this.rxIgnored.malformed++;
      return;
    }
    const pdu = decoded.pdu;
    const header = pdu.pdu.header;
    if (this.cfg.receive.exerciseFilter && header.exerciseId !== this.cfg.dis.exerciseId) {
      this.rxIgnored.exercise++;
      return;
    }
    if (pdu.kind !== "espdu") {
      this.rxIgnored.otherTypes++;
      return;
    }
    const id = pdu.pdu.entityId;
    if (id.site === this.cfg.dis.siteId && id.app === this.cfg.dis.applicationId) {
      this.selfHeard = true;
      this.rxIgnored.self++;
      return;
    }
    if (!this.cfg.receive.enabled) return;
    this.tracks.upsert(pdu.pdu, Date.now());
    const peer = this.peers.get(from) ?? { lastSeenMs: 0, pduCount: 0 };
    peer.lastSeenMs = Date.now();
    peer.pduCount++;
    this.peers.set(from, peer);
  }

  onSessionStart(info: SessionInfo): void {
    if (this.publisher === null) return;
    this.state = "running";
    this.sessionLabel = `session ${info.sessionId} seed ${info.seed} (${info.mode})`;
    this.detail = this.speedDetail(info.speed);
    this.publisher.sessionStart(info, Date.now());
  }

  onTick(view: TickView): void {
    this.lastView = view;
    try {
      this.publisher?.onTick(view, Date.now());
    } catch (err) {
      this.lastError = `publish: ${(err as Error).message}`;
    }
  }

  /** "<session> at Nx", plus the advisory when N exceeds publish.maxSpeedFactor. */
  private speedDetail(speed: number): string {
    const max = this.cfg.publish.maxSpeedFactor;
    const warn = speed > max ? ` · speed ${speed}x exceeds publish.maxSpeedFactor ${max} — remote smoothing will degrade` : "";
    return `${this.sessionLabel} at ${speed}x${warn}`;
  }

  onSpeedChange(speed: number): void {
    if (this.state === "running") this.detail = this.speedDetail(speed);
    this.publisher?.setSpeed(speed, this.lastView, Date.now());
  }

  onPause(): void {
    this.publisher?.pause(Date.now());
  }

  onResume(): void {
    this.publisher?.resume(Date.now());
  }

  onSessionEnd(): void {
    this.publisher?.sessionEnd(Date.now());
    this.state = "stopped";
  }

  status(): GatewayStatus {
    const counters = this.publisher?.counters;
    return {
      enabled: true,
      state: this.state,
      detail: this.detail,
      lastError: this.lastError ?? this.socket?.stats.lastError ?? undefined,
      tx: counters === undefined ? undefined : { ...counters, bytes: this.socket?.stats.txBytes ?? 0 },
      rx:
        this.socket === null
          ? undefined
          : {
              pdus: this.socket.stats.rxPdus,
              bytes: this.socket.stats.rxBytes,
              ignoredExercise: this.rxIgnored.exercise,
              ignoredSelf: this.rxIgnored.self,
              malformed: this.rxIgnored.malformed,
              otherTypes: this.rxIgnored.otherTypes,
              selfHeard: this.selfHeard ? 1 : 0,
            },
      peers: [...this.peers.entries()].map(([addr, p]) => ({ addr, lastSeenMs: p.lastSeenMs, pduCount: p.pduCount })),
      externalTracks: this.tracks?.count ?? 0,
    };
  }

  onOverlay(cb: (tracks: OverlayTrack[]) => void): () => void {
    this.overlayCbs.add(cb);
    return () => this.overlayCbs.delete(cb);
  }

  async shutdown(): Promise<void> {
    if (this.overlayTimer !== null) clearInterval(this.overlayTimer);
    this.overlayTimer = null;
    await this.socket?.close();
    this.socket = null;
    this.publisher = null;
    this.state = "stopped";
  }
}
