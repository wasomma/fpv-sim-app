/*
 * Wire entry points. decodePdu never throws: short buffers, protocol
 * versions outside 4..7, unknown PDU types, and lying length fields
 * all come back { ok: false, reason }. encodePdu writes the model's
 * header verbatim except its length, which every encoder recomputes.
 */

import type { AnyPdu } from "../types.js";
import { PduType } from "../types.js";
import { BeReader } from "./reader.js";
import { decodeHeader } from "./header.js";
import { decodeEspdu, encodeEspdu } from "./espdu.js";
import { decodeEmission, encodeEmission } from "./emission.js";
import { decodeDetonation, decodeFire, encodeDetonation, encodeFire } from "./warfare.js";
import { decodeStartResume, decodeStopFreeze, encodeStartResume, encodeStopFreeze } from "./simman.js";

export type DecodeResult = { ok: true; pdu: AnyPdu } | { ok: false; reason: string };

const MIN_PROTOCOL_VERSION = 4;
const MAX_PROTOCOL_VERSION = 7;

export function decodePdu(buf: Uint8Array): DecodeResult {
  try {
    const r = new BeReader(buf);
    const header = decodeHeader(r);
    if (header.protocolVersion < MIN_PROTOCOL_VERSION || header.protocolVersion > MAX_PROTOCOL_VERSION) {
      return { ok: false, reason: `unsupported protocol version ${header.protocolVersion}` };
    }
    switch (header.pduType) {
      case PduType.EntityState:
        return { ok: true, pdu: { kind: "espdu", pdu: decodeEspdu(r, header) } };
      case PduType.Fire:
        return { ok: true, pdu: { kind: "fire", pdu: decodeFire(r, header) } };
      case PduType.Detonation:
        return { ok: true, pdu: { kind: "detonation", pdu: decodeDetonation(r, header) } };
      case PduType.StartResume:
        return { ok: true, pdu: { kind: "startResume", pdu: decodeStartResume(r, header) } };
      case PduType.StopFreeze:
        return { ok: true, pdu: { kind: "stopFreeze", pdu: decodeStopFreeze(r, header) } };
      case PduType.ElectromagneticEmission:
        return { ok: true, pdu: { kind: "emission", pdu: decodeEmission(r, header) } };
      default:
        return { ok: false, reason: `unsupported pdu type ${header.pduType}` };
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function encodePdu(p: AnyPdu): Uint8Array {
  switch (p.kind) {
    case "espdu":
      return encodeEspdu(p.pdu);
    case "fire":
      return encodeFire(p.pdu);
    case "detonation":
      return encodeDetonation(p.pdu);
    case "startResume":
      return encodeStartResume(p.pdu);
    case "stopFreeze":
      return encodeStopFreeze(p.pdu);
    case "emission":
      return encodeEmission(p.pdu);
    default: {
      const never: never = p;
      throw new Error(`unreachable pdu kind ${JSON.stringify(never)}`);
    }
  }
}
