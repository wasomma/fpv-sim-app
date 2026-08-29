/*
 * interop-check — proves the DIS wire format against a SECOND,
 * independent implementation of IEEE 1278.1 (open-dis-python), closing
 * the circularity of testing our codec against itself. Two phases:
 *
 *   A. The real publisher stack (engine seed 20260719 orbit ->
 *      buildTickView -> Publisher -> DisSocket) streams a full
 *      engagement over UDP loopback to `tools/dis-crosscheck.py
 *      receive`, which decodes every datagram with open-dis and scores
 *      the stream (types, lengths, identity, geodesy, markings, EE
 *      beams). The Python scorecard must pass AND its counts must
 *      exactly match the publisher's own counters (zero datagram loss).
 *
 *   B. `dis-crosscheck.py send` emits an ESPDU orbit encoded by
 *      open-dis's encoder at a DisGateway with the receive path armed;
 *      the entity must appear as an overlay track with the sender's
 *      site:app within 10 s.
 *
 * Port topology (Windows-safe): DisSocket always binds its own receive
 * socket on the port it sends to, so the app side binds interface
 * 127.0.0.2 while Python binds 127.0.0.1 on the same port — unicast
 * best-match delivery then routes every datagram to Python and none to
 * the app's rx socket (verified: specific-address bind wins).
 *
 * Also: `--write-pcap <file>` renders the first 60 s of the same golden
 * engagement (1x synthetic clock, fixed epoch — byte-deterministic)
 * through the publisher path into a classic pcap via PcapWriter, then
 * structurally validates every record. Used to generate the committed
 * docs/captures/seed-20260719-orbit.pcap.
 *
 * Plain node, no Electron. Exits nonzero on any failure.
 */

import { spawn, spawnSync } from "node:child_process";
import dgram from "node:dgram";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Simulation } from "fpv-sim-mcp/engine";
import { buildTickView } from "../dist/src/main/sessions/tick-view.js";
import { validateGatewayConfig } from "../dist/src/main/gateway/config.js";
import { LocalFrame } from "../dist/src/main/gateway/geo/localframe.js";
import { IdAllocator } from "../dist/src/main/gateway/publish/ids.js";
import { Publisher } from "../dist/src/main/gateway/publish/publisher.js";
import { encodePdu } from "../dist/src/main/gateway/codec/factory.js";
import { DisSocket } from "../dist/src/main/gateway/net/udp.js";
import { DisGateway } from "../dist/src/main/gateway/index.js";
import { PcapWriter } from "../dist/src/main/gateway/tools/pcap.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const crosscheckPy = path.join(root, "tools", "dis-crosscheck.py");

