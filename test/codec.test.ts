/*
 * Codec contract: byte-exact big-endian DIS wire forms with fixed
 * total lengths (ESPDU 144, Fire 96, Detonation 104, Start/Resume 44,
 * Stop/Freeze 40, EE 28 + sum(20 + 52*beams)), encode->decode identity
 * up to float32 rounding, and a decodePdu that never throws on hostile
 * bytes. All fuzzing is seeded — no Math.random anywhere.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { BeWriter } from "../src/main/gateway/codec/writer.js";
import { BeReader } from "../src/main/gateway/codec/reader.js";
import {
  decodeHeader,
  disTimestamp,
  encodeHeader,
  timestampToSecondsPastHour,
} from "../src/main/gateway/codec/header.js";
import { encodeEspdu } from "../src/main/gateway/codec/espdu.js";
import { emissionByteLength } from "../src/main/gateway/codec/emission.js";
import { decodePdu, encodePdu } from "../src/main/gateway/codec/factory.js";
import type {
  AnyPdu,
  DetonationModel,
  EmissionModel,
  EmitterBeamModel,
  EmitterSystemModel,
  EntityId,
  EntityType,
  EspduModel,
  EventId,
  FireModel,
  PduHeader,
  StartResumeModel,
  StopFreezeModel,
  Vec3,
} from "../src/main/gateway/types.js";
import {
  APPEARANCE_DESTROYED,
  APPEARANCE_FLAMING,
  PduType,
  ProtocolFamily,
} from "../src/main/gateway/types.js";

// ---------------------------------------------------------------- helpers

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function dv(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

function mkHeader(pduType: number, protocolFamily: number, timestamp = 0x12345678, length = 0): PduHeader {
  return { protocolVersion: 6, exerciseId: 1, pduType, protocolFamily, timestamp, length };
}

/** Numerical Recipes LCG; all randomness in this file flows from it. */
class Lcg {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  u32(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s;
  }
  u16(): number {
    return this.u32() & 0xffff;
  }
  u8(): number {
    return this.u32() & 0xff;
  }
  int(n: number): number {
    return this.u32() % n;
  }
  float(): number {
    return this.u32() / 0x100000000;
  }
  f32(scale = 1e4): number {
    return Math.fround((this.float() - 0.5) * 2 * scale);
  }
  f64(scale = 1e7): number {
    return (this.float() - 0.5) * 2 * scale;
  }
}

const fr = Math.fround;
const frv = (v: Vec3): Vec3 => ({ x: fr(v.x), y: fr(v.y), z: fr(v.z) });
const cpv = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

// Decoded models must equal the input with every f32 field rounded to
// float32 and header.length replaced by the wire length.
function canonEspdu(m: EspduModel): EspduModel {
  return {
    ...m,
    header: { ...m.header, length: 144 },
    entityId: { ...m.entityId },
    entityType: { ...m.entityType },
    altEntityType: { ...m.altEntityType },
    linearVelocity: frv(m.linearVelocity),
    location: cpv(m.location),
    orientation: { psi: fr(m.orientation.psi), theta: fr(m.orientation.theta), phi: fr(m.orientation.phi) },
    linearAcceleration: frv(m.linearAcceleration),
    angularVelocity: frv(m.angularVelocity),
  };
}

function canonEmission(m: EmissionModel): EmissionModel {
  return {
    ...m,
    header: { ...m.header, length: emissionByteLength(m) },
    emittingEntityId: { ...m.emittingEntityId },
    eventId: { ...m.eventId },
    systems: m.systems.map((s) => ({
      ...s,
      location: frv(s.location),
      beams: s.beams.map((b) => ({
        ...b,
        frequencyHz: fr(b.frequencyHz),
        frequencyRangeHz: fr(b.frequencyRangeHz),
        erpDbm: fr(b.erpDbm),
        prfHz: fr(b.prfHz),
        pulseWidthUs: fr(b.pulseWidthUs),
        azimuthCenterRad: fr(b.azimuthCenterRad),
        azimuthSweepRad: fr(b.azimuthSweepRad),
        elevationCenterRad: fr(b.elevationCenterRad),
        elevationSweepRad: fr(b.elevationSweepRad),
        sweepSync: fr(b.sweepSync),
      })),
    })),
  };
}

