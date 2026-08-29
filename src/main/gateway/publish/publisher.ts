/*
 * DIS publisher — a strictly read-only tick observer over engine
 * TickViews. Everything DIS needs beyond raw state is derived here:
 * velocity from heading/speed plus finite-difference climb, attitude
 * from the physics (pitch from climb, bank from turn rate — engine-frame
 * rates: a banked drone is banked regardless of replay speed), and
 * dead-reckoning fields in the WALL-APPARENT frame (engine rates x the
 * session speed factor), because DIS receivers extrapolate in wall time.
 * A speed change re-prices those fields, so it triggers a full ESPDU
 * refresh volley.
 *
 * Trigger source is typed field diffing (state transitions, keying
 * booleans), never the prose event log — that text belongs to the
 * upstream parity contract.
 */

import type { Side, SessionInfo, TickEntity, TickView } from "../../../shared/gateway-slot.js";
import type { GatewayConfig } from "../config.js";
import type { LocalFrame } from "../geo/localframe.js";
import { synthesizeAttitude, nedEulerToDis } from "../geo/orientation.js";
import { disTimestamp } from "../codec/header.js";
import {
  DetonationResult,
  DrAlgorithm,
  NO_ENTITY,
  PduType,
  ProtocolFamily,
  StopFreezeReason,
  type AnyPdu,
  type DisEuler,
  type EntityId,
  type PduHeader,
  type Vec3,
} from "../types.js";
import { appearanceFor } from "./appearance.js";
import { DrMirror } from "./drmirror.js";
import { EmitterFsm, buildEmitterSystem } from "./emitters.js";
import { IdAllocator } from "./ids.js";

const EMA_ALPHA = 1 / 3; // dt 0.1 s over tau 0.3 s

interface EntityRecord {
  mirror: DrMirror;
  prev: TickEntity | null;
  vzEma: number;
  turnRateEma: number;
  lastHdg: number | null;
  dead: boolean;
  killWallMs: number | null;
  flaming: boolean;
  lastDerived: { velocityEcef: Vec3; orientation: DisEuler; locationEcef: Vec3 } | null;
}

export interface PublisherCounters {
  espdu: number;
  emission: number;
  fire: number;
  detonation: number;
  startResume: number;
  stopFreeze: number;
}

export class Publisher {
  private readonly cfg: GatewayConfig;
  private readonly frame: LocalFrame;
  private readonly ids: IdAllocator;
  private readonly send: (pdu: AnyPdu) => void;
  private readonly records = new Map<string, EntityRecord>();
  private readonly emitters = new Map<string, EmitterFsm>();
  private prevGcsDestroyed: Record<Side, boolean> = { BLUFOR: false, OPFOR: false };
  private speed = 1;
  private requestId = 0;
  readonly counters: PublisherCounters = { espdu: 0, emission: 0, fire: 0, detonation: 0, startResume: 0, stopFreeze: 0 };

  constructor(cfg: GatewayConfig, frame: LocalFrame, ids: IdAllocator, send: (pdu: AnyPdu) => void) {
    this.cfg = cfg;
    this.frame = frame;
    this.ids = ids;
    this.send = send;
  }

  private header(pduType: number, family: number, nowMs: number): PduHeader {
    return {
      protocolVersion: this.cfg.dis.protocolVersion,
      exerciseId: this.cfg.dis.exerciseId,
      pduType,
      protocolFamily: family,
      timestamp: disTimestamp(nowMs, this.cfg.dis.timestampMode === "absolute"),
      length: 0,
    };
  }

  sessionStart(info: SessionInfo, nowMs: number): void {
    this.speed = info.speed;
    if (this.cfg.simMgmt.announceSession) this.startResume(nowMs);
  }

  private startResume(nowMs: number): void {
    this.send({
      kind: "startResume",
      pdu: {
        header: this.header(PduType.StartResume, ProtocolFamily.SimulationManagement, nowMs),
        originatingEntityId: { site: this.cfg.dis.siteId, app: this.cfg.dis.applicationId, entity: 0 },
        receivingEntityId: { site: 0xffff, app: 0xffff, entity: 0xffff },
        realWorldTime: { hour: 0, timePastHour: 0 }, // zeros = immediate action
        simulationTime: { hour: 0, timePastHour: 0 },
        requestId: ++this.requestId,
      },
    });
    this.counters.startResume++;
  }

