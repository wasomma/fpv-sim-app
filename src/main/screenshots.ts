/*
 * Screenshot mode: `electron . --screenshots[=<outDir>]`.
 *
 * Regenerates the user-manual figures from the app itself, so the manual
 * can never drift from the UI. The run is isolated from the user's real
 * profile: userData is redirected to a scratch directory before anything
 * reads it (results are re-seeded there, and settings.json is pre-written
 * with a fixed placeholder MCP token so the MCP panel figure never shows a
 * real secret). One window per group; each shot's setup drives the page to
 * a known state through the same globals and IPC the UI uses, then
 * webContents.capturePage() writes the image. manifest.json records
 * provenance (versions, pins, sizes, hashes) beside the images.
 *
 * Flags:
 *   --screenshots[=<outDir>]   default docs/manual/images
 *   --only=<id|group,...>      capture only these (earlier shots in a group
 *                              still run their setup so state chains hold)
 *   --skip=<id|group,...>      a group name skips the whole group; a shot id
 *                              skips just that capture
 *   --hidden                   never show windows (fallback; pages that rely
 *                              on requestAnimationFrame may render stale)
 *   --keep-scratch             leave the scratch userData dir in %TEMP%
 *   --scale=<n>                device scale factor (default 1)
 */

import { BrowserWindow, app } from "electron";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodePdu } from "./gateway/codec/factory.js";
import { disTimestamp } from "./gateway/codec/header.js";
import { LocalFrame } from "./gateway/geo/localframe.js";
import { DrAlgorithm, PduType, ProtocolFamily, type EspduModel } from "./gateway/types.js";
import { loaded, poll, sleep, withTimeout } from "./headless-util.js";
import { mcpHostStatus } from "./mcp/host.js";
import { appRoot, engineRoot, pinsFile } from "./paths.js";
import {
  liveGatewayStatus,
  livePause,
  liveResume,
  liveSetSpeed,
  liveStart,
  liveStatus,
  liveWaitForEnd,
} from "./sessions/session-manager.js";
import { studyStatus } from "./studies/study-runner.js";
import { createShellWindow, openAppPanel, openAppUrl } from "./windows.js";

/* ------------------------------------------------------------------ */
/* argv                                                                */

function argValue(name: string): string | null {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit === undefined) return null;
  const eq = hit.indexOf("=");
  return eq < 0 ? "" : hit.slice(eq + 1);
}

function argList(name: string): Set<string> {
  const v = argValue(name);
  return new Set((v ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0));
}

export function isScreenshots(): boolean {
  return argValue("screenshots") !== null;
}

/* ------------------------------------------------------------------ */
/* boot (before app.whenReady)                                         */

export const PLACEHOLDER_TOKEN = "EXAMPLE-TOKEN-REPLACE-ME-0123456789";
let scratchDir = "";

/**
 * Must run before registerAppScheme() / requestSingleInstanceLock(): the
 * single-instance lock and every userData consumer derive from the path
 * set here, so a normally running FPV Sim neither blocks this run nor
 * shares its results/settings with it.
 */
export function prepareScreenshotsBoot(): void {
  const base = path.join(app.getPath("temp"), "fpv-sim-app-screenshots");
  scratchDir = base;
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    scratchDir = `${base}-${Date.now()}`; // a previous run still holds a cache file
  }
  mkdirSync(scratchDir, { recursive: true });
  app.setPath("userData", scratchDir);
  app.setPath("sessionData", path.join(scratchDir, "session"));
  writeFileSync(
    path.join(scratchDir, "settings.json"),
    JSON.stringify({ mcp: { port: 8765, token: PLACEHOLDER_TOKEN } }, null, 2) + "\n",
  );
  app.commandLine.appendSwitch("force-device-scale-factor", argValue("scale") || "1");
}

/* ------------------------------------------------------------------ */
/* shot model                                                          */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface DomRect {
  x: number;
  y: number;
  w: number;
  h: number;
  vw: number;
  vh: number;
}

interface Ctx {
  win: BrowserWindow;
  js<T = unknown>(code: string): Promise<T>;
  waitFor(expr: string, timeoutMs?: number): Promise<void>;
  click(sel: string): Promise<void>;
  setVal(sel: string, value: string, fireEvents?: boolean): Promise<void>;
  rectOf(sel: string, pad?: number): Promise<Rect>;
  /** code must evaluate to {x,y,w,h,vw,vh} in CSS px (viewport-relative) or null. */
  rectJs(code: string, pad?: number): Promise<Rect>;
  settle(): Promise<void>;
}

class SkipShot extends Error {}

interface Shot {
  id: string;
  caption: string;
  setup?: (c: Ctx) => Promise<void>;
  clip?: (c: Ctx) => Promise<Rect>;
  format?: "png" | "jpeg";
  timeoutMs?: number;
}

interface Group {
  name: string;
  width: number;
  height: number;
  open: () => BrowserWindow;
  ready?: (c: Ctx) => Promise<void>;
  shots: Shot[];
  close?: () => Promise<void>;
}

interface ShotRecord {
  id: string;
  group: string;
  order: number;
  file: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  sha256: string | null;
  caption: string;
  skipped: string | null;
  error: string | null;
}