function canonFire(m: FireModel): FireModel {
  return {
    ...m,
    header: { ...m.header, length: 96 },
    firingEntityId: { ...m.firingEntityId },
    targetEntityId: { ...m.targetEntityId },
    munitionEntityId: { ...m.munitionEntityId },
    eventId: { ...m.eventId },
    location: cpv(m.location),
    burst: { ...m.burst, munitionType: { ...m.burst.munitionType } },
    velocity: frv(m.velocity),
    rangeM: fr(m.rangeM),
  };
}

function canonDetonation(m: DetonationModel): DetonationModel {
  return {
    ...m,
    header: { ...m.header, length: 104 },
    firingEntityId: { ...m.firingEntityId },
    targetEntityId: { ...m.targetEntityId },
    munitionEntityId: { ...m.munitionEntityId },
    eventId: { ...m.eventId },
    velocity: frv(m.velocity),
    location: cpv(m.location),
    burst: { ...m.burst, munitionType: { ...m.burst.munitionType } },
    locationRelativeToEntity: frv(m.locationRelativeToEntity),
  };
}

function canonStartResume(m: StartResumeModel): StartResumeModel {
  return {
    ...m,
    header: { ...m.header, length: 44 },
    originatingEntityId: { ...m.originatingEntityId },
    receivingEntityId: { ...m.receivingEntityId },
    realWorldTime: { ...m.realWorldTime },
    simulationTime: { ...m.simulationTime },
  };
}

function canonStopFreeze(m: StopFreezeModel): StopFreezeModel {
  return {
    ...m,
    header: { ...m.header, length: 40 },
    originatingEntityId: { ...m.originatingEntityId },
    receivingEntityId: { ...m.receivingEntityId },
    realWorldTime: { ...m.realWorldTime },
  };
}

function canonAny(p: AnyPdu): AnyPdu {
  switch (p.kind) {
    case "espdu":
      return { kind: "espdu", pdu: canonEspdu(p.pdu) };
    case "emission":
      return { kind: "emission", pdu: canonEmission(p.pdu) };
    case "fire":
      return { kind: "fire", pdu: canonFire(p.pdu) };
    case "detonation":
      return { kind: "detonation", pdu: canonDetonation(p.pdu) };
    case "startResume":
      return { kind: "startResume", pdu: canonStartResume(p.pdu) };
    case "stopFreeze":
      return { kind: "stopFreeze", pdu: canonStopFreeze(p.pdu) };
  }
}

function roundTrip(input: AnyPdu): Uint8Array {
  const wire = encodePdu(input);
  const res = decodePdu(wire);
  const reason = res.ok ? "" : res.reason;
  assert.ok(res.ok, `decode failed: ${reason}`);
  assert.deepStrictEqual(res.pdu, canonAny(input));
  return wire;
}

// ------------------------------------------------------------ fixed models

const ZERO_TYPE: EntityType = { kind: 0, domain: 0, country: 0, category: 0, subcategory: 0, specific: 0, extra: 0 };
const ZERO_V: Vec3 = { x: 0, y: 0, z: 0 };

const fpvType: EntityType = { kind: 1, domain: 2, country: 225, category: 50, subcategory: 4, specific: 1, extra: 0 };

const espduGolden: EspduModel = {
  header: mkHeader(PduType.EntityState, ProtocolFamily.EntityInformation),
  entityId: { site: 1, app: 3001, entity: 11 },
  forceId: 1,
  entityType: fpvType,
  altEntityType: ZERO_TYPE,
  linearVelocity: { x: 1, y: 2, z: 3 },
  location: { x: 6378137, y: 1000, z: 2000 },
  orientation: { psi: 0.1, theta: -0.2, phi: 0.3 },
  appearance: APPEARANCE_DESTROYED | APPEARANCE_FLAMING,
  drAlgorithm: 2,
  linearAcceleration: ZERO_V,
  angularVelocity: ZERO_V,
  marking: "B-sUAS-1",
  capabilities: 0,
};