  private stopFreeze(reason: number, nowMs: number): void {
    this.send({
      kind: "stopFreeze",
      pdu: {
        header: this.header(PduType.StopFreeze, ProtocolFamily.SimulationManagement, nowMs),
        originatingEntityId: { site: this.cfg.dis.siteId, app: this.cfg.dis.applicationId, entity: 0 },
        receivingEntityId: { site: 0xffff, app: 0xffff, entity: 0xffff },
        realWorldTime: { hour: 0, timePastHour: 0 },
        reason,
        frozenBehavior: 0,
        requestId: ++this.requestId,
      },
    });
    this.counters.stopFreeze++;
  }

  pause(nowMs: number): void {
    if (this.cfg.simMgmt.sendPauseResume) this.stopFreeze(StopFreezeReason.Recess, nowMs);
  }

  resume(nowMs: number): void {
    if (this.cfg.simMgmt.sendPauseResume) this.startResume(nowMs);
  }

  setSpeed(speed: number, view: TickView | null, nowMs: number): void {
    this.speed = speed;
    // Published DR fields are stale in the new wall frame — refresh all.
    if (view !== null) {
      for (const e of this.publishable(view)) this.publishEspdu(e, nowMs, true);
    }
  }

  sessionEnd(nowMs: number): void {
    if (this.cfg.simMgmt.endVbsMissionOnStop) this.stopFreeze(StopFreezeReason.Termination, nowMs);
  }

  private publishable(view: TickView): TickEntity[] {
    return view.entities.filter(
      (e) => e.kind !== "drone" || this.cfg.publish.publishStandby || e.launched === true || e.state === "IMPACT",
    );
  }

  private record(id: string): EntityRecord {
    let r = this.records.get(id);
    if (r === undefined) {
      r = {
        mirror: new DrMirror(),
        prev: null,
        vzEma: 0,
        turnRateEma: 0,
        lastHdg: null,
        dead: false,
        killWallMs: null,
        flaming: false,
        lastDerived: null,
      };
      this.records.set(id, r);
    }
    return r;
  }

  /** Engine-frame kinematics -> ECEF truth + wall-apparent DR fields. */
  private derive(e: TickEntity, r: EntityRecord): {
    locationEcef: Vec3;
    velocityEcefWall: Vec3;
    orientation: DisEuler;
    yawRateWall: number;
  } {
    const z = e.zM ?? 0;
    const geo = this.frame.localToGeodetic(e.x, e.y, z);
    const locationEcef = this.frame.localToEcef(e.x, e.y, z);
    if (e.kind !== "drone") {
      const psi = nedEulerToDis(this.frame.rotationRad, 0, 0, geo.latRad, geo.lonRad);
      r.lastDerived = { velocityEcef: { x: 0, y: 0, z: 0 }, orientation: psi, locationEcef };
      return { locationEcef, velocityEcefWall: { x: 0, y: 0, z: 0 }, orientation: psi, yawRateWall: 0 };
    }
    const hdg = e.hdgRad ?? 0;
    const spd = e.spdMps ?? 0;
    const vx = Math.sin(hdg) * spd;
    const vy = Math.cos(hdg) * spd;
    const prevZ = r.prev?.zM ?? z;
    const vzRaw = (z - prevZ) / 0.1;
    r.vzEma += EMA_ALPHA * (vzRaw - r.vzEma);
    let turnRaw = 0;
    if (r.lastHdg !== null) {
      let d = hdg - r.lastHdg;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      turnRaw = d / 0.1;
    }
    r.turnRateEma += EMA_ALPHA * (turnRaw - r.turnRateEma);
    r.lastHdg = hdg;

    const ned = synthesizeAttitude({ hdgRad: hdg, spdMps: spd, vUp: r.vzEma, turnRateRps: r.turnRateEma });
    const orientation = nedEulerToDis(
      ned.psiNed + this.frame.rotationRad,
      ned.thetaNed,
      ned.phiNed,
      geo.latRad,
      geo.lonRad,
    );
    const velTruth = this.frame.localVelocityToEcef(vx, vy, r.vzEma, geo.latRad, geo.lonRad);
    const velocityEcefWall: Vec3 = {
      x: velTruth.x * this.speed,
      y: velTruth.y * this.speed,
      z: velTruth.z * this.speed,
    };
    r.lastDerived = { velocityEcef: velocityEcefWall, orientation, locationEcef };
    return { locationEcef, velocityEcefWall, orientation, yawRateWall: r.turnRateEma * this.speed };
  }

