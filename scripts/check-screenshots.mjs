#!/usr/bin/env node
/*
 * CI guard for the screenshot pipeline: every figure the committed manual
 * manifest lists must have been produced by a fresh `--screenshots` run
 * (ignoring groups that need hardware the runner lacks, e.g. viewer3d).
 *
 *   node scripts/check-screenshots.mjs <produced/manifest.json> <docs/manual/images/manifest.json> [--ignore-group=viewer3d,...]
 */

import { readFileSync } from "node:fs";

const [producedPath, committedPath, ...rest] = process.argv.slice(2);
if (!producedPath || !committedPath) {
  console.error("usage: check-screenshots.mjs <produced manifest> <committed manifest> [--ignore-group=a,b]");
  process.exit(2);
}
const ignore = new Set(
  rest
    .filter((a) => a.startsWith("--ignore-group="))
    .flatMap((a) => a.slice("--ignore-group=".length).split(","))
    .filter(Boolean),
);
const produced = JSON.parse(readFileSync(producedPath, "utf8"));
const committed = JSON.parse(readFileSync(committedPath, "utf8"));
const got = new Map(produced.shots.map((s) => [s.id, s]));

const missing = [];
for (const s of committed.shots) {
  if (s.file === null || ignore.has(s.group)) continue;
  const p = got.get(s.id);
  if (!p || p.file === null) missing.push(`${s.id} (${p ? (p.error ?? p.skipped ?? "no file") : "not produced"})`);
}
const failed = produced.shots.filter((s) => s.error !== null && !ignore.has(s.group)).map((s) => `${s.id}: ${s.error}`);

if (missing.length === 0 && failed.length === 0) {
  console.log(`check-screenshots: OK — ${committed.shots.filter((s) => s.file !== null).length} committed figures all reproduced`);
  process.exit(0);
}
if (missing.length) console.error(`check-screenshots: ${missing.length} committed figure(s) not reproduced:\n  ${missing.join("\n  ")}`);
if (failed.length) console.error(`check-screenshots: ${failed.length} shot(s) failed:\n  ${failed.join("\n  ")}`);
process.exit(1);