function clampRect(r: DomRect, pad: number): Rect {
  const x = Math.max(0, Math.floor(r.x - pad));
  const y = Math.max(0, Math.floor(r.y - pad));
  const right = Math.min(r.vw, Math.ceil(r.x + r.w + pad));
  const bottom = Math.min(r.vh, Math.ceil(r.y + r.h + pad));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

const RECT_OF = (selJson: string) =>
  `(() => { const el = document.querySelector(${selJson}); if (!el) return null;` +
  ` el.scrollIntoView({ block: "start" }); const b = el.getBoundingClientRect();` +
  ` return { x: b.left, y: b.top, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight }; })()`;

function makeCtx(win: BrowserWindow): Ctx {
  const js = <T,>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>;
  const rectFrom = async (code: string, pad: number): Promise<Rect> => {
    const r = await js<DomRect | null>(code);
    if (r === null) throw new Error(`clip target not found: ${code.slice(0, 80)}`);
    return clampRect(r, pad);
  };
  return {
    win,
    js,
    /* 45 s, not 15: CI runners render the heaviest dashboards (the 24,800-run
       tactical study) far slower than a dev box with a GPU. The expression is
       folded into the failure so a timeout says which wait gave up. */
    waitFor: (expr, timeoutMs = 45000) =>
      poll(() => js<boolean>(`!!(${expr})`), (v) => v === true, timeoutMs, 100)
        .then(() => undefined)
        .catch((e: unknown) => {
          throw new Error(`waitFor ${expr} — ${e instanceof Error ? e.message : String(e)}`);
        }),
    click: (sel) => js(`(() => { document.querySelector(${JSON.stringify(sel)}).click(); return true; })()`).then(() => undefined),
    setVal: (sel, value, fireEvents = true) =>
      js(
        `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(value)};` +
          (fireEvents
            ? ` el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));`
            : "") +
          ` return true; })()`,
      ).then(() => undefined),
    rectOf: (sel, pad = 8) => rectFrom(RECT_OF(JSON.stringify(sel)), pad),
    rectJs: (code, pad = 8) => rectFrom(code, pad),
    settle: () =>
      js(
        `document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))`,
      ).then(() => undefined),
  };
}

/* ------------------------------------------------------------------ */
/* helpers used by several groups                                      */

function freeUdpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket("udp4");
    s.once("error", reject);
    s.bind({ address: "127.0.0.1", port: 0 }, () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

/** Emits a stationary external Entity State PDU (site 2, app 9000) at 1 Hz — the overlay-track figure. */
class ExternalTrackSender {
  private readonly sock = dgram.createSocket("udp4");
  private timer: NodeJS.Timeout | null = null;
  private readonly bytes: Uint8Array;

  constructor(private readonly port: number) {
    const frame = new LocalFrame({ lat0Deg: 21.35, lon0Deg: -157.95, h0M: 0, rotationDeg: 0, geoidOffsetM: 0 });
    const zero = { x: 0, y: 0, z: 0 };
    const pdu: EspduModel = {
      header: {
        protocolVersion: 6,
        exerciseId: 1,
        pduType: PduType.EntityState,
        protocolFamily: ProtocolFamily.EntityInformation,
        timestamp: disTimestamp(Date.now(), false),
        length: 0,
      },
      entityId: { site: 2, app: 9000, entity: 1 },
      forceId: 3,
      entityType: { kind: 1, domain: 2, country: 0, category: 50, subcategory: 1, specific: 1, extra: 0 },
      altEntityType: { kind: 0, domain: 0, country: 0, category: 0, subcategory: 0, specific: 0, extra: 0 },
      linearVelocity: zero,
      location: frame.localToEcef(2000, 3200, 120),
      orientation: { psi: 0, theta: 0, phi: 0 },
      appearance: 0,
      drAlgorithm: DrAlgorithm.Static,
      linearAcceleration: zero,
      angularVelocity: zero,
      marking: "VBS-EXT-1",
      capabilities: 0,
    };
    this.bytes = encodePdu({ kind: "espdu", pdu });
    this.sock.on("error", () => {
      /* best effort */
    });
  }

  start(): void {
    const send = () => this.sock.send(this.bytes, 0, this.bytes.length, this.port, "127.0.0.1");
    send();
    this.timer = setInterval(send, 1000);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    try {
      this.sock.close();
    } catch {
      /* already closed */
    }
  }
}

const GATEWAY_DEFAULT_TEXT = `{"network":{"mode":"broadcast","port":3000},
 "dis":{"exerciseId":1},
 "anchor":{"lat0Deg":21.35,"lon0Deg":-157.95}}`;

/* ------------------------------------------------------------------ */
/* the shot table                                                      */

const SIM_READY =
  `typeof state !== "undefined" && typeof stepSim === "function" && typeof draw === "function" && typeof renderPanel === "function"`;

/** Step the sim to T seconds and repaint (the page's own loop only redraws; it never steps while paused). */
const simAdvance = (t: number) =>
  `(() => { let g = 0; while (state.t < ${t} && g++ < 400000) stepSim(CONFIG.SIM_DT);` +
  ` document.getElementById("simclock").textContent = fmtT(state.t);` +
  ` document.getElementById("phase").textContent = state.phase; draw(); if (state.selected) renderPanel(); return state.t; })()`;

const SIM_TO_ENDEX =
  `(() => { let g = 0; while (!state.endShown && g++ < 400000) stepSim(CONFIG.SIM_DT);` +
  ` document.getElementById("simclock").textContent = fmtT(state.t);` +
  ` document.getElementById("phase").textContent = state.phase; draw(); return state.endShown; })()`;

const DASH_CARD = (re: string) =>
  `(() => { const c = [...document.querySelectorAll("main .card")].find((c) => ${re}.test((c.querySelector("h2") || {}).textContent || ""));` +
  ` if (!c) return null; c.scrollIntoView({ block: "start" }); const b = c.getBoundingClientRect();` +
  ` return { x: b.left, y: b.top, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight }; })()`;

// The ALL EVIDENCE fold (<details id="evidence">) hides dose response,
// histograms, notable engagements and provenance until opened. Full-window
// shots keep it closed, as a user sees the page; clips of the cards inside
// it open it first. Its state is static skeleton, so it survives dataset
// switches.
const DASH_EVIDENCE = (open: boolean) =>
  `(() => { const d = document.getElementById("evidence"); if (!d) return false; d.open = ${open}; return true; })()`;
const DASH_FINDING_HAS = (needle: string) => `document.getElementById("finding").textContent.includes(${JSON.stringify(needle)})`;
const openEvidence = async (c: Ctx): Promise<void> => {
  await c.js(DASH_EVIDENCE(true));
  await c.waitFor(`document.querySelector("#evidence svg") !== null`, 20000);
  await sleep(100);
};
const closeEvidence = async (c: Ctx): Promise<void> => {
  await c.js(DASH_EVIDENCE(false));
  await c.js(`scrollTo(0, 0)`);
  await sleep(100);
};

const DASH_SELECT = (needle: string) =>
  `(() => { const s = document.getElementById("dataset"); const o = [...s.options].find((o) => o.textContent.includes(${JSON.stringify(needle)}));` +
  ` if (!o) return false; s.value = o.value; s.dispatchEvent(new Event("change")); return true; })()`;

const DASH_PROV_HAS = (needle: string) => `document.getElementById("prov").textContent.includes(${JSON.stringify(needle)})`;

const WALKTHROUGH_LABEL = "DF bearing error doubled";
const WALKTHROUGH_OVERRIDES = `{"CUAS":{"BRG_SIGMA_DEG":8}}`;

/*
 * dashboard.html only reveals #content after every card is rendered, yet a
 * committed dashboard-overview once caught the "Loading results…"
 * placeholder with an empty page: the frame on screen can lag the DOM the
 * waits inspect. So readiness demands the visible artifacts themselves —
 * placeholder hidden, content revealed, a chart svg in the DOM, the
 * walkthrough sweep's provenance — and the first shot re-asserts all of it
 * right before capturing instead of trusting the group ready() from
 * moments earlier.
 */
const dashReady = async (c: Ctx): Promise<void> => {
  await c.waitFor(`document.getElementById("status").hidden`, 20000);
  await c.waitFor(`!document.getElementById("content").hidden`, 20000);
  await c.waitFor(`document.querySelectorAll("#tiles .tile").length >= 3`, 20000);
  await c.waitFor(`document.querySelector("#charts .card svg") !== null`, 20000);
  // Newest manifest entry loads by default — the walkthrough sweep just
  // written — and the finding names it.
  await c.waitFor(DASH_PROV_HAS(WALKTHROUGH_LABEL), 20000);
  await c.waitFor(DASH_FINDING_HAS(WALKTHROUGH_LABEL), 20000);
};

function buildGroups(hidden: boolean): Group[] {
  const winOpts = { show: false, backgroundThrottling: false };
  const place = (win: BrowserWindow, w: number, h: number): BrowserWindow => {
    win.setResizable(false);
    win.setContentSize(w, h);
    win.setPosition(0, 0);
    if (!hidden) win.showInactive();
    return win;
  };
  const ui = (w: number, h: number, url: string) => () => place(openAppUrl(url, winOpts), w, h);
  const panel = (name: string) => () => {
    const win = openAppPanel(name, winOpts);
    if (win === null) throw new Error(`unknown panel ${name}`);
    return place(win, 1100, 780);
  };

  // Live Ops state shared across that group's shots.
  let livePort = 0;
  let sender: ExternalTrackSender | null = null;

  return [
    {
      name: "shell",
      width: 860,
      height: 640,
      open: () => place(createShellWindow(winOpts), 860, 640),
      ready: async (c) => {
        await c.waitFor(`document.getElementById("version").textContent.startsWith("app ")`);
        await c.waitFor(`/RUNNING/.test(document.getElementById("st-mcp-text").textContent)`);
      },
      shots: [
        { id: "shell-launcher", caption: "The launcher window: six tiles, the launch bar, the status strip, and the version footer." },
        {
          id: "shell-tactical",
          caption: "Launch bar with MODE set to tactical.",
          setup: (c) => c.setVal("#mode", "tactical"),
          clip: (c) => c.rectOf(".launch", 6),
        },
      ],
    },
    {
      name: "mcp",
      width: 1100,
      height: 780,
      open: panel("mcp"),
      ready: (c) =>
        c.waitFor(
          `/RUNNING/.test(document.getElementById("status").textContent) && document.getElementById("snippet-cli").textContent.length > 0`,
        ),
      shots: [
        {
          id: "mcp-running",
          caption: "The MCP Endpoint panel with the endpoint RUNNING and both copy-paste snippets (placeholder token).",
          // The panel masks the token by default; the figure shows the placeholder.
          setup: (c) => c.click("#show-token"),
        },
      ],
    },
    {
      name: "studies",
      width: 1100,
      height: 780,
      open: panel("studies"),
      ready: async (c) => {
        await c.waitFor(`document.getElementById("status").textContent === "idle"`);
        // The DATASETS box has listed the seeded store (3 bundled entries).
        await c.waitFor(`document.querySelectorAll("#ds-list .ds-row").length >= 3`);
      },
      shots: [
        { id: "studies-idle", caption: "The Studies panel before any run." },
        {
          id: "studies-refused-label",
          caption: "Refusals appear in the log: RUN PARALLEL with an empty label.",
          setup: async (c) => {
            await c.click("#sw-run");
            await c.waitFor(`/refused: a label is required/.test(document.getElementById("log").textContent)`);
          },
        },
        {
          id: "studies-overrides-filled",
          caption: "The guided exercise filled in: label, 1000 seeds, orbit, and the bearing-error override.",
          setup: async (c) => {
            await c.js(`document.getElementById("log").innerHTML = ""`);
            // Typed, not poked: the input events clear the previous shot's
            // field error and run the override check, as they do for a user.
            await c.setVal("#sw-label", WALKTHROUGH_LABEL);
            await c.setVal("#sw-start", "1");
            await c.setVal("#sw-count", "1000");
            await c.setVal("#sw-overrides", WALKTHROUGH_OVERRIDES);
            await c.waitFor(`/1 override OK/.test(document.getElementById("overrides-status").textContent)`);
          },
        },
        {
          id: "studies-running",
          caption: "A parallel sweep in progress: green status, progress bar, CANCEL enabled.",
          timeoutMs: 120000,
          setup: async (c) => {
            await c.click("#sw-run");
            const deadline = Date.now() + 90000;
            for (;;) {
              const mid = await c.js<boolean>(
                `(p => !p.hidden && p.value > 0 && p.value < p.max)(document.getElementById("progress"))`,
              );
              if (mid) return;
              if (!studyStatus().running) {
                const done = await c.js<boolean>(`/finished with exit code/.test(document.getElementById("log").textContent)`);
                if (done) throw new SkipShot("sweep finished before a mid-run progress frame could be captured");
              }
              if (Date.now() > deadline) throw new Error("no progress frame within 90 s");
              await sleep(20);
            }
          },
        },
        {
          id: "studies-finished",
          caption: "The finished sweep: the headline with its delta against the stock study and OPEN IN DASHBOARD, then the answer-key line and the exit code in the log.",
          timeoutMs: 240000,
          setup: async (c) => {
            await poll(async () => studyStatus().running, (r) => r === false, 200000, 250);
            await c.waitFor(`/finished with exit code 0/.test(document.getElementById("log").textContent)`, 20000);
            // The headline paints once the DATASETS refresh after study-done lands.
            await c.waitFor(`document.getElementById("dataset-headline").textContent.includes("Δ")`, 20000);
          },
        },
        {
          id: "studies-datasets",
          caption: "The DATASETS box opened after the sweep: every manifest entry with its headline numbers and OPEN, RENAME, EXPORT, REVEAL and DELETE.",
          setup: async (c) => {
            await c.js(`(() => { document.getElementById("ds-details").open = true; return true; })()`);
            // The box refreshed on study-done: the walkthrough sweep tops the list.
            await c.waitFor(
              `document.querySelectorAll("#ds-list .ds-row").length >= 4 && document.getElementById("ds-list").textContent.includes(${JSON.stringify(WALKTHROUGH_LABEL)})` +
                ` && document.querySelectorAll("#ds-list .ds-headline").length >= 3`,
            );
          },
          clip: (c) => c.rectOf("#datasets-box", 6),
        },
      ],
    },
    {
      name: "dashboard",
      width: 1440,
      height: 920,
      open: ui(1440, 920, "app://ui/dashboard.html"),
      ready: dashReady,
      shots: [
        {
          id: "dashboard-overview",
          caption: "The Dashboard right after the exercise: the finding for your ad-hoc dataset, its tiles, and the vs-stock card.",
          setup: async (c) => {
            await dashReady(c);
            await closeEvidence(c);
          },
        },
        {
          id: "dashboard-finding",
          caption: "The finding for the doubled-bearing-error sweep: verdict, deltas against the stock study, the override that was changed.",
          clip: (c) => c.rectOf("#finding", 8),
        },
        { id: "dashboard-tiles-adhoc", caption: "Summary tiles for the doubled-bearing-error sweep, each with its delta against the stock study.", clip: (c) => c.rectOf("#tiles", 8) },
        {
          id: "dashboard-vs-baseline",
          caption: "VS STOCK BASELINE: hollow = the stock study, filled = this sweep, one dumbbell per outcome.",
          clip: (c) => c.rectJs(DASH_CARD("/vs stock/i"), 8),
        },
        {
          id: "dashboard-seeds",
          caption: "Notable engagements (under ALL EVIDENCE) — WATCH opens the exact battle behind a statistic.",
          setup: openEvidence,
          clip: (c) => c.rectOf("#seedsCard", 8),
        },
        {
          id: "dashboard-provenance",
          caption: "Provenance footer for an ad-hoc dataset: overrides echoed and the reproduction command.",
          clip: (c) => c.rectOf("#prov", 8),
        },
        {
          id: "dashboard-tiles-full",
          caption: "Summary tiles for the bundled full study — the baseline for comparison.",
          setup: async (c) => {
            if (!(await c.js<boolean>(DASH_SELECT("Full study")))) throw new Error("Full study option not found");
            await c.waitFor(DASH_PROV_HAS("monte-carlo.json"));
          },
          clip: (c) => c.rectOf("#tiles", 8),
        },
        {
          id: "dashboard-finding-full",
          caption: "The finding for the full study: the baseline, one clause per paired experiment, the dose sweep and the time-to-fix gap.",
          clip: (c) => c.rectOf("#finding", 8),
        },
        { id: "dashboard-full-overview", caption: "The Dashboard with the full study selected: finding, tiles, paired comparisons, ALL EVIDENCE closed.", setup: closeEvidence },
        {
          id: "dashboard-dose",
          caption: "Dose response (under ALL EVIDENCE): win rate versus OPFOR uplink duty cycle, with 95% CI whiskers.",
          setup: openEvidence,
          clip: (c) => c.rectJs(DASH_CARD("/dose/i"), 8),
        },
        {
          id: "dashboard-tooltip",
          caption: "Hovering a point shows the cell's duty cycle, win rate, CI, and n.",
          setup: async (c) => {
            await c.js(
              `(() => { const card = [...document.querySelectorAll("main .card")].find((c) => /dose/i.test((c.querySelector("h2") || {}).textContent || ""));` +
                ` card.scrollIntoView({ block: "start" }); const dots = [...card.querySelectorAll("svg circle")]; const dot = dots[Math.min(5, dots.length - 1)];` +
                ` const b = dot.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2;` +
                ` const target = document.elementFromPoint(x, y) || dot;` +
                ` for (const type of ["mouseenter", "mouseover", "mousemove"]) target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));` +
                ` return true; })()`,
            );
            await sleep(150);
          },
          clip: (c) => c.rectJs(DASH_CARD("/dose/i"), 8),
        },
        {
          id: "dashboard-paired",
          caption: "Paired comparisons: hollow = stock, filled = variant, same 2,000 seeds.",
          setup: (c) => c.js(`(() => { const t = document.getElementById("tooltip"); if (t) { t.style.display = "none"; } return true; })()`).then(() => undefined),
          clip: (c) => c.rectJs(DASH_CARD("/paired/i"), 8),
        },
        { id: "dashboard-histograms", caption: "Baseline timelines: time-to-fix per side and time-to-kill, 60 s bins.", clip: (c) => c.rectJs(DASH_CARD("/timeline|histogram|distribution/i"), 8) },
        {
          id: "dashboard-adhoc-only",
          caption: "SHOW → AD-HOC ONLY lists only sweeps; yours sits beside the bundled 8° dataset.",
          setup: async (c) => {
            await c.setVal("#kindFilter", "adhoc", true);
            await c.waitFor(DASH_PROV_HAS(WALKTHROUGH_LABEL));
            await closeEvidence(c);
          },
        },
        {
          id: "dashboard-tactical",
          caption: "A tactical dataset: the strikes clause and tile, and the reserve-hunter row in the paired card.",
          setup: async (c) => {
            await c.setVal("#kindFilter", "all", true);
            await c.waitFor(`document.getElementById("dataset").options.length >= 3`);
            if (!(await c.js<boolean>(DASH_SELECT("Tactical study")))) throw new Error("Tactical study option not found");
            await c.waitFor(DASH_PROV_HAS("monte-carlo-tactical.json"));
            await closeEvidence(c);
          },
        },
        { id: "dashboard-tactical-paired", caption: "Tactical paired comparisons including 'No reserve hunter'.", clip: (c) => c.rectJs(DASH_CARD("/paired/i"), 8) },
        {
          id: "dashboard-header",
          caption: "SHOW filter, DATASET selector, and the two header links.",
          setup: (c) => c.js(`scrollTo(0, 0)`).then(() => undefined),
          clip: (c) =>
            c.rectJs(
              `(() => { const k = document.getElementById("kindFilter"); const el = k.closest("header") || k.closest("nav") || k.parentElement.parentElement || k.parentElement;` +
                ` const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight }; })()`,
              0,
            ),
        },
      ],
    },
    {
      name: "sim",
      width: 1440,
      height: 920,
      open: ui(1440, 920, "app://ui/index.html?seed=20260719"),
      ready: (c) => c.waitFor(SIM_READY, 15000),
      shots: [
        { id: "sim-emplacement", caption: "The Simulation window at T+00:00 — Phase I, Emplacement." },
        { id: "sim-controls", caption: "Controls: Play/Reset, speed, Mode, Scenario, Map Layers, SEED and Random.", clip: (c) => c.rectOf("#ctrlsec", 6) },
        {
          id: "sim-search-collect",
          caption: "T+01:00 — both drones airborne, the first lines of bearing collected.",
          setup: (c) => c.js(simAdvance(60)).then(() => undefined),
        },
        {
          id: "sim-rf-coverage",
          caption: "RF Coverage rings show each DF node's maximum detection range.",
          setup: async (c) => {
            await c.js(
              `(() => { const t = document.getElementById("tglRF"); t.checked = true; t.dispatchEvent(new Event("change", { bubbles: true })); draw(); return true; })()`,
            );
          },
        },
        {
          id: "sim-fix-lobs-ellipses",
          caption: "T+03:00 — Phase III: LOBs crossing on the enemy GCS and the error ellipse with its CEP.",
          setup: async (c) => {
            await c.js(
              `(() => { const t = document.getElementById("tglRF"); t.checked = false; t.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`,
            );
            await c.js(simAdvance(180));
          },
        },
        { id: "sim-hud", caption: "Status HUD cards: drone state, battery, LOBs held, fix CEP.", clip: async (c) => { const r = await c.rectOf("#mapwrap", 0); return { ...r, height: Math.min(r.height, 210) }; } },
        { id: "sim-event-log", caption: "The Event Log narrates the engagement in message-traffic style.", clip: (c) => c.rectOf("#logsec", 6) },
        {
          id: "sim-unit-detail-drone",
          caption: "Unit Detail for the BLUFOR drone (click any unit on the map).",
          setup: (c) =>
            c
              .js(
                `(() => { const T = state.teams.BLUFOR; const d = teamDrones(T)[0]; state.selected = { type: "drone", side: "BLUFOR", id: d.id }; renderPanel(); draw(); return d.id; })()`,
              )
              .then(() => undefined),
          clip: (c) => c.rectOf("#detail", 6),
        },
        {
          id: "sim-unit-detail-gcs",
          caption: "Unit Detail for the OPFOR ground control station.",
          setup: (c) =>
            c
              .js(
                `(() => { const T = state.teams.OPFOR; state.selected = { type: "gcs", side: "OPFOR", id: T.gcs.id }; renderPanel(); draw(); return T.gcs.id; })()`,
              )
              .then(() => undefined),
          clip: (c) => c.rectOf("#detail", 6),
        },
        {
          id: "sim-attack",
          caption: "T+04:50 — Phase IV: the BLUFOR drone committed and inbound on the fix.",
          setup: async (c) => {
            await c.js(`(() => { state.selected = null; renderPanel(); return true; })()`);
            await c.js(simAdvance(290));
          },
        },
        {
          id: "sim-endex",
          caption: "ENDEX overlay after the strike: Replay the same seed or pick a Random one.",
          setup: async (c) => {
            const shown = await c.js<boolean>(SIM_TO_ENDEX);
            if (!shown) throw new Error("ENDEX card did not appear");
            await sleep(100);
          },
        },
      ],
    },
    {
      name: "sim-tactical",
      width: 1440,
      height: 920,
      open: ui(1440, 920, "app://ui/index.html?seed=12&mode=tactical"),
      ready: (c) => c.waitFor(SIM_READY, 15000),
      shots: [
        {
          id: "sim-tactical",
          caption: "Tactical mode, seed 12 at T+04:00: the objective ring, sortie packages in flight, hunter-killer held back.",
          setup: (c) => c.js(simAdvance(240)).then(() => undefined),
        },
      ],
    },
    {
      name: "viewer3d",
      width: 1440,
      height: 920,
      open: ui(1440, 920, "app://ui/viewer3d.html?seed=20260719"),
      ready: async (c) => {
        await c.waitFor(`window.__test !== undefined`, 20000);
      },
      shots: [
        {
          id: "viewer3d-default",
          caption: "The 3D Viewer at T+03:00: terrain in relief, drones at altitude, LOBs and ellipses draped on the ground.",
          format: "jpeg",
          setup: async (c) => {
            const gpu = await c.js<boolean>(`__test.gpuOk()`);
            if (!gpu) throw new SkipShot("no WebGPU adapter on this machine");
            // The viewer's own state lives in a module scope; its engine is
            // shared through window.__test.engine, and the render loop draws
            // whatever that engine's state is, so step it directly.
            await c.js(
              `(() => { const E = __test.engine; let g = 0; while (E.state.t < 180 && g++ < 400000) E.stepSim(E.CONFIG.SIM_DT); return E.state.t; })()`,
            );
            await sleep(500);
          },
        },
        {
          id: "viewer3d-detectability",
          caption: "Detectability Field: where a BLUFOR uplink would be heard by OPFOR's DF nodes.",
          format: "jpeg",
          setup: async (c) => {
            if (!(await c.js<boolean>(`__test.gpuOk()`))) throw new SkipShot("no WebGPU adapter on this machine");
            await c.setVal("#detsel", "1", true);
            await sleep(500);
          },
        },
        {
          id: "viewer3d-controls",
          caption: "Viewer controls: Cam reset, Scene Layers, Detectability Field.",
          setup: async (c) => {
            if (!(await c.js<boolean>(`__test.gpuOk()`))) throw new SkipShot("no WebGPU adapter on this machine");
          },
          clip: (c) => c.rectOf("#ctrlsec", 6),
        },
        {
          id: "viewer3d-fallback",
          caption: "Without WebGPU the viewer explains itself; the 2D sim shows the same engagement.",
          setup: async (c) => {
            if (await c.js<boolean>(`__test.gpuOk()`)) throw new SkipShot("WebGPU available — fallback card not shown on this machine");
          },
          clip: (c) => c.rectOf("#msg", 10),
        },
      ],
    },
    {
      name: "live-ops",
      width: 1100,
      height: 780,
      open: panel("live-ops"),
      ready: async (c) => {
        await c.waitFor(`document.getElementById("phase").textContent === "idle"`);
        await c.waitFor(`!/checking/.test(document.getElementById("gateway").textContent)`);
      },
      shots: [
        { id: "live-ops-idle", caption: "Live Ops before a session: no gateway staged, sessions run app-local." },
        {
          id: "live-ops-setup",
          caption: "SETUP opened: the bearing-error override checked against the parameter table, and the sim-time limit.",
          setup: async (c) => {
            await c.js(`(() => { document.getElementById("setup").open = true; return true; })()`);
            await c.setVal("#overrides", WALKTHROUGH_OVERRIDES);
            await c.waitFor(`/1 override OK/.test(document.getElementById("overrides-status").textContent)`);
          },
          clip: (c) => c.rectOf("#setup", 8),
        },
        {
          id: "live-ops-stage-refused",
          caption: "A typo in the gateway JSON is refused with the exact path.",
          setup: async (c) => {
            // Fold SETUP away again so the later full-window shots show the panel as it opens.
            await c.setVal("#overrides", "");
            await c.js(`(() => { document.getElementById("setup").open = false; return true; })()`);
            await c.setVal("#gateway-cfg", `{"netwok":{"mode":"broadcast","port":3000}}`, false);
            await c.click("#stage");
            await c.waitFor(`/refused:/.test(document.getElementById("gateway").textContent)`);
          },
          clip: (c) => c.rectOf("#gateway-box", 6),
        },
        {
          id: "live-ops-staged",
          caption: "A valid config staged for the next session.",
          setup: async (c) => {
            await c.setVal("#gateway-cfg", GATEWAY_DEFAULT_TEXT, false);
            await c.click("#stage");
            await c.waitFor(`/configured for next session/.test(document.getElementById("gateway").textContent)`);
          },
          clip: (c) => c.rectOf("#gateway-box", 6),
        },
        {
          id: "live-ops-gateway-form",
          caption: "FORM: the same configuration as fields — every key with its default, range and meaning; edits keep the JSON in step.",
          setup: async (c) => {
            await c.click("#gateway-view");
            await c.waitFor(
              `!document.getElementById("gateway-form").hidden && document.querySelectorAll("#gateway-form .gw-sec").length >= 10`,
            );
            await c.waitFor(`/all keys OK/.test(document.getElementById("gateway-form-note").textContent)`);
            // ANCHOR opened itself (2 changed keys); open NETWORK too so the figure shows fields.
            await c.js(`(() => { document.querySelector("#gateway-form .gw-sec").open = true; return true; })()`);
          },
          clip: (c) => c.rectOf("#gateway-box", 6),
        },
        {
          id: "live-ops-running",
          caption: "A gateway-armed session at 1×: entities, events, and PDU counters climbing.",
          timeoutMs: 90000,
          setup: async (c) => {
            // Back to the JSON view so the later editor shots match the panel as it opens.
            await c.click("#gateway-view");
            await c.waitFor(`document.getElementById("gateway-form").hidden`);
            livePort = await freeUdpPort();
            const started = liveStart({
              seed: 20260719,
              mode: "orbit",
              speed: 8,
              maxSimS: 3600,
              gateway: {
                network: { mode: "unicast", unicastDestinations: ["127.0.0.1"], port: livePort },
                anchor: { lat0Deg: 21.35, lon0Deg: -157.95, h0M: 0, rotationDeg: 0, geoidOffsetM: 0 },
              },
            });
            if (!started.ok) throw new Error(started.error);
            await poll(async () => liveStatus().t ?? 0, (t) => t >= 75, 60000, 100);
            liveSetSpeed(1);
            await sleep(500);
            await c.waitFor(`/at 1x/.test(document.getElementById("gateway").textContent)`, 5000).catch(() => undefined);
          },
        },
        {
          id: "live-ops-overlay-track",
          caption: "An external DIS entity received on the wire renders as a gray diamond overlay (peers 1 · overlay 1).",
          setup: async () => {
            sender = new ExternalTrackSender(livePort);
            sender.start();
            await poll(async () => liveGatewayStatus().externalTracks ?? 0, (n) => n >= 1, 15000, 200);
            await sleep(600);
          },
        },
        { id: "live-ops-gateway-crop", caption: "The GATEWAY box while publishing.", clip: (c) => c.rectOf("#gateway-box", 6) },
        { id: "live-ops-entities-crop", caption: "The ENTITIES table: id, kind, state, battery, speed, altitude, emitters keyed.", clip: (c) => c.rectOf("#entities-box", 6) },
        {
          id: "live-ops-paused",
          caption: "PAUSE holds the sim clock; the button becomes RESUME.",
          setup: async (c) => {
            if (!livePause()) throw new Error("pause refused");
            await poll(async () => liveStatus().state, (s) => s === "paused", 5000, 100);
            await c.waitFor(`/PAUSED/.test(document.getElementById("phase").textContent)`, 5000);
          },
          clip: (c) => c.rectOf("header", 6),
        },
        {
          id: "live-ops-endex",
          caption: "ENDEX: the outcome and reason in the header and as the last SYS event.",
          timeoutMs: 180000,
          setup: async (c) => {
            liveResume();
            liveSetSpeed(8); // stays under publish.maxSpeedFactor, so the GATEWAY box carries no warning
            await liveWaitForEnd(150000);
            await c.waitFor(`/ENDEX/.test(document.getElementById("phase").textContent)`, 10000);
            await sleep(300);
          },
        },
      ],
      close: async () => {
        sender?.stop();
        sender = null;
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* runner                                                              */

function log(line: string): void {
  console.log(`SHOT ${line}`);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function runScreenshots(): Promise<number> {
  const outDir = argValue("screenshots") || path.join(appRoot, "docs", "manual", "images");
  const only = argList("only");
  const skip = argList("skip");
  const hidden = argValue("hidden") !== null;
  mkdirSync(outDir, { recursive: true });

  const mcp = mcpHostStatus();
  if (!mcp.running) {
    console.error(
      `SCREENSHOTS abort: MCP host is not running (${mcp.lastError ?? "unknown"}). Close any running FPV Sim (it holds port ${mcp.port}) and retry.`,
    );
    return 2;
  }

  const records: ShotRecord[] = [];
  let failures = 0;
  let order = 0;
  const groups = buildGroups(hidden);
  const selected = (g: Group, s: Shot) => (only.size === 0 || only.has(s.id) || only.has(g.name)) && !skip.has(s.id);

  for (const group of groups) {
    if (skip.has(group.name)) continue;
    if (only.size > 0 && !group.shots.some((s) => selected(group, s))) continue;
    let win: BrowserWindow | null = null;
    try {
      win = group.open();
      const ctx = makeCtx(win);
      await withTimeout(loaded(win), 20000, `${group.name} load`);
      await ctx.settle();
      if (group.ready) await withTimeout(group.ready(ctx), 30000, `${group.name} ready`);
      for (const shot of group.shots) {
        order++;
        const rec: ShotRecord = {
          id: shot.id,
          group: group.name,
          order,
          file: null,
          width: null,
          height: null,
          bytes: null,
          sha256: null,
          caption: shot.caption,
          skipped: null,
          error: null,
        };
        records.push(rec);
        try {
          if (shot.setup) await withTimeout(shot.setup(ctx), shot.timeoutMs ?? 60000, shot.id);
          if (!selected(group, shot)) {
            rec.skipped = "not selected";
            log(`skip ${shot.id} — not selected`);
            continue;
          }
          await ctx.settle();
          const rect = shot.clip ? await shot.clip(ctx) : null;
          if (rect !== null) await ctx.settle();
          const img = rect === null ? await win.webContents.capturePage() : await win.webContents.capturePage(rect);
          const size = img.getSize();
          const expected = rect ?? { width: group.width, height: group.height };
          if (size.width !== expected.width || size.height !== expected.height) {
            throw new Error(`captured ${size.width}x${size.height}, expected ${expected.width}x${expected.height}`);
          }
          const ext = shot.format === "jpeg" ? "jpg" : "png";
          const buf = shot.format === "jpeg" ? img.toJPEG(88) : img.toPNG();
          const file = `${shot.id}.${ext}`;
          writeFileSync(path.join(outDir, file), buf);
          rec.file = file;
          rec.width = size.width;
          rec.height = size.height;
          rec.bytes = buf.length;
          rec.sha256 = createHash("sha256").update(buf).digest("hex");
          log(`ok ${shot.id} ${size.width}x${size.height} ${buf.length} B`);
        } catch (err) {
          if (err instanceof SkipShot) {
            rec.skipped = err.message;
            log(`skip ${shot.id} — ${err.message}`);
          } else {
            failures++;
            rec.error = err instanceof Error ? err.message : String(err);
            log(`FAIL ${shot.id} — ${rec.error}`);
          }
        }
      }
    } catch (err) {
      failures++;
      const message = err instanceof Error ? err.message : String(err);
      log(`FAIL group ${group.name} — ${message}`);
      records.push({
        id: `${group.name}:group`,
        group: group.name,
        order: ++order,
        file: null,
        width: null,
        height: null,
        bytes: null,
        sha256: null,
        caption: "",
        skipped: null,
        error: message,
      });
    } finally {
      if (group.close) await group.close().catch(() => undefined);
      if (win !== null && !win.isDestroyed()) win.destroy();
    }
  }

  const enginePkg = readJson<{ version?: string }>(path.join(engineRoot(), "package.json"), {});
  const manifest = {
    generated: new Date().toISOString(),
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    engineVersion: enginePkg.version ?? "unknown",
    pins: readJson<unknown>(pinsFile(), null),
    scale: Number(argValue("scale") || "1"),
    shots: records,
  };
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const ok = records.filter((r) => r.file !== null).length;
  const skipped = records.filter((r) => r.skipped !== null).length;
  console.log(
    `SCREENSHOTS RESULT ${failures === 0 ? "PASS" : "FAIL"} — ${ok} captured, ${skipped} skipped, ${failures} failed → ${outDir}`,
  );
  return failures === 0 ? 0 : 1;
}

export async function screenshotsAndExit(): Promise<void> {
  const watchdog = setTimeout(() => {
    console.error("SCREENSHOTS watchdog: 8 minutes exceeded");
    app.exit(2);
  }, 480000);
  watchdog.unref();
  let code = 1;
  try {
    code = await runScreenshots();
  } catch (err) {
    console.error("SCREENSHOTS crashed:", err);
  }
  if (argValue("keep-scratch") === null && scratchDir !== "") {
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    try {
      rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      /* Chromium may still hold a cache file; the next run wipes it at boot */
    }
  }
  app.exit(code);
}
