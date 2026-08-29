/*
 * Simulation-management family (5): Start/Resume (type 13, fixed 44
 * bytes) and Stop/Freeze (type 14, fixed 40 bytes). ClockTime on the
 * wire is two u32s (hour, timePastHour) — no sign handling, matching
 * the model.
 */

import type { ClockTime, PduHeader, StartResumeModel, StopFreezeModel } from "../types.js";
import { BeWriter } from "./writer.js";
import { BeReader } from "./reader.js";
import { decodeEntityId, encodeEntityId, encodeHeader, finishPdu } from "./header.js";

export const START_RESUME_BYTES = 44;
export const STOP_FREEZE_BYTES = 40;

function encodeClockTime(w: BeWriter, t: ClockTime): void {
  w.u32(t.hour);
  w.u32(t.timePastHour);
}

function decodeClockTime(r: BeReader): ClockTime {
  return { hour: r.u32(), timePastHour: r.u32() };
}

export function encodeStartResume(m: StartResumeModel): Uint8Array {
  const w = new BeWriter(START_RESUME_BYTES);
  encodeHeader(w, m.header);
  encodeEntityId(w, m.originatingEntityId);
  encodeEntityId(w, m.receivingEntityId);
  encodeClockTime(w, m.realWorldTime);
  encodeClockTime(w, m.simulationTime);
  w.u32(m.requestId);
  return finishPdu(w);
}

/** `r` positioned just past the 12-byte header. */
export function decodeStartResume(r: BeReader, header: PduHeader): StartResumeModel {
  const originatingEntityId = decodeEntityId(r);
  const receivingEntityId = decodeEntityId(r);
  const realWorldTime = decodeClockTime(r);
  const simulationTime = decodeClockTime(r);
  const requestId = r.u32();
  return { header, originatingEntityId, receivingEntityId, realWorldTime, simulationTime, requestId };
}

export function encodeStopFreeze(m: StopFreezeModel): Uint8Array {
  const w = new BeWriter(STOP_FREEZE_BYTES);
  encodeHeader(w, m.header);
  encodeEntityId(w, m.originatingEntityId);
  encodeEntityId(w, m.receivingEntityId);
  encodeClockTime(w, m.realWorldTime);
  w.u8(m.reason);
  w.u8(m.frozenBehavior);
  w.u16(0);
  w.u32(m.requestId);
  return finishPdu(w);
}

/** `r` positioned just past the 12-byte header. */
export function decodeStopFreeze(r: BeReader, header: PduHeader): StopFreezeModel {
  const originatingEntityId = decodeEntityId(r);
  const receivingEntityId = decodeEntityId(r);
  const realWorldTime = decodeClockTime(r);
  const reason = r.u8();
  const frozenBehavior = r.u8();
  r.skip(2);
  const requestId = r.u32();
  return { header, originatingEntityId, receivingEntityId, realWorldTime, reason, frozenBehavior, requestId };
}
