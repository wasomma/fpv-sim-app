/*
 * Headline numbers for the Studies panel, derived from manifest entries
 * alone — no dataset file is opened. Every entry carries its baseline
 * B / O / S rates in `baseline.win_rates`; for an ad-hoc sweep the
 * headline also carries the delta against the canonical study of the
 * same mode, using the same reference rule and the same displayed-rate
 * delta rule as the dashboard's finding, so the panel and the page never
 * disagree. Electron-free and unit-tested.
 */

import type { DatasetEntry, ResultsListing } from "./results-manifest.js";

export interface WinRates {
  BLUFOR: number;
  OPFOR: number;
  STALEMATE: number;
}

export interface Headline {
  rates: WinRates;
  runs: number | null;
  /** The same-mode study the deltas are measured against; null for a study, or when none is registered. */
  baseline: { file: string; label: string; rates: WinRates } | null;
  /** (this − baseline) in points, one decimal, from the displayed rates; null without a baseline. */
  deltaPts: WinRates | null;
  /** "B 14.6% / O 14.4% / S 71.0%" */
  text: string;
  /** "Δ vs Full study −33.4 / −13.7 / +47.1 pts", or null without a baseline. */
  deltaText: string | null;
}

export type HeadlinedListing = Omit<ResultsListing, "datasets"> & {
  datasets: (ResultsListing["datasets"][number] & { headline: Headline | null })[];
};

const SIDES = ["BLUFOR", "OPFOR", "STALEMATE"] as const;
const MINUS = "−";

// The dashboard's own defaults for entries written before these fields existed.
const kindOf = (e: DatasetEntry): string => (typeof e.kind === "string" ? e.kind : "study");
const modeOf = (e: DatasetEntry): string => (typeof e.mode === "string" ? e.mode : "orbit");
const labelOf = (e: DatasetEntry): string => (typeof e.label === "string" && e.label !== "" ? e.label : "Full study");

export function winRatesOf(entry: DatasetEntry): WinRates | null {
  const b = entry.baseline as { win_rates?: Record<string, unknown> } | undefined;
  const w = b?.win_rates;
  if (typeof w !== "object" || w === null) return null;
  const out: Partial<WinRates> = {};
  for (const s of SIDES) {
    const v = w[s];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out[s] = v;
  }
  return out as WinRates;
}

export function runsOf(entry: DatasetEntry): number | null {
  const b = entry.baseline as { runs?: unknown } | undefined;
  return typeof b?.runs === "number" && Number.isFinite(b.runs) ? b.runs : null;
}

/** The dashboard's reference: the first (newest) study of the same mode in manifest order; null for a study. */
export function studyBaselineFor(entry: DatasetEntry, datasets: DatasetEntry[]): DatasetEntry | null {
  if (kindOf(entry) !== "adhoc") return null;
  return (
    datasets.find(
      (d) => d.file !== entry.file && kindOf(d) === "study" && modeOf(d) === modeOf(entry) && winRatesOf(d) !== null && runsOf(d) !== null,
    ) ?? null
  );
}

/** The dashboard's delta rule: a difference of displayed rates, in integer tenths of a point. */
export const deltaTenths = (a: number, b: number): number => Math.round(a * 1000) - Math.round(b * 1000);

export const fmtDelta = (dT: number): string => (dT === 0 ? "0.0" : (dT > 0 ? "+" : MINUS) + (Math.abs(dT) / 10).toFixed(1));

const pct = (v: number): string => (v * 100).toFixed(1) + "%";

export function datasetHeadline(entry: DatasetEntry, datasets: DatasetEntry[]): Headline | null {
  const rates = winRatesOf(entry);
  if (rates === null) return null;
  const text = `B ${pct(rates.BLUFOR)} / O ${pct(rates.OPFOR)} / S ${pct(rates.STALEMATE)}`;
  const runs = runsOf(entry);
  const ref = studyBaselineFor(entry, datasets);
  const refRates = ref === null ? null : winRatesOf(ref);
  if (ref === null || refRates === null) return { rates, runs, baseline: null, deltaPts: null, text, deltaText: null };
  const dT = {
    BLUFOR: deltaTenths(rates.BLUFOR, refRates.BLUFOR),
    OPFOR: deltaTenths(rates.OPFOR, refRates.OPFOR),
    STALEMATE: deltaTenths(rates.STALEMATE, refRates.STALEMATE),
  };
  return {
    rates,
    runs,
    baseline: { file: ref.file, label: labelOf(ref), rates: refRates },
    deltaPts: { BLUFOR: dT.BLUFOR / 10, OPFOR: dT.OPFOR / 10, STALEMATE: dT.STALEMATE / 10 },
    text,
    deltaText: `Δ vs ${labelOf(ref)} ${fmtDelta(dT.BLUFOR)} / ${fmtDelta(dT.OPFOR)} / ${fmtDelta(dT.STALEMATE)} pts`,
  };
}

/** Decorate a results listing with a headline per entry; everything else passes through untouched. */
export function withHeadlines(listing: ResultsListing): HeadlinedListing {
  return { ...listing, datasets: listing.datasets.map((d) => ({ ...d, headline: datasetHeadline(d, listing.datasets) })) };
}
