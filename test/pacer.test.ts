/*
 * The pacer's contract: sim time is ticks x 0.1 s; the wall clock only
 * schedules. Speed changes, pauses and resumes re-anchor and never
 * retroactively re-price elapsed ticks.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { TickPacer } from "../src/main/sessions/pacer.js";

test("real time: one tick per 100 ms", () => {
  const p = new TickPacer(1000, 1);
  assert.equal(p.targetTick(1000), 0);
  assert.equal(p.targetTick(1099), 0);
  assert.equal(p.targetTick(1100), 1);
  assert.equal(p.targetTick(2000), 10);
});

test("speed factor scales the schedule", () => {
  const p = new TickPacer(0, 4);
  assert.equal(p.targetTick(1000), 40);
  assert.equal(p.targetTick(250), 10);
});

test("speed change re-anchors without re-pricing the past", () => {
  const p = new TickPacer(0, 1);
  assert.equal(p.targetTick(1000), 10);
  p.setSpeed(10, 10, 1000); // host has done 10 ticks at wall t=1000
  assert.equal(p.targetTick(1000), 10, "no jump at the change instant");
  assert.equal(p.targetTick(2000), 110, "one wall second at 10x adds 100 ticks");
});

test("pause holds the target; resume re-anchors", () => {
  const p = new TickPacer(0, 1);
  p.pause(5, 500);
  assert.equal(p.targetTick(10000), 5, "paused target never advances");
  assert.equal(p.isPaused, true);
  p.resume(5, 10000);
  assert.equal(p.targetTick(10000), 5);
  assert.equal(p.targetTick(11000), 15);
});

test("lag reports wall ms behind schedule at current speed", () => {
  const p = new TickPacer(0, 2);
  // At wall 1000 ms the target is 20 ticks; host has done 10 -> 10 ticks
  // behind = 1 sim-second = 500 wall ms at 2x.
  assert.equal(p.lagMs(10, 1000), 500);
  assert.equal(p.lagMs(20, 1000), 0);
  assert.equal(p.lagMs(25, 1000), 0, "ahead of schedule is not lag");
});
