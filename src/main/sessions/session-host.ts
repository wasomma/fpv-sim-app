/*
 * Live session host — runs inside an Electron utilityProcess.
 *
 * Owns the headless Simulation, paces it against the wall clock, calls
 * the gateway slot synchronously after every tick, and posts throttled
 * snapshots to the main process. End-of-run conditions replicate
 * Simulation.runToCompletion() exactly, per mode, so a live session that
 * runs to its end produces buildResult() output deep-equal to the batch
 * runEngagement() of the same (seed, mode, overrides).
 */

import { Simulation, type ConfigOverrides } from "fpv-sim-mcp/engine";

type Mode = "orbit" | "tactical";
import { NullGateway, type GatewaySlot, type TickEntity, type TickView } from "../../shared/gateway-slot.js";
import { TICK_S, TickPacer } from "./pacer.js";

/* Electron's utilityProcess message port on `process`. */
interface ParentPort {
  on(event: "message", listener: (e: { data: HostCommand }) => void): void;
  postMessage(message: unknown): void;
}
const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort;

type HostCommand =
  | { type: "start"; sessionId: string; seed: number; mode: Mode; overrides: ConfigOverrides | undefined; speed: number; maxSimS: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "set-speed"; speed: number }
  | { type: "stop" };

interface HostRuntime {
  sim: Simulation;
  pacer: TickPacer;
  sessionId: string;
  mode: Mode;
  maxSimS: number;
  tick: number;
  /** Next engine event index the SNAPSHOT stream hasn't sent yet. */
  eventCursor: number;
  /** Next engine event index the GATEWAY hasn't been shown yet. */
  gatewayEventCursor: number;
  interval: NodeJS.Timeout;
  gateway: GatewaySlot;
  /** False while the slot holds the NullGateway — skips per-tick view builds. */
  gatewayActive: boolean;
  endedReason: string | null;
}

let rt: HostRuntime | null = null;
const CATCHUP_TICKS_PER_WAKE = 40;
const SNAPSHOT_MS = 100;
let lastSnapshotAt = 0;

function entityViews(sim: Simulation): TickEntity[] {
  const out: TickEntity[] = [];
  for (const side of ["BLUFOR", "OPFOR"] as const) {
    const T = sim.teams[side];
    out.push({
      id: T.gcs.id,
      side,
      kind: "gcs",
      x: T.gcs.x,
      y: T.gcs.y,
      destroyed: T.gcs.destroyed,
      transmitting: T.gcs.transmitting,
    });
    for (const n of T.nodes) {
      out.push({ id: n.id, side, kind: "df_node", x: n.x, y: n.y });
    }
    const drones = T.drones ?? (T.drone !== null ? [T.drone] : []);
    for (const d of drones) {
      out.push({
        id: d.id,
        side,
        kind: "drone",
        role: d.role,
        x: d.x,
        y: d.y,
        aglM: d.agl,
        hdgRad: d.hdg,
        spdMps: d.spd,
        state: d.state,
        battPct: d.batt,
        launched: d.launched,
        downed: d.downed,
        videoOn: d.videoOn,
      });
    }
  }
  return out;
}

function buildView(includeEventsFrom: number): TickView {
  const sim = rt!.sim;
  const fix = (side: "BLUFOR" | "OPFOR") => {
    const est = sim.teams[side].est;
    return est !== null && est.solved && est.p !== null ? { x: est.p.x, y: est.p.y, cepM: est.cep } : null;
  };
  return {
    t: sim.t,
    tick: rt!.tick,
    mode: rt!.mode,
    phase: sim.phase,
    entities: entityViews(sim),
    fixes: { BLUFOR: fix("BLUFOR"), OPFOR: fix("OPFOR") },
    winner: sim.winner ?? undefined,
    stalemate: sim.stalemate,
    objective: sim.obj !== null ? { x: sim.obj.x, y: sim.obj.y, r: sim.obj.r, name: sim.obj.name } : undefined,
    eventsTail: sim.events.slice(includeEventsFrom),
  };
}

