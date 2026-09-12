/*
 * The Studies panel's headline numbers come from manifest entries alone
 * and must match the dashboard's finding: same reference (the newest
 * same-mode study), same displayed-rate delta rule.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { datasetHeadline, deltaTenths, fmtDelta, studyBaselineFor, withHeadlines, winRatesOf } from "../src/main/results-headline.js";
import type { DatasetEntry, ResultsListing } from "../src/main/results-manifest.js";

const study = (file: string, mode: string, rates: [number, number, number], extra: Record<string, unknown> = {}): DatasetEntry => ({
  file,
  kind: "study",
  mode,
  label: mode === "tactical" ? "Tactical study" : "Full study",
  baseline: { runs: 10000, win_rates: { BLUFOR: rates[0], OPFOR: rates[1], STALEMATE: rates[2] } },
  ...extra,
});
const adhoc: DatasetEntry = {
  file: "adhoc-df-bearing-error-doubled-8-deg-2026-08-24.json",
  kind: "adhoc",
  mode: "orbit",
  label: "DF bearing error doubled (8 deg)",
  baseline: { runs: 1000, win_rates: { BLUFOR: 0.146, OPFOR: 0.144, STALEMATE: 0.71 } },
};
const orbit = study("monte-carlo.json", "orbit", [0.48, 0.281, 0.239]);
const tactical = study("monte-carlo-tactical.json", "tactical", [0.297, 0.185, 0.519]);
const manifest = [adhoc, tactical, orbit];

test("rates text comes from baseline.win_rates", () => {
  assert.deepEqual(winRatesOf(adhoc), { BLUFOR: 0.146, OPFOR: 0.144, STALEMATE: 0.71 });
  assert.equal(datasetHeadline(adhoc, manifest)?.text, "B 14.6% / O 14.4% / S 71.0%");
  assert.equal(winRatesOf({ file: "x.json" }), null);
  assert.equal(winRatesOf({ file: "x.json", baseline: { win_rates: { BLUFOR: "0.5" } } }), null);
  assert.equal(datasetHeadline({ file: "x.json" }, manifest), null);
});

test("an ad-hoc sweep is measured against the same-mode study; the delta follows the displayed-rate rule", () => {
  const h = datasetHeadline(adhoc, manifest);
  assert.ok(h);
  assert.equal(h.baseline?.file, "monte-carlo.json");
  assert.equal(h.baseline?.label, "Full study");
  assert.deepEqual(h.deltaPts, { BLUFOR: -33.4, OPFOR: -13.7, STALEMATE: 47.1 });
  assert.equal(h.deltaText, "Δ vs Full study −33.4 / −13.7 / +47.1 pts");
});

test("the other mode's study is never the reference, and a study has no delta", () => {
  const tacticalSweep: DatasetEntry = { ...adhoc, file: "adhoc-t.json", mode: "tactical" };
  assert.equal(studyBaselineFor(tacticalSweep, manifest)?.file, "monte-carlo-tactical.json");
  assert.equal(studyBaselineFor(adhoc, [adhoc, tactical]), null);
  const h = datasetHeadline(adhoc, [adhoc, tactical]);
  assert.equal(h?.baseline, null);
  assert.equal(h?.deltaText, null);
  assert.equal(datasetHeadline(orbit, manifest)?.deltaText, null);
  assert.equal(studyBaselineFor(orbit, manifest), null);
});

test("legacy entries default to study / orbit / Full study, like the dashboard", () => {
  const legacy: DatasetEntry = { file: "monte-carlo.json", baseline: { runs: 10000, win_rates: { BLUFOR: 0.48, OPFOR: 0.281, STALEMATE: 0.239 } } };
  const h = datasetHeadline(adhoc, [adhoc, legacy]);
  assert.equal(h?.baseline?.file, "monte-carlo.json");
  assert.equal(h?.baseline?.label, "Full study");
  assert.equal(datasetHeadline(legacy, [adhoc, legacy])?.deltaText, null);
});

test("delta formatting: sign, one decimal, Unicode minus, tenths of displayed rates", () => {
  assert.equal(deltaTenths(0.4525, 0.279), 174);
  assert.equal(deltaTenths(0.3595, 0.4885), -129);
  assert.equal(fmtDelta(174), "+17.4");
  assert.equal(fmtDelta(-129), "−12.9");
  assert.equal(fmtDelta(0), "0.0");
});

test("withHeadlines decorates every entry and preserves the rest of the listing", () => {
  const listing: ResultsListing = {
    ok: true,
    datasets: manifest.map((d, i) => ({ ...d, missing: i === 1 })),
    unregistered: [{ file: "monte-carlo-quick.json", bytes: 12 }],
    bundled: ["monte-carlo.json"],
  };
  const out = withHeadlines(listing);
  assert.equal(out.ok, true);
  assert.deepEqual(out.unregistered, listing.unregistered);
  assert.deepEqual(out.bundled, listing.bundled);
  assert.equal(out.datasets[1]?.missing, true);
  assert.equal(out.datasets[0]?.headline?.deltaText, "Δ vs Full study −33.4 / −13.7 / +47.1 pts");
  assert.equal(out.datasets[2]?.headline?.text, "B 48.0% / O 28.1% / S 23.9%");
  assert.equal(out.datasets[2]?.headline?.baseline, null);
});
