/*
 * settings.json normalization: the v1 -> v2 migration, repair of bad MCP
 * values, preservation of unknown keys, and the guards on the renderer-
 * owned `ui` bag.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MCP_PORT,
  UI_VALUE_LIMIT,
  normalizeSettings,
  validateUiEntry,
} from "../src/main/settings-schema.js";

const TOKEN = "EXAMPLE-TOKEN-REPLACE-ME-0123456789";
const mint = () => "MINTED-TOKEN-0123456789abcdef";

test("a v1 file migrates to v2 keeping its port and token", () => {
  const { settings, changed } = normalizeSettings({ mcp: { port: 9000, token: TOKEN } }, mint);
  assert.equal(changed, true, "migration must be written back");
  assert.equal(settings.version, 2);
  assert.deepEqual(settings.mcp, { port: 9000, token: TOKEN });
  assert.deepEqual(settings.ui, {});
});

test("a valid v2 file is left alone", () => {
  const raw = { version: 2, mcp: { port: 8765, token: TOKEN }, ui: { shell: { seed: 7, mode: "orbit" } } };
  const { settings, changed } = normalizeSettings(raw, mint);
  assert.equal(changed, false);
  assert.deepEqual(settings, raw);
});

test("first run and garbage both yield defaults with a minted token", () => {
  for (const raw of [undefined, null, "nope", 42, []]) {
    const { settings, changed } = normalizeSettings(raw, mint);
    assert.equal(changed, true);
    assert.equal(settings.mcp.port, DEFAULT_MCP_PORT);
    assert.equal(settings.mcp.token, mint());
    assert.deepEqual(settings.ui, {});
  }
});

test("a bad port and a short token are repaired", () => {
  const { settings, changed } = normalizeSettings({ version: 2, mcp: { port: 80, token: "short" }, ui: {} }, mint);
  assert.equal(changed, true);
  assert.equal(settings.mcp.port, DEFAULT_MCP_PORT);
  assert.equal(settings.mcp.token, mint());
});

test("unknown top-level keys survive a round trip", () => {
  const raw = { version: 2, mcp: { port: 8765, token: TOKEN }, ui: {}, future: { flag: true } };
  const { settings, changed } = normalizeSettings(raw, mint);
  assert.equal(changed, false);
  assert.deepEqual(settings.future, { flag: true });
});

test("ui entries with bad keys or oversize values are pruned", () => {
  const big = "x".repeat(UI_VALUE_LIMIT);
  const raw = {
    version: 2,
    mcp: { port: 8765, token: TOKEN },
    ui: { good: { a: 1 }, "Bad Key": 1, "": 2, huge: { text: big }, gone: null },
  };
  const { settings, changed } = normalizeSettings(raw, mint);
  assert.equal(changed, true);
  assert.deepEqual(Object.keys(settings.ui), ["good"]);
});

test("a non-object ui is replaced", () => {
  const { settings, changed } = normalizeSettings({ version: 2, mcp: { port: 8765, token: TOKEN }, ui: [1] }, mint);
  assert.equal(changed, true);
  assert.deepEqual(settings.ui, {});
});

test("validateUiEntry enforces the key pattern and the size cap", () => {
  assert.equal(validateUiEntry("liveOps", { seed: 1 }).ok, true);
  assert.equal(validateUiEntry("live-ops", { seed: 1 }).ok, true);
  assert.equal(validateUiEntry("LiveOps", {}).ok, false, "must start lowercase");
  assert.equal(validateUiEntry("a".repeat(33), {}).ok, false, "too long");
  assert.equal(validateUiEntry(7, {}).ok, false, "not a string");
  assert.equal(validateUiEntry("k", { t: "x".repeat(UI_VALUE_LIMIT) }).ok, false, "oversize");
  assert.equal(validateUiEntry("k", () => 1).ok, false, "not serializable");
  const del = validateUiEntry("k", null);
  assert.deepEqual(del, { ok: true, value: null });
});

test("validateUiEntry returns a plain JSON copy", () => {
  const value = { n: 1, nested: { u: undefined, s: "s" } };
  const r = validateUiEntry("k", value);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.notEqual(r.value, value, "must not alias the caller's object");
    assert.deepEqual(r.value, { n: 1, nested: { s: "s" } });
  }
});
