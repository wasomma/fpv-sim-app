/*
 * Electromagnetic Emission PDU (type 23, family 6). Wire form:
 *   preamble 28 bytes — header 12, emittingEntityId 6, eventId 6,
 *   stateUpdateIndicator u8, numberOfSystems u8, pad u16;
 *   system record 20 + 52*beams bytes — systemDataLength counts the
 *   WHOLE system record in 32-bit words (5 + 13*beams), covering its
 *   own header, the emitter-system record, the location, and every
 *   beam;
 *   beam record 52 bytes — beamDataLength = 13 words.
 * Encode derives every count/length field from the model and rejects
 * shapes the u8 fields cannot express (> 255 systems, > 19 beams per
 * system). Decode rejects declared lengths that disagree with this
 * layout and beams carrying track/jam target records
 * (numberOfTargets != 0): the model has no place for either.
 */

import type { EmissionModel, EmitterBeamModel, EmitterSystemModel, PduHeader } from "../types.js";
import { BeWriter } from "./writer.js";
import { BeReader } from "./reader.js";
import {
  decodeEntityId,
  decodeEventId,
  decodeVec3f32,
  encodeEntityId,
  encodeEventId,
  encodeHeader,
  encodeVec3f32,
  finishPdu,
} from "./header.js";

export const EMISSION_PREAMBLE_BYTES = 28;
export const EMISSION_SYSTEM_HEADER_BYTES = 20;
export const EMISSION_BEAM_BYTES = 52;

const SYSTEM_HEADER_WORDS = EMISSION_SYSTEM_HEADER_BYTES / 4; // 5
const BEAM_WORDS = EMISSION_BEAM_BYTES / 4; // 13

/** Total wire bytes encodeEmission will produce for this model. */
export function emissionByteLength(m: EmissionModel): number {
  let n = EMISSION_PREAMBLE_BYTES;
  for (const s of m.systems) n += EMISSION_SYSTEM_HEADER_BYTES + EMISSION_BEAM_BYTES * s.beams.length;
  return n;
}

export function encodeEmission(m: EmissionModel): Uint8Array {
  if (m.systems.length > 0xff) {
    throw new RangeError(`numberOfSystems ${m.systems.length} exceeds the u8 field`);
  }
  const w = new BeWriter(emissionByteLength(m));
  encodeHeader(w, m.header);
  encodeEntityId(w, m.emittingEntityId);
  encodeEventId(w, m.eventId);
  w.u8(m.stateUpdateIndicator);
  w.u8(m.systems.length);
  w.u16(0);
  for (const s of m.systems) {
    const words = SYSTEM_HEADER_WORDS + BEAM_WORDS * s.beams.length;
    if (words > 0xff) {
      throw new RangeError(`systemDataLength ${words} words exceeds the u8 field (${s.beams.length} beams)`);
    }
    w.u8(words);
    w.u8(s.beams.length);
    w.u16(0);
    w.u16(s.emitterName);
    w.u8(s.emitterFunction);
    w.u8(s.emitterIdNumber);
    encodeVec3f32(w, s.location);
    for (const b of s.beams) encodeBeam(w, b);
  }
  return finishPdu(w);
}

function encodeBeam(w: BeWriter, b: EmitterBeamModel): void {
  w.u8(BEAM_WORDS);
  w.u8(b.beamIdNumber);
  w.u16(b.parameterIndex);
  w.f32(b.frequencyHz);
  w.f32(b.frequencyRangeHz);
  w.f32(b.erpDbm);
  w.f32(b.prfHz);
  w.f32(b.pulseWidthUs);
  w.f32(b.azimuthCenterRad);
  w.f32(b.azimuthSweepRad);
  w.f32(b.elevationCenterRad);
  w.f32(b.elevationSweepRad);
  w.f32(b.sweepSync);
  w.u8(b.beamFunction);
  w.u8(0); // numberOfTargets: track/jam records unsupported
  w.u8(b.highDensityTrackJam);
  w.u8(0);
  w.u32(b.jammingModeSequence);
}

/** `r` positioned just past the 12-byte header. */
export function decodeEmission(r: BeReader, header: PduHeader): EmissionModel {
  const emittingEntityId = decodeEntityId(r);
  const eventId = decodeEventId(r);
  const stateUpdateIndicator = r.u8();
  const numberOfSystems = r.u8();
  r.skip(2);
  const systems: EmitterSystemModel[] = [];
  for (let i = 0; i < numberOfSystems; i++) {
    const declaredWords = r.u8();
    const numberOfBeams = r.u8();
    r.skip(2);
    const expectedWords = SYSTEM_HEADER_WORDS + BEAM_WORDS * numberOfBeams;
    if (declaredWords !== expectedWords) {
      throw new Error(
        `emission system ${i}: systemDataLength ${declaredWords} words, expected ${expectedWords} for ${numberOfBeams} beam(s)`,
      );
    }
    const emitterName = r.u16();
    const emitterFunction = r.u8();
    const emitterIdNumber = r.u8();
    const location = decodeVec3f32(r);
    const beams: EmitterBeamModel[] = [];
    for (let j = 0; j < numberOfBeams; j++) beams.push(decodeBeam(r, i, j));
    systems.push({ emitterName, emitterFunction, emitterIdNumber, location, beams });
  }
  return { header, emittingEntityId, eventId, stateUpdateIndicator, systems };
}

function decodeBeam(r: BeReader, sysIndex: number, beamIndex: number): EmitterBeamModel {
  const declaredWords = r.u8();
  if (declaredWords !== BEAM_WORDS) {
    throw new Error(
      `emission system ${sysIndex} beam ${beamIndex}: beamDataLength ${declaredWords} words, expected ${BEAM_WORDS}`,
    );
  }
  const beamIdNumber = r.u8();
  const parameterIndex = r.u16();
  const frequencyHz = r.f32();
  const frequencyRangeHz = r.f32();
  const erpDbm = r.f32();
  const prfHz = r.f32();
  const pulseWidthUs = r.f32();
  const azimuthCenterRad = r.f32();
  const azimuthSweepRad = r.f32();
  const elevationCenterRad = r.f32();
  const elevationSweepRad = r.f32();
  const sweepSync = r.f32();
  const beamFunction = r.u8();
  const numberOfTargets = r.u8();
  if (numberOfTargets !== 0) {
    throw new Error(
      `emission system ${sysIndex} beam ${beamIndex}: ${numberOfTargets} track/jam target record(s) unsupported`,
    );
  }
  const highDensityTrackJam = r.u8();
  r.skip(1);
  const jammingModeSequence = r.u32();
  return {
    beamIdNumber,
    parameterIndex,
    frequencyHz,
    frequencyRangeHz,
    erpDbm,
    prfHz,
    pulseWidthUs,
    azimuthCenterRad,
    azimuthSweepRad,
    elevationCenterRad,
    elevationSweepRad,
    sweepSync,
    beamFunction,
    highDensityTrackJam,
    jammingModeSequence,
  };
}
