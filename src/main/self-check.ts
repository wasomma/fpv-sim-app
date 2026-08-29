/*
 * Headless smoke test: `electron . --self-check`.
 *
 * Proves, from the app itself, that the Phase-1 contract holds: the
 * app:// protocol serves the vendored pages, the sim engine actually
 * ticks under a deep link, the dashboard finds the seeded results store
 * through the same origin, and viewer3d loads (WebGPU availability is
 * reported, not required — CI runners often lack a GPU). Exits 0 on
 * pass, 1 on fail; output is plain lines for CI logs.
 */

import { BrowserWindow, app } from "electron";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runEngagement } from "fpv-sim-mcp/engine";
import { mcpHostStatus } from "./mcp/host.js";
import { resultsDir } from "./paths.js";
import { liveGatewayStatus, liveStart, liveWaitForEnd } from "./sessions/session-manager.js";
import { getSettings } from "./settings.js";
import { startStudy, studyStatus } from "./studies/study-runner.js";
import { openAppUrl } from "./windows.js";

function log(line: string): void {
  console.log(`SELF-CHECK ${line}`);
}

async function loaded(win: BrowserWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    win.webContents.once("did-finish-load", () => resolve());
    win.webContents.once("did-fail-load", (_e, code, desc) => reject(new Error(`load failed: ${code} ${desc}`)));
  });
}