  private publishEspdu(e: TickEntity, nowMs: number, force: boolean): void {
    const r = this.record(e.id);
    const derived = this.derive(e, r);
    const isStatic = e.kind !== "drone";
    const drCfg = this.cfg.deadReckoning;
    const algorithm = isStatic || r.dead ? DrAlgorithm.Static : drCfg.drone.algorithm;
    const sinceKillS = r.killWallMs !== null && r.flaming ? (nowMs - r.killWallMs) / 1000 : null;
    const appearance = appearanceFor(r.dead, sinceKillS, this.cfg.publish.flamingS);

    const oriThresholdRad = (drCfg.drone.oriThresholdDeg * Math.PI) / 180;
    const heartbeatS = isStatic ? drCfg.static.heartbeatS : drCfg.drone.heartbeatS;
    const due =
      force ||
      r.mirror.appearanceChanged(appearance) ||
      r.mirror.heartbeatDue(nowMs, heartbeatS) ||
      (!isStatic &&
        !r.dead &&
        r.mirror.exceeds(
          { location: derived.locationEcef, orientation: derived.orientation },
          drCfg.drone.posThresholdM,
          oriThresholdRad,
          nowMs,
        ));
    if (!due) return;

    const velocity = r.dead ? { x: 0, y: 0, z: 0 } : derived.velocityEcefWall;
    const angularVelocity: Vec3 =
      algorithm === DrAlgorithm.Rvw && !r.dead ? { x: 0, y: 0, z: derived.yawRateWall } : { x: 0, y: 0, z: 0 };
    this.send({
      kind: "espdu",
      pdu: {
        header: this.header(PduType.EntityState, ProtocolFamily.EntityInformation, nowMs),
        entityId: this.ids.entityId(e),
        forceId: this.ids.forceId(e.side),
        entityType: this.ids.entityType(e.kind, e.side),
        altEntityType: this.ids.entityType(e.kind, e.side),
        linearVelocity: velocity,
        location: derived.locationEcef,
        orientation: derived.orientation,
        appearance,
        drAlgorithm: algorithm,
        linearAcceleration: { x: 0, y: 0, z: 0 },
        angularVelocity,
        marking: this.ids.marking(e.id),
        capabilities: 0,
      },
    });
    this.counters.espdu++;
    r.mirror.record({
      atWallMs: nowMs,
      algorithm,
      location: derived.locationEcef,
      velocity,
      orientation: derived.orientation,
      angularVelocity,
      appearance,
    });
  }

  private sendEmission(entity: TickEntity, emitterCfgKey: "uplink" | "video", keyed: boolean, nowMs: number): void {
    const cfg = this.cfg.emissions[emitterCfgKey];
    this.send({
      kind: "emission",
      pdu: {
        header: this.header(PduType.ElectromagneticEmission, ProtocolFamily.DistributedEmissionRegeneration, nowMs),
        emittingEntityId: this.ids.entityId(entity),
        eventId: this.ids.nextEventId(),
        stateUpdateIndicator: 1,
        systems: [buildEmitterSystem(cfg, 1, keyed)],
      },
    });
    this.counters.emission++;
  }

  private sendDetonation(
    drone: TickEntity,
    r: EntityRecord,
    target: { id: EntityId } | null,
    nowMs: number,
  ): void {
    const eventId = this.ids.nextEventId();
    const location = r.lastDerived?.locationEcef ?? this.frame.localToEcef(drone.x, drone.y, drone.zM ?? 0);
    const velocity = r.lastDerived?.velocityEcef ?? { x: 0, y: 0, z: 0 };
    const burst = {
      munitionType: this.ids.warheadType(drone.side),
      warhead: 1000, // HE (SISO generic)
      fuse: 1000, // contact
      quantity: 1,
      rate: 0,
    };
    if (this.cfg.dis.emitFirePdu) {
      this.send({
        kind: "fire",
        pdu: {
          header: this.header(PduType.Fire, ProtocolFamily.Warfare, nowMs),
          firingEntityId: this.ids.entityId(drone),
          targetEntityId: target?.id ?? NO_ENTITY,
          munitionEntityId: NO_ENTITY,
          eventId,
          fireMissionIndex: 0,
          location,
          burst,
          velocity,
          rangeM: 0,
        },
      });
      this.counters.fire++;
    }
    this.send({
      kind: "detonation",
      pdu: {
        header: this.header(PduType.Detonation, ProtocolFamily.Warfare, nowMs),
        firingEntityId: this.ids.entityId(drone),
        targetEntityId: target?.id ?? NO_ENTITY,
        munitionEntityId: NO_ENTITY,
        eventId,
        velocity,
        location,
        burst,
        locationRelativeToEntity: { x: 0, y: 0, z: 0 },
        detonationResult: target !== null ? DetonationResult.EntityImpact : DetonationResult.GroundImpact,
      },
    });
    this.counters.detonation++;
  }

