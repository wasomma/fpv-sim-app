/*
 * Studies runner — executes the CANONICAL vendored fpv-sim scripts (and
 * the app's worker-pool ad-hoc runner) as child processes of the app's
 * own binary via ELECTRON_RUN_AS_NODE, pointed at the bundled engine
 * (FPV_SIM_MCP) and the per-user results store (FPV_SIM_RESULTS). Zero
 * fork of experiment or manifest logic; the dashboard renders the output
 * unchanged.
 *
 * One run at a time. Both canonical scripts write their dataset and
 * manifest entry only at the very end, so cancellation (kill) never
 * leaves a half-written results store.
 *
 * Main keeps a ring buffer of the run's output and the facts the panel
 * needs after the fact (dataset file, whether it was registered, exit
 * code), so a panel opened mid-run or after the run shows the same thing
 * as one that watched it live. The canonical study prints one
 * "<label>: N runs in …" line per experiment; those are turned into
 * progress lines so the study gets a real bar too.
 */

import { BrowserWindow } from "electron";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import path from "node:path";
import { engineRoot, pinsFile, resultsDir, runnersDir, uiRoot } from "../paths.js";
import { reloadDashboardWindows } from "../windows.js";
import { overridesCheck } from "./overrides-schema.js";
import {
  type StudyField,
  type StudyKind,
  type StudyStartOpts,
  isUpdatedManifestLine,
  parseRunsLine,
  parseWroteLine,
  studyExpectedRuns,
  studyExpectedSeconds,
  validateStudyOpts,
} from "./validate.js";

export type { StudyKind, StudyStartOpts };

export interface LogLine {
  stream: "stdout" | "stderr" | "sys";
  line: string;
}

/** What a panel needs to render a run it did not watch from the start. */
export interface RunFacts {
  kind: StudyKind;
  descr: string;
  startedAtMs: number;
  /** Rough wall-clock expectation for the canonical study; undefined for sweeps. */
  expectedS?: number;
  /** Whether {type:"progress"} lines will arrive (adhoc pool and the canonical study). */
  hasProgress: boolean;
  /** Known total when progress is derived from the log (canonical study). */
  total?: number;
  datasetFile: string | null;
  registered: boolean;
  log: LogLine[];
}

export interface FinishedRun extends RunFacts {
  code: number | null;
  endedAtMs: number;
}

interface ActiveRun extends RunFacts {
  child: ChildProcessByStdio<null, Readable, Readable>;
  runsDone: number;
}

const LOG_KEEP = 500;

let active: ActiveRun | null = null;
let last: FinishedRun | null = null;

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function emit(run: ActiveRun, stream: LogLine["stream"], line: string): void {
  run.log.push({ stream, line });
  if (run.log.length > LOG_KEEP) run.log.splice(0, run.log.length - LOG_KEEP);
  broadcast("study-output", { stream, line });
}

const facts = (r: RunFacts): RunFacts => ({
  kind: r.kind,
  descr: r.descr,
  startedAtMs: r.startedAtMs,
  expectedS: r.expectedS,
  hasProgress: r.hasProgress,
  total: r.total,
  datasetFile: r.datasetFile,
  registered: r.registered,
  log: r.log.slice(),
});

export function studyStatus(): {
  running: boolean;
  kind?: StudyKind;
  descr?: string;
  startedAtMs?: number;
  resultsDir: string;
  run: RunFacts | null;
  last: FinishedRun | null;
} {
  const base = { resultsDir: resultsDir(), last: last === null ? null : { ...facts(last), code: last.code, endedAtMs: last.endedAtMs } };
  if (active === null) return { running: false, run: null, ...base };
  return { running: true, kind: active.kind, descr: active.descr, startedAtMs: active.startedAtMs, run: facts(active), ...base };
}

function readPins(): { fpv_sim_commit?: string; fpv_sim_mcp_resolved?: string } {
  try {
    return JSON.parse(readFileSync(pinsFile(), "utf8")) as { fpv_sim_commit?: string; fpv_sim_mcp_resolved?: string };
  } catch {
    return {};
  }
}

export type StartResult =
  | { ok: true; descr: string; startedAtMs: number; expectedS?: number; hasProgress: boolean; total?: number }
  | { ok: false; error: string; field?: StudyField };

