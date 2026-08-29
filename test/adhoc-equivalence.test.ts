/*
 * The parallel ad-hoc runner must reproduce run-sweep.mjs's dataset
 * byte-for-byte, minus the timestamp and provenance-commit fields — the
 * no-fork guarantee. Runs both against temp results stores over the same
 * 40 seeds and deep-compares the dataset and manifest entry.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appRoot, mcpRoot } from "./util.js";

const ui = path.join(appRoot(), "build", "resources", "ui");

function readDataset(dir: string): Record<string, unknown> {
  const file = readdirSync(dir).find((f) => f.startsWith("adhoc-equiv-check-") && f.endsWith(".json"));
  assert.ok(file, `no adhoc dataset written in ${dir}`);
  return JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Record<string, unknown>;
}

function normalize(d: Record<string, unknown>): Record<string, unknown> {
  const meta = d.meta as Record<string, unknown>;
  meta.generated = null;
  meta.sim_commit = null;
  meta.engine_commit = null;
  return d;
}

function normalizeManifest(dir: string): unknown {
  const m = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as {
    datasets: Record<string, unknown>[];
  };
  for (const e of m.datasets) {
    e.generated = null;
    e.sim_commit = null;
    e.engine_commit = null;
    e.file = "normalized";
  }
  return m;
}

test("parallel ad-hoc runner reproduces run-sweep.mjs datasets", () => {
  assert.ok(
    existsSync(path.join(ui, "scripts", "run-sweep.mjs")),
    "vendored UI missing — run `npm run vendor` before `npm test`",
  );
  const tmpA = mkdtempSync(path.join(tmpdir(), "fpv-equiv-a-"));
  const tmpB = mkdtempSync(path.join(tmpdir(), "fpv-equiv-b-"));

  const canonical = spawnSync(
    process.execPath,
    [
      path.join(ui, "scripts", "run-sweep.mjs"),
      "--label", "equiv check",
      "--start", "100",
      "--count", "40",
      "--mode", "orbit",
    ],
    {
      cwd: ui,
      encoding: "utf8",
      env: { ...process.env, FPV_SIM_MCP: mcpRoot(), FPV_SIM_RESULTS: tmpA },
    },
  );
  assert.equal(canonical.status, 0, `run-sweep failed:\n${canonical.stderr}`);

  const pool = spawnSync(
    process.execPath,
    [
      path.join(appRoot(), "src", "main", "studies", "adhoc-runner.mjs"),
      JSON.stringify({
        label: "equiv check",
        start: 100,
        count: 40,
        mode: "orbit",
        overrides: null,
        engineRoot: mcpRoot(),
        uiScripts: path.join(ui, "scripts"),
        resultsDir: tmpB,
        pins: { sim_commit: null, engine_commit: null },
      }),
    ],
    { encoding: "utf8" },
  );
  assert.equal(pool.status, 0, `adhoc-runner failed:\n${pool.stderr}`);

  assert.deepEqual(
    normalize(readDataset(tmpB)),
    normalize(readDataset(tmpA)),
    "pool dataset must equal canonical dataset (minus timestamp/provenance)",
  );
  assert.deepEqual(normalizeManifest(tmpB), normalizeManifest(tmpA), "manifest entries must match");
});
