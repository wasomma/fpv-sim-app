/*
 * Gateway publisher integration: a REAL engine engagement (golden seed
 * 20260719, orbit) drives the publisher tick by tick under a synthetic
 * wall clock, and the captured PDU stream is asserted against the
 * engine's own truth — entity census, heartbeat cadence, EE edges
 * matching the keying booleans, exactly one Entity-Impact detonation on
 * the kill tick in the specified order, wall-apparent speed scaling,
 * and codec validity of every captured PDU. TickViews are deep-frozen:
 * the publisher holding only derived state is proven, not assumed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "fpv-sim-mcp/engine";
import { buildTickView } from "../src/main/sessions/tick-view.js";
import { validateGatewayConfig } from "../src/main/gateway/config.js";
import { LocalFrame } from "../src/main/gateway/geo/localframe.js";
import { IdAllocator } from "../src/main/gateway/publish/ids.js";
import { Publisher } from "../src/main/gateway/publish/publisher.js";
import { decodePdu, encodePdu } from "../src/main/gateway/codec/factory.js";
import type { AnyPdu } from "../src/main/gateway/types.js";
import type { TickView } from "../src/shared/gateway-slot.js";

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object") {
    for (const v of Object.values(o as object)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

interface Captured {
  pdu: AnyPdu;
  atMs: number;
  simT: number;
}

function runPublished(seed: number, opts?: { speedChangeAtT?: number; newSpeed?: number }): {
  captured: Captured[];
  views: TickView[];
  killT: number | null;
} {
  const { config, issues } = validateGatewayConfig({
    anchor: { lat0Deg: 21.35, lon0Deg: -157.95 },
  });
  assert.equal(issues.length, 0, JSON.stringify(issues));
  const frame = new LocalFrame(config.anchor);
  const captured: Captured[] = [];
  const t0 = 1_000_000;
  let nowMs = t0;
  let simT = 0;
  const publisher = new Publisher(config, frame, new IdAllocator(config), (pdu) => {
    captured.push({ pdu, atMs: nowMs, simT });
  });

  const sim = new Simulation(seed, undefined, "orbit");
  publisher.sessionStart(
    { sessionId: "test", seed, mode: "orbit", overridesDigest: "", startedAtMs: t0, speed: 1 },
    nowMs,
  );

  const views: TickView[] = [];
  let tick = 0;
  let killT: number | null = null;
  let speedChanged = false;
  for (;;) {
    sim.step();
    tick++;
    simT = sim.t;
    nowMs = t0 + tick * 100; // 1x real time
    const view = deepFreeze(buildTickView(sim, tick, "orbit", 0));
    views.push(view);
    if (opts?.speedChangeAtT !== undefined && !speedChanged && sim.t >= opts.speedChangeAtT) {
      publisher.setSpeed(opts.newSpeed ?? 4, view, nowMs);
      speedChanged = true;
    }
    publisher.onTick(view, nowMs);
    if (sim.winner !== null) {
      if (killT === null) killT = sim.t;
      break;
    }
    if (sim.teams.BLUFOR.drone!.downed && sim.teams.OPFOR.drone!.downed) break;
    if (sim.t >= 3600) break;
  }
  // Wreck window: the engagement is over but the gateway keeps
  // heartbeating until stop — feed the final view on wall time alone.
  const finalView = views[views.length - 1]!;
  for (let i = 1; i <= 120; i++) {
    nowMs += 100;
    publisher.onTick(finalView, nowMs);
  }
  publisher.sessionEnd(nowMs);
  return { captured, views, killT };
}

const run = runPublished(20260719);

test("session start announces with Start/Resume first", () => {
  assert.ok(run.captured.length > 0);
  assert.equal(run.captured[0]!.pdu.kind, "startResume");
});

test("entity census: 6 statics immediately, 8 total after launches, wrecks persist", () => {
  const espdus = run.captured.filter((c) => c.pdu.kind === "espdu");
  const bySimT1 = new Set(
    espdus.filter((c) => c.simT <= 1).map((c) => (c.pdu.pdu as { marking: string }).marking),
  );
  assert.equal(bySimT1.size, 6, `statics at start: ${[...bySimT1].join(",")}`);
  const all = new Set(espdus.map((c) => (c.pdu.pdu as { marking: string }).marking));
  assert.equal(all.size, 8, `total entities published: ${[...all].join(",")}`);
  // After the engagement ended, wreck/static heartbeats continue on wall time.
  const endMs = run.captured.filter((c) => c.pdu.kind === "detonation")[0]!.atMs;
  const late = espdus.filter((c) => c.atMs > endMs + 6000);
  assert.ok(late.length >= 6, `post-ENDEX heartbeats: ${late.length}`);
});

test("static heartbeat cadence never gaps past the configured interval", () => {
  const espdus = run.captured.filter((c) => c.pdu.kind === "espdu");
  const gcs = espdus.filter((c) => (c.pdu.pdu as { marking: string }).marking === "B-GCS");
  assert.ok(gcs.length >= 3);
  for (let i = 1; i < gcs.length; i++) {
    assert.ok(
      gcs[i]!.atMs - gcs[i - 1]!.atMs <= 5100,
      `B-GCS heartbeat gap ${gcs[i]!.atMs - gcs[i - 1]!.atMs} ms at ${gcs[i]!.simT}`,
    );
  }
});

test("EE PDUs track the uplink keying edges for the first 120 s", () => {
  // Reconstruct expected BLUFOR uplink edges from the engine's own booleans.
  const expectedEdges: { t: number; keyed: boolean }[] = [];
  let prev = false;
  for (const v of run.views) {
    if (v.t > 120) break;
    const gcs = v.entities.find((e) => e.id === "BLUFOR-GCS")!;
    const keyed = gcs.transmitting === true;
    if (keyed !== prev) {
      expectedEdges.push({ t: v.t, keyed });
      prev = keyed;
    }
  }
  assert.ok(expectedEdges.length >= 4, `engine produced ${expectedEdges.length} edges in 120 s`);
  const ee = run.captured.filter(
    (c) => c.pdu.kind === "emission" && c.simT <= 121 && (c.pdu.pdu as { emittingEntityId: { entity: number } }).emittingEntityId.entity === 1,
  );
  for (const edge of expectedEdges) {
    const match = ee.find((c) => Math.abs(c.simT - edge.t) < 0.15);
    assert.ok(match, `no EE within a tick of the ${edge.keyed ? "key-on" : "key-off"} edge at t=${edge.t}`);
    const systems = (match!.pdu.pdu as { systems: { beams: unknown[] }[] }).systems;
    assert.equal(systems[0]!.beams.length > 0, edge.keyed, `beam count wrong at edge t=${edge.t}`);
  }
});

test("exactly one detonation: Entity Impact on the kill tick, ordered, no Fire", () => {
  const detonations = run.captured.filter((c) => c.pdu.kind === "detonation");
  assert.equal(detonations.length, 1);
  const det = detonations[0]!;
  assert.equal((det.pdu.pdu as { detonationResult: number }).detonationResult, 1, "Entity Impact");
  assert.ok(run.killT !== null && Math.abs(det.simT - run.killT) < 0.15, `detonation at ${det.simT} vs kill ${run.killT}`);
  assert.equal(run.captured.filter((c) => c.pdu.kind === "fire").length, 0, "Fire omitted by default");
  const idx = run.captured.indexOf(det);
  const before = run.captured.slice(0, idx).filter((c) => c.pdu.kind === "espdu" && c.simT === det.simT);
  assert.ok(
    before.some((c) => ((c.pdu.pdu as { appearance: number }).appearance & (3 << 3)) !== 0),
    "killer drone's destroyed ESPDU precedes the detonation",
  );
  const after = run.captured.slice(idx + 1).filter((c) => c.pdu.kind === "espdu" && c.simT === det.simT);
  assert.ok(
    after.some((c) => ((c.pdu.pdu as { appearance: number }).appearance & (3 << 3)) !== 0),
    "target GCS destroyed ESPDU follows the detonation",
  );
});

test("every captured PDU encodes and decodes byte-clean", () => {
  for (const c of run.captured) {
    const decoded = decodePdu(encodePdu(c.pdu));
    assert.ok(decoded.ok, `codec rejected a published ${c.pdu.kind}`);
  }
});

test("speed change triggers a refresh volley with wall-apparent velocities", () => {
  const accel = runPublished(20260719, { speedChangeAtT: 60, newSpeed: 4 });
  const volleyMs = accel.captured.find((c) => c.pdu.kind === "espdu" && c.simT >= 60)!.atMs;
  const volley = accel.captured.filter((c) => c.pdu.kind === "espdu" && c.atMs === volleyMs);
  assert.ok(volley.length >= 6, `refresh volley republished ${volley.length} entities`);
  // A moving drone's published speed must be ~4x its engine airspeed AT
  // THE SAME SIM TIME (the drone accelerates through loiter/dash/terminal,
  // so the comparison must pair each PDU with its contemporaneous view).
  const sample = accel.captured.find(
    (c) =>
      c.pdu.kind === "espdu" &&
      c.simT >= 61 &&
      (c.pdu.pdu as { marking: string }).marking.includes("sUAS") &&
      ((c.pdu.pdu as { appearance: number }).appearance & (3 << 3)) === 0,
  );
  assert.ok(sample, "an airborne drone ESPDU after the speed change");
  const marking = (sample!.pdu.pdu as { marking: string }).marking;
  const engineId = marking.replace(/^B-/, "BLUFOR-").replace(/^O-/, "OPFOR-");
  const view = accel.views.find((w) => Math.abs(w.t - sample!.simT) < 0.05);
  assert.ok(view, `a view at simT ${sample!.simT}`);
  const droneView = view!.entities.find((e) => e.id === engineId);
  assert.ok(droneView, `entity ${engineId} in the contemporaneous view`);
  const v = (sample!.pdu.pdu as { linearVelocity: { x: number; y: number; z: number } }).linearVelocity;
  const speed = Math.hypot(v.x, v.y, v.z);
  const engineSpd = droneView!.spdMps ?? 0;
  assert.ok(engineSpd > 5, `sampled drone is moving (${engineSpd})`);
  assert.ok(
    Math.abs(speed - engineSpd * 4) / (engineSpd * 4) < 0.2,
    `published |v| ${speed.toFixed(1)} vs 4x engine ${engineSpd.toFixed(1)} (vertical smoothing tolerance 20%)`,
  );
});

test("pause/resume emit Stop-Freeze(Recess)/Start-Resume; Termination only on opt-in", () => {
  const { config } = validateGatewayConfig({ anchor: { lat0Deg: 0, lon0Deg: 0 } });
  const frame = new LocalFrame(config.anchor);
  const sent: AnyPdu[] = [];
  const p = new Publisher(config, frame, new IdAllocator(config), (pdu) => sent.push(pdu));
  p.pause(1000);
  p.resume(2000);
  p.sessionEnd(3000);
  assert.deepEqual(
    sent.map((s) => s.kind),
    ["stopFreeze", "startResume"],
    "default sessionEnd sends nothing",
  );
  assert.equal((sent[0]!.pdu as { reason: number }).reason, 1, "Recess");

  const { config: cfg2 } = validateGatewayConfig({
    anchor: { lat0Deg: 0, lon0Deg: 0 },
    simMgmt: { endVbsMissionOnStop: true },
  });
  const sent2: AnyPdu[] = [];
  const p2 = new Publisher(cfg2, frame, new IdAllocator(cfg2), (pdu) => sent2.push(pdu));
  p2.sessionEnd(1000);
  assert.equal(sent2.length, 1);
  assert.equal(sent2[0]!.pdu.header.pduType, 14);
  assert.equal((sent2[0]!.pdu as { reason: number }).reason, 2, "Termination");
});
