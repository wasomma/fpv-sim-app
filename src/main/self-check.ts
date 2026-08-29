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
import { existsSync } from "node:fs";
import path from "node:path";
import { resultsDir } from "./paths.js";
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