const SEED = 20260719;
const ANCHOR = { lat0Deg: 21.35, lon0Deg: -157.95 };
const ANCHOR_ARG = "21.35,-157.95";
const T0 = 1_000_000; // synthetic wall-clock origin, ms

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`interop | PASS ${label}`);
  else {
    failures++;
    console.error(`interop | FAIL ${label}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, what) {
  return Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    }),
  ]);
}

function findPython() {
  for (const cmd of ["python", "python3", "py"]) {
    try {
      const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
      if (r.status === 0 && /Python 3\./.test(`${r.stdout}${r.stderr}`)) return cmd;
    } catch {
      /* try the next launcher name */
    }
  }
  throw new Error("no Python 3 found on PATH (tried python, python3, py)");
}

function freeUdpPort() {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket("udp4");
    s.once("error", reject);
    s.bind({ address: "127.0.0.1", port: 0 }, () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

const liveChildren = new Set();

function spawnPython(python, argv, prefix) {
  const child = spawn(python, argv, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  liveChildren.add(child);
  const state = { child, stdoutText: "" };
  let readyResolve;
  state.ready = new Promise((res) => (readyResolve = res));
  state.exitP = new Promise((res) => {
    child.on("close", (code) => {
      liveChildren.delete(child);
      res(code);
    });
  });
  const buffers = { out: "", err: "" };
  const onChunk = (which, chunk) => {
    buffers[which] += chunk.toString();
    for (;;) {
      const nl = buffers[which].indexOf("\n");
      if (nl === -1) break;
      const line = buffers[which].slice(0, nl).replace(/\r$/, "");
      buffers[which] = buffers[which].slice(nl + 1);
      if (which === "out") state.stdoutText += `${line}\n`;
      if (line.trim() !== "") console.log(`${prefix} | ${line}`);
      if (which === "out" && line.startsWith("READY")) readyResolve();
    }
  };
  child.stdout.on("data", (c) => onChunk("out", c));
  child.stderr.on("data", (c) => onChunk("err", c));
  return state;
}

function gatewayConfig(port) {
  const { config, issues } = validateGatewayConfig({
    network: { mode: "unicast", unicastDestinations: ["127.0.0.1"], port, interface: "127.0.0.2" },
    anchor: ANCHOR,
    simMgmt: { endVbsMissionOnStop: true },
  });
  if (issues.length > 0) throw new Error(`gateway config rejected: ${JSON.stringify(issues)}`);
  return config;
}

/**
 * Drive the golden engagement through the real publisher, tick by tick
 * on a synthetic 1x wall clock (same pattern as gateway-publish.test.ts).
 * sink(wireBytes, nowMs) is called for every published PDU.
 */
async function runEngagement(config, sink, opts = {}) {
  const frame = new LocalFrame(config.anchor);
  let nowMs = T0;
  const publisher = new Publisher(config, frame, new IdAllocator(config), (pdu) => sink(encodePdu(pdu), nowMs));
  const sim = new Simulation(SEED, undefined, "orbit");
  publisher.sessionStart(
    { sessionId: "interop", seed: SEED, mode: "orbit", overridesDigest: "", startedAtMs: T0, speed: 1 },
    nowMs,
  );
  let tick = 0;
  for (;;) {
    sim.step();
    tick++;
    nowMs = T0 + tick * 100;
    publisher.onTick(buildTickView(sim, tick, "orbit", 0), nowMs);
    if (opts.untilSimT !== undefined && sim.t >= opts.untilSimT) break;
    if (sim.winner !== null) break;
    if (sim.teams.BLUFOR.drone.downed && sim.teams.OPFOR.drone.downed) break;
    if (sim.t >= 3600) break;
    if (opts.yieldEvery !== undefined && tick % opts.yieldEvery === 0) await new Promise((r) => setImmediate(r));
  }
  if (opts.untilSimT === undefined) {
    // Wreck window: heartbeats continue on wall time after ENDEX.
    const finalView = buildTickView(sim, tick, "orbit", 0);
    for (let i = 1; i <= 120; i++) {
      nowMs += 100;
      publisher.onTick(finalView, nowMs);
      if (opts.yieldEvery !== undefined && i % opts.yieldEvery === 0) await new Promise((r) => setImmediate(r));
    }
  }
  if (opts.drainMs !== undefined) await sleep(opts.drainMs);
  if (opts.sessionEnd !== false) publisher.sessionEnd(nowMs); // Stop/Freeze (Termination): the receiver's end sentinel
  return { counters: publisher.counters, simT: sim.t, winner: sim.winner, ticks: tick };
}

function parseScorecard(stdoutText) {
  const lines = stdoutText.split("\n").filter((l) => l.startsWith("SCORECARD-JSON "));
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1].slice("SCORECARD-JSON ".length));
  } catch {
    return null;
  }
}

async function phaseA(python) {
  console.log("interop | phase A: real publisher stream -> open-dis-python receiver");
  const port = await freeUdpPort();
  const recv = spawnPython(
    python,
    [crosscheckPy, "receive", "--port", String(port), "--duration", "90", "--anchor", ANCHOR_ARG, "--exercise", "1", "--bind", "127.0.0.1"],
    "py-recv",
  );
  try {
    await withTimeout(recv.ready, 30_000, "the python receiver's READY line");
    const config = gatewayConfig(port);
    const socket = new DisSocket(config.network);
    await socket.open();
    let run;
    try {
      run = await runEngagement(config, (wire) => socket.send(wire), { yieldEvery: 100, drainMs: 400 });
    } finally {
      await socket.close();
    }
    console.log(
      `interop | engagement done: winner ${run.winner} at t=${run.simT.toFixed(1)} s; ` +
        `published espdu=${run.counters.espdu} ee=${run.counters.emission} det=${run.counters.detonation} ` +
        `sr=${run.counters.startResume} sf=${run.counters.stopFreeze} (tx ${socket.stats.txPdus} datagrams)`,
    );

    const exitCode = await withTimeout(recv.exitP, 120_000, "the python receiver to exit");
    const card = parseScorecard(recv.stdoutText);
    check(card !== null, "receiver printed a machine-readable scorecard");
    check(exitCode === 0, `receiver exit code 0 (got ${exitCode})`);
    if (card !== null) {
      check(card.result === "PASS" && card.violations === 0, `scorecard PASS with zero violations (got ${card.result}, ${card.violations})`);
      check(card.datagrams === socket.stats.txPdus, `zero datagram loss (${card.datagrams} received of ${socket.stats.txPdus} sent)`);
      check(card.espdu === run.counters.espdu, `ESPDU count matches the publisher (${card.espdu}/${run.counters.espdu})`);
      const ee = card.types.EmissionEE ?? 0;
      check(ee === run.counters.emission, `EE count matches the publisher (${ee}/${run.counters.emission})`);
      check(card.detonation === 1 && run.counters.detonation === 1, `exactly one Detonation (got ${card.detonation})`);
      check(card.fire === 0, `no Fire PDUs by default (got ${card.fire})`);
      check(card.startResume === run.counters.startResume && card.startResume >= 1, `Start/Resume announced (${card.startResume})`);
      check(card.stopFreeze === run.counters.stopFreeze, `Stop/Freeze count matches (${card.stopFreeze}/${run.counters.stopFreeze})`);
      check(card.espdu >= 500, `hundreds of ESPDUs (${card.espdu})`);
      check(ee >= 20, `tens of EE PDUs (${ee})`);
      check(Object.keys(card.espduEntities).length === 8, `8 distinct entities (${Object.keys(card.espduEntities).length})`);
    }
  } finally {
    if (recv.child.exitCode === null) recv.child.kill();
  }
}

async function phaseB(python) {
  console.log("interop | phase B: open-dis-python sender -> gateway receive path");
  const port = await freeUdpPort();
  const gw = new DisGateway({
    network: { mode: "unicast", unicastDestinations: ["127.0.0.1"], port, interface: null },
    anchor: ANCHOR,
  });
  if (gw.configIssues !== undefined) throw new Error(`gateway config rejected: ${gw.configIssues}`);
  await gw.open();
  let track = null;
  const unsubscribe = gw.onOverlay((tracks) => {
    for (const t of tracks) if (t.key === "3:5001:1") track = t;
  });
  const sender = spawnPython(
    python,
    [crosscheckPy, "send", "--port", String(port), "--anchor", ANCHOR_ARG, "--site", "3", "--app", "5001", "--duration", "6", "--rate", "2"],
    "py-send",
  );
  try {
    const deadline = Date.now() + 10_000;
    while (track === null && Date.now() < deadline) await sleep(100);
    const trackAppeared = track !== null;
    const senderExit = await withTimeout(sender.exitP, 20_000, "the python sender to exit");
    const status = gw.status(); // after the full send: rx counters reflect every datagram

    check(trackAppeared, "overlay track appeared within 10 s");
    if (track !== null) {
      check(track.key === "3:5001:1", `track key carries the sender's site:app (${track.key})`);
      check(track.marking === "PY-EXT-1", `track marking survived the foreign encoder (${track.marking})`);
      check(track.spdMps !== null && track.spdMps > 10, `track speed is the orbit's tangential speed (${track.spdMps?.toFixed(1)} m/s)`);
    }
    check((status.externalTracks ?? 0) >= 1, `gateway status counts >= 1 external track (${status.externalTracks})`);
    check((status.rx?.pdus ?? 0) >= 2, `gateway rx saw the sender's datagrams (${status.rx?.pdus})`);
    check(senderExit === 0, `sender exit code 0 (got ${senderExit})`);
    check(/(^|\n)SENT \d+/.test(sender.stdoutText), "sender reported its SENT count");
  } finally {
    if (sender.child.exitCode === null) sender.child.kill();
    unsubscribe();
    await gw.shutdown();
  }
}

