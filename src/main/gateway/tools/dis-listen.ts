/*
 * dis-listen — standalone DIS traffic monitor for debugging and two-node
 * dry runs (stands in for VBS when none is on the LAN).
 *
 *   node dist/src/main/gateway/tools/dis-listen.js \
 *     [--port 3000] [--mode broadcast|multicast|unicast] \
 *     [--group 239.1.2.3] [--interface 192.168.1.20] [--anchor lat,lon]
 *
 * Prints one line per decoded PDU; with --anchor, ESPDU positions are
 * also shown in the sim's local frame. Runs under plain node — no
 * Electron required.
 */

import { parseArgs } from "node:util";
import { decodePdu } from "../codec/factory.js";
import { DEFAULT_GATEWAY_CONFIG } from "../config.js";
import { LocalFrame } from "../geo/localframe.js";
import { DisSocket } from "../net/udp.js";
import { timestampToSecondsPastHour } from "../codec/header.js";

const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: "3000" },
    mode: { type: "string", default: "broadcast" },
    group: { type: "string", default: "239.1.2.3" },
    interface: { type: "string" },
    anchor: { type: "string" },
  },
});

const mode = args.mode as "broadcast" | "multicast" | "unicast";
const frame =
  args.anchor !== undefined
    ? new LocalFrame({
        lat0Deg: Number(args.anchor.split(",")[0]),
        lon0Deg: Number(args.anchor.split(",")[1]),
        h0M: 0,
        rotationDeg: 0,
        geoidOffsetM: 0,
      })
    : null;

const socket = new DisSocket({
  ...DEFAULT_GATEWAY_CONFIG.network,
  mode,
  port: Number(args.port),
  multicastGroup: args.group ?? "239.1.2.3",
  interface: args.interface ?? null,
});

const id = (e: { site: number; app: number; entity: number }) => `${e.site}:${e.app}:${e.entity}`;
const fmt = (n: number, digits = 1) => n.toFixed(digits);

socket.onPacket((data, from) => {
  const decoded = decodePdu(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  const stamp = new Date().toISOString().slice(11, 23);
  if (!decoded.ok) {
    console.log(`${stamp} ${from} MALFORMED ${data.length}B: ${decoded.reason}`);
    return;
  }
  const p = decoded.pdu;
  const ts = timestampToSecondsPastHour(p.pdu.header.timestamp);
  const head = `${stamp} ${from} ex${p.pdu.header.exerciseId} t+${fmt(ts.seconds, 2)}${ts.absolute ? "Z" : "r"}`;
  switch (p.kind) {
    case "espdu": {
      const e = p.pdu;
      let pos = `ecef(${fmt(e.location.x, 0)},${fmt(e.location.y, 0)},${fmt(e.location.z, 0)})`;
      if (frame !== null) {
        const l = frame.ecefToLocal(e.location);
        pos = `local(${fmt(l.x, 0)},${fmt(l.y, 0)},${fmt(l.z, 0)})`;
      }
      const spd = Math.hypot(e.linearVelocity.x, e.linearVelocity.y, e.linearVelocity.z);
      console.log(
        `${head} ESPDU ${id(e.entityId)} "${e.marking}" force${e.forceId} ` +
          `${pos} spd ${fmt(spd)} dr${e.drAlgorithm} app 0x${e.appearance.toString(16)}`,
      );
      break;
    }
    case "emission": {
      const s = p.pdu.systems[0];
      const beam = s?.beams[0];
      console.log(
        `${head} EE ${id(p.pdu.emittingEntityId)} systems ${p.pdu.systems.length} ` +
          (beam !== undefined
            ? `KEYED ${fmt(beam.frequencyHz / 1e6, 1)} MHz erp ${fmt(beam.erpDbm, 0)} dBm`
            : "SILENT (0 beams)"),
      );
      break;
    }
    case "fire":
      console.log(`${head} FIRE ${id(p.pdu.firingEntityId)} -> ${id(p.pdu.targetEntityId)}`);
      break;
    case "detonation":
      console.log(
        `${head} DETONATION ${id(p.pdu.firingEntityId)} -> ${id(p.pdu.targetEntityId)} result ${p.pdu.detonationResult}`,
      );
      break;
    case "startResume":
      console.log(`${head} START/RESUME req ${p.pdu.requestId}`);
      break;
    case "stopFreeze":
      console.log(`${head} STOP/FREEZE reason ${p.pdu.reason} req ${p.pdu.requestId}`);
      break;
  }
});

await socket.open();
console.log(
  `dis-listen: ${mode} port ${args.port}` +
    (mode === "multicast" ? ` group ${args.group}` : "") +
    (args.interface !== undefined ? ` iface ${args.interface}` : "") +
    (frame !== null ? ` anchor ${args.anchor}` : "") +
    " — ctrl-c to stop",
);