const beamGolden: EmitterBeamModel = {
  beamIdNumber: 1,
  parameterIndex: 1200,
  frequencyHz: 9.6e9,
  frequencyRangeHz: 5e8,
  erpDbm: 43.5,
  prfHz: 1500,
  pulseWidthUs: 1.25,
  azimuthCenterRad: 0.5,
  azimuthSweepRad: 3.141592653589793,
  elevationCenterRad: -0.1,
  elevationSweepRad: 0.25,
  sweepSync: 0.75,
  beamFunction: 2,
  highDensityTrackJam: 0,
  jammingModeSequence: 0,
};

const emissionGolden: EmissionModel = {
  header: mkHeader(PduType.ElectromagneticEmission, ProtocolFamily.DistributedEmissionRegeneration),
  emittingEntityId: { site: 1, app: 3001, entity: 21 },
  eventId: { site: 1, app: 3001, number: 7 },
  stateUpdateIndicator: 0,
  systems: [
    {
      emitterName: 45300,
      emitterFunction: 2,
      emitterIdNumber: 1,
      location: { x: 0.25, y: 0, z: -0.5 },
      beams: [beamGolden],
    },
    {
      emitterName: 12345,
      emitterFunction: 9,
      emitterIdNumber: 2,
      location: { x: -1, y: 2.5, z: 0 },
      beams: [],
    },
  ],
};

// -------------------------------------------------------------- header

test("header: hand-computed golden bytes", () => {
  // 06 version | 01 exercise | 01 type | 01 family |
  // 12 34 56 78 timestamp | 00 90 length (144) | 00 00 padding
  const w = new BeWriter();
  encodeHeader(w, {
    protocolVersion: 6,
    exerciseId: 1,
    pduType: 1,
    protocolFamily: 1,
    timestamp: 0x12345678,
    length: 144,
  });
  assert.equal(w.length, 12);
  assert.equal(hex(w.bytes()), "060101011234567800900000");
});

test("header: decode returns the wire fields verbatim", () => {
  const h: PduHeader = {
    protocolVersion: 7,
    exerciseId: 42,
    pduType: 23,
    protocolFamily: 6,
    timestamp: 0xdeadbeef,
    length: 120,
  };
  const w = new BeWriter();
  encodeHeader(w, h);
  assert.deepStrictEqual(decodeHeader(new BeReader(w.bytes())), h);
});

test("writer/reader primitives: ascii framing, patch bounds, end-of-buffer", () => {
  const w = new BeWriter();
  w.ascii("HELLO WORLD!!", 11); // truncated to exactly 11 bytes
  w.ascii("AB", 4); // NUL-padded
  const b = w.bytes();
  assert.equal(b.length, 15);
  assert.equal(hex(b.subarray(0, 11)), "48454c4c4f20574f524c44");
  assert.equal(hex(b.subarray(11)), "41420000");

  const r = new BeReader(b);
  assert.equal(r.ascii(11), "HELLO WORLD");
  assert.equal(r.ascii(4), "AB"); // trailing NULs trimmed
  assert.equal(r.remaining, 0);
  assert.equal(r.offset, 15);
  assert.throws(() => r.u8(), RangeError);
  assert.throws(() => new BeReader(new Uint8Array(3)).u32(), RangeError);
  assert.throws(() => new BeReader(new Uint8Array(3)).skip(4), RangeError);

  // Embedded NUL survives; only trailing NULs trim.
  assert.equal(new BeReader(new Uint8Array([0x41, 0x00, 0x42, 0x00])).ascii(4), "A\0B");

  assert.throws(() => new BeWriter().patchU16(0, 1), RangeError); // nothing written yet
});

// -------------------------------------------------------------- espdu