async function poll<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs: number,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  for (;;) {
    last = await fn();
    if (ok(last)) return last;
    if (Date.now() > deadline) throw new Error(`timeout; last value: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function runSelfCheck(): Promise<number> {
  let failures = 0;
  const step = async (name: string, fn: () => Promise<string>) => {
    try {
      const detail = await fn();
      log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
    } catch (err) {
      failures++;
      log(`FAIL ${name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  await step("results store seeded", async () => {
    const manifest = path.join(resultsDir(), "index.json");
    if (!existsSync(manifest)) throw new Error(`missing ${manifest}`);
    return manifest;
  });

  await step("sim engine runs under app://ui deep link", async () => {
    const win = openAppUrl("app://ui/index.html?seed=20260719&play=1", { show: false, backgroundThrottling: false });
    try {
      await loaded(win);
      // Wait for the page's init to finish (engine state exists).
      await poll(
        () => win.webContents.executeJavaScript(`typeof state !== "undefined" && typeof stepSim === "function"`) as Promise<boolean>,
        (v) => v === true,
        10000,
      );
      // ?play=1 honored (deep-link parsing survived the app:// origin).
      const playing = (await win.webContents.executeJavaScript(`state.playing === true`)) as boolean;
      if (!playing) throw new Error("?play=1 not honored — state.playing is false");
      // A hidden, never-shown window throttles requestAnimationFrame to
      // ~1 Hz regardless of backgroundThrottling, so don't wait on the
      // page's own loop: drive the engine directly through its globals.
      const t = (await win.webContents.executeJavaScript(
        `(() => { for (let i = 0; i < 600; i++) stepSim(CONFIG.SIM_DT); return state.t; })()`,
      )) as number;
      if (!(t >= 60)) throw new Error(`state.t only ${t} after 600 driven ticks`);
      const seed = (await win.webContents.executeJavaScript(`state.seed`)) as number;
      if (seed !== 20260719) throw new Error(`deep-linked seed not applied: ${seed}`);
      return `seed ${seed}, playing, state.t ${t.toFixed(1)} s after 600 driven ticks`;
    } finally {
      win.destroy();
    }
  });

  await step("dashboard reads seeded results through app://ui origin", async () => {
    const win = openAppUrl("app://ui/dashboard.html", { show: false, backgroundThrottling: false });
    try {
      await loaded(win);
      const n = (await win.webContents.executeJavaScript(
        `fetch("results/index.json").then((r) => r.json()).then((m) => m.datasets.length)`,
      )) as number;
      if (!(n >= 1)) throw new Error(`manifest lists ${n} datasets`);
      const status = (await win.webContents.executeJavaScript(
        `fetch("results/index.json").then((r) => r.json()).then((m) => fetch("results/" + m.datasets[0].file)).then((r) => r.status)`,
      )) as number;
      if (status !== 200) throw new Error(`first dataset fetch returned ${status}`);
      return `${n} datasets, first dataset fetch 200`;
    } finally {
      win.destroy();
    }
  });

  await step("studies runner spawns app-as-node children", async () => {
    const before = new Set(readdirSync(resultsDir()));
    const started = startStudy({ kind: "adhoc", label: "self check", start: 1, count: 8, mode: "orbit" });
    if (!started.ok) throw new Error(started.error);
    await poll(async () => studyStatus().running, (r) => r === false, 60000, 400);
    const written = readdirSync(resultsDir()).find(
      (f) => f.startsWith("adhoc-self-check-") && !before.has(f),
    );
    if (written === undefined) throw new Error("no dataset written by the ad-hoc child");
    // Clean the probe artifact back out of the user's results store.
    const manifestPath = path.join(resultsDir(), "index.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { datasets: { file: string }[] };
    manifest.datasets = manifest.datasets.filter((d) => d.file !== written);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    rmSync(path.join(resultsDir(), written));
    return `wrote and cleaned ${written}`;
  });

  await step("mcp endpoint serves the batch tools", async () => {
    const status = mcpHostStatus();
    if (!status.running) throw new Error(`host not running: ${status.lastError ?? "unknown"}`);
    const health = await fetch(`http://127.0.0.1:${status.port}/healthz`);
    if (!health.ok) throw new Error(`healthz returned ${health.status}`);
    const unauthorized = await fetch(status.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
    });
    if (unauthorized.status !== 401) throw new Error(`missing token should 401, got ${unauthorized.status}`);
    const init = await fetch(status.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${getSettings().mcp.token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "self-check", version: "0" },
        },
      }),
    });
    if (!init.ok) throw new Error(`initialize returned ${init.status}`);
    const text = await init.text();
    if (!text.includes("fpv-sim-mcp")) throw new Error(`initialize response missing server info: ${text.slice(0, 200)}`);
    // Full tool round-trip. Stateless transport: every POST gets a fresh
    // server, so a bare tools/call is handled on its own (batching was
    // removed from the MCP protocol). The SSE body escapes inner quotes,
    // so match the bare token.
    const call = await fetch(status.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${getSettings().mcp.token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "run_engagement", arguments: { seed: 20260719 } },
      }),
    });
    if (!call.ok) throw new Error(`tools/call returned ${call.status}`);
    const callText = await call.text();
    if (!callText.includes("BLUFOR")) {
      throw new Error(`run_engagement(20260719) did not report the golden outcome: ${callText.slice(0, 800)}`);
    }
    return `healthz ok, 401 without token, initialize ok, run_engagement(20260719) golden on port ${status.port}`;
  });

  await step("live session at 60x replays the batch result exactly", async () => {
    const seed = 66; // featured fast orbit win — short even at real time
    const started = liveStart({ seed, mode: "orbit", speed: 60, maxSimS: 3600 });
    if (!started.ok) throw new Error(started.error);
    const liveResult = await liveWaitForEnd(120000);
    if (liveResult === null) throw new Error("session host died without a result");
    const batch = runEngagement(seed, undefined, { mode: "orbit" });
    const a = JSON.stringify(liveResult);
    const b = JSON.stringify(batch);
    if (a !== b) {
      throw new Error(
        `live buildResult() differs from batch runEngagement() (${a.length} vs ${b.length} chars)`,
      );
    }
    const summary = batch.outcome.result + " at " + batch.duration_s.toFixed(1) + " s";
    return `seed ${seed}: live === batch (${summary}, ${a.length} chars compared)`;
  });

  await step("DIS gateway publishes over loopback UDP inside a live session", async () => {
    const seed = 66;
    const started = liveStart({
      seed,
      mode: "orbit",
      speed: 60,
      maxSimS: 3600,
      gateway: {
        network: { mode: "unicast", unicastDestinations: ["127.0.0.1"], port: 46731 },
        anchor: { lat0Deg: 21.35, lon0Deg: -157.95, h0M: 0, rotationDeg: 0, geoidOffsetM: 0 },
      },
    });
    if (!started.ok) throw new Error(started.error);
    await liveWaitForEnd(120000);
    const g = liveGatewayStatus();
    if (g.tx === undefined || (g.tx.espdu ?? 0) < 50) {
      throw new Error(`too few ESPDUs published: ${JSON.stringify(g.tx)}`);
    }
    if ((g.tx.detonation ?? 0) !== 1) throw new Error(`expected exactly 1 detonation, got ${g.tx.detonation}`);
    if ((g.tx.emission ?? 0) < 10) throw new Error(`too few EE PDUs: ${g.tx.emission}`);
    const rx = g.rx as Record<string, number> | undefined;
    if (rx === undefined || rx.selfHeard !== 1) {
      throw new Error(`gateway did not hear its own traffic on loopback: ${JSON.stringify(rx)}`);
    }
    return `espdu ${g.tx.espdu}, ee ${g.tx.emission}, detonation 1, start/resume ${g.tx.startResume}, self-heard`;
  });

  await step("viewer3d loads (WebGPU reported, not required)", async () => {
    const win = openAppUrl("app://ui/viewer3d.html", { show: false, backgroundThrottling: false });
    try {
      await loaded(win);
      const gpu = (await win.webContents.executeJavaScript(`!!navigator.gpu`)) as boolean;
      return gpu ? "navigator.gpu present" : "navigator.gpu ABSENT (page still loads)";
    } finally {
      win.destroy();
    }
  });

  log(failures === 0 ? "RESULT PASS" : `RESULT FAIL (${failures} failing)`);
  return failures === 0 ? 0 : 1;
}

export function isSelfCheck(): boolean {
  return process.argv.includes("--self-check");
}

export async function selfCheckAndExit(): Promise<void> {
  let code = 1;
  try {
    code = await runSelfCheck();
  } catch (err) {
    console.error("SELF-CHECK crashed:", err);
  }
  app.exit(code);
}
