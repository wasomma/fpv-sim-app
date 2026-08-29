/*
 * Per-user results store. dashboard.html fetches results/index.json
 * relative to its own origin, which the app:// handler maps to this
 * directory. First run seeds it with the datasets vendored from the
 * pinned fpv-sim checkout so the dashboard opens populated; an existing
 * user manifest is never overwritten.
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { resultsDir, uiRoot } from "./paths.js";

export function seedResultsIfEmpty(): { seeded: boolean; dir: string } {
  const dir = resultsDir();
  const manifest = path.join(dir, "index.json");
  if (existsSync(manifest)) {
    return { seeded: false, dir };
  }
  mkdirSync(dir, { recursive: true });
  const vendored = path.join(uiRoot(), "results");
  if (existsSync(vendored)) {
    cpSync(vendored, dir, { recursive: true });
    return { seeded: true, dir };
  }
  return { seeded: false, dir };
}