function validatePcap(file, expectedRecords) {
  const buf = readFileSync(file);
  check(buf.length >= 24, `pcap: global header present (${buf.length} B file)`);
  check(buf.readUInt32LE(0) === 0xa1b2c3d4, "pcap: classic magic 0xa1b2c3d4, little-endian");
  check(buf.readUInt16LE(4) === 2 && buf.readUInt16LE(6) === 4, "pcap: version 2.4");
  check(buf.readUInt32LE(20) === 1, "pcap: LINKTYPE_ETHERNET");
  let off = 24;
  let records = 0;
  let framesOk = true;
  let checksumsOk = true;
  let disLensOk = true;
  let tsMono = true;
  let prevTs = -Infinity;
  while (off + 16 <= buf.length) {
    const inclLen = buf.readUInt32LE(off + 8);
    const origLen = buf.readUInt32LE(off + 12);
    const ts = buf.readUInt32LE(off) * 1e6 + buf.readUInt32LE(off + 4);
    if (ts < prevTs) tsMono = false;
    prevTs = ts;
    if (inclLen !== origLen || off + 16 + inclLen > buf.length) {
      framesOk = false;
      break;
    }
    const f = off + 16;
    const ipTotal = buf.readUInt16BE(f + 16);
    if (buf.readUInt16BE(f + 12) !== 0x0800 || buf[f + 14] !== 0x45 || buf[f + 23] !== 17 || ipTotal !== inclLen - 14) {
      framesOk = false;
      break;
    }
    let sum = 0;
    for (let i = 0; i < 20; i += 2) sum += buf.readUInt16BE(f + 14 + i);
    while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
    if (sum !== 0xffff) checksumsOk = false;
    const udpLen = buf.readUInt16BE(f + 38);
    if (udpLen !== ipTotal - 20) framesOk = false;
    const disHeaderLen = buf.readUInt16BE(f + 50); // DIS header length field, 8 bytes into the payload
    if (disHeaderLen !== udpLen - 8) disLensOk = false;
    records++;
    off += 16 + inclLen;
  }
  check(off === buf.length, "pcap: records tile the file exactly");
  check(records === expectedRecords, `pcap: ${records} records match the ${expectedRecords} published PDUs`);
  check(framesOk, "pcap: Ethernet/IPv4/UDP framing and length fields consistent in every record");
  check(checksumsOk, "pcap: IPv4 header checksum valid in every record");
  check(disLensOk, "pcap: every UDP payload length equals its DIS header length field");
  check(tsMono, "pcap: timestamps are monotonic");
}

