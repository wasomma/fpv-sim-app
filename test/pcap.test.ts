/*
 * PcapWriter: classic pcap global header, record framing, fabricated
 * Ethernet/IPv4/UDP headers with a real IPv4 checksum, payload
 * round-trip — the byte structure Wireshark's DIS dissector expects.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PcapWriter, ipv4HeaderChecksum } from "../src/main/gateway/tools/pcap.js";

test("ipv4HeaderChecksum matches the classic worked example", () => {
  // Well-known IPv4 header example: checksum field (offset 10) zeroed,
  // expected checksum 0xb861.
  const header = Uint8Array.from([
    0x45, 0x00, 0x00, 0x73, 0x00, 0x00, 0x40, 0x00, 0x40, 0x11, 0x00, 0x00,
    0xc0, 0xa8, 0x00, 0x01, 0xc0, 0xa8, 0x00, 0xc7,
  ]);
  assert.equal(ipv4HeaderChecksum(header), 0xb861);
});

test("pcap writer: classic header, framed records, valid checksums, payload round-trip", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pcap-test-"));
  const file = path.join(dir, "t.pcap");
  try {
    const w = new PcapWriter(file);
    const payloadA = Uint8Array.from([1, 2, 3, 4, 5]);
    const payloadB = new Uint8Array(144).fill(0xab);
    w.appendDatagram(payloadA, { tsMs: 1752883200123, srcIp: "192.168.1.10", dstIp: "255.255.255.255", srcPort: 3000, dstPort: 3000 });
    w.appendDatagram(payloadB, { tsMs: 1752883200223, srcIp: "10.0.0.1", dstIp: "239.1.2.3", srcPort: 62000, dstPort: 3000 });
    w.close();

    const buf = readFileSync(file);
    assert.equal(buf.readUInt32LE(0), 0xa1b2c3d4, "classic pcap magic, little-endian");
    assert.equal(buf.readUInt16LE(4), 2, "version major");
    assert.equal(buf.readUInt16LE(6), 4, "version minor");
    assert.equal(buf.readUInt32LE(16), 65535, "snaplen");
    assert.equal(buf.readUInt32LE(20), 1, "LINKTYPE_ETHERNET");

    // Record A.
    let off = 24;
    assert.equal(buf.readUInt32LE(off), 1752883200, "ts_sec");
    assert.equal(buf.readUInt32LE(off + 4), 123000, "ts_usec");
    const incl = buf.readUInt32LE(off + 8);
    assert.equal(incl, 14 + 20 + 8 + payloadA.length, "incl_len covers eth+ip+udp+payload");
    assert.equal(buf.readUInt32LE(off + 12), incl, "orig_len == incl_len");
    const f = off + 16;
    assert.equal(buf.readUInt16BE(f + 12), 0x0800, "EtherType IPv4");
    assert.equal(buf[f + 14], 0x45, "IPv4 version/IHL");
    assert.equal(buf.readUInt16BE(f + 16), 20 + 8 + payloadA.length, "IPv4 total length");
    assert.equal(buf[f + 23], 17, "IPv4 protocol UDP");
    assert.deepEqual([...buf.subarray(f + 26, f + 30)], [192, 168, 1, 10], "src IP");
    assert.deepEqual([...buf.subarray(f + 30, f + 34)], [255, 255, 255, 255], "dst IP");
    let sum = 0;
    for (let i = 0; i < 20; i += 2) sum += buf.readUInt16BE(f + 14 + i);
    while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
    assert.equal(sum, 0xffff, "IPv4 header checksum validates (ones'-complement sum)");
    assert.equal(buf.readUInt16BE(f + 34), 3000, "UDP src port");
    assert.equal(buf.readUInt16BE(f + 36), 3000, "UDP dst port");
    assert.equal(buf.readUInt16BE(f + 38), 8 + payloadA.length, "UDP length");
    assert.deepEqual([...buf.subarray(f + 42, f + 42 + payloadA.length)], [...payloadA], "payload round-trips");

    // Record B follows immediately; the two records tile the file.
    off += 16 + incl;
    const inclB = buf.readUInt32LE(off + 8);
    assert.equal(inclB, 14 + 20 + 8 + payloadB.length);
    assert.equal(off + 16 + inclB, buf.length, "records tile the file exactly");
    let sumB = 0;
    const fb = off + 16;
    for (let i = 0; i < 20; i += 2) sumB += buf.readUInt16BE(fb + 14 + i);
    while (sumB > 0xffff) sumB = (sumB & 0xffff) + (sumB >>> 16);
    assert.equal(sumB, 0xffff, "second record's IPv4 checksum validates");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