test("espdu: golden byte spot-checks at hand-computed offsets", () => {
  // Offsets: header 0..11 | entityId site 12, app 14, entity 16 |
  // forceId 18, artCount 19 | entityType 20, altType 28 | velocity 36 |
  // location x@48 y@56 z@64 (f64) | orientation 72 | appearance 84 |
  // drAlgorithm 88, 15 zeros 89..103, accel 104, angVel 116 |
  // marking charset 128, chars 129..139 | capabilities 140.
  const wire = encodeEspdu(espduGolden);
  assert.equal(wire.length, 144);
  // Header identical to the golden header test (length patched to 144).
  assert.equal(hex(wire.subarray(0, 12)), "060101011234567800900000");

  const v = dv(wire);
  assert.equal(v.getUint16(12), 1); // site
  assert.equal(v.getUint16(14), 3001); // app
  assert.equal(v.getUint16(16), 11); // entity
  assert.equal(v.getUint8(18), 1); // forceId
  assert.equal(v.getUint8(19), 0); // articulation count
  assert.equal(v.getFloat64(48), 6378137); // location.x, f64 exact
  assert.equal(v.getUint32(84), APPEARANCE_DESTROYED | APPEARANCE_FLAMING);
  assert.equal(v.getUint8(88), 2); // DR algorithm
  assert.equal(v.getUint8(128), 1); // marking charset = ASCII
  // "B-sUAS-1" = 42 2d 73 55 41 53 2d 31, then 3 NUL pad bytes.
  assert.equal(hex(wire.subarray(129, 140)), "422d735541532d31000000");
});

test("espdu: round-trip, 144 bytes", () => {
  const wire = roundTrip({ kind: "espdu", pdu: espduGolden });
  assert.equal(wire.length, 144);
});

// ------------------------------------------------------------ emission

test("emission: round-trip with 2 systems (1 beam + 0 beams) exercises length math", () => {
  // 28 preamble + (20 + 52) + 20 = 120 bytes.
  // System 0 record at 28: systemDataLength (72/4 = 18 words) @28,
  // numberOfBeams @29, beamDataLength (13) @48. System 1 record at 100:
  // systemDataLength 5 words, 0 beams.
  const wire = roundTrip({ kind: "emission", pdu: emissionGolden });
  assert.equal(wire.length, 120);
  assert.equal(emissionByteLength(emissionGolden), 120);
  const v = dv(wire);
  assert.equal(v.getUint16(8), 120); // header length field
  assert.equal(v.getUint8(25), 2); // numberOfSystems
  assert.equal(v.getUint8(28), 18); // sys0 systemDataLength in words
  assert.equal(v.getUint8(29), 1); // sys0 beams
  assert.equal(v.getUint8(48), 13); // beam0 beamDataLength in words
  assert.equal(v.getUint8(100), 5); // sys1 systemDataLength in words
  assert.equal(v.getUint8(101), 0); // sys1 beams
});

// ------------------------------------------------------------- warfare

const fireGolden: FireModel = {
  header: mkHeader(PduType.Fire, ProtocolFamily.Warfare),
  firingEntityId: { site: 1, app: 3001, entity: 11 },
  targetEntityId: { site: 1, app: 3001, entity: 40 },
  munitionEntityId: { site: 1, app: 3001, entity: 90 },
  eventId: { site: 1, app: 3001, number: 3 },
  fireMissionIndex: 0,
  location: { x: 6378137.5, y: -1000.25, z: 2000.125 },
  burst: { munitionType: { ...fpvType, kind: 2 }, warhead: 1000, fuse: 100, quantity: 1, rate: 0 },
  velocity: { x: 30, y: -4, z: 0.5 },
  rangeM: 850,
};

const detonationGolden: DetonationModel = {
  header: mkHeader(PduType.Detonation, ProtocolFamily.Warfare),
  firingEntityId: { site: 1, app: 3001, entity: 11 },
  targetEntityId: { site: 1, app: 3001, entity: 40 },
  munitionEntityId: { site: 1, app: 3001, entity: 90 },
  eventId: { site: 1, app: 3001, number: 3 },
  velocity: { x: 30, y: -4, z: 0.5 },
  location: { x: 6378000, y: -990, z: 2010 },
  burst: { munitionType: { ...fpvType, kind: 2 }, warhead: 1000, fuse: 100, quantity: 1, rate: 0 },
  locationRelativeToEntity: { x: 0.5, y: -0.25, z: 1 },
  detonationResult: 1,
};

