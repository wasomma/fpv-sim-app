/*
 * The FORM view descriptor must mirror DEFAULT_GATEWAY_CONFIG exactly:
 * every leaf covered by one field, every field pointing at a real leaf,
 * every declared type and range consistent with the default value and
 * with what the validator accepts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GATEWAY_CONFIG, validateGatewayConfig } from "../src/main/gateway/config.js";
import { GATEWAY_FORM_SECTIONS, type GatewayFormField } from "../src/main/gateway/form-schema.js";

const allFields: GatewayFormField[] = GATEWAY_FORM_SECTIONS.flatMap((s) => s.fields);

function leafAt(path: string): unknown {
  let cur: unknown = DEFAULT_GATEWAY_CONFIG;
  for (const part of path.split(".")) {
    assert.ok(typeof cur === "object" && cur !== null && part in (cur as Record<string, unknown>), `${path}: missing at ${part}`);
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Every path a form field must cover: primitives and the two array shapes. */
function configLeaves(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    out.push(path); // u16-pair / ip-list fields cover the whole array
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) configLeaves(v, path === "" ? k : `${path}.${k}`, out);
    return;
  }
  out.push(path);
}

test("fields cover every config leaf exactly once", () => {
  const expected: string[] = [];
  configLeaves(DEFAULT_GATEWAY_CONFIG, "", expected);
  const declared = allFields.map((f) => f.path);
  assert.deepEqual(declared.slice().sort(), expected.slice().sort());
  assert.equal(new Set(declared).size, declared.length, "duplicate field path");
});

test("each field lives in the section named by its path", () => {
  for (const s of GATEWAY_FORM_SECTIONS) {
    for (const f of s.fields) {
      assert.ok(f.path.startsWith(`${s.key}.`), `${f.path} filed under ${s.key}`);
    }
  }
  const keys = GATEWAY_FORM_SECTIONS.map((s) => s.key);
  assert.deepEqual(keys.slice().sort(), Object.keys(DEFAULT_GATEWAY_CONFIG).slice().sort());
});

test("declared types match the default values", () => {
  for (const f of allFields) {
    const d = leafAt(f.path);
    switch (f.type) {
      case "bool":
        assert.equal(typeof d, "boolean", f.path);
        break;
      case "int":
        assert.ok(typeof d === "number" && Number.isInteger(d), f.path);
        break;
      case "num":
        assert.equal(typeof d, "number", f.path);
        break;
      case "ip":
        assert.ok(typeof d === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(d), f.path);
        break;
      case "ip-or-null":
        assert.ok(d === null || typeof d === "string", f.path);
        break;
      case "ip-list":
        assert.ok(Array.isArray(d), f.path);
        break;
      case "u16-pair":
        assert.ok(Array.isArray(d) && d.length === 2 && d.every((n) => Number.isInteger(n)), f.path);
        break;
      case "enum": {
        assert.ok(f.options && f.options.length >= 2, f.path);
        assert.ok(f.options.some((o) => o.value === d), `${f.path}: default ${String(d)} not among options`);
        break;
      }
    }
  }
});

test("defaults sit inside every declared range", () => {
  for (const f of allFields) {
    const d = leafAt(f.path);
    if (typeof d !== "number") continue;
    if (f.min !== undefined) assert.ok(f.minExclusive ? d > f.min : d >= f.min, `${f.path}: default ${d} under min ${f.min}`);
    if (f.max !== undefined) assert.ok(d <= f.max, `${f.path}: default ${d} over max ${f.max}`);
  }
});

test("every enum option and every range edge is accepted by the validator", () => {
  const patchAt = (path: string, value: unknown): Record<string, unknown> => {
    const root: Record<string, unknown> = {};
    let cur = root;
    const parts = path.split(".");
    for (const p of parts.slice(0, -1)) {
      cur[p] = {};
      cur = cur[p] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]!] = value;
    return root;
  };
  const issuesAt = (path: string, value: unknown): string[] =>
    validateGatewayConfig(patchAt(path, value)).issues.map((i) => i.path);

  for (const f of allFields) {
    if (f.type === "enum") {
      for (const o of f.options!) {
        assert.ok(!issuesAt(f.path, o.value).includes(f.path), `${f.path}: option ${String(o.value)} refused`);
      }
    }
    if (f.type === "int" && f.min !== undefined && f.max !== undefined) {
      assert.ok(!issuesAt(f.path, f.min).includes(f.path), `${f.path}: min ${f.min} refused`);
      assert.ok(!issuesAt(f.path, f.max).includes(f.path), `${f.path}: max ${f.max} refused`);
    }
  }
  // The validator's own edges the form declares: spot-check both directions.
  assert.ok(issuesAt("network.port", 0).includes("network.port"));
  assert.ok(issuesAt("dis.exerciseId", 256).includes("dis.exerciseId"));
  assert.ok(issuesAt("anchor.lat0Deg", 90).includes("anchor.lat0Deg"));
  assert.ok(!issuesAt("anchor.lat0Deg", 89.9).includes("anchor.lat0Deg"));
  assert.ok(issuesAt("deadReckoning.drone.posThresholdM", 0).includes("deadReckoning.drone.posThresholdM"));
});
