/*
 * Every gateway preset the Live Ops panel offers must stage cleanly, and
 * the VBS4 one must carry the values Appendix H says VBS Gateway needs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGatewayConfig } from "../src/main/gateway/config.js";
import { GATEWAY_PRESETS, gatewayWarnings } from "../src/main/gateway/presets.js";

test("each preset parses and validates with no issues", () => {
  assert.ok(GATEWAY_PRESETS.length >= 4);
  const ids = new Set<string>();
  for (const p of GATEWAY_PRESETS) {
    assert.ok(!ids.has(p.id), `duplicate preset id ${p.id}`);
    ids.add(p.id);
    const cfg = JSON.parse(p.text) as unknown;
    const { issues } = validateGatewayConfig(cfg);
    assert.deepEqual(issues, [], `${p.id}: ${JSON.stringify(issues)}`);
  }
});

test("the broadcast preset is the panel's default text", () => {
  const p = GATEWAY_PRESETS.find((x) => x.id === "broadcast-lan");
  assert.ok(p);
  assert.equal(
    p.text,
    `{"network":{"mode":"broadcast","port":3000},\n "dis":{"exerciseId":1},\n "anchor":{"lat0Deg":21.35,"lon0Deg":-157.95}}`,
  );
});

test("the VBS4 preset carries the values VBS Gateway needs", () => {
  const p = GATEWAY_PRESETS.find((x) => x.id === "vbs4-gateway");
  assert.ok(p);
  const cfg = JSON.parse(p.text) as {
    network: { mode: string; unicastDestinations: string[] };
    dis: { protocolVersion: number; exerciseId: number };
    emissions: { uplink: { function: number }; video: { function: number } };
  };
  assert.equal(cfg.network.mode, "unicast");
  assert.equal(cfg.network.unicastDestinations.length, 1);
  assert.equal(cfg.dis.protocolVersion, 6);
  assert.equal(cfg.dis.exerciseId, 1);
  assert.equal(cfg.emissions.uplink.function, 5);
  assert.equal(cfg.emissions.video.function, 5);
  const { config } = validateGatewayConfig(cfg);
  assert.ok(config);
  assert.equal(config.dis.siteId, 1, "site ID stays at the default VBS Gateway expects");
  assert.equal(config.dis.applicationId, 3001);
});

test("warnings flag the untouched anchor and loopback unicast, not a real setup", () => {
  const zero = validateGatewayConfig({ network: { mode: "broadcast", port: 3000 } }).config;
  assert.ok(zero);
  assert.match(gatewayWarnings(zero).join("\n"), /anchor is 0°, 0°/);

  const loop = validateGatewayConfig({
    network: { mode: "unicast", unicastDestinations: ["127.0.0.1"], port: 3000 },
    anchor: { lat0Deg: 21.35, lon0Deg: -157.95 },
  }).config;
  assert.ok(loop);
  assert.match(gatewayWarnings(loop).join("\n"), /loopback/);

  const real = validateGatewayConfig(JSON.parse(GATEWAY_PRESETS[3]!.text)).config;
  assert.ok(real);
  assert.deepEqual(gatewayWarnings(real), []);
});
