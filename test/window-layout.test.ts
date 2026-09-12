/*
 * Window placement rules: remembered bounds come back only where they
 * are still visible, sizes respect the display and the minimums, and
 * upstream windows get titles that name their seed and mode.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fitBounds, isSavedBounds, titleForUiUrl, uiKindForUrl, uiPageUrl } from "../src/main/window-layout.js";

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 2560, height: 1400 };
const spec = { width: 1100, height: 780, minWidth: 720, minHeight: 520 };

test("nothing remembered: default size, no position (OS centers)", () => {
  const p = fitBounds(undefined, [primary], primary, spec);
  assert.deepEqual(p, { width: 1100, height: 780, maximized: false });
});

test("remembered bounds on the primary display come back as they were", () => {
  const p = fitBounds({ x: 100, y: 80, width: 1200, height: 800 }, [primary], primary, spec);
  assert.deepEqual(p, { x: 100, y: 80, width: 1200, height: 800, maximized: false });
});

test("a window remembered on an unplugged monitor keeps its size but loses its position", () => {
  const p = fitBounds({ x: 3000, y: 100, width: 1200, height: 800 }, [primary], primary, spec);
  assert.deepEqual(p, { width: 1200, height: 800, maximized: false });
});

test("a window mostly on the second display stays there and is nudged fully inside it", () => {
  const p = fitBounds({ x: 4200, y: 900, width: 1000, height: 700 }, [primary, second], primary, spec);
  assert.equal(p.x, 4480 - 1000, "right edge pulled back to the display edge");
  assert.equal(p.y, 1400 - 700);
  assert.equal(p.width, 1000);
});

test("an oversize remembered window is clamped to the work area", () => {
  const p = fitBounds({ x: 0, y: 0, width: 5000, height: 3000 }, [primary], primary, spec);
  assert.deepEqual(p, { x: 0, y: 0, width: 1920, height: 1040, maximized: false });
});

test("defaults larger than a small laptop display are clamped too", () => {
  const laptop = { x: 0, y: 0, width: 1366, height: 728 };
  const p = fitBounds(undefined, [laptop], laptop, { width: 1440, height: 920, minWidth: 960, minHeight: 640 });
  assert.deepEqual(p, { width: 1366, height: 728, maximized: false });
});

test("the minimum size wins over a tiny remembered size, and yields to a tinier display", () => {
  const p = fitBounds({ x: 10, y: 10, width: 200, height: 150 }, [primary], primary, spec);
  assert.equal(p.width, 720);
  assert.equal(p.height, 520);
  const tiny = { x: 0, y: 0, width: 600, height: 400 };
  const q = fitBounds(undefined, [tiny], tiny, spec);
  assert.deepEqual(q, { width: 600, height: 400, maximized: false });
});

test("maximized is carried through", () => {
  const p = fitBounds({ x: 0, y: 0, width: 1100, height: 780, maximized: true }, [primary], primary, spec);
  assert.equal(p.maximized, true);
});

test("isSavedBounds rejects junk", () => {
  assert.equal(isSavedBounds({ x: 0, y: 0, width: 10, height: 10 }), true);
  assert.equal(isSavedBounds({ x: 0, y: 0, width: 0, height: 10 }), false);
  assert.equal(isSavedBounds({ x: "0", y: 0, width: 10, height: 10 }), false);
  assert.equal(isSavedBounds({ x: 0, y: 0, width: 10, height: 10, maximized: "yes" }), false);
  assert.equal(isSavedBounds(null), false);
  assert.equal(isSavedBounds([]), false);
});

test("upstream URLs map to kinds and titles", () => {
  assert.equal(uiKindForUrl("app://ui/index.html?seed=20260719&play=1"), "sim");
  assert.equal(uiKindForUrl("app://ui/"), "sim");
  assert.equal(uiKindForUrl("app://ui/dashboard.html"), "dashboard");
  assert.equal(uiKindForUrl("app://ui/viewer3d.html?seed=12"), "viewer3d");
  assert.equal(uiKindForUrl("app://app/studies/index.html"), null);
  assert.equal(uiKindForUrl("not a url"), null);

  assert.equal(titleForUiUrl("app://ui/index.html?seed=20260719&play=1"), "Simulation · seed 20260719 (orbit) — FPV Sim");
  assert.equal(titleForUiUrl("app://ui/index.html?seed=12&mode=tactical"), "Simulation · seed 12 (tactical) — FPV Sim");
  assert.equal(titleForUiUrl("app://ui/index.html"), "Simulation · (orbit) — FPV Sim");
  assert.equal(titleForUiUrl("app://ui/dashboard.html"), "Dashboard — FPV Sim");
  assert.equal(titleForUiUrl("app://ui/viewer3d.html?seed=12"), "3D Viewer · seed 12 — FPV Sim");
  assert.equal(titleForUiUrl("app://ui/viewer3d.html"), "3D Viewer — FPV Sim");
  // A query never changes the kind or the title.
  assert.equal(uiKindForUrl("app://ui/dashboard.html?dataset=a.json"), "dashboard");
  assert.equal(titleForUiUrl("app://ui/dashboard.html?dataset=a.json"), "Dashboard — FPV Sim");
});

test("uiPageUrl validates and encodes deep-link params", () => {
  assert.equal(uiPageUrl("index.html"), "app://ui/index.html");
  assert.equal(uiPageUrl("index.html", { seed: 20260719, play: true }), "app://ui/index.html?seed=20260719&play=1");
  assert.equal(uiPageUrl("index.html", { seed: 12, mode: "tactical" }), "app://ui/index.html?seed=12&mode=tactical");
  assert.equal(uiPageUrl("index.html", { seed: -1, mode: "orbit", play: false }), "app://ui/index.html");
  assert.equal(uiPageUrl("index.html", { seed: 1.5 }), "app://ui/index.html");
  // A dataset deep link: plain file names only, spaces as %20, round-trips through URLSearchParams.
  const u = uiPageUrl("dashboard.html", { dataset: "My Export (1).json" });
  assert.equal(u, "app://ui/dashboard.html?dataset=My%20Export%20(1).json");
  assert.equal(new URL(u).searchParams.get("dataset"), "My Export (1).json");
  assert.equal(uiPageUrl("dashboard.html", { mode: "tactical", dataset: "monte-carlo-tactical.json" }), "app://ui/dashboard.html?mode=tactical&dataset=monte-carlo-tactical.json");
  for (const junk of ["../x.json", "index.json", "", "a/b.json", "x.txt", 42 as unknown as string]) {
    assert.equal(uiPageUrl("dashboard.html", { dataset: junk }), "app://ui/dashboard.html", `dropped: ${String(junk)}`);
  }
  // Only the dashboard reads it.
  assert.equal(uiPageUrl("index.html", { dataset: "monte-carlo.json" }), "app://ui/index.html");
  assert.equal(uiPageUrl("viewer3d.html", { seed: 3, dataset: "monte-carlo.json" }), "app://ui/viewer3d.html?seed=3");
});
