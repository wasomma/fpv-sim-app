/*
 * Validation of a Studies request, electron-free and unit-tested. Every
 * refusal names the field it belongs to so the panel can show it next to
 * the input as well as in the log. Nothing is silently substituted: an
 * empty count is an error, not 1000.
 */

export type StudyKind = "study" | "sweep" | "adhoc";
export type StudyMode = "orbit" | "tactical";
export type StudyField = "kind" | "label" | "start" | "count" | "overrides";

export interface StudyStartOpts {
  kind: StudyKind;
  /** study */
  quick?: boolean;
  mode?: StudyMode;
  /** sweep + adhoc */
  label?: string;
  start?: number;
  count?: number;
  /** JSON string of config overrides (keys checked against the engine schema when available). */
  overrides?: string;
}

export interface NormalizedStudyOpts {
  kind: StudyKind;
  quick: boolean;
  mode: StudyMode;
  label: string;
  start: number;
  count: number;
  /** The overrides text as typed (trimmed), or null when empty. */
  overrides: string | null;
  /** The parsed overrides object, or null when empty. */
  overridesValue: Record<string, unknown> | null;
}

export type StudyValidation =
  | { ok: true; norm: NormalizedStudyOpts }
  | { ok: false; error: string; field: StudyField };

export const MAX_SWEEP_COUNT = 1_000_000;
export const MAX_SEED = 4294967295;

/** Optional deeper check of the parsed overrides (the engine schema); returns an error string or null. */
export type OverridesCheck = (value: Record<string, unknown>) => string | null;

export function validateStudyOpts(raw: unknown, checkOverrides?: OverridesCheck): StudyValidation {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<StudyStartOpts>;
  const kind = o.kind;
  if (kind !== "study" && kind !== "sweep" && kind !== "adhoc") {
    return { ok: false, error: `unknown kind ${String(kind)}`, field: "kind" };
  }
  const mode: StudyMode = o.mode === "tactical" ? "tactical" : "orbit";
  const quick = o.quick === true;

  if (kind === "study") {
    return { ok: true, norm: { kind, quick, mode, label: "", start: 0, count: 0, overrides: null, overridesValue: null } };
  }

  const label = typeof o.label === "string" ? o.label.trim() : "";
  if (label === "") return { ok: false, error: "a label is required", field: "label" };

  const start = o.start;
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0 || start > MAX_SEED) {
    return { ok: false, error: `start must be an integer in 0..${MAX_SEED}`, field: "start" };
  }
  const count = o.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_SWEEP_COUNT) {
    return { ok: false, error: `count must be an integer in 1..${MAX_SWEEP_COUNT}`, field: "count" };
  }
  if (start + count - 1 > MAX_SEED) {
    return { ok: false, error: `start + count exceeds the seed range (max seed ${MAX_SEED})`, field: "count" };
  }

  let overrides: string | null = null;
  let overridesValue: Record<string, unknown> | null = null;
  if (typeof o.overrides === "string" && o.overrides.trim() !== "") {
    overrides = o.overrides.trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(overrides);
    } catch {
      return { ok: false, error: "overrides is not valid JSON", field: "overrides" };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "overrides must be a JSON object", field: "overrides" };
    }
    overridesValue = parsed as Record<string, unknown>;
    if (checkOverrides !== undefined) {
      const problem = checkOverrides(overridesValue);
      if (problem !== null) return { ok: false, error: problem, field: "overrides" };
    }
  }

  return { ok: true, norm: { kind, quick, mode, label, start, count, overrides, overridesValue } };
}

/**
 * Engagements the canonical study script will run, from its fixed
 * experiment battery (E1 10,000 · E2 stock arm + 3 paired [4 tactical]
 * × 2,000 · E3 12 cells × 400; --quick scales each to max(50, n/10)).
 * Lets the panel draw a real progress bar from the per-experiment log lines.
 */
export function studyExpectedRuns(mode: StudyMode, quick: boolean): number {
  const s = (n: number): number => (quick ? Math.max(50, Math.round(n / 10)) : n);
  const paired = mode === "tactical" ? 4 : 3;
  return s(10000) + s(2000) * (1 + paired) + s(400) * 12;
}

/** Rough wall-clock expectation the buttons already promise (seconds). */
export function studyExpectedSeconds(quick: boolean): number {
  return quick ? 240 : 1500;
}

/** "  stock: 10000 runs in 660.2s — …" / "  1000 runs in 5.4s — …" → 10000 / 1000. */
export function parseRunsLine(line: string): number | null {
  const m = /^\s+(?:.*?:\s+)?(\d+) runs in [\d.]+s/.exec(line);
  return m === null ? null : Number(m[1]);
}

/** Dataset basename from the runners' completion lines, or null. */
export function parseWroteLine(line: string): { file: string; registered: boolean } | null {
  // adhoc-runner / run-sweep: "Wrote <path> and registered it in …"
  let m = /^Wrote (.+?) and registered it in /.exec(line);
  if (m !== null) return { file: basename(m[1] as string), registered: true };
  // monte-carlo-study: "Wrote <path> (<n> engagements)" — registered only if "Updated …index.json" follows
  m = /^Wrote (.+?) \(\d+ engagements\)/.exec(line);
  if (m !== null) return { file: basename(m[1] as string), registered: false };
  return null;
}

export function isUpdatedManifestLine(line: string): boolean {
  return /^Updated .*index\.json\s*$/.test(line);
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i < 0 ? p : p.slice(i + 1);
}
