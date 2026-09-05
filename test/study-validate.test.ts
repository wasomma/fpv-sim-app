/*
 * Studies request validation: every refusal names its field, nothing is
 * silently substituted, and the log-line parsers that drive the progress
 * bar and the dataset row recognise exactly what the runners print.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isUpdatedManifestLine,
  parseRunsLine,
  parseWroteLine,
  studyExpectedRuns,
  validateStudyOpts,
} from "../src/main/studies/validate.js";

const sweep = { kind: "adhoc", label: "DF bearing error doubled", start: 1, count: 1000, mode: "orbit" };

test("a complete sweep request normalizes", () => {
  const v = validateStudyOpts({ ...sweep, overrides: ' {"CUAS":{"BRG_SIGMA_DEG":8}} ' });
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.norm.label, "DF bearing error doubled");
    assert.equal(v.norm.overrides, '{"CUAS":{"BRG_SIGMA_DEG":8}}');
    assert.deepEqual(v.norm.overridesValue, { CUAS: { BRG_SIGMA_DEG: 8 } });
  }
});

test("empty overrides mean the stock configuration", () => {
  const v = validateStudyOpts({ ...sweep, overrides: "   " });
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.norm.overrides, null);
    assert.equal(v.norm.overridesValue, null);
  }
});

test("refusals name their field", () => {
  const cases: [Record<string, unknown>, string, string][] = [
    [{ ...sweep, label: "  " }, "label", "a label is required"],
    [{ ...sweep, start: -1 }, "start", "start must be an integer"],
    [{ ...sweep, start: 1.5 }, "start", "start must be an integer"],
    [{ ...sweep, count: 0 }, "count", "count must be an integer"],
    [{ ...sweep, count: undefined }, "count", "count must be an integer"],
    [{ ...sweep, count: Number.NaN }, "count", "count must be an integer"],
    [{ ...sweep, start: 4294967295, count: 2 }, "count", "exceeds the seed range"],
    [{ ...sweep, overrides: "{nope" }, "overrides", "not valid JSON"],
    [{ ...sweep, overrides: "[1]" }, "overrides", "must be a JSON object"],
    [{ kind: "nope" }, "kind", "unknown kind"],
  ];
  for (const [opts, field, msg] of cases) {
    const v = validateStudyOpts(opts);
    assert.equal(v.ok, false, JSON.stringify(opts));
    if (!v.ok) {
      assert.equal(v.field, field, JSON.stringify(opts));
      assert.match(v.error, new RegExp(msg));
    }
  }
});

test("the study kind needs no label or range", () => {
  const v = validateStudyOpts({ kind: "study", quick: true, mode: "tactical" });
  assert.equal(v.ok, true);
  if (v.ok) assert.deepEqual([v.norm.quick, v.norm.mode], [true, "tactical"]);
});

test("an overrides checker can refuse with its own message", () => {
  const v = validateStudyOpts({ ...sweep, overrides: '{"CUAS":{"BRG_SIGMA":8}}' }, () => "CUAS.BRG_SIGMA: unknown key");
  assert.deepEqual(v, { ok: false, error: "CUAS.BRG_SIGMA: unknown key", field: "overrides" });
  const w = validateStudyOpts({ ...sweep, overrides: '{"CUAS":{"BRG_SIGMA_DEG":8}}' }, () => null);
  assert.equal(w.ok, true);
});

test("expected study sizes match the published battery", () => {
  assert.equal(studyExpectedRuns("orbit", false), 22800);
  assert.equal(studyExpectedRuns("tactical", false), 24800);
  assert.equal(studyExpectedRuns("orbit", true), 2400);
  assert.equal(studyExpectedRuns("tactical", true), 2600);
});

test("runner log lines are recognised", () => {
  assert.equal(parseRunsLine("  stock: 10000 runs in 660.2s — B 4801 / O 2814 / S 2385"), 10000);
  assert.equal(parseRunsLine("  uplink 2/12 video continuous: 400 runs in 26.1s — B 1 / O 2 / S 3"), 400);
  assert.equal(parseRunsLine("  1000 runs in 5.4s — B 146 / O 144 / S 710"), 1000);
  assert.equal(parseRunsLine("E1 baseline (stock config)..."), null);

  assert.deepEqual(
    parseWroteLine("Wrote C:\\Users\\x\\results\\adhoc-df-2026-09-05.json and registered it in the results manifest."),
    { file: "adhoc-df-2026-09-05.json", registered: true },
  );
  assert.deepEqual(
    parseWroteLine("Wrote C:\\Users\\x\\results\\adhoc-df-2026-09-05.json and registered it in results/index.json."),
    { file: "adhoc-df-2026-09-05.json", registered: true },
  );
  assert.deepEqual(parseWroteLine("Wrote /home/x/results/monte-carlo-quick.json (2280 engagements)"), {
    file: "monte-carlo-quick.json",
    registered: false,
  });
  assert.equal(parseWroteLine("parallel sweep: seeds 1–1000 (stock config) on 31 workers..."), null);

  assert.equal(isUpdatedManifestLine("Updated C:\\Users\\x\\results\\index.json"), true);
  assert.equal(isUpdatedManifestLine("Updated something else"), false);
});