async function writePcap(file) {
  console.log(`interop | writing golden capture: first 60 s of seed ${SEED} (orbit) at 1x`);
  mkdirSync(path.dirname(file), { recursive: true });
  const writer = new PcapWriter(file);
  const epochMs = Date.UTC(2026, 6, 19); // fixed epoch: regeneration is byte-identical
  let count = 0;
  const run = await runEngagement(
    gatewayConfig(3000),
    (wire, nowMs) => {
      writer.appendDatagram(wire, {
        tsMs: epochMs + (nowMs - T0),
        srcIp: "192.168.1.10",
        dstIp: "255.255.255.255",
        srcPort: 3000,
        dstPort: 3000,
      });
      count++;
    },
    { untilSimT: 60, sessionEnd: false }, // a 60 s slice, not a terminated session
  );
  writer.close();
  const size = statSync(file).size;
  console.log(`interop | pcap: ${count} PDUs over ${run.ticks} ticks -> ${file} (${size} B)`);
  validatePcap(file, count);
}

async function main() {
  const args = process.argv.slice(2);
  const pcapFlag = args.indexOf("--write-pcap");
  if (pcapFlag !== -1) {
    const target = args[pcapFlag + 1];
    if (target === undefined) throw new Error("--write-pcap needs a file path");
    await writePcap(path.resolve(root, target));
  } else {
    const python = findPython();
    console.log(`interop | python: ${python}; independent decoder: open-dis-python`);
    await phaseA(python);
    await phaseB(python);
  }
  console.log(failures === 0 ? "interop | ALL CHECKS PASSED" : `interop | ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`interop | fatal: ${err instanceof Error ? err.message : err}`);
  for (const child of liveChildren) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  process.exit(1);
});
