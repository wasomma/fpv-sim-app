/*
 * Parallel ad-hoc sweep runner (node child; the interactive path).
 *
 * Reproduces run-sweep.mjs's dataset envelope EXACTLY — same aggregation
 * helpers (imported from the vendored sweep-utils.mjs, no fork), same
 * file naming, same manifest registration — but runs the engagements on
 * a worker_threads pool. Determinism makes the parallelism invisible:
 * results are collected into a seed-indexed array, so aggregation sees
 * the exact sequence the sequential runner produces (workers strip only
 * the event logs, which the aggregation provably never reads).
 *
 * argv[2] is a JSON config:
 *   { label, start, count, mode, overrides, engineRoot, uiScripts,
 *     resultsDir, pins: { sim_commit, engine_commit } }
 *
 * Progress goes to stdout as JSON lines: {type:"progress",done,total}.
 * The CI equivalence test asserts byte-parity with run-sweep.mjs minus
 * meta.generated and the provenance commits.
 */

import { availableParallelism } from "node:os";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const cfg = JSON.parse(process.argv[2]);
process.env.FPV_SIM_MCP = cfg.engineRoot;
process.env.FPV_SIM_RESULTS = cfg.resultsDir;

const su = await import(pathToFileURL(path.join(cfg.uiScripts, "sweep-utils.mjs")).href);
const { engine } = await su.loadEngine();

const total = cfg.count;
const results = new Array(total);
const workerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "adhoc-worker.mjs");
const enginePath = path.join(cfg.engineRoot, "dist", "src", "engine", "index.js");
const poolSize = Math.max(1, Math.min(availableParallelism() - 1, total));

console.error(
  `parallel sweep: seeds ${cfg.start}–${cfg.start + total - 1}` +
    (cfg.mode === "tactical" ? " [tactical]" : "") +
    (cfg.overrides ? ` with overrides ${JSON.stringify(cfg.overrides)}` : " (stock config)") +
    ` on ${poolSize} workers...`,
);
const t0 = Date.now();

let next = 0;
let done = 0;
await new Promise((resolveAll, rejectAll) => {
  const workers = [];
  const dispatch = (worker) => {
    if (next >= total) {
      worker.postMessage(null);
      return;
    }
    worker.postMessage(cfg.start + next++);
  };
  for (let i = 0; i < poolSize; i++) {
    const worker = new Worker(workerFile, {
      workerData: { enginePath, overrides: cfg.overrides ?? undefined, mode: cfg.mode },
    });
    workers.push(worker);
    worker.on("message", (msg) => {
      results[msg.seed - cfg.start] = msg.result;
      done++;
      if (done % 25 === 0 || done === total) {
        console.log(JSON.stringify({ type: "progress", done, total }));
      }
      if (done === total) {
        for (const w of workers) void w.terminate();
        resolveAll();
      } else {
        dispatch(worker);
      }
    });
    worker.on("error", (err) => {
      for (const w of workers) void w.terminate();
      rejectAll(err);
    });
    dispatch(worker);
  }
});

const agg = su.buildAgg(results, engine.aggregateSweep);
console.error(
  `  ${agg.runs} runs in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
    `— B ${agg.outcomes.BLUFOR} / O ${agg.outcomes.OPFOR} / S ${agg.outcomes.STALEMATE}`,
);

/* Envelope mirrors run-sweep.mjs exactly (naming, fields, order). */
const generated = new Date().toISOString();
const slug = cfg.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
const outFile = `adhoc-${slug}-${generated.slice(0, 10)}.json`;

const dataset = {
  kind: "adhoc",
  mode: cfg.mode,
  label: cfg.label,
  quick: false,
  meta: {
    generated,
    sim_commit: cfg.pins?.sim_commit ?? null,
    engine_commit: cfg.pins?.engine_commit ?? null,
    engine_source: "https://github.com/wasomma/fpv-sim-mcp",
    total_runs: agg.runs,
    seed_range: { start: cfg.start, count: cfg.count },
    overrides: cfg.overrides ?? null,
  },
  experiments: { baseline: agg },
};

mkdirSync(su.RESULTS_DIR, { recursive: true });
const outPath = path.join(su.RESULTS_DIR, outFile);
writeFileSync(outPath, JSON.stringify(dataset, null, 2));
su.registerDataset({
  file: outFile,
  kind: "adhoc",
  mode: cfg.mode,
  label: cfg.label,
  generated,
  sim_commit: dataset.meta.sim_commit,
  engine_commit: dataset.meta.engine_commit,
  total_runs: agg.runs,
  overrides: cfg.overrides ?? null,
  baseline: { runs: agg.runs, win_rates: agg.win_rates },
});
console.log(JSON.stringify({ type: "done", file: outFile, runs: agg.runs, outcomes: agg.outcomes }));
console.error(`\nWrote ${outPath} and registered it in the results manifest.`);
