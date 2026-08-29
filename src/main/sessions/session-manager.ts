/*
 * Main-process handle on the live session: spawns the utilityProcess
 * session host, routes commands, caches the latest snapshot, accumulates
 * the event stream behind absolute cursors (for MCP paging and the Live
 * Ops feed), and broadcasts updates to app windows. One session at a
 * time in v1; the API carries session_id so that can widen later.
 */

import { BrowserWindow, utilityProcess, type UtilityProcess } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GatewayStatus, OverlayTrack, TickView } from "../../shared/gateway-slot.js";
import { validateGatewayConfig } from "../gateway/config.js";

export interface LiveStartOpts {
  seed: number;
  mode?: "orbit" | "tactical";
  overrides?: Record<string, unknown>;
  speed?: number;
  maxSimS?: number;
  /** Gateway config for this session; falls back to the pending config. */
  gateway?: unknown;
}

interface SnapshotMsg {
  type: "snapshot";
  view: TickView;
  speed: number;
  paused: boolean;
  lagMs: number;
  gateway: GatewayStatus | null;
  overlay: OverlayTrack[];
}
type HostMsg =
  | { type: "started"; sessionId: string }
  | SnapshotMsg
  | { type: "ended"; reason: string; result: unknown }
  | { type: "error"; message: string };

export type LiveState = "idle" | "running" | "paused" | "ended";

interface SessionRecord {
  sessionId: string;
  seed: number;
  mode: "orbit" | "tactical";
  overrides: Record<string, unknown> | undefined;
  speed: number;
  maxSimS: number;
  startedAtMs: number;
  child: UtilityProcess | null;
  state: LiveState;
  lastView: TickView | null;
  lagMs: number;
  events: { t: number; side: string; text: string }[];
  endedReason: string | null;
  result: unknown | null;
  stopWaiters: ((result: unknown) => void)[];
  gatewayStatus: GatewayStatus | null;
  overlay: OverlayTrack[];
}

let session: SessionRecord | null = null;
let counter = 0;
let pendingGatewayCfg: unknown | null = null;

function hostModulePath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "session-host.js");
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

export function liveStatus(): {
  state: LiveState;
  sessionId?: string;
  seed?: number;
  mode?: string;
  t?: number;
  tick?: number;
  phase?: string;
  speed?: number;
  lagMs?: number;
  winner?: string;
  endedReason?: string;
  gateway: { enabled: boolean; state: string };
} {
  if (session === null) return { state: "idle", gateway: { enabled: false, state: "idle" } };
  return {
    state: session.state,
    sessionId: session.sessionId,
    seed: session.seed,
    mode: session.mode,
    t: session.lastView?.t,
    tick: session.lastView?.tick,
    phase: session.lastView?.phase,
    speed: session.speed,
    lagMs: session.lagMs,
    winner: session.lastView?.winner,
    endedReason: session.endedReason ?? undefined,
    gateway: session.gatewayStatus ?? { enabled: false, state: "idle" },
  };
}

/** Stage a gateway config for the next session (validated immediately). */
export function liveConfigureGateway(cfg: unknown): { ok: boolean; error?: string } {
  const { issues } = validateGatewayConfig(cfg);
  if (issues.length > 0) {
    return { ok: false, error: issues.map((i) => `${i.path}: ${i.message}`).join("; ") };
  }
  if (session !== null && session.state !== "ended") {
    return { ok: false, error: "a session is active; the new gateway config applies to the next session" };
  }
  pendingGatewayCfg = cfg;
  return { ok: true };
}

export function liveGatewayStatus(): GatewayStatus & { pendingConfig: boolean } {
  const status = session?.gatewayStatus ?? {
    enabled: false,
    state: "idle" as const,
    detail: pendingGatewayCfg !== null ? "configured for next session" : "no gateway config staged",
  };
  return { ...status, pendingConfig: pendingGatewayCfg !== null };
}

export function liveOverlay(): OverlayTrack[] {
  return session?.overlay ?? [];
}

export function liveSnapshot(eventsAfter = 0): {
  state: LiveState;
  view: TickView | null;
  events: { t: number; side: string; text: string }[];
  nextCursor: number;
} {
  if (session === null) return { state: "idle", view: null, events: [], nextCursor: 0 };
  const from = Math.max(0, Math.min(eventsAfter, session.events.length));
  return {
    state: session.state,
    view: session.lastView,
    events: session.events.slice(from),
    nextCursor: session.events.length,
  };
}

