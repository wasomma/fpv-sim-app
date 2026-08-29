/*
 * Warfare family (2): Fire (type 2, fixed 96 bytes) and Detonation
 * (type 3, fixed 104 bytes with 0 articulation parameters — encode
 * writes a count of 0, decode ignores trailing articulation blocks).
 * Burst descriptor is 16 bytes: munition EntityType(8), warhead u16,
 * fuse u16, quantity u16, rate u16. Detonation trailing order is
 * result u8, articulation count u8, pad u16.
 */

import type { BurstDescriptor, DetonationModel, FireModel, PduHeader } from "../types.js";
import { BeWriter } from "./writer.js";
import { BeReader } from "./reader.js";
import {
  decodeEntityId,
  decodeEntityType,
  decodeEventId,
  decodeVec3f32,
  decodeVec3f64,
  encodeEntityId,
  encodeEntityType,
  encodeEventId,
  encodeHeader,
  encodeVec3f32,
  encodeVec3f64,
  finishPdu,
} from "./header.js";

export const FIRE_BYTES = 96;
export const DETONATION_BYTES = 104;

function encodeBurst(w: BeWriter, b: BurstDescriptor): void {
  encodeEntityType(w, b.munitionType);
  w.u16(b.warhead);
  w.u16(b.fuse);
  w.u16(b.quantity);
  w.u16(b.rate);
}

function decodeBurst(r: BeReader): BurstDescriptor {
  return {
    munitionType: decodeEntityType(r),
    warhead: r.u16(),
    fuse: r.u16(),
    quantity: r.u16(),
    rate: r.u16(),
  };
}

export function encodeFire(m: FireModel): Uint8Array {
  const w = new BeWriter(FIRE_BYTES);
  encodeHeader(w, m.header);
  encodeEntityId(w, m.firingEntityId);
  encodeEntityId(w, m.targetEntityId);
  encodeEntityId(w, m.munitionEntityId);
  encodeEventId(w, m.eventId);
  w.u32(m.fireMissionIndex);
  encodeVec3f64(w, m.location);
  encodeBurst(w, m.burst);
  encodeVec3f32(w, m.velocity);
  w.f32(m.rangeM);
  return finishPdu(w);
}

/** `r` positioned just past the 12-byte header. */
export function decodeFire(r: BeReader, header: PduHeader): FireModel {
  const firingEntityId = decodeEntityId(r);
  const targetEntityId = decodeEntityId(r);
  const munitionEntityId = decodeEntityId(r);
  const eventId = decodeEventId(r);
  const fireMissionIndex = r.u32();
  const location = decodeVec3f64(r);
  const burst = decodeBurst(r);
  const velocity = decodeVec3f32(r);
  const rangeM = r.f32();
  return {
    header,
    firingEntityId,
    targetEntityId,
    munitionEntityId,
    eventId,
    fireMissionIndex,
    location,
    burst,
    velocity,
    rangeM,
  };
}

export function encodeDetonation(m: DetonationModel): Uint8Array {
  const w = new BeWriter(DETONATION_BYTES);
  encodeHeader(w, m.header);
  encodeEntityId(w, m.firingEntityId);
  encodeEntityId(w, m.targetEntityId);
  encodeEntityId(w, m.munitionEntityId);
  encodeEventId(w, m.eventId);
  encodeVec3f32(w, m.velocity);
  encodeVec3f64(w, m.location);
  encodeBurst(w, m.burst);
  encodeVec3f32(w, m.locationRelativeToEntity);
  w.u8(m.detonationResult);
  w.u8(0); // numberOfArticulationParameters
  w.u16(0);
  return finishPdu(w);
}

/** `r` positioned just past the 12-byte header. */
export function decodeDetonation(r: BeReader, header: PduHeader): DetonationModel {
  const firingEntityId = decodeEntityId(r);
  const targetEntityId = decodeEntityId(r);
  const munitionEntityId = decodeEntityId(r);
  const eventId = decodeEventId(r);
  const velocity = decodeVec3f32(r);
  const location = decodeVec3f64(r);
  const burst = decodeBurst(r);
  const locationRelativeToEntity = decodeVec3f32(r);
  const detonationResult = r.u8();
  r.u8(); // articulation count: records trail the base and carry no model fields
  r.skip(2);
  return {
    header,
    firingEntityId,
    targetEntityId,
    munitionEntityId,
    eventId,
    velocity,
    location,
    burst,
    locationRelativeToEntity,
    detonationResult,
  };
}
