/*
 * Engine override validation against fpv-sim-mcp's own parameter table.
 *
 * The engine merges overrides silently (a misspelled key is simply
 * ignored), but its MCP server module ships a strict zod schema plus a
 * flat parameter table (path, default, unit, range, description) that the
 * batch tools validate with. This module loads that same schema — from
 * the installed package, so zod resolves and the copy is the one the MCP
 * tools use — and turns its issues into "path: message" strings in the
 * style of the gateway validator.
 *
 * params.js is not in the package's exports map, so it is resolved
 * relative to the exported server entry and imported by file URL. If that
 * ever fails, validation degrades to a syntax check with a logged warning
 * rather than blocking runs.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface SchemaParam {
  path: string;
  default: number | boolean;
  unit: string;
  range: [number, number] | null;
  integer: boolean;
  boolean?: boolean;
  description: string;
}

export interface SchemaPayload {
  description: string;
  parameters: SchemaParam[];
  not_overridable: { path: string; reason: string }[];
  determinism_note: string;
}

export interface OverridesIssue {
  path: string;
  message: string;
}

export type OverridesResult =
  | { ok: true; keys: number; warning?: string }
  | { ok: false; error: string; issues: OverridesIssue[] };

/** The subset of a zod v3 issue this module reads. */
export interface IssueLike {
  code: string;
  path: (string | number)[];
  message: string;
  keys?: string[];
  expected?: string;
  received?: string;
}

interface SchemaModule {
  configOverridesSchema: {
    safeParse(value: unknown): { success: true } | { success: false; error: { issues: IssueLike[] } };
  };
  buildConfigSchemaPayload(): SchemaPayload;
}

let mod: SchemaModule | null = null;
let payload: SchemaPayload | null = null;
let byPath: Map<string, SchemaParam> = new Map();
let loadError: string | null = null;

export async function loadOverridesSchema(): Promise<boolean> {
  if (mod !== null) return true;
  try {
    const require = createRequire(import.meta.url);
    const serverEntry = require.resolve("fpv-sim-mcp/server"); // <pkg>/dist/src/server/build.js
    const paramsFile = path.join(path.dirname(serverEntry), "params.js");
    const loaded = (await import(pathToFileURL(paramsFile).href)) as SchemaModule;
    if (typeof loaded.configOverridesSchema?.safeParse !== "function" || typeof loaded.buildConfigSchemaPayload !== "function") {
      throw new Error("params.js does not export configOverridesSchema/buildConfigSchemaPayload");
    }
    payload = loaded.buildConfigSchemaPayload();
    byPath = new Map(payload.parameters.map((p) => [p.path, p]));
    mod = loaded;
    loadError = null;
    return true;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    console.error(`overrides schema unavailable — keys will not be checked: ${loadError}`);
    return false;
  }
}

export function overridesSchemaState(): { loaded: boolean; error: string | null } {
  return { loaded: mod !== null, error: loadError };
}

export function overridesSchemaPayload(): SchemaPayload | null {
  return payload;
}

/** Zod issues → one "path: message" per problem, unknown keys expanded one per key. */
export function formatIssues(issues: IssueLike[], params: Map<string, SchemaParam> = byPath): OverridesIssue[] {
  const out: OverridesIssue[] = [];
  for (const issue of issues) {
    const base = issue.path.map(String);
    if (issue.code === "unrecognized_keys" && Array.isArray(issue.keys)) {
      for (const key of issue.keys) out.push({ path: [...base, key].join("."), message: "unknown key" });
      continue;
    }
    const p = base.join(".") || "(root)";
    const meta = params.get(p);
    let message = issue.message;
    if ((issue.code === "too_small" || issue.code === "too_big") && meta?.range) {
      message = `must be in ${meta.range[0]}..${meta.range[1]}`;
    } else if (issue.code === "invalid_type") {
      const want = issue.expected ?? (meta?.boolean ? "boolean" : meta?.integer ? "integer" : "number");
      message = `expected ${want}${issue.received ? `, got ${issue.received}` : ""}`;
    }
    out.push({ path: p, message });
  }
  return out;
}

function countLeaves(v: unknown): number {
  if (typeof v !== "object" || v === null) return 1;
  let n = 0;
  for (const x of Object.values(v as Record<string, unknown>)) n += countLeaves(x);
  return n;
}

export function validateOverridesValue(value: unknown): OverridesResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "overrides must be a JSON object", issues: [{ path: "(root)", message: "must be a JSON object" }] };
  }
  if (mod === null) {
    return { ok: true, keys: countLeaves(value), warning: "keys not checked (engine schema unavailable)" };
  }
  const r = mod.configOverridesSchema.safeParse(value);
  if (r.success) return { ok: true, keys: countLeaves(value) };
  const issues = formatIssues(r.error.issues);
  return { ok: false, error: issues.map((i) => `${i.path}: ${i.message}`).join("; "), issues };
}

export function validateOverridesText(text: string): OverridesResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, keys: 0 };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "overrides is not valid JSON", issues: [{ path: "(json)", message }] };
  }
  return validateOverridesValue(value);
}

/** Adapter for validateStudyOpts: an error string, or null when the value passes. */
export function overridesCheck(value: Record<string, unknown>): string | null {
  const r = validateOverridesValue(value);
  return r.ok ? null : r.error;
}
