/*
 * Override validation against the engine's own parameter table: unknown
 * keys and out-of-range values are refused by path, valid overrides pass,
 * and the table the panel renders is the one the MCP tools publish.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  formatIssues,
  loadOverridesSchema,
  overridesSchemaPayload,
  validateOverridesText,
  validateOverridesValue,
} from "../src/main/studies/overrides-schema.js";

before(async () => {
  assert.equal(await loadOverridesSchema(), true, "the installed fpv-sim-mcp must expose params.js");
});

test("the parameter table is the engine's", () => {
  const p = overridesSchemaPayload();
  assert.ok(p !== null);
  const brg = p.parameters.find((x) => x.path === "CUAS.BRG_SIGMA_DEG");
  assert.ok(brg, "CUAS.BRG_SIGMA_DEG is a documented parameter");
  assert.equal(brg.default, 4);
  assert.deepEqual(brg.range, [0.5, 15]);
  assert.ok(p.parameters.some((x) => x.path === "TEAMS.OPFOR.videoOff"));
  assert.ok(p.parameters.some((x) => x.path === "TACTICAL.SORTIES.BLUFOR"));
  assert.ok(p.not_overridable.some((x) => x.path === "SIM_DT"));
});

test("valid overrides pass and count their leaves", () => {
  assert.deepEqual(validateOverridesValue({ CUAS: { BRG_SIGMA_DEG: 8 } }), { ok: true, keys: 1 });
  assert.deepEqual(validateOverridesValue({}), { ok: true, keys: 0 });
  const r = validateOverridesValue({ TEAMS: { OPFOR: { uplinkOn: 4, uplinkOff: 13, videoOn: 3, videoOff: 7 } } });
  assert.equal(r.ok, true);
  const t = validateOverridesValue({ TACTICAL: { RESERVE_HUNTER: false, SORTIES: { BLUFOR: 7, OPFOR: 7 } } });
  assert.equal(t.ok, true);
});

test("a misspelled key is refused by path (the manual's own example)", () => {
  const r = validateOverridesValue({ CUAS: { BRG_SIGMA: 8 } });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error, "CUAS.BRG_SIGMA: unknown key");
    assert.deepEqual(r.issues, [{ path: "CUAS.BRG_SIGMA", message: "unknown key" }]);
  }
  const s = validateOverridesValue({ CAUS: { BRG_SIGMA_DEG: 8 } });
  assert.equal(s.ok, false);
  if (!s.ok) assert.equal(s.error, "CAUS: unknown key");
});

test("out-of-range and wrong-type values name the path and the allowed range", () => {
  const r = validateOverridesValue({ CUAS: { BRG_SIGMA_DEG: 40 } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "CUAS.BRG_SIGMA_DEG: must be in 0.5..15");
  const s = validateOverridesValue({ CUAS: { BRG_SIGMA_DEG: "eight" } });
  assert.equal(s.ok, false);
  if (!s.ok) assert.match(s.error, /^CUAS\.BRG_SIGMA_DEG: expected number/);
  const t = validateOverridesValue({ TACTICAL: { RESERVE_HUNTER: 1 } });
  assert.equal(t.ok, false);
  if (!t.ok) assert.match(t.error, /^TACTICAL\.RESERVE_HUNTER: expected boolean/);
});

test("several problems are all reported", () => {
  const r = validateOverridesValue({ CUAS: { BRG_SIGMA: 8, MAX_RANGE_M: 100 }, FOO: 1 });
  assert.equal(r.ok, false);
  if (!r.ok) {
    const paths = r.issues.map((i) => i.path).sort();
    assert.deepEqual(paths, ["CUAS.BRG_SIGMA", "CUAS.MAX_RANGE_M", "FOO"]);
  }
});

test("text validation covers syntax and shape", () => {
  assert.deepEqual(validateOverridesText("   "), { ok: true, keys: 0 });
  const bad = validateOverridesText("{nope");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error, "overrides is not valid JSON");
  const arr = validateOverridesText("[1]");
  assert.equal(arr.ok, false);
  if (!arr.ok) assert.equal(arr.error, "overrides must be a JSON object");
  assert.equal(validateOverridesText('{"CUAS":{"BRG_SIGMA_DEG":8}}').ok, true);
});

test("formatIssues expands unknown keys and rewrites range messages", () => {
  const params = new Map([["CUAS.SCAN_S", { path: "CUAS.SCAN_S", default: 1.5, unit: "s", range: [0.5, 10] as [number, number], integer: false, description: "" }]]);
  const out = formatIssues(
    [
      { code: "unrecognized_keys", path: ["CUAS"], message: "Unrecognized key(s)", keys: ["A", "B"] },
      { code: "too_big", path: ["CUAS", "SCAN_S"], message: "Number must be less than or equal to 10" },
      { code: "invalid_type", path: ["CUAS", "SCAN_S"], message: "Expected number", expected: "number", received: "string" },
    ],
    params,
  );
  assert.deepEqual(out, [
    { path: "CUAS.A", message: "unknown key" },
    { path: "CUAS.B", message: "unknown key" },
    { path: "CUAS.SCAN_S", message: "must be in 0.5..10" },
    { path: "CUAS.SCAN_S", message: "expected number, got string" },
  ]);
});
