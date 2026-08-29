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
 */

import { BrowserWindow } from "electron";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import path from "node:path";
import { engineRoot, pinsFile, resultsDir, runnersDir, uiRoot } from "../paths.js";

export type StudyKind = "study" | "sweep" | "adhoc";

export interface StudyStartOpts {
  kind: StudyKind;
  /** study */
  quick?: boolean;
  mode?: "orbit" | "tactical";
  /** sweep + adhoc */
  label?: string;
  start?: number;
  count?: number;
  /** JSON string of config overrides (validated by the engine). */
  overrides?: string;
}

interface ActiveRun {
  child: ChildProcessByStdio<null, Readable, Readable>;
  kind: StudyKind;
  descr: string;
  startedAtMs: number;
}

let active: ActiveRun | null = null;

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

export function studyStatus(): { running: boolean; kind?: StudyKind; descr?: string; startedAtMs?: number } {
  if (active === null) return { running: false };
  return { running: true, kind: active.kind, descr: active.descr, startedAtMs: active.startedAtMs };
}

function readPins(): { fpv_sim_commit?: string; fpv_sim_mcp_resolved?: string } {
  try {
    return JSON.parse(readFileSync(pinsFile(), "utf8")) as { fpv_sim_commit?: string; fpv_sim_mcp_resolved?: string };
  } catch {
    return {};
  }
}

export function startStudy(opts: StudyStartOpts): { ok: boolean; error?: string } {
  if (active !== null) return { ok: false, error: `a ${active.kind} run is already active` };

  const mode = opts.mode === "tactical" ? "tactical" : "orbit";
  let script: string;
  let args: string[];
  let descr: string;

  if (opts.kind === "study") {
    script = path.join(uiRoot(), "scripts", "monte-carlo-study.mjs");
    args = [];
    if (opts.quick === true) args.push("--quick");
    if (mode === "tactical") args.push("--mode", "tactical");
    descr = `${opts.quick === true ? "quick" : "full"} study (${mode})`;
  } else if (opts.kind === "sweep" || opts.kind === "adhoc") {
    const label = (opts.label ?? "").trim();
    if (label === "") return { ok: false, error: "a label is required" };
    const start = Number.isInteger(opts.start) && (opts.start as number) >= 0 ? (opts.start as number) : 1;
    const count = Number.isInteger(opts.count) && (opts.count as number) >= 1 ? (opts.count as number) : 1000;
    if (opts.overrides !== undefined && opts.overrides.trim() !== "") {
      try {
        JSON.parse(opts.overrides);
      } catch {
        return { ok: false, error: "overrides is not valid JSON" };
      }
    }
    if (opts.kind === "sweep") {
      script = path.join(uiRoot(), "scripts", "run-sweep.mjs");
      args = ["--label", label, "--start", String(start), "--count", String(count), "--mode", mode];
      if (opts.overrides !== undefined && opts.overrides.trim() !== "") args.push("--overrides", opts.overrides);
      descr = `sweep "${label}" ${start}..${start + count - 1} (${mode})`;
    } else {
      const pins = readPins();
      const resolvedSha = pins.fpv_sim_mcp_resolved?.match(/#([0-9a-f]{40})/)?.[1] ?? null;
      script = path.join(runnersDir(), "adhoc-runner.mjs");
      args = [
        JSON.stringify({
          label,
          start,
          count,
          mode,
          overrides: opts.overrides !== undefined && opts.overrides.trim() !== "" ? JSON.parse(opts.overrides) : null,
          engineRoot: engineRoot(),
          uiScripts: path.join(uiRoot(), "scripts"),
          resultsDir: resultsDir(),
          pins: { sim_commit: pins.fpv_sim_commit ?? null, engine_commit: resolvedSha },
        }),
      ];
      descr = `parallel sweep "${label}" ${start}..${start + count - 1} (${mode})`;
    }
  } else {
    return { ok: false, error: `unknown kind ${String(opts.kind)}` };
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

  active = { child, kind: opts.kind, descr, startedAtMs: Date.now() };
  broadcast("study-output", { stream: "sys", line: `started: ${descr}` });

  for (const [stream, readable] of [
    ["stdout", child.stdout],
    ["stderr", child.stderr],
  ] as const) {
    createInterface({ input: readable }).on("line", (line) => {
      broadcast("study-output", { stream, line });
    });
  }
  child.on("close", (code) => {
    broadcast("study-done", { code, descr });
    active = null;
  });
  child.on("error", (err) => {
    broadcast("study-output", { stream: "sys", line: `spawn error: ${err.message}` });
  });

  return { ok: true };
}

export function cancelStudy(): boolean {
  if (active === null) return false;
  broadcast("study-output", { stream: "sys", line: "cancelling…" });
  return active.child.kill();
}