/** One engine tick + the exact end conditions of runToCompletion(). */
function stepOnce(): boolean {
  const sim = rt!.sim;
  sim.step();
  rt!.tick++;
  if (rt!.mode === "tactical") {
    if (sim.winner !== null) return true;
    if (sim.stalemate) {
      // endReason is private in TS terms only; runtime assignment matches
      // what runToCompletion() itself does.
      (sim as unknown as { endReason: string }).endReason = "packages_expended";
      return true;
    }
  } else {
    if (sim.winner !== null) return true;
    if (sim.teams.BLUFOR.drone!.downed && sim.teams.OPFOR.drone!.downed) {
      (sim as unknown as { endReason: string }).endReason = "both_drones_down";
      return true;
    }
  }
  return sim.t >= rt!.maxSimS;
}

function postSnapshot(force: boolean): void {
  const now = Date.now();
  if (!force && now - lastSnapshotAt < SNAPSHOT_MS) return;
  lastSnapshotAt = now;
  const view = buildView(rt!.eventCursor);
  rt!.eventCursor = rt!.sim.events.length;
  parentPort.postMessage({
    type: "snapshot",
    view,
    speed: rt!.pacer.speed,
    paused: rt!.pacer.isPaused,
    lagMs: rt!.pacer.lagMs(rt!.tick, now),
  });
}

function endSession(reason: string): void {
  if (rt === null) return;
  clearInterval(rt.interval);
  rt.gateway.onSessionEnd(reason);
  postSnapshot(true);
  parentPort.postMessage({ type: "ended", reason, result: rt.sim.buildResult() });
  rt = null;
}

function onWake(): void {
  if (rt === null) return;
  const now = Date.now();
  const target = rt.pacer.targetTick(now);
  let steps = 0;
  while (rt.tick < target && steps < CATCHUP_TICKS_PER_WAKE) {
    const ended = stepOnce();
    steps++;
    if (rt.gatewayActive) {
      const view = buildView(rt.gatewayEventCursor);
      rt.gatewayEventCursor = rt.sim.events.length;
      rt.gateway.onTick(view);
    }
    if (ended) {
      endSession(rt.sim.winner !== null ? "engagement_decided" : "engagement_over");
      return;
    }
  }
  postSnapshot(false);
}

parentPort.on("message", (e) => {
  const msg = e.data;
  if (msg.type === "start") {
    if (rt !== null) {
      parentPort.postMessage({ type: "error", message: "session already running in this host" });
      return;
    }
    try {
      const sim = new Simulation(msg.seed, msg.overrides, msg.mode);
      rt = {
        sim,
        pacer: new TickPacer(Date.now(), msg.speed),
        sessionId: msg.sessionId,
        mode: msg.mode,
        maxSimS: msg.maxSimS,
        tick: 0,
        eventCursor: 0,
        gatewayEventCursor: 0,
        interval: setInterval(onWake, 20),
        gateway: new NullGateway(),
        gatewayActive: false,
        endedReason: null,
      };
      rt.gateway.onSessionStart({
        sessionId: msg.sessionId,
        seed: msg.seed,
        mode: msg.mode,
        overridesDigest: msg.overrides !== undefined ? JSON.stringify(msg.overrides) : "",
        startedAtMs: Date.now(),
        speed: msg.speed,
      });
      parentPort.postMessage({ type: "started", sessionId: msg.sessionId });
      postSnapshot(true);
    } catch (err) {
      parentPort.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (rt === null) return;
  const now = Date.now();
  switch (msg.type) {
    case "pause":
      rt.pacer.pause(rt.tick, now);
      postSnapshot(true);
      break;
    case "resume":
      rt.pacer.resume(rt.tick, now);
      postSnapshot(true);
      break;
    case "set-speed":
      rt.pacer.setSpeed(msg.speed, rt.tick, now);
      rt.gateway.onSpeedChange?.(msg.speed);
      postSnapshot(true);
      break;
    case "stop":
      endSession("stopped_by_user");
      break;
  }
});
