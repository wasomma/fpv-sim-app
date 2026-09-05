/*
 * The launcher status strip's three lines, formatted from the facts the
 * study runner, the session manager and the MCP host report.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStrip, fmtDuration, fmtSimTime, liveLine, mcpLine, studiesLine } from "../src/main/status-strip.js";

const idleLive = { state: "idle" as const, gateway: { enabled: false, state: "idle" } };
const mcpUp = { running: true, port: 8765, lastError: null };

test("time formatting", () => {
  assert.equal(fmtDuration(0), "0:00");
  assert.equal(fmtDuration(83_400), "1:23");
  assert.equal(fmtDuration(-5), "0:00");
  assert.equal(fmtSimTime(0), "T+00:00");
  assert.equal(fmtSimTime(311.7), "T+05:11");
});

test("studies: idle, running with elapsed, finished, failed, killed", () => {
  assert.deepEqual(studiesLine({ running: false, last: null }, 0), { text: "idle", cls: "" });
  assert.deepEqual(
    studiesLine({ running: true, descr: 'parallel sweep "x" 1..1000 (orbit)', startedAtMs: 10_000, last: null }, 93_000),
    { text: 'running · parallel sweep "x" 1..1000 (orbit) · 1:23', cls: "ok" },
  );
  const last = { descr: "quick study (orbit)", startedAtMs: 0, endedAtMs: 250_000 };
  assert.deepEqual(studiesLine({ running: false, last: { ...last, code: 0 } }, 999_999), {
    text: "done · quick study (orbit) · took 4:10",
    cls: "",
  });
  assert.deepEqual(studiesLine({ running: false, last: { ...last, code: 1 } }, 0), {
    text: "failed · quick study (orbit) · exit 1",
    cls: "bad",
  });
  assert.deepEqual(studiesLine({ running: false, last: { ...last, code: null } }, 0), {
    text: "failed · quick study (orbit) · exit killed",
    cls: "bad",
  });
});

test("live: idle, running, paused, gateway flag, ENDEX, ABORTED", () => {
  assert.deepEqual(liveLine(idleLive), { text: "idle", cls: "" });
  const running = {
    state: "running" as const,
    seed: 20260719,
    mode: "orbit",
    t: 133.2,
    phase: "PHASE II // SEARCH AND COLLECT",
    gateway: { enabled: false, state: "idle" },
  };
  assert.deepEqual(liveLine(running), {
    text: "orbit · seed 20260719 · T+02:13 · PHASE II // SEARCH AND COLLECT",
    cls: "ok",
  });
  assert.deepEqual(liveLine({ ...running, state: "paused", gateway: { enabled: true, state: "publishing" } }), {
    text: "orbit · seed 20260719 · T+02:13 · PHASE II // SEARCH AND COLLECT · DIS · PAUSED",
    cls: "caution",
  });
  assert.deepEqual(liveLine({ ...running, state: "ended", t: 311, winner: "BLUFOR", endedReason: "endex" }), {
    text: "ENDEX · BLUFOR at T+05:11",
    cls: "",
  });
  assert.deepEqual(liveLine({ ...running, state: "ended", endedReason: "host exited unexpectedly (code 1)" }), {
    text: "ABORTED · host exited unexpectedly (code 1)",
    cls: "bad",
  });
  assert.deepEqual(liveLine({ ...running, state: "ended", endedReason: "error: boom" }).cls, "bad");
});

test("mcp: running with the loopback address, down with the reason", () => {
  assert.deepEqual(mcpLine(mcpUp), { text: "RUNNING · 127.0.0.1:8765", cls: "ok" });
  assert.deepEqual(mcpLine({ running: false, port: 8765, lastError: "port 8765 is in use" }), {
    text: "DOWN · port 8765 is in use",
    cls: "bad",
  });
  assert.deepEqual(mcpLine({ running: false, port: 8765, lastError: null }), { text: "DOWN", cls: "bad" });
});

test("busy is set while a study or a session is active, not after", () => {
  assert.equal(buildStrip({ running: false, last: null }, idleLive, mcpUp, 0).busy, false);
  assert.equal(buildStrip({ running: true, descr: "x", last: null }, idleLive, mcpUp, 0).busy, true);
  assert.equal(buildStrip({ running: false, last: null }, { ...idleLive, state: "paused" }, mcpUp, 0).busy, true);
  assert.equal(buildStrip({ running: false, last: null }, { ...idleLive, state: "ended" }, mcpUp, 0).busy, false);
});
