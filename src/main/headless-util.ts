/*
 * Small async helpers shared by the headless modes (--self-check and
 * --screenshots): window-load awaiting, polling with a deadline, and
 * timeouts. No Electron state of their own.
 */

import type { BrowserWindow } from "electron";

/** Resolves on did-finish-load, rejects on did-fail-load. Attach before loading finishes. */
export async function loaded(win: BrowserWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    win.webContents.once("did-finish-load", () => resolve());
    win.webContents.once("did-fail-load", (_e, code, desc) => reject(new Error(`load failed: ${code} ${desc}`)));
  });
}

/** Calls fn until ok(value) holds or the deadline passes (throws with the last value). */
export async function poll<T>(
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
    await sleep(intervalMs);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Rejects with a named error if p does not settle within ms. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
