/*
 * Electron-free window layout rules: where a remembered window may come
 * back, how big a window may be on the current displays, and what an
 * upstream page's window should be called. Unit-tested; windows.ts feeds
 * it the live display list.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedBounds extends Rect {
  maximized?: boolean;
}

export interface SizeSpec {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface Placement {
  /** Absent when the window should be centered by the OS. */
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** How much of a remembered window must still be on some display to reuse its position. */
const VISIBLE_MIN_PX = 100;

function isFiniteInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isSavedBounds(v: unknown): v is SavedBounds {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    isFiniteInt(b.x) &&
    isFiniteInt(b.y) &&
    isFiniteInt(b.width) &&
    isFiniteInt(b.height) &&
    b.width > 0 &&
    b.height > 0 &&
    (b.maximized === undefined || typeof b.maximized === "boolean")
  );
}

function intersection(a: Rect, b: Rect): { width: number; height: number } {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, w), height: Math.max(0, h) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Decide the placement for a window of `spec` given what was remembered
 * (if anything) and the work areas of the current displays.
 *
 * - Size: the remembered size, else the default; never below the spec
 *   minimum and never above the target display's work area (the minimum
 *   yields to a display smaller than it).
 * - Position: kept only when at least VISIBLE_MIN_PX² of the remembered
 *   window still lands on some display; the window is then nudged fully
 *   into that display. Otherwise no position is returned and the caller
 *   lets the OS center it on the primary display.
 */
export function fitBounds(saved: SavedBounds | undefined, displays: Rect[], primary: Rect, spec: SizeSpec): Placement {
  let target = primary;
  let usePosition = false;
  if (saved !== undefined) {
    let best: { d: Rect; area: number } | null = null;
    for (const d of displays) {
      const i = intersection(saved, d);
      if (i.width >= VISIBLE_MIN_PX && i.height >= VISIBLE_MIN_PX) {
        const area = i.width * i.height;
        if (best === null || area > best.area) best = { d, area };
      }
    }
    if (best !== null) {
      target = best.d;
      usePosition = true;
    }
  }

  const maxW = Math.max(1, target.width);
  const maxH = Math.max(1, target.height);
  const minW = Math.min(spec.minWidth, maxW);
  const minH = Math.min(spec.minHeight, maxH);
  const width = clamp(Math.round(saved?.width ?? spec.width), minW, maxW);
  const height = clamp(Math.round(saved?.height ?? spec.height), minH, maxH);

  const placement: Placement = { width, height, maximized: saved?.maximized === true };
  if (usePosition && saved !== undefined) {
    placement.x = clamp(Math.round(saved.x), target.x, target.x + target.width - width);
    placement.y = clamp(Math.round(saved.y), target.y, target.y + target.height - height);
  }
  return placement;
}

/** Which upstream page an app://ui/ URL shows, or null for anything else. */
export function uiKindForUrl(url: string): "sim" | "dashboard" | "viewer3d" | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "app:" || u.host !== "ui") return null;
  const file = u.pathname.replace(/^\/+/, "") || "index.html";
  if (file === "index.html") return "sim";
  if (file === "dashboard.html") return "dashboard";
  if (file === "viewer3d.html") return "viewer3d";
  return null;
}

/** Window title for an upstream page, carrying the seed and mode it was opened with. */
export function titleForUiUrl(url: string): string {
  const kind = uiKindForUrl(url);
  if (kind === null) return "FPV Sim";
  const params = new URL(url).searchParams;
  const seed = params.get("seed");
  const mode = params.get("mode") === "tactical" ? "tactical" : "orbit";
  if (kind === "sim") return `Simulation · ${seed !== null ? `seed ${seed} ` : ""}(${mode}) — FPV Sim`;
  if (kind === "viewer3d") return `3D Viewer${seed !== null ? ` · seed ${seed}` : ""} — FPV Sim`;
  return "Dashboard — FPV Sim";
}
