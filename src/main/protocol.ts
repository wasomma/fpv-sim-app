/*
 * app:// protocol — serves the vendored fpv-sim UI and the app's own
 * renderer pages from one privileged origin, so every relative reference
 * in the unmodified upstream files keeps working:
 *
 *   app://ui/index.html?seed=N&play=1&mode=tactical   the sim
 *   app://ui/dashboard.html                           fetches results/index.json
 *   app://ui/results/<file>                           -> writable userData results dir
 *   app://ui/viewer3d.html                            fetches index.html at runtime
 *   app://app/shell/index.html                        app panels
 *
 * The scheme is registered standard+secure (WebGPU needs a secure
 * context) with fetch support (dashboard/viewer3d use fetch).
 */

import { protocol } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { rendererRoot, resultsDir, uiRoot } from "./paths.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

/** Must run before app.whenReady(). */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/** Resolve an app:// URL to a filesystem path, or null if out of bounds. */
export function resolveAppUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;

  let root: string;
  let rel: string;
  if (url.host === "ui") {
    if (pathname === "/" || pathname === "") pathname = "/index.html";
    if (pathname.startsWith("/results/")) {
      root = resultsDir();
      rel = pathname.slice("/results/".length);
    } else {
      root = uiRoot();
      rel = pathname.slice(1);
    }
  } else if (url.host === "app") {
    root = rendererRoot();
    rel = pathname === "/" || pathname === "" ? "shell/index.html" : pathname.slice(1);
  } else {
    return null;
  }

  const resolved = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return null; // traversal attempt
  }
  return resolved;
}

/** Must run after app.whenReady(). */
export function installAppProtocol(): void {
  protocol.handle("app", async (request) => {
    const file = resolveAppUrl(request.url);
    if (file === null) {
      return new Response("bad request", { status: 400 });
    }
    try {
      const body = await fs.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      return new Response(body, { status: 200, headers: { "Content-Type": type } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}
