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
import { DisGateway } from "../gateway/index.js";
import { NullGateway, type GatewaySlot, type OverlayTrack, type TickView } from "../../shared/gateway-slot.js";
import { buildTickView } from "./tick-view.js";
import { TickPacer } from "./pacer.js";

type Mode = "orbit" | "tactical";

/* Electron's utilityProcess message port on `process`. */
interface ParentPort {
  on(event: "message", listener: (e: { data: HostCommand }) => void): void;
  postMessage(message: unknown): void;
}
const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort;

type HostCommand =
  | {
      type: "start";
      sessionId: string;
      seed: number;
      mode: Mode;
      overrides: ConfigOverrides | undefined;
      speed: number;
      maxSimS: number;
      gatewayConfig: unknown | null;
    }
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
  gatewayActive: boolean;
  overlay: OverlayTrack[];
}

let rt: HostRuntime | null = null;
const CATCHUP_TICKS_PER_WAKE = 40;
const SNAPSHOT_MS = 100;
let lastSnapshotAt = 0;

function view(eventsFrom: number): TickView {
  return buildTickView(rt!.sim, rt!.tick, rt!.mode, eventsFrom);
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
  const v = view(rt!.eventCursor);
  rt!.eventCursor = rt!.sim.events.length;
  parentPort.postMessage({
    type: "snapshot",
    view: v,
    speed: rt!.pacer.speed,
    paused: rt!.pacer.isPaused,
    lagMs: rt!.pacer.lagMs(rt!.tick, now),
    gateway: rt!.gatewayActive ? rt!.gateway.status() : null,
    overlay: rt!.overlay,
  });
}

function endSession(reason: string): void {
  if (rt === null) return;
  clearInterval(rt.interval);
  rt.gateway.onSessionEnd(reason);
  postSnapshot(true);
  parentPort.postMessage({ type: "ended", reason, result: rt.sim.buildResult() });
  void rt.gateway.shutdown();
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
      const v = view(rt.gatewayEventCursor);
      rt.gatewayEventCursor = rt.sim.events.length;
      rt.gateway.onTick(v);
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
    void (async () => {
      try {
        const sim = new Simulation(msg.seed, msg.overrides, msg.mode);
        let gateway: GatewaySlot = new NullGateway();
        let gatewayActive = false;
        if (msg.gatewayConfig !== null && msg.gatewayConfig !== undefined) {
          const dis = new DisGateway(msg.gatewayConfig);
          if (dis.configIssues !== undefined) {
            parentPort.postMessage({ type: "error", message: `gateway config: ${dis.configIssues}` });
            return;
          }
          await dis.open();
          gateway = dis;
          gatewayActive = true;
        }
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
          gateway,
          gatewayActive,
          overlay: [],
        };
        gateway.onOverlay((tracks) => {
          if (rt !== null) rt.overlay = tracks;
        });
        gateway.onSessionStart({
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
    })();
    return;
  }
  if (rt === null) return;
  const now = Date.now();
  switch (msg.type) {
    case "pause":
      rt.pacer.pause(rt.tick, now);
      rt.gateway.onPause?.();
      postSnapshot(true);
      break;
    case "resume":
      rt.pacer.resume(rt.tick, now);
      rt.gateway.onResume?.();
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