test("fire: round-trip, 96 bytes", () => {
  const wire = roundTrip({ kind: "fire", pdu: fireGolden });
  assert.equal(wire.length, 96);
});

test("detonation: round-trip, 104 bytes", () => {
  const wire = roundTrip({ kind: "detonation", pdu: detonationGolden });
  assert.equal(wire.length, 104);
});

// -------------------------------------------------------------- simman

test("start/resume: round-trip, 44 bytes", () => {
  const m: StartResumeModel = {
    header: mkHeader(PduType.StartResume, ProtocolFamily.SimulationManagement),
    originatingEntityId: { site: 1, app: 3001, entity: 0 },
    receivingEntityId: { site: 0xffff, app: 0xffff, entity: 0xffff },
    realWorldTime: { hour: 491978, timePastHour: 0x40000000 },
    simulationTime: { hour: 0, timePastHour: 0 },
    requestId: 7,
  };
  const wire = roundTrip({ kind: "startResume", pdu: m });
  assert.equal(wire.length, 44);
});

test("stop/freeze: round-trip, 40 bytes", () => {
  const m: StopFreezeModel = {
    header: mkHeader(PduType.StopFreeze, ProtocolFamily.SimulationManagement),
    originatingEntityId: { site: 1, app: 3001, entity: 0 },
    receivingEntityId: { site: 0xffff, app: 0xffff, entity: 0xffff },
    realWorldTime: { hour: 491978, timePastHour: 0x20000000 },
    reason: 2,
    frozenBehavior: 0,
    requestId: 8,
  };
  const wire = roundTrip({ kind: "stopFreeze", pdu: m });
  assert.equal(wire.length, 40);
});

// ---------------------------------------------------------------- fuzz

function rndId(r: Lcg): EntityId {
  return { site: r.u16(), app: r.u16(), entity: r.u16() };
}

function rndEvent(r: Lcg): EventId {
  return { site: r.u16(), app: r.u16(), number: r.u16() };
}

function rndType(r: Lcg): EntityType {
  return {
    kind: r.u8(),
    domain: r.u8(),
    country: r.u16(),
    category: r.u8(),
    subcategory: r.u8(),
    specific: r.u8(),
    extra: r.u8(),
  };
}

function rndVecF32(r: Lcg): Vec3 {
  return { x: r.f32(), y: r.f32(), z: r.f32() };
}

function rndVecF64(r: Lcg): Vec3 {
  return { x: r.f64(), y: r.f64(), z: r.f64() };
}

const MARK_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";

function rndMarking(r: Lcg): string {
  const n = r.int(12); // 0..11 chars, never NUL
  let s = "";
  for (let i = 0; i < n; i++) s += MARK_CHARS[r.int(MARK_CHARS.length)] ?? "A";
  return s;
}

function rndHeader(r: Lcg, pduType: number, protocolFamily: number): PduHeader {
  return {
    protocolVersion: 4 + r.int(4), // 4..7, all accepted by decodePdu
    exerciseId: r.u8(),
    pduType,
    protocolFamily,
    timestamp: r.u32(),
    length: r.u16(), // ignored by encode; canon substitutes the wire value
  };
}

function rndBeam(r: Lcg): EmitterBeamModel {
  return {
    beamIdNumber: r.u8(),
    parameterIndex: r.u16(),
    frequencyHz: Math.fround(r.float() * 4e10),
    frequencyRangeHz: Math.fround(r.float() * 1e9),
    erpDbm: r.f32(100),
    prfHz: Math.fround(r.float() * 1e5),
    pulseWidthUs: r.f32(50),
    azimuthCenterRad: r.f32(4),
    azimuthSweepRad: r.f32(4),
    elevationCenterRad: r.f32(2),
    elevationSweepRad: r.f32(2),
    sweepSync: r.f32(1),
    beamFunction: r.u8(),
    highDensityTrackJam: r.int(2),
    jammingModeSequence: r.u32(),
  };
}

