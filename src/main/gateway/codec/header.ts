/*
 * The 12-byte PDU header, the DIS timestamp scale, and the wire
 * fragments shared by more than one body codec (EntityId, EventId,
 * EntityType, Vec3 in f32/f64).
 *
 * Header offsets: version 0, exercise 1, type 2, family 3, timestamp 4,
 * length 8, pad 10. Encoders never trust the model's header.length:
 * finishPdu patches the true byte count at offset 8. decodeHeader
 * returns the wire value untouched.
 *
 * Timestamp field: one hour = 2^31 units (3600 s / 2^31 per unit),
 * value = unitsPastHour << 1 | absoluteFlag. The shift is done in
 * doubles — units can reach 2^31 - 1, so `<<` would overflow the
 * signed 32-bit bitwise range.
 */

import type { EntityId, EntityType, EventId, PduHeader, Vec3 } from "../types.js";
import { BeWriter } from "./writer.js";
import { BeReader } from "./reader.js";

export const HEADER_BYTES = 12;
export const LENGTH_OFFSET = 8;

export function encodeHeader(w: BeWriter, h: PduHeader): void {
  w.u8(h.protocolVersion);
  w.u8(h.exerciseId);
  w.u8(h.pduType);
  w.u8(h.protocolFamily);
  w.u32(h.timestamp);
  w.u16(h.length);
  w.u16(0);
}

export function decodeHeader(r: BeReader): PduHeader {
  const protocolVersion = r.u8();
  const exerciseId = r.u8();
  const pduType = r.u8();
  const protocolFamily = r.u8();
  const timestamp = r.u32();
  const length = r.u16();
  r.skip(2);
  return { protocolVersion, exerciseId, pduType, protocolFamily, timestamp, length };
}

/** Patches the true encoded length into the header and returns the wire bytes. */
export function finishPdu(w: BeWriter, lengthOffset: number = LENGTH_OFFSET): Uint8Array {
  if (w.length > 0xffff) throw new RangeError(`PDU length ${w.length} exceeds the u16 header field`);
  w.patchU16(lengthOffset, w.length);
  return w.bytes();
}

const MS_PER_HOUR = 3_600_000;
const UNITS_PER_HOUR = 0x80000000; // 2^31

export function disTimestamp(wallMs: number, absolute: boolean): number {
  const msPastHour = ((wallMs % MS_PER_HOUR) + MS_PER_HOUR) % MS_PER_HOUR;
  const units = Math.floor((msPastHour / MS_PER_HOUR) * UNITS_PER_HOUR);
  return (units * 2 + (absolute ? 1 : 0)) >>> 0;
}

export function timestampToSecondsPastHour(field: number): { seconds: number; absolute: boolean } {
  const absolute = (field & 1) === 1;
  const units = field >>> 1;
  return { seconds: (units / UNITS_PER_HOUR) * 3600, absolute };
}

export function encodeEntityId(w: BeWriter, id: EntityId): void {
  w.u16(id.site);
  w.u16(id.app);
  w.u16(id.entity);
}

export function decodeEntityId(r: BeReader): EntityId {
  return { site: r.u16(), app: r.u16(), entity: r.u16() };
}

export function encodeEventId(w: BeWriter, id: EventId): void {
  w.u16(id.site);
  w.u16(id.app);
  w.u16(id.number);
}

export function decodeEventId(r: BeReader): EventId {
  return { site: r.u16(), app: r.u16(), number: r.u16() };
}

export function encodeEntityType(w: BeWriter, t: EntityType): void {
  w.u8(t.kind);
  w.u8(t.domain);
  w.u16(t.country);
  w.u8(t.category);
  w.u8(t.subcategory);
  w.u8(t.specific);
  w.u8(t.extra);
}

export function decodeEntityType(r: BeReader): EntityType {
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

export function encodeVec3f32(w: BeWriter, v: Vec3): void {
  w.f32(v.x);
  w.f32(v.y);
  w.f32(v.z);
}

export function decodeVec3f32(r: BeReader): Vec3 {
  return { x: r.f32(), y: r.f32(), z: r.f32() };
}

export function encodeVec3f64(w: BeWriter, v: Vec3): void {
  w.f64(v.x);
  w.f64(v.y);
  w.f64(v.z);
}

export function decodeVec3f64(r: BeReader): Vec3 {
  return { x: r.f64(), y: r.f64(), z: r.f64() };
}