export function startStudy(opts: StudyStartOpts): StartResult {
  if (active !== null) return { ok: false, error: `${article(active.kind)} ${active.kind} run is already active` };

  // Keys and ranges are checked against the engine's own parameter table
  // (a syntax-only check when that schema could not be loaded).
  const v = validateStudyOpts(opts, overridesCheck);
  if (!v.ok) return { ok: false, error: v.error, field: v.field };
  const n = v.norm;

  let script: string;
  let args: string[];
  let descr: string;
  let expectedS: number | undefined;
  let total: number | undefined;
  let hasProgress: boolean;

  if (n.kind === "study") {
    script = path.join(uiRoot(), "scripts", "monte-carlo-study.mjs");
    args = [];
    if (n.quick) args.push("--quick");
    if (n.mode === "tactical") args.push("--mode", "tactical");
    descr = `${n.quick ? "quick" : "full"} study (${n.mode})`;
    expectedS = studyExpectedSeconds(n.quick);
    total = studyExpectedRuns(n.mode, n.quick);
    hasProgress = true;
  } else if (n.kind === "sweep") {
    script = path.join(uiRoot(), "scripts", "run-sweep.mjs");
    args = ["--label", n.label, "--start", String(n.start), "--count", String(n.count), "--mode", n.mode];
    if (n.overrides !== null) args.push("--overrides", n.overrides);
    descr = `sweep "${n.label}" ${n.start}..${n.start + n.count - 1} (${n.mode})`;
    hasProgress = false;
  } else {
    const pins = readPins();
    const resolvedSha = pins.fpv_sim_mcp_resolved?.match(/#([0-9a-f]{40})/)?.[1] ?? null;
    script = path.join(runnersDir(), "adhoc-runner.mjs");
    args = [
      JSON.stringify({
        label: n.label,
        start: n.start,
        count: n.count,
        mode: n.mode,
        overrides: n.overridesValue,
        engineRoot: engineRoot(),
        uiScripts: path.join(uiRoot(), "scripts"),
        resultsDir: resultsDir(),
        pins: { sim_commit: pins.fpv_sim_commit ?? null, engine_commit: resolvedSha },
      }),
    ];
    descr = `parallel sweep "${n.label}" ${n.start}..${n.start + n.count - 1} (${n.mode})`;
    hasProgress = true;
  }

  const child = spawn(process.execPath, [script, ...args], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      FPV_SIM_MCP: engineRoot(),
      FPV_SIM_RESULTS: resultsDir(),
    },
    cwd: uiRoot(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const run: ActiveRun = {
    child,
    kind: n.kind,
    descr,
    startedAtMs: Date.now(),
    expectedS,
    hasProgress,
    total,
    datasetFile: null,
    registered: false,
    log: [],
    runsDone: 0,
  };
  active = run;
  emit(run, "sys", `started: ${descr}`);

  for (const [stream, readable] of [
    ["stdout", child.stdout],
    ["stderr", child.stderr],
  ] as const) {
    createInterface({ input: readable }).on("line", (line) => {
      if (active !== run) return;
      observe(run, stream, line);
      emit(run, stream, line);
    });
  }
  child.on("close", (code) => {
    if (active !== run) return;
    emit(run, "sys", `${descr} finished with exit code ${code}`);
    active = null;
    last = { ...facts(run), code, endedAtMs: Date.now() };
    // An open dashboard jumps to the finished run explicitly (the page keeps
    // its ?dataset= across a plain reload, so "newest first" no longer applies).
    const reloaded = code === 0 && run.registered ? reloadDashboardWindows(run.datasetFile ?? undefined) : 0;
    broadcast("study-done", {
      code,
      descr,
      kind: run.kind,
      datasetFile: run.datasetFile,
      registered: run.registered,
      elapsedMs: last.endedAtMs - run.startedAtMs,
      resultsDir: resultsDir(),
      reloaded,
    });
  });
  child.on("error", (err) => {
    if (active === run) emit(run, "sys", `spawn error: ${err.message}`);
  });

  return { ok: true, descr, startedAtMs: run.startedAtMs, expectedS, hasProgress, total };
}

/** Pull the facts out of the child's output as it streams past. */
function observe(run: ActiveRun, stream: "stdout" | "stderr", line: string): void {
  if (stream === "stdout") {
    if (run.kind === "adhoc") {
      try {
        const msg = JSON.parse(line) as { type?: string; file?: string };
        if (msg.type === "done" && typeof msg.file === "string") {
          run.datasetFile = msg.file;
          run.registered = true;
        }
      } catch {
        /* plain line */
      }
    }
    return;
  }
  const wrote = parseWroteLine(line);
  if (wrote !== null) {
    run.datasetFile = wrote.file;
    run.registered = run.registered || wrote.registered;
    return;
  }
  if (isUpdatedManifestLine(line)) {
    run.registered = true;
    return;
  }
  if (run.kind === "study" && run.total !== undefined) {
    const runs = parseRunsLine(line);
    if (runs !== null) {
      run.runsDone = Math.min(run.total, run.runsDone + runs);
      emit(run, "stdout", JSON.stringify({ type: "progress", done: run.runsDone, total: run.total }));
    }
  }
}

export function cancelStudy(): boolean {
  if (active === null) return false;
  emit(active, "sys", "cancelling…");
  return active.child.kill();
}

const article = (kind: StudyKind): string => (kind === "adhoc" ? "an" : "a");
