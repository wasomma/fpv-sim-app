/*
 * Dataset management for the per-user results store, electron-free and
 * unit-tested. The manifest (index.json) is the dashboard's source of
 * truth, and the vendored runners own its schema — this module only
 * upserts, relabels and removes entries, always preserving fields it does
 * not know about, writing the exact format registerDataset() in
 * sweep-utils.mjs writes (2-space indent, trailing newline), and always
 * through a temp file + rename so a crash can never leave half a
 * manifest.
 *
 * Every operation takes a plain file name, never a path: anything with a
 * separator, a colon or a leading dot is refused before it reaches the
 * filesystem, and index.json itself is not a dataset.
 */

import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/** One manifest entry. Only `file` is ours to interpret; the rest ships through untouched. */
export interface DatasetEntry {
  file: string;
  [key: string]: unknown;
}

export interface ResultsManifest {
  datasets: DatasetEntry[];
  [key: string]: unknown;
}

export type Result<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string };

/** What the Studies panel's DATASETS box renders. */
export interface ResultsListing {
  ok: boolean;
  /** Why the manifest could not be read; datasets is empty then. */
  error?: string;
  datasets: (DatasetEntry & { missing: boolean })[];
  /** .json files in the folder the manifest does not list (quick runs, hand-copied files). */
  unregistered: { file: string; bytes: number }[];
  /** Files the vendored (factory) manifest ships, for the RESTORE row. */
  bundled: string[];
}

const MANIFEST = "index.json";
export const MAX_LABEL_LENGTH = 200;

/** A plain .json file name safe to join under the results dir; never the manifest itself. */
export function isDatasetFileName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._ ()-]*\.json$/.test(name) &&
    name.toLowerCase() !== MANIFEST
  );
}

