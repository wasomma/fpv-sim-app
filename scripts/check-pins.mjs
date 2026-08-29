/*
 * Pin-pair check: the vendored UI (upstream/fpv-sim submodule) and the
 * bundled engine (fpv-sim-mcp git dependency) must be a parity-verified
 * pair.
 *
 * The engine's golden fixtures record the upstream commit their runs were
 * generated from (_meta.source_commit). Later upstream commits that only
 * touch docs/results/scripts are fine — the invariant is that index.html
 * (the engine spec) is UNCHANGED between the fixtures' source commit and
 * the submodule pin:
 *
 *   git diff <source_commit>..<submodule HEAD> -- index.html   is empty
 *
 * Also asserts the vendored copy matches the submodule byte-for-byte
 * (stale build/resources would otherwise mask a bumped pin).
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sub = path.join(root, "upstream", "fpv-sim");

function fail(msg) {
  console.error(`check-pins: FAIL — ${msg}`);
  process.exit(1);
}

const engineIndex = require.resolve("fpv-sim-mcp/engine");
const mcpRoot = path.resolve(path.dirname(engineIndex), "..", "..", "..");

const sources = new Set();
for (const file of ["golden-seeds.json", "golden-seeds-tactical.json"]) {
  const fixture = JSON.parse(readFileSync(path.join(mcpRoot, "test", "fixtures", file), "utf8"));
  sources.add(fixture._meta.source_commit);
}
if (sources.size !== 1) fail(`fixture sets pin different upstream commits: ${[...sources].join(", ")}`);
const sourceCommit = [...sources][0];

const subHead = execFileSync("git", ["-C", sub, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

/* CI checkouts clone the submodule shallow; fetch the fixtures' source
   commit into it if the local history doesn't reach that far. */
try {
  execFileSync("git", ["-C", sub, "cat-file", "-e", `${sourceCommit}^{commit}`], { stdio: "ignore" });
} catch {
  try {
    execFileSync("git", ["-C", sub, "fetch", "--quiet", "origin", sourceCommit], { stdio: "ignore" });
  } catch {
    execFileSync("git", ["-C", sub, "fetch", "--quiet", "--unshallow", "origin"], { stdio: "ignore" });
  }
}

try {
  execFileSync("git", ["-C", sub, "merge-base", "--is-ancestor", sourceCommit, subHead]);
} catch {
  fail(`fixtures' source commit ${sourceCommit.slice(0, 7)} is not an ancestor of submodule ${subHead.slice(0, 7)}`);
}

const diff = execFileSync(
  "git",
  ["-C", sub, "diff", "--name-only", `${sourceCommit}..${subHead}`, "--", "index.html"],
  { encoding: "utf8" },
).trim();
if (diff !== "") {
  fail(
    `index.html changed between fixtures' source ${sourceCommit.slice(0, 7)} and submodule ${subHead.slice(0, 7)} — ` +
      "bump the fpv-sim-mcp pin (with regenerated fixtures) and the submodule together",
  );
}

const vendored = path.join(root, "build", "resources", "ui", "index.html");
if (existsSync(vendored)) {
  const a = readFileSync(vendored);
  const b = readFileSync(path.join(sub, "index.html"));
  if (!a.equals(b)) fail("vendored build/resources/ui/index.html differs from the submodule — rerun npm run vendor");
} else {
  console.log("check-pins: note — no vendored build yet (npm run vendor not run); skipped byte check");
}

console.log(
  `check-pins: OK — fixtures@${sourceCommit.slice(0, 7)} .. submodule@${subHead.slice(0, 7)}: index.html unchanged`,
);