function rndSystem(r: Lcg): EmitterSystemModel {
  const beams: EmitterBeamModel[] = [];
  const n = r.int(4); // 0..3
  for (let i = 0; i < n; i++) beams.push(rndBeam(r));
  return {
    emitterName: r.u16(),
    emitterFunction: r.u8(),
    emitterIdNumber: r.u8(),
    location: rndVecF32(r),
    beams,
  };
}

function rndPdu(r: Lcg, which: number): AnyPdu {
  switch (which) {
    case 0:
      return {
        kind: "espdu",
        pdu: {
          header: rndHeader(r, PduType.EntityState, ProtocolFamily.EntityInformation),
          entityId: rndId(r),
          forceId: r.u8(),
          entityType: rndType(r),
          altEntityType: rndType(r),
          linearVelocity: rndVecF32(r),
          location: rndVecF64(r),
          orientation: { psi: r.f32(4), theta: r.f32(2), phi: r.f32(4) },
          appearance: r.u32(),
          drAlgorithm: r.u8(),
          linearAcceleration: rndVecF32(r),
          angularVelocity: rndVecF32(r),
          marking: rndMarking(r),
          capabilities: r.u32(),
        },
      };
    case 1:
      return {
        kind: "fire",
        pdu: {
          header: rndHeader(r, PduType.Fire, ProtocolFamily.Warfare),
          firingEntityId: rndId(r),
          targetEntityId: rndId(r),
          munitionEntityId: rndId(r),
          eventId: rndEvent(r),
          fireMissionIndex: r.u32(),
          location: rndVecF64(r),
          burst: { munitionType: rndType(r), warhead: r.u16(), fuse: r.u16(), quantity: r.u16(), rate: r.u16() },
          velocity: rndVecF32(r),
          rangeM: Math.fround(r.float() * 1e5),
        },
      };
    case 2:
      return {
        kind: "detonation",
        pdu: {
          header: rndHeader(r, PduType.Detonation, ProtocolFamily.Warfare),
          firingEntityId: rndId(r),
          targetEntityId: rndId(r),
          munitionEntityId: rndId(r),
          eventId: rndEvent(r),
          velocity: rndVecF32(r),
          location: rndVecF64(r),
          burst: { munitionType: rndType(r), warhead: r.u16(), fuse: r.u16(), quantity: r.u16(), rate: r.u16() },
          locationRelativeToEntity: rndVecF32(r),
          detonationResult: r.u8(),
        },
      };
    case 3:
      return {
        kind: "startResume",
        pdu: {
          header: rndHeader(r, PduType.StartResume, ProtocolFamily.SimulationManagement),
          originatingEntityId: rndId(r),
          receivingEntityId: rndId(r),
          realWorldTime: { hour: r.u32(), timePastHour: r.u32() },
          simulationTime: { hour: r.u32(), timePastHour: r.u32() },
          requestId: r.u32(),
        },
      };
    case 4:
      return {
        kind: "stopFreeze",
        pdu: {
          header: rndHeader(r, PduType.StopFreeze, ProtocolFamily.SimulationManagement),
          originatingEntityId: rndId(r),
          receivingEntityId: rndId(r),
          realWorldTime: { hour: r.u32(), timePastHour: r.u32() },
          reason: r.u8(),
          frozenBehavior: r.u8(),
          requestId: r.u32(),
        },
      };
    default: {
      const systems: EmitterSystemModel[] = [];
      const n = r.int(4); // 0..3
      for (let i = 0; i < n; i++) systems.push(rndSystem(r));
      return {
        kind: "emission",
        pdu: {
          header: rndHeader(r, PduType.ElectromagneticEmission, ProtocolFamily.DistributedEmissionRegeneration),
          emittingEntityId: rndId(r),
          eventId: rndEvent(r),
          stateUpdateIndicator: r.u8(),
          systems,
        },
      };
    }
  }
}