export function readManifest(dir: string): Result<{ manifest: ResultsManifest }> {
  const file = path.join(dir, MANIFEST);
  if (!existsSync(file)) return { ok: true, manifest: { datasets: [] } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return { ok: false, error: `${MANIFEST} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as ResultsManifest).datasets)) {
    return { ok: false, error: `${MANIFEST} has no "datasets" list` };
  }
  return { ok: true, manifest: parsed as ResultsManifest };
}

/** Same bytes registerDataset() writes, via temp + rename so readers never see a torn file. */
export function writeManifest(dir: string, manifest: ResultsManifest): void {
  const target = path.join(dir, MANIFEST);
  const tmp = path.join(dir, `${MANIFEST}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  try {
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Files listed in a directory's manifest (used against the vendored copy for RESTORE). */
export function bundledFiles(bundledDir: string): string[] {
  const read = readManifest(bundledDir);
  if (!read.ok) return [];
  return read.manifest.datasets.map((d) => d.file).filter(isDatasetFileName);
}

export function listResults(dir: string, bundledDir: string): ResultsListing {
  const bundled = bundledFiles(bundledDir);
  const read = readManifest(dir);
  let onDisk: string[] = [];
  try {
    onDisk = readdirSync(dir).filter(isDatasetFileName);
  } catch {
    /* no results dir yet — nothing on disk */
  }
  if (!read.ok) {
    return {
      ok: false,
      error: read.error,
      datasets: [],
      unregistered: onDisk.map((file) => ({ file, bytes: sizeOf(dir, file) })),
      bundled,
    };
  }
  const listed = new Set(read.manifest.datasets.map((d) => d.file));
  return {
    ok: true,
    datasets: read.manifest.datasets.map((d) => ({ ...d, missing: !onDisk.includes(d.file) })),
    unregistered: onDisk.filter((f) => !listed.has(f)).map((file) => ({ file, bytes: sizeOf(dir, file) })),
    bundled,
  };
}

function sizeOf(dir: string, file: string): number {
  try {
    return statSync(path.join(dir, file)).size;
  } catch {
    return 0;
  }
}

/**
 * Delete a dataset: its manifest entry (when registered) and its file
 * (when present). Removing an unregistered file or a dangling entry is
 * fine; a name that is neither is an error.
 */
export function removeDataset(
  dir: string,
  file: unknown,
): Result<{ removedEntry: boolean; removedFile: boolean }> {
  if (!isDatasetFileName(file)) return { ok: false, error: "not a dataset file name" };
  const read = readManifest(dir);
  if (!read.ok) return read;
  const kept = read.manifest.datasets.filter((d) => d.file !== file);
  const removedEntry = kept.length !== read.manifest.datasets.length;
  const full = path.join(dir, file);
  const removedFile = existsSync(full);
  if (!removedEntry && !removedFile) return { ok: false, error: `${file} is not in the results store` };
  try {
    if (removedEntry) writeManifest(dir, { ...read.manifest, datasets: kept });
    if (removedFile) rmSync(full);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, removedEntry, removedFile };
}

/** Change the label a dataset shows in the Dashboard. The file name never changes. */
export function relabelDataset(dir: string, file: unknown, label: unknown): Result {
  if (!isDatasetFileName(file)) return { ok: false, error: "not a dataset file name" };
  const trimmed = typeof label === "string" ? label.trim() : "";
  if (trimmed === "") return { ok: false, error: "a label is required" };
  if (trimmed.length > MAX_LABEL_LENGTH) {
    return { ok: false, error: `label is too long (max ${MAX_LABEL_LENGTH} characters)` };
  }
  const read = readManifest(dir);
  if (!read.ok) return read;
  const entry = read.manifest.datasets.find((d) => d.file === file);
  if (entry === undefined) return { ok: false, error: `${file} is not registered in the manifest` };
  entry.label = trimmed;
  try {
    writeManifest(dir, read.manifest);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}

/**
 * Register a dataset file that is already in the folder (a colleague's
 * export, a hand copy) by rebuilding its manifest entry from the
 * provenance the file itself carries — the same fields run-sweep.mjs
 * registers. Quick-run files stay smoke tests: never registered.
 */
export function registerDatasetFile(dir: string, file: unknown): Result<{ label: string }> {
  if (!isDatasetFileName(file)) return { ok: false, error: "not a dataset file name" };
  const full = path.join(dir, file);
  if (!existsSync(full)) return { ok: false, error: `${file} is not in the results folder` };
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(full, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not a JSON object");
    data = parsed as Record<string, unknown>;
  } catch (err) {
    return { ok: false, error: `${file} is not a dataset: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (data.quick === true) {
    return { ok: false, error: "quick runs are smoke tests and are never registered — run an ad-hoc sweep or the full study instead" };
  }
  const meta = (typeof data.meta === "object" && data.meta !== null ? data.meta : {}) as Record<string, unknown>;
  if (typeof meta.generated !== "string" || typeof meta.total_runs !== "number") {
    return { ok: false, error: `${file} carries no run provenance (meta.generated, meta.total_runs) — not a dataset the Dashboard can list` };
  }

  const entry: DatasetEntry = { file };
  entry.kind = typeof data.kind === "string" ? data.kind : "study";
  entry.mode = typeof data.mode === "string" ? data.mode : "orbit";
  const label = typeof data.label === "string" && data.label.trim() !== "" ? data.label.trim() : file;
  entry.label = label;
  entry.generated = meta.generated;
  if (typeof meta.sim_commit === "string") entry.sim_commit = meta.sim_commit;
  if (typeof meta.engine_commit === "string") entry.engine_commit = meta.engine_commit;
  entry.total_runs = meta.total_runs;
  if (typeof meta.overrides === "object" && meta.overrides !== null) entry.overrides = meta.overrides;
  const experiments = (typeof data.experiments === "object" && data.experiments !== null ? data.experiments : {}) as Record<string, unknown>;
  const baseline = (typeof experiments.baseline === "object" && experiments.baseline !== null ? experiments.baseline : {}) as Record<string, unknown>;
  if (typeof baseline.runs === "number" && typeof baseline.win_rates === "object" && baseline.win_rates !== null) {
    entry.baseline = { runs: baseline.runs, win_rates: baseline.win_rates };
  }

  const read = readManifest(dir);
  if (!read.ok) return read;
  read.manifest.datasets = [entry, ...read.manifest.datasets.filter((d) => d.file !== file)];
  try {
    writeManifest(dir, read.manifest);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, label };
}

/**
 * Bring one factory dataset back: copy the vendored file over and upsert
 * the vendored manifest entry (newest first, replacing any stale entry
 * for the same file). Only files the vendored manifest lists qualify.
 */
export function restoreBundled(dir: string, bundledDir: string, file: unknown): Result {
  if (!isDatasetFileName(file)) return { ok: false, error: "not a dataset file name" };
  const vendored = readManifest(bundledDir);
  if (!vendored.ok) return { ok: false, error: `the bundled manifest is unreadable: ${vendored.error}` };
  const entry = vendored.manifest.datasets.find((d) => d.file === file);
  if (entry === undefined) return { ok: false, error: `${file} is not a bundled dataset` };
  const read = readManifest(dir);
  if (!read.ok) return read;
  try {
    copyFileSync(path.join(bundledDir, file), path.join(dir, file));
    read.manifest.datasets = [{ ...entry }, ...read.manifest.datasets.filter((d) => d.file !== file)];
    writeManifest(dir, read.manifest);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}
