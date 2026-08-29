/*
 * Entity State PDU (type 1, family 1). Fixed 144-byte wire form:
 * articulation parameters are outside the model — encode always writes
 * a count of 0; decode reads the 144-byte base record and ignores any
 * trailing articulation blocks (they sit after capabilities). Marking
 * is charset 1 (ASCII) + 11 bytes, NUL-padded: longer strings truncate
 * on encode, trailing NULs trim on decode, the charset byte itself is
 * not round-tripped.
 *
 * Offsets from PDU start: entityId 12, forceId 18, artCount 19,
 * entityType 20, altEntityType 28, linearVelocity 36 (3xf32),
 * location 48 (3xf64), orientation 72 (3xf32 psi/theta/phi),
 * appearance 84, DR block 88 (u8 algorithm + 15 zero bytes +
 * accel 3xf32 + angVel 3xf32), marking 128, capabilities 140.
 */

import type { EspduModel, PduHeader } from "../types.js";
import { BeWriter } from "./writer.js";
import { BeReader } from "./reader.js";
import {
  decodeEntityId,
  decodeEntityType,
  decodeVec3f32,
  decodeVec3f64,
  encodeEntityId,
  encodeEntityType,
  encodeHeader,
  encodeVec3f32,
  encodeVec3f64,
  finishPdu,
} from "./header.js";

export const ESPDU_BYTES = 144;

const MARKING_CHARSET_ASCII = 1;
const MARKING_CHARS = 11;
const DR_OTHER_PARAMS_BYTES = 15;

export function encodeEspdu(m: EspduModel): Uint8Array {
  const w = new BeWriter(ESPDU_BYTES);
  encodeHeader(w, m.header);
  encodeEntityId(w, m.entityId);
  w.u8(m.forceId);
  w.u8(0); // numberOfArticulationParameters
  encodeEntityType(w, m.entityType);
  encodeEntityType(w, m.altEntityType);
  encodeVec3f32(w, m.linearVelocity);
  encodeVec3f64(w, m.location);
  w.f32(m.orientation.psi);
  w.f32(m.orientation.theta);
  w.f32(m.orientation.phi);
  w.u32(m.appearance);
  w.u8(m.drAlgorithm);
  w.zeros(DR_OTHER_PARAMS_BYTES);
  encodeVec3f32(w, m.linearAcceleration);
  encodeVec3f32(w, m.angularVelocity);
  w.u8(MARKING_CHARSET_ASCII);
  w.ascii(m.marking, MARKING_CHARS);
  w.u32(m.capabilities);
  return finishPdu(w);
}

/** `r` positioned just past the 12-byte header. */
export function decodeEspdu(r: BeReader, header: PduHeader): EspduModel {
  const entityId = decodeEntityId(r);
  const forceId = r.u8();
  r.u8(); // articulation count: records trail the base and carry no model fields
  const entityType = decodeEntityType(r);
  const altEntityType = decodeEntityType(r);
  const linearVelocity = decodeVec3f32(r);
  const location = decodeVec3f64(r);
  const orientation = { psi: r.f32(), theta: r.f32(), phi: r.f32() };
  const appearance = r.u32();
  const drAlgorithm = r.u8();
  r.skip(DR_OTHER_PARAMS_BYTES);
  const linearAcceleration = decodeVec3f32(r);
  const angularVelocity = decodeVec3f32(r);
  r.u8(); // marking charset: the 11-byte layout is fixed regardless of declared set
  const marking = r.ascii(MARKING_CHARS);
  const capabilities = r.u32();
  return {
    header,
    entityId,
    forceId,
    entityType,
    altEntityType,
    linearVelocity,
    location,
    orientation,
    appearance,
    drAlgorithm,
    linearAcceleration,
    angularVelocity,
    marking,
    capabilities,
  };
}