test("fuzz: 300 seeded models encode->decode->deep-equal", () => {
  const r = new Lcg(0x00fab1e5);
  for (let i = 0; i < 300; i++) {
    const input = rndPdu(r, i % 6);
    try {
      roundTrip(input);
    } catch (err) {
      throw new Error(`fuzz case ${i} (${input.kind}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
});

// ----------------------------------------------------------- malformed

test("malformed: every truncation 0..20 of a valid espdu fails cleanly", () => {
  const full = encodeEspdu(espduGolden);
  for (let n = 0; n <= 20; n++) {
    const res = decodePdu(full.subarray(0, n)); // must not throw
    assert.equal(res.ok, false, `truncated to ${n} bytes must fail`);
  }
});

test("malformed: 100 seeded noise buffers never throw and never decode", () => {
  const r = new Lcg(0x0bad5eed);
  for (let c = 0; c < 100; c++) {
    const len = r.int(201);
    const buf = new Uint8Array(len);
    for (let i = 0; i < len; i++) buf[i] = r.u8();
    const res = decodePdu(buf); // must not throw
    assert.equal(res.ok, false, `noise case ${c} (len ${len}, head ${hex(buf.subarray(0, 12))})`);
  }
});

test("malformed: lying systemDataLength is rejected with a clear reason", () => {
  const wire = encodePdu({ kind: "emission", pdu: emissionGolden }).slice();
  assert.equal(wire[28], 18);
  wire[28] = 7; // claim 7 words for a 1-beam system (needs 18)
  const res = decodePdu(wire);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /systemDataLength 7 words, expected 18/);
});

test("malformed: unknown pdu type and out-of-range protocol version", () => {
  const wire = encodeEspdu(espduGolden);

  const badType = wire.slice();
  badType[2] = 99;
  const r1 = decodePdu(badType);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.reason, "unsupported pdu type 99");

  const badVersionLow = wire.slice();
  badVersionLow[0] = 3;
  const r2 = decodePdu(badVersionLow);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.reason, "unsupported protocol version 3");

  const badVersionHigh = wire.slice();
  badVersionHigh[0] = 8;
  assert.equal(decodePdu(badVersionHigh).ok, false);

  assert.equal(decodePdu(new Uint8Array(0)).ok, false);
});

// ---------------------------------------------------------- timestamps

test("timestamps: golden 30-minute value, flag round-trip, inverse within 2 ms", () => {
  // 30 min past hour: fraction 0.5 -> units = floor(0.5 * 2^31) =
  // 0x40000000 -> field = units << 1 = 0x80000000 (relative), +1 absolute.
  assert.equal(disTimestamp(30 * 60 * 1000, false), 0x80000000);
  assert.equal(disTimestamp(7 * 3_600_000 + 30 * 60 * 1000, true), 0x80000001);
  assert.deepStrictEqual(timestampToSecondsPastHour(0x80000000), { seconds: 1800, absolute: false });
  assert.deepStrictEqual(timestampToSecondsPastHour(0x80000001), { seconds: 1800, absolute: true });

  const cases: Array<[number, boolean]> = [
    [0, false],
    [1, true],
    [59_999, false],
    [123_456, true],
    [1_799_999, false],
    [3_599_999, true],
  ];
  for (const [ms, absolute] of cases) {
    const field = disTimestamp(ms, absolute);
    const back = timestampToSecondsPastHour(field);
    assert.equal(back.absolute, absolute, `flag for ${ms} ms`);
    assert.ok(Math.abs(back.seconds * 1000 - ms) <= 2, `inverse of ${ms} ms gave ${back.seconds * 1000} ms`);
  }

  // Whole hours wrap to zero; the flag bit is still honored.
  assert.equal(disTimestamp(3_600_000, false), 0);
  assert.equal(disTimestamp(2 * 3_600_000, true), 1);
});
