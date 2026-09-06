/*
 * Dataset management: the manifest survives a rewrite byte-compatible
 * with what the vendored runners write (unknown fields included), file
 * names are validated before they touch the filesystem, and every
 * operation the DATASETS box offers — delete, relabel, register a
 * hand-copied file, restore a bundled dataset — behaves on a real
 * directory.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isDatasetFileName,
  listResults,
  readManifest,
  registerDatasetFile,
  relabelDataset,
  removeDataset,
  restoreBundled,
  writeManifest,
} from "../src/main/results-manifest.js";

function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), "fpv-results-"));
}

const entry = (file: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  file,
  kind: "adhoc",
  mode: "orbit",
  label: `label for ${file}`,
  generated: "2026-09-05T12:00:00.000Z",
  total_runs: 1000,
  ...extra,
});

function seed(dir: string, entries: Record<string, unknown>[]): void {
  writeFileSync(path.join(dir, "index.json"), JSON.stringify({ datasets: entries }, null, 2) + "\n");
  for (const e of entries) writeFileSync(path.join(dir, e.file as string), "{}");
}

test("file names with separators, colons or the manifest itself are refused", () => {
  for (const good of ["monte-carlo.json", "adhoc-df-2026-09-05.json", "My Export (1).json"]) {
    assert.equal(isDatasetFileName(good), true, good);
  }
  for (const bad of ["", "index.json", "INDEX.JSON", "..", "../x.json", "a/b.json", "a\\b.json", "C:x.json", ".hidden.json", "no-extension", "x.json.tmp", 42, null]) {
    assert.equal(isDatasetFileName(bad), false, String(bad));
  }
});

test("a manifest rewrite preserves unknown fields and the runners' exact format", () => {
  const dir = scratch();
  try {
    const manifest = {
      datasets: [entry("a.json", { future_field: { nested: true } })],
      manifest_note: "kept",
    };
    const bytes = JSON.stringify(manifest, null, 2) + "\n";
    writeFileSync(path.join(dir, "index.json"), bytes);
    const read = readManifest(dir);
    assert.equal(read.ok, true);
    if (read.ok) {
      writeManifest(dir, read.manifest);
      assert.equal(readFileSync(path.join(dir, "index.json"), "utf8"), bytes);
      assert.deepEqual(readdirSync(dir), ["index.json"]); // no temp file left behind
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing manifest reads as empty; corrupt or shapeless ones are errors", () => {
  const dir = scratch();
  try {
    assert.deepEqual(readManifest(dir), { ok: true, manifest: { datasets: [] } });
    writeFileSync(path.join(dir, "index.json"), "{nope");
    const bad = readManifest(dir);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /not valid JSON/);
    writeFileSync(path.join(dir, "index.json"), JSON.stringify({ datasets: "x" }));
    const shapeless = readManifest(dir);
    assert.equal(shapeless.ok, false);
    if (!shapeless.ok) assert.match(shapeless.error, /no "datasets" list/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeDataset deletes the entry and the file, and tolerates either being absent", () => {
  const dir = scratch();
  try {
    seed(dir, [entry("a.json"), entry("b.json"), entry("dangling.json")]);
    rmSync(path.join(dir, "dangling.json"));
    writeFileSync(path.join(dir, "orphan.json"), "{}");

    assert.deepEqual(removeDataset(dir, "a.json"), { ok: true, removedEntry: true, removedFile: true });
    assert.deepEqual(removeDataset(dir, "dangling.json"), { ok: true, removedEntry: true, removedFile: false });
    assert.deepEqual(removeDataset(dir, "orphan.json"), { ok: true, removedEntry: false, removedFile: true });

    const read = readManifest(dir);
    assert.equal(read.ok, true);
    if (read.ok) assert.deepEqual(read.manifest.datasets.map((d) => d.file), ["b.json"]);
    assert.deepEqual(readdirSync(dir).sort(), ["b.json", "index.json"]);

    const gone = removeDataset(dir, "a.json");
    assert.equal(gone.ok, false);
    if (!gone.ok) assert.match(gone.error, /not in the results store/);
    const manifestItself = removeDataset(dir, "index.json");
    assert.equal(manifestItself.ok, false);
    if (!manifestItself.ok) assert.match(manifestItself.error, /not a dataset file name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("relabelDataset edits only the label", () => {
  const dir = scratch();
  try {
    seed(dir, [entry("a.json", { future_field: 7 })]);
    assert.deepEqual(relabelDataset(dir, "a.json", "  Renamed  "), { ok: true });
    const read = readManifest(dir);
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.manifest.datasets[0]?.label, "Renamed");
      assert.equal(read.manifest.datasets[0]?.future_field, 7);
      assert.equal(read.manifest.datasets[0]?.total_runs, 1000);
    }
    const empty = relabelDataset(dir, "a.json", "   ");
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.match(empty.error, /label is required/);
    const long = relabelDataset(dir, "a.json", "x".repeat(201));
    assert.equal(long.ok, false);
    if (!long.ok) assert.match(long.error, /too long/);
    const unknown = relabelDataset(dir, "other.json", "X");
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.match(unknown.error, /not registered/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listResults reports entries, missing files, unregistered files and the bundled set", () => {
  const dir = scratch();
  const vendored = scratch();
  try {
    seed(vendored, [entry("monte-carlo.json", { kind: "study" })]);
    seed(dir, [entry("a.json"), entry("gone.json")]);
    rmSync(path.join(dir, "gone.json"));
    writeFileSync(path.join(dir, "monte-carlo-quick.json"), "{}");
    writeFileSync(path.join(dir, "notes.txt"), "not a dataset");

    const listing = listResults(dir, vendored);
    assert.equal(listing.ok, true);
    assert.deepEqual(listing.datasets.map((d) => [d.file, d.missing]), [["a.json", false], ["gone.json", true]]);
    assert.deepEqual(listing.unregistered.map((u) => u.file), ["monte-carlo-quick.json"]);
    assert.equal(listing.unregistered[0]!.bytes, 2);
    assert.deepEqual(listing.bundled, ["monte-carlo.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(vendored, { recursive: true, force: true });
  }
});

test("listResults with a corrupt manifest still lists the folder", () => {
  const dir = scratch();
  try {
    writeFileSync(path.join(dir, "index.json"), "{nope");
    writeFileSync(path.join(dir, "a.json"), "{}");
    const listing = listResults(dir, path.join(dir, "no-vendored-dir"));
    assert.equal(listing.ok, false);
    assert.match(listing.error ?? "", /not valid JSON/);
    assert.deepEqual(listing.datasets, []);
    assert.deepEqual(listing.unregistered.map((u) => u.file), ["a.json"]);
    assert.deepEqual(listing.bundled, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("registerDatasetFile rebuilds the run-sweep entry from the file's own provenance", () => {
  const dir = scratch();
  try {
    seed(dir, [entry("existing.json")]);
    writeFileSync(
      path.join(dir, "adhoc-copied-2026-09-05.json"),
      JSON.stringify({
        kind: "adhoc",
        mode: "tactical",
        label: "Copied in by hand",
        quick: false,
        meta: {
          generated: "2026-09-04T08:00:00.000Z",
          sim_commit: "abc",
          engine_commit: "def",
          total_runs: 500,
          seed_range: { start: 1, count: 500 },
          overrides: { CUAS: { BRG_SIGMA_DEG: 8 } },
        },
        experiments: { baseline: { runs: 500, win_rates: { BLUFOR: 0.1, OPFOR: 0.2, STALEMATE: 0.7 } } },
      }),
    );
    const r = registerDatasetFile(dir, "adhoc-copied-2026-09-05.json");
    assert.deepEqual(r, { ok: true, label: "Copied in by hand" });
    const read = readManifest(dir);
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.deepEqual(read.manifest.datasets[0], {
        file: "adhoc-copied-2026-09-05.json",
        kind: "adhoc",
        mode: "tactical",
        label: "Copied in by hand",
        generated: "2026-09-04T08:00:00.000Z",
        sim_commit: "abc",
        engine_commit: "def",
        total_runs: 500,
        overrides: { CUAS: { BRG_SIGMA_DEG: 8 } },
        baseline: { runs: 500, win_rates: { BLUFOR: 0.1, OPFOR: 0.2, STALEMATE: 0.7 } },
      });
      assert.equal(read.manifest.datasets[1]?.file, "existing.json"); // unshifted, newest first
    }
    // Registering again replaces the entry instead of duplicating it.
    assert.equal(registerDatasetFile(dir, "adhoc-copied-2026-09-05.json").ok, true);
    const again = readManifest(dir);
    if (again.ok) assert.equal(again.manifest.datasets.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("registerDatasetFile refuses quick runs, junk and files without provenance", () => {
  const dir = scratch();
  try {
    seed(dir, []);
    writeFileSync(path.join(dir, "monte-carlo-quick.json"), JSON.stringify({ quick: true, meta: { generated: "x", total_runs: 1 } }));
    const quick = registerDatasetFile(dir, "monte-carlo-quick.json");
    assert.equal(quick.ok, false);
    if (!quick.ok) assert.match(quick.error, /smoke tests/);

    writeFileSync(path.join(dir, "junk.json"), "{nope");
    const junk = registerDatasetFile(dir, "junk.json");
    assert.equal(junk.ok, false);
    if (!junk.ok) assert.match(junk.error, /not a dataset/);

    writeFileSync(path.join(dir, "bare.json"), JSON.stringify({ label: "no meta" }));
    const bare = registerDatasetFile(dir, "bare.json");
    assert.equal(bare.ok, false);
    if (!bare.ok) assert.match(bare.error, /no run provenance/);

    const absent = registerDatasetFile(dir, "absent.json");
    assert.equal(absent.ok, false);
    if (!absent.ok) assert.match(absent.error, /not in the results folder/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restoreBundled copies the vendored file and entry back, replacing any stale entry", () => {
  const dir = scratch();
  const vendored = scratch();
  try {
    writeFileSync(path.join(vendored, "index.json"), JSON.stringify({ datasets: [entry("monte-carlo.json", { kind: "study", label: "Full study" })] }, null, 2) + "\n");
    writeFileSync(path.join(vendored, "monte-carlo.json"), '{"factory":true}');
    seed(dir, [entry("monte-carlo.json", { label: "user-relabeled", stale: true }), entry("mine.json")]);
    rmSync(path.join(dir, "monte-carlo.json"));

    assert.deepEqual(restoreBundled(dir, vendored, "monte-carlo.json"), { ok: true });
    assert.equal(readFileSync(path.join(dir, "monte-carlo.json"), "utf8"), '{"factory":true}');
    const read = readManifest(dir);
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.deepEqual(read.manifest.datasets.map((d) => d.file), ["monte-carlo.json", "mine.json"]);
      assert.equal(read.manifest.datasets[0]?.label, "Full study");
      assert.equal(read.manifest.datasets[0]?.stale, undefined);
    }

    const notBundled = restoreBundled(dir, vendored, "mine.json");
    assert.equal(notBundled.ok, false);
    if (!notBundled.ok) assert.match(notBundled.error, /not a bundled dataset/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(vendored, { recursive: true, force: true });
  }
});

test("operations that need the manifest refuse to run on a corrupt one", () => {
  const dir = scratch();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.json"), "{nope");
    writeFileSync(path.join(dir, "a.json"), "{}");
    for (const r of [removeDataset(dir, "a.json"), relabelDataset(dir, "a.json", "X")]) {
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error, /not valid JSON/);
    }
    // Nothing was deleted while the manifest was unreadable.
    assert.deepEqual(readdirSync(dir).sort(), ["a.json", "index.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