export function liveStart(opts: LiveStartOpts): { ok: boolean; sessionId?: string; error?: string } {
  if (session !== null && session.state !== "ended") {
    return { ok: false, error: `session ${session.sessionId} is ${session.state}; stop it first` };
  }
  const seed = opts.seed;
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    return { ok: false, error: "seed must be an integer in 0..4294967295" };
  }
  const mode = opts.mode === "tactical" ? "tactical" : "orbit";
  const speed = typeof opts.speed === "number" ? Math.min(60, Math.max(0.25, opts.speed)) : 1;
  const maxSimS = typeof opts.maxSimS === "number" ? Math.min(14400, Math.max(60, opts.maxSimS)) : 3600;
  const sessionId = `live-${Date.now()}-${++counter}`;

  const child = utilityProcess.fork(hostModulePath(), [], {
    serviceName: "fpv-sim live session",
    stdio: "pipe",
  });
  child.stdout?.on("data", (d: Buffer) => console.log(`[session-host] ${String(d).trimEnd()}`));
  child.stderr?.on("data", (d: Buffer) => console.error(`[session-host] ${String(d).trimEnd()}`));

  session = {
    sessionId,
    seed,
    mode,
    overrides: opts.overrides,
    speed,
    maxSimS,
    startedAtMs: Date.now(),
    child,
    state: "running",
    lastView: null,
    lagMs: 0,
    events: [],
    endedReason: null,
    result: null,
    stopWaiters: [],
    gatewayStatus: null,
    overlay: [],
  };

  child.on("message", (raw: unknown) => {
    const msg = raw as HostMsg;
    if (session === null || session.sessionId !== sessionId) return;
    if (msg.type === "snapshot") {
      session.lastView = msg.view;
      session.speed = msg.speed;
      session.lagMs = msg.lagMs;
      session.state = msg.paused ? "paused" : session.state === "ended" ? "ended" : "running";
      session.gatewayStatus = msg.gateway;
      session.overlay = msg.overlay;
      if (msg.view.eventsTail.length > 0) session.events.push(...msg.view.eventsTail);
      broadcast("live-snapshot", { status: liveStatus(), view: msg.view, overlay: msg.overlay });
    } else if (msg.type === "ended") {
      session.state = "ended";
      session.endedReason = msg.reason;
      session.result = msg.result;
      for (const w of session.stopWaiters) w(msg.result);
      session.stopWaiters = [];
      broadcast("live-ended", { status: liveStatus(), reason: msg.reason, result: msg.result });
      child.kill();
      session.child = null;
    } else if (msg.type === "error") {
      session.state = "ended";
      session.endedReason = `error: ${msg.message}`;
      broadcast("live-ended", { status: liveStatus(), reason: session.endedReason, result: null });
      child.kill();
      session.child = null;
    }
  });
  child.on("exit", (code) => {
    if (session === null || session.sessionId !== sessionId) return;
    if (session.state !== "ended") {
      session.state = "ended";
      session.endedReason = `host exited unexpectedly (code ${code})`;
      for (const w of session.stopWaiters) w(null);
      session.stopWaiters = [];
      broadcast("live-ended", { status: liveStatus(), reason: session.endedReason, result: null });
    }
  });

  child.postMessage({
    type: "start",
    sessionId,
    seed,
    mode,
    overrides: opts.overrides,
    speed,
    maxSimS,
    gatewayConfig: opts.gateway ?? pendingGatewayCfg,
  });
  return { ok: true, sessionId };
}

export async function liveStop(): Promise<{ ok: boolean; reason?: string; result?: unknown; error?: string }> {
  if (session === null) return { ok: false, error: "no session" };
  if (session.state === "ended") {
    return { ok: true, reason: session.endedReason ?? "ended", result: session.result };
  }
  const s = session;
  const result = await new Promise<unknown>((resolve) => {
    s.stopWaiters.push(resolve);
    s.child?.postMessage({ type: "stop" });
    setTimeout(() => {
      if (s.state !== "ended") {
        s.child?.kill();
      }
    }, 5000);
  });
  return { ok: true, reason: s.endedReason ?? "stopped", result };
}

export function livePause(): boolean {
  if (session?.state !== "running") return false;
  session.state = "paused";
  session.child?.postMessage({ type: "pause" });
  return true;
}

export function liveResume(): boolean {
  if (session?.state !== "paused") return false;
  session.state = "running";
  session.child?.postMessage({ type: "resume" });
  return true;
}

export function liveSetSpeed(speed: number): { ok: boolean; speed?: number; error?: string } {
  if (session === null || session.state === "ended") return { ok: false, error: "no active session" };
  if (typeof speed !== "number" || !(speed >= 0.25 && speed <= 60)) {
    return { ok: false, error: "speed must be in 0.25..60" };
  }
  session.speed = speed;
  session.child?.postMessage({ type: "set-speed", speed });
  return { ok: true, speed };
}

/** Await the running session's end (self-check helper). */
export function liveWaitForEnd(timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (session === null) {
      reject(new Error("no session"));
      return;
    }
    if (session.state === "ended") {
      resolve(session.result);
      return;
    }
    const s = session;
    const timer = setTimeout(() => reject(new Error("timed out waiting for session end")), timeoutMs);
    s.stopWaiters.push((r) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}
