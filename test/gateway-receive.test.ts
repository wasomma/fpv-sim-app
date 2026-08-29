/*
 * Receive path: track store extrapolation/expiry semantics and a real
 * UDP self-loop smoke through DisSocket (bind, send, receive on
 * loopback), with heading recovery through the full geo round trip.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGatewayConfig } from "../src/main/gateway/config.js";
import { LocalFrame } from "../src/main/gateway/geo/localframe.js";
import { nedEulerToDis } from "../src/main/gateway/geo/orientation.js";
import { DisSocket } from "../src/main/gateway/net/udp.js";
import { TrackStore } from "../src/main/gateway/receive/trackstore.js";
import { encodePdu } from "../src/main/gateway/codec/factory.js";
import { DrAlgorithm, type EspduModel } from "../src/main/gateway/types.js";

const { config } = validateGatewayConfig({ anchor: { lat0Deg: 21.35, lon0Deg: -157.95 } });
const frame = new LocalFrame(config.anchor);

function espduAt(localX: number, localY: number, entity: number, hdgRad: number, spdMps: number): EspduModel {
  const geo = frame.localToGeodetic(localX, localY, 50);
  const vel = frame.localVelocityToEcef(Math.sin(hdgRad) * spdMps, Math.cos(hdgRad) * spdMps, 0, geo.latRad, geo.lonRad);
  return {
    header: { protocolVersion: 6, exerciseId: 1, pduType: 1, protocolFamily: 1, timestamp: 0, length: 0 },
    entityId: { site: 42, app: 7, entity },
    forceId: 1,
    entityType: { kind: 1, domain: 2, country: 0, category: 50, subcategory: 1, specific: 0, extra: 0 },
    altEntityType: { kind: 1, domain: 2, country: 0, category: 50, subcategory: 1, specific: 0, extra: 0 },
    linearVelocity: vel,
    location: frame.localToEcef(localX, localY, 50),
    orientation: nedEulerToDis(hdgRad, 0, 0, geo.latRad, geo.lonRad),
    appearance: 0,
    drAlgorithm: DrAlgorithm.Fpw,
    linearAcceleration: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    marking: "EXT-1",
    capabilities: 0,
  };
}

test("track store: inverse geo, heading recovery, extrapolation, cap, expiry", () => {
  const store = new TrackStore(frame, 12, true);
  const t0 = 5_000_000;
  store.upsert(espduAt(1000, 2000, 1, Math.PI / 2, 20), t0); // heading east, 20 m/s

  let snap = store.snapshot(t0);
  assert.equal(snap.length, 1);
  assert.ok(Math.abs(snap[0]!.x - 1000) < 0.01 && Math.abs(snap[0]!.y - 2000) < 0.01, "inverse geo lands on the local point");
  assert.ok(Math.abs((snap[0]!.hdgRad ?? 0) - Math.PI / 2) < 1e-6, "heading recovered through DIS Euler");
  assert.ok(Math.abs((snap[0]!.spdMps ?? 0) - 20) < 1e-3);

  snap = store.snapshot(t0 + 2000);
  assert.ok(Math.abs(snap[0]!.x - 1040) < 0.5, `2 s at 20 m/s east extrapolates ~40 m: ${snap[0]!.x.toFixed(1)}`);

  snap = store.snapshot(t0 + 8000);
  assert.ok(Math.abs(snap[0]!.x - 1100) < 1.0, `extrapolation caps at 5 s: ${snap[0]!.x.toFixed(1)}`);

  snap = store.snapshot(t0 + 12100);
  assert.equal(snap.length, 0, "silent track expires after timeoutS");
});

test("track store: outsideWorld flag on entities beyond the 4 km box", () => {
  const store = new TrackStore(frame, 12, false);
  store.upsert(espduAt(6000, 2000, 2, 0, 0), 0);
  const snap = store.snapshot(0);
  assert.equal(snap.length, 1);
  assert.equal(snap[0]!.outsideWorld, true);
});

test("DisSocket loopback: bind, send, self-receive", async () => {
  const { config: netCfg } = validateGatewayConfig({
    network: { mode: "unicast", unicastDestinations: ["127.0.0.1"], port: 46753 },
    anchor: { lat0Deg: 0, lon0Deg: 0 },
  });
  const socket = new DisSocket(netCfg.network);
  await socket.open();
  try {
    const received: number[] = [];
    socket.onPacket((data) => received.push(data.length));
    socket.send(encodePdu({ kind: "espdu", pdu: espduAt(1, 1, 3, 0, 0) }));
    const deadline = Date.now() + 3000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(received.length, 1, "own datagram received on loopback");
    assert.equal(received[0], 144, "full ESPDU length on the wire");
    assert.equal(socket.stats.txPdus, 1);
    assert.equal(socket.stats.rxPdus, 1);
  } finally {
    await socket.close();
  }
});
