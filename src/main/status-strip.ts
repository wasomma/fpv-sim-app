/*
 * The launcher's status strip: one line each for the study runner, the
 * live session and the MCP host, formatted from the facts the three
 * services already report. Electron-free and unit-tested; index.ts feeds
 * it the live status objects and the clock.
 */

export interface StudyFacts {
  running: boolean;
  descr?: string;
  startedAtMs?: number;
  last: { descr: string; code: number | null; startedAtMs: number; endedAtMs: number } | null;
}

export interface LiveFacts {
  state: "idle" | "running" | "paused" | "ended";
  seed?: number;
  mode?: string;
  t?: number;
  phase?: string;
  winner?: string;
  endedReason?: string;
  gateway: { enabled: boolean; state: string };
}

export interface McpFacts {
  running: boolean;
  port: number;
  lastError: string | null;
}

export interface StripLine {
  text: string;
  /** "" | "ok" | "bad" | "caution" — the shared stylesheet's classes. */
  cls: "" | "ok" | "bad" | "caution";
}

export interface Strip {
  studies: StripLine;
  live: StripLine;
  mcp: StripLine;
  /** True while a study or a live session is active: the launcher then refreshes every second. */
  busy: boolean;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtSimTime(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `T+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function studiesLine(s: StudyFacts, nowMs: number): StripLine {
  if (s.running) {
    const elapsed = s.startedAtMs !== undefined ? ` · ${fmtDuration(nowMs - s.startedAtMs)}` : "";
    return { text: `running · ${s.descr ?? "study"}${elapsed}`, cls: "ok" };
  }
  if (s.last !== null) {
    const took = fmtDuration(s.last.endedAtMs - s.last.startedAtMs);
    if (s.last.code === 0) return { text: `done · ${s.last.descr} · took ${took}`, cls: "" };
    return { text: `failed · ${s.last.descr} · exit ${s.last.code ?? "killed"}`, cls: "bad" };
  }
  return { text: "idle", cls: "" };
}

/** Matches the Live Ops panel's own reading of an end reason. */
export function isAbortedReason(reason: string | undefined): boolean {
  return typeof reason === "string" && (/^error:/.test(reason) || /^host exited/.test(reason));
}

export function liveLine(l: LiveFacts): StripLine {
  if (l.state === "idle") return { text: "idle", cls: "" };
  const at = l.t !== undefined ? fmtSimTime(l.t) : "T+00:00";
  if (l.state === "ended") {
    if (isAbortedReason(l.endedReason)) return { text: `ABORTED · ${l.endedReason}`, cls: "bad" };
    return { text: `ENDEX · ${l.winner ?? l.endedReason ?? "ended"} at ${at}`, cls: "" };
  }
  const head = `${l.mode ?? "orbit"} · seed ${l.seed ?? "?"} · ${at}`;
  const phase = l.phase ? ` · ${l.phase}` : "";
  const dis = l.gateway.enabled ? " · DIS" : "";
  if (l.state === "paused") return { text: `${head}${phase}${dis} · PAUSED`, cls: "caution" };
  return { text: `${head}${phase}${dis}`, cls: "ok" };
}

export function mcpLine(m: McpFacts): StripLine {
  if (m.running) return { text: `RUNNING · 127.0.0.1:${m.port}`, cls: "ok" };
  return { text: `DOWN${m.lastError ? ` · ${m.lastError}` : ""}`, cls: "bad" };
}

export function buildStrip(study: StudyFacts, live: LiveFacts, mcp: McpFacts, nowMs: number): Strip {
  return {
    studies: studiesLine(study, nowMs),
    live: liveLine(live),
    mcp: mcpLine(mcp),
    busy: study.running || live.state === "running" || live.state === "paused",
  };
}