  onTick(view: TickView, nowMs: number): void {
    const byId = new Map(view.entities.map((e) => [e.id, e]));
    const gcsBySide: Record<Side, TickEntity | undefined> = {
      BLUFOR: view.entities.find((e) => e.kind === "gcs" && e.side === "BLUFOR"),
      OPFOR: view.entities.find((e) => e.kind === "gcs" && e.side === "OPFOR"),
    };

    // 1. Deaths and detonations from typed transitions.
    for (const e of this.publishable(view)) {
      const r = this.record(e.id);
      if (e.kind === "drone" && r.prev !== null) {
        const impacted = e.state === "IMPACT" && r.prev.state !== "IMPACT";
        const crashed = e.downed === true && r.prev.downed !== true && e.state !== "IMPACT";
        if (impacted) {
          const enemySide: Side = e.side === "BLUFOR" ? "OPFOR" : "BLUFOR";
          const enemyGcs = gcsBySide[enemySide];
          const gcsKill = enemyGcs?.destroyed === true && !this.prevGcsDestroyed[enemySide];
          // Ordering: final drone ESPDU (at rest, destroyed) -> [Fire] ->
          // Detonation -> GCS destroyed ESPDU -> EE unkeys below.
          r.dead = true;
          r.killWallMs = nowMs;
          r.flaming = true;
          this.publishEspdu(e, nowMs, true);
          this.sendDetonation(e, r, gcsKill && enemyGcs !== undefined ? { id: this.ids.entityId(enemyGcs) } : null, nowMs);
          if (gcsKill && enemyGcs !== undefined) {
            const gr = this.record(enemyGcs.id);
            gr.dead = true;
            gr.killWallMs = nowMs;
            gr.flaming = true;
            this.publishEspdu(enemyGcs, nowMs, true);
          }
        } else if (crashed) {
          r.dead = true; // destroyed appearance, no detonation, no flames
          this.publishEspdu(e, nowMs, true);
        }
      }
      if (e.kind === "gcs" && e.destroyed === true && !r.dead) {
        r.dead = true;
        r.killWallMs = nowMs;
        r.flaming = true;
        this.publishEspdu(e, nowMs, true);
      }
    }

    // 2. Regular ESPDU pass (thresholds + heartbeats + first sighting).
    for (const e of this.publishable(view)) {
      this.publishEspdu(e, nowMs, false);
    }

    // 3. Emitters: GCS uplinks and per-drone video, death-silenced.
    for (const side of ["BLUFOR", "OPFOR"] as const) {
      const gcs = gcsBySide[side];
      if (gcs === undefined) continue;
      const key = `${side}-UL`;
      let fsm = this.emitters.get(key);
      if (fsm === undefined) {
        fsm = new EmitterFsm();
        this.emitters.set(key, fsm);
      }
      const trigger = gcs.destroyed === true ? fsm.silence(nowMs) : fsm.update(gcs.transmitting === true, nowMs, this.cfg.emissions.heartbeatS);
      if (trigger !== null) this.sendEmission(gcs, "uplink", fsm.isKeyed, nowMs);
    }
    for (const e of this.publishable(view)) {
      if (e.kind !== "drone") continue;
      const key = `${e.id}-VID`;
      let fsm = this.emitters.get(key);
      if (fsm === undefined) {
        fsm = new EmitterFsm();
        this.emitters.set(key, fsm);
      }
      const r = this.record(e.id);
      const trigger = r.dead ? fsm.silence(nowMs) : fsm.update(e.videoOn === true, nowMs, this.cfg.emissions.heartbeatS);
      if (trigger !== null) this.sendEmission(e, "video", fsm.isKeyed, nowMs);
    }

    // 4. Book-keeping for the next tick's diffs.
    for (const e of view.entities) {
      const r = this.record(e.id);
      r.prev = e;
      if (r.flaming && r.killWallMs !== null && (nowMs - r.killWallMs) / 1000 > this.cfg.publish.flamingS) {
        r.flaming = false; // next appearance change drops the fire bits
      }
    }
    this.prevGcsDestroyed = {
      BLUFOR: gcsBySide.BLUFOR?.destroyed === true,
      OPFOR: gcsBySide.OPFOR?.destroyed === true,
    };
    void byId;
  }
}
