/*
 * TickView construction from a live Simulation — shared by the session
 * host and the gateway integration tests, so what the tests assert
 * against is byte-for-byte what the gateway consumes at runtime.
 * Read-only over engine state; zM is the engine's MSL convention
 * (max(ground, 0) + AGL — negative terrain is water at sea level).
 */

import { elevAt, type Simulation } from "fpv-sim-mcp/engine";
import type { TickEntity, TickView } from "../../shared/gateway-slot.js";

export function entityViews(sim: Simulation): TickEntity[] {
  const out: TickEntity[] = [];
  for (const side of ["BLUFOR", "OPFOR"] as const) {
    const T = sim.teams[side];
    out.push({
      id: T.gcs.id,
      side,
      kind: "gcs",
      x: T.gcs.x,
      y: T.gcs.y,
      zM: Math.max(elevAt(sim.world, T.gcs.x, T.gcs.y), 0),
      destroyed: T.gcs.destroyed,
      transmitting: T.gcs.transmitting,
    });
    for (const n of T.nodes) {
      out.push({ id: n.id, side, kind: "df_node", x: n.x, y: n.y, zM: Math.max(elevAt(sim.world, n.x, n.y), 0) });
    }
    const drones = T.drones ?? (T.drone !== null ? [T.drone] : []);
    for (const d of drones) {
      out.push({
        id: d.id,
        side,
        kind: "drone",
        role: d.role,
        x: d.x,
        y: d.y,
        aglM: d.agl,
        zM: Math.max(elevAt(sim.world, d.x, d.y), 0) + d.agl,
        hdgRad: d.hdg,
        spdMps: d.spd,
        state: d.state,
        battPct: d.batt,
        launched: d.launched,
        downed: d.downed,
        videoOn: d.videoOn,
      });
    }
  }
  return out;
}

export function buildTickView(sim: Simulation, tick: number, mode: "orbit" | "tactical", eventsFrom: number): TickView {
  const fix = (side: "BLUFOR" | "OPFOR") => {
    const est = sim.teams[side].est;
    return est !== null && est.solved && est.p !== null ? { x: est.p.x, y: est.p.y, cepM: est.cep } : null;
  };
  return {
    t: sim.t,
    tick,
    mode,
    phase: sim.phase,
    entities: entityViews(sim),
    fixes: { BLUFOR: fix("BLUFOR"), OPFOR: fix("OPFOR") },
    winner: sim.winner ?? undefined,
    stalemate: sim.stalemate,
    objective: sim.obj !== null ? { x: sim.obj.x, y: sim.obj.y, r: sim.obj.r, name: sim.obj.name } : undefined,
    eventsTail: sim.events.slice(eventsFrom),
  };
}
