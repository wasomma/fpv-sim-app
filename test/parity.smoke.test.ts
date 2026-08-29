/*
 * Engine-parity smoke: the bundled fpv-sim-mcp engine must reproduce the
 * golden fixtures COMMITTED IN THAT SAME DEPENDENCY — outcome, clock,
 * phase timeline, and byte-equal event-log strings, both modes.
 *
 * Upstream CI proves engine-vs-browser parity exhaustively; this test's
 * job is narrower: catch packaging drift inside this repo (wrong engine
 * build bundled, pin skew, a broken prepare step) cheaply on every PR.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runEngagement } from "fpv-sim-mcp/engine";
import { mcpRoot } from "./util.js";

interface GoldenRun {
  seed: number;
  winner: string | null;
  stalemate?: { reason?: string } | boolean | null;
  endT: number | null;
  duration: number;
  phases: { t: number; phase: string }[];
  events: { t: number; side: string; text: string }[];
}
interface Fixture {
  _meta: { source_commit: string; mode?: string };
  runs: GoldenRun[];
}

const root = mcpRoot();
const orbit = JSON.parse(readFileSync(path.join(root, "test", "fixtures", "golden-seeds.json"), "utf8")) as Fixture;
const tactical = JSON.parse(
  readFileSync(path.join(root, "test", "fixtures", "golden-seeds-tactical.json"), "utf8"),
) as Fixture;

assert.ok(orbit.runs.length >= 5, "orbit fixture should carry the featured seeds");
assert.ok(tactical.runs.length >= 6, "tactical fixture should carry the featured seeds");
assert.equal(
  orbit._meta.source_commit,
  tactical._meta.source_commit,
  "both fixture sets should pin the same upstream commit",
);

function checkRun(golden: GoldenRun, mode: "orbit" | "tactical"): void {
  const r = runEngagement(golden.seed, undefined, { mode });
  assert.equal(r.outcome.result, golden.winner ?? "STALEMATE", "outcome");
  assert.equal(r.duration_s, golden.duration, "duration");
  assert.deepEqual(r.phase_timeline, golden.phases, "phase timeline");
  assert.deepEqual(r.events, golden.events, "event log (string-equal)");
}

for (const run of orbit.runs) {
  test(`parity smoke: orbit seed ${run.seed}`, () => checkRun(run, "orbit"));
}
for (const run of tactical.runs) {
  test(`parity smoke: tactical seed ${run.seed}`, () => checkRun(run, "tactical"));
}
