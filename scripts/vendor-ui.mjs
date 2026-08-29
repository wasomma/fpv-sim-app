/*
 * Vendor the pinned fpv-sim UI into build/resources:
 *
 *   build/resources/ui/{index,dashboard,viewer3d}.html   the three pages, unmodified
 *   build/resources/ui/scripts/*.mjs                     study/sweep runners (run as node children)
 *   build/resources/ui/results/*                         committed datasets (first-run seed)
 *   build/resources/upstream-pins.json                   provenance shown in the app / stamped on datasets
 *
 * Source of truth is the upstream/fpv-sim git submodule; run
 * `git submodule update --init` first. The fpv-sim-mcp pin is read from
 * package-lock.json so it always reflects what is actually installed.
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sub = path.join(root, "upstream", "fpv-sim");
const out = path.join(root, "build", "resources");
const uiOut = path.join(out, "ui");

if (!existsSync(path.join(sub, "index.html"))) {
  console.error(`upstream/fpv-sim submodule not present at ${sub}`);
  console.error("Run: git submodule update --init");
  process.exit(1);
}

rmSync(uiOut, { recursive: true, force: true });
mkdirSync(path.join(uiOut, "scripts"), { recursive: true });

for (const file of ["index.html", "dashboard.html", "viewer3d.html"]) {
  cpSync(path.join(sub, file), path.join(uiOut, file));
}
for (const file of readdirSync(path.join(sub, "scripts"))) {
  if (file.endsWith(".mjs")) {
    cpSync(path.join(sub, "scripts", file), path.join(uiOut, "scripts", file));
  }
}
cpSync(path.join(sub, "results"), path.join(uiOut, "results"), { recursive: true });

const fpvSimCommit = execSync("git rev-parse HEAD", { cwd: sub, encoding: "utf8" }).trim();

let mcpResolved = null;
let mcpVersion = null;
try {
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const entry = lock.packages?.["node_modules/fpv-sim-mcp"];
  mcpResolved = entry?.resolved ?? null;
  mcpVersion = entry?.version ?? null;
} catch {
  /* lockfile missing — pins stay null */
}

const pins = {
  generated: new Date().toISOString(),
  fpv_sim_commit: fpvSimCommit,
  fpv_sim_mcp_version: mcpVersion,
  fpv_sim_mcp_resolved: mcpResolved,
};
writeFileSync(path.join(out, "upstream-pins.json"), JSON.stringify(pins, null, 2) + "\n");

/* Plain-file engine copy for packaged builds: child node processes and
   the parity smoke need it outside the asar archive. */
const mcpSrc = path.join(root, "node_modules", "fpv-sim-mcp");
const engineOut = path.join(out, "engine");
rmSync(engineOut, { recursive: true, force: true });
if (existsSync(path.join(mcpSrc, "dist"))) {
  mkdirSync(engineOut, { recursive: true });
  cpSync(path.join(mcpSrc, "dist"), path.join(engineOut, "dist"), { recursive: true });
  cpSync(path.join(mcpSrc, "package.json"), path.join(engineOut, "package.json"));
  cpSync(path.join(mcpSrc, "test", "fixtures"), path.join(engineOut, "test", "fixtures"), { recursive: true });
} else {
  console.error("warning: node_modules/fpv-sim-mcp/dist missing — run npm install first");
}

console.log(`vendored ui from fpv-sim ${fpvSimCommit.slice(0, 7)} -> ${uiOut}`);
console.log(`engine copy: fpv-sim-mcp ${mcpVersion ?? "?"} -> ${engineOut}`);
console.log(`pins: ${JSON.stringify(pins)}`);
