/*
 * The command line shared by `npm run terrain-export` and the installed
 * app's --terrain-export mode: flags, the Electron argv shape (an app
 * path positional and the mode flag are ignored), both variants by
 * default, --vdatum to narrow, exit codes and messages.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { USAGE, runTerrainExportCli } from "../src/main/gateway/terrain/cli.js";

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { log: (l: string) => out.push(l), error: (l: string) => err.push(l) } };
}

test("writes the whole set and reports each elevation file, ignoring Electron's positionals and mode flag", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fpv-terrain-cli-"));
  try {
    const { out, err, io: o } = io();
    const code = runTerrainExportCli(
      [".", "--terrain-export", "--seed=20260719", "--lat=21.35", "--lon=-157.95", "--geoid=12.5", `--out=${path.join(dir, "export")}`],
      o,
    );
    assert.equal(code, 0, err.join("\n"));
    assert.deepEqual(err, []);
    assert.deepEqual(readdirSync(path.join(dir, "export")).sort(), [
      "seed-20260719-canopy.tif",
      "seed-20260719-elevation-egm96.json",
      "seed-20260719-elevation-egm96.tif",
      "seed-20260719-elevation-ellipsoid.json",
      "seed-20260719-elevation-ellipsoid.tif",
    ]);
    assert.equal(out.length, 4);
    assert.match(out[0]!, /elevation-egm96\.tif: 200x200 @ 20\.1005 m, EPSG:4326 .* heights egm96 \(EPSG:5773\), offset \+0\.00 m/);
    assert.match(out[1]!, /elevation-ellipsoid\.tif: .* heights ellipsoid \(EPSG:4979\), offset \+12\.50 m/);
    assert.match(out[2]!, /wrote 5 files in /);
    assert.match(out[3]!, /water line/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--vdatum narrows to one variant; a zero geoid with the ellipsoid variant is a warning, not an error", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fpv-terrain-cli-"));
  try {
    const { out, err, io: o } = io();
    const code = runTerrainExportCli(["--seed=20260719", "--lat=21.35", "--lon=-157.95", "--vdatum=ellipsoid", `--out=${dir}`], o);
    assert.equal(code, 0);
    assert.equal(err.length, 1);
    assert.match(err[0]!, /^warning: anchor\.geoidOffsetM is 0/);
    assert.deepEqual(readdirSync(dir).sort(), ["seed-20260719-canopy.tif", "seed-20260719-elevation-ellipsoid.json", "seed-20260719-elevation-ellipsoid.tif"]);
    assert.match(out[1]!, /wrote 3 files/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing or bad arguments exit 1 with the usage line and write nothing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fpv-terrain-cli-"));
  try {
    const cases: [string[], RegExp][] = [
      [[], /^usage:/],
      [["--seed=20260719", "--lat=21.35"], /^usage:/],
      [["--seed=1.5", "--lat=21.35", "--lon=-157.95"], /seed must be an integer/],
      [["--seed=1", "--lat=95", "--lon=0"], /anchor\.lat0Deg/],
      [["--seed=1", "--lat=21.35", "--lon=-157.95", "--vdatum=msl"], /--vdatum must be egm96 or ellipsoid \(got msl\)/],
    ];
    for (const [argv, expect] of cases) {
      const { out, err, io: o } = io();
      const code = runTerrainExportCli([...argv, `--out=${dir}`], o);
      assert.equal(code, 1, argv.join(" "));
      assert.deepEqual(out, []);
      assert.ok(err.some((l) => expect.test(l)), `${argv.join(" ")}: ${err.join(" | ")}`);
    }
    assert.ok(!existsSync(path.join(dir, "seed-1-canopy.tif")));
    assert.match(USAGE, /--vdatum=egm96\|ellipsoid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
