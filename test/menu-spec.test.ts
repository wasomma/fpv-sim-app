/*
 * The menu's static shape: one entry per window kind, no accelerator
 * bound twice, help links that go somewhere, and the version line the
 * About box and the launcher footer share.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { HELP_URLS, OTHER_ACCELERATORS, WINDOW_ENTRIES, isHelpTarget, versionLine } from "../src/main/menu-spec.js";

test("every window kind has exactly one File entry, launcher first", () => {
  const kinds = WINDOW_ENTRIES.map((e) => e.kind);
  assert.deepEqual([...kinds].sort(), ["dashboard", "live-ops", "mcp", "shell", "sim", "studies", "viewer3d"]);
  assert.equal(kinds[0], "shell");
  for (const e of WINDOW_ENTRIES) assert.ok(e.label.length > 0, `${e.kind} has a label`);
});

test("window entries take Ctrl+0..6 in launcher-tile order", () => {
  assert.deepEqual(
    WINDOW_ENTRIES.map((e) => e.accelerator),
    ["CmdOrCtrl+0", "CmdOrCtrl+1", "CmdOrCtrl+2", "CmdOrCtrl+3", "CmdOrCtrl+4", "CmdOrCtrl+5", "CmdOrCtrl+6"],
  );
});

test("no accelerator is bound twice across the whole menu", () => {
  const all = [...WINDOW_ENTRIES.map((e) => e.accelerator), ...Object.values(OTHER_ACCELERATORS)];
  assert.equal(new Set(all).size, all.length, `duplicates in ${all.join(", ")}`);
});

test("help targets are https URLs on the repository", () => {
  for (const [name, url] of Object.entries(HELP_URLS)) {
    assert.ok(url.startsWith("https://github.com/"), `${name}: ${url}`);
    assert.ok(isHelpTarget(name));
  }
  assert.equal(isHelpTarget("settings"), false);
  assert.equal(isHelpTarget(undefined), false);
});

test("versionLine is the footer line users are asked to quote", () => {
  const line = versionLine({
    appVersion: "0.2.1",
    engineVersion: "0.3.0",
    electron: "44.0.0",
    node: "24.18.1",
    chrome: "152.0.7977.54",
    pins: { fpv_sim_commit: "7050617a4ee2d8e35ad676a31268b6c101511fe5" },
  });
  assert.equal(
    line,
    "app 0.2.1 · engine fpv-sim-mcp 0.3.0 · ui pin 7050617 · electron 44.0.0 · node 24.18.1 · chrome 152.0.7977.54",
  );
});

test("versionLine says unvendored when there is no pin", () => {
  const base = { appVersion: "0.2.1", engineVersion: "unknown", electron: "44.0.0", node: "24", chrome: "152" };
  assert.match(versionLine({ ...base, pins: null }), / · ui pin unvendored · /);
  assert.match(versionLine({ ...base, pins: { fpv_sim_commit: "abc" } }), / · ui pin unvendored · /);
});
