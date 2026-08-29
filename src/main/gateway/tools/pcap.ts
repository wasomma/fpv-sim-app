/*
 * Minimal classic pcap writer (the original libpcap format, magic
 * 0xa1b2c3d4, little-endian file byte order) with LINKTYPE_ETHERNET and
 * fabricated Ethernet/IPv4/UDP headers around each DIS datagram, so
 * Wireshark's DIS dissector opens a capture directly with zero setup.
 * The IPv4 header checksum is computed for real (some analyzers flag a
 * zero checksum); the UDP checksum is 0, which IPv4 defines as "not
 * computed". Zero dependencies beyond node:fs; sync appends — this is
 * tool-path code, never in the render or publish path.
 */

import { closeSync, openSync, writeSync } from "node:fs";

export interface PcapPacketMeta {
  /** Wall-clock capture time, ms since the Unix epoch. */
  tsMs: number;
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
}

const PCAP_MAGIC = 0xa1b2c3d4;
const LINKTYPE_ETHERNET = 1;
const SNAPLEN = 65535;
const ETHERNET_BYTES = 14;
const IPV4_BYTES = 20;
const UDP_BYTES = 8;
const RECORD_HEADER_BYTES = 16;

/** Fabricated locally-administered MACs; nothing routes these frames. */
const MAC_DST = [0x02, 0x00, 0x00, 0x00, 0x00, 0x02];
const MAC_SRC = [0x02, 0x00, 0x00, 0x00, 0x00, 0x01];

function parseIpv4(s: string): number[] {
  const parts = s.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new RangeError(`not an IPv4 dotted quad: ${s}`);
  }
  return parts;
}

/** RFC 1071 ones'-complement sum over the 20-byte header (checksum field zeroed). */
export function ipv4HeaderChecksum(header: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < header.length; i += 2) {
    sum += (header[i]! << 8) | header[i + 1]!;
  }
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return ~sum & 0xffff;
}

export class PcapWriter {
  private fd: number | null;
  private ipId = 0;

  constructor(filePath: string) {
    this.fd = openSync(filePath, "w");
    const h = Buffer.alloc(24);
    h.writeUInt32LE(PCAP_MAGIC, 0);
    h.writeUInt16LE(2, 4); // version major
    h.writeUInt16LE(4, 6); // version minor
    h.writeInt32LE(0, 8); // thiszone
    h.writeUInt32LE(0, 12); // sigfigs
    h.writeUInt32LE(SNAPLEN, 16);
    h.writeUInt32LE(LINKTYPE_ETHERNET, 20);
    writeSync(this.fd, h);
  }

  appendDatagram(payload: Uint8Array, meta: PcapPacketMeta): void {
    if (this.fd === null) throw new Error("pcap writer is closed");
    const ipTotal = IPV4_BYTES + UDP_BYTES + payload.length;
    if (ipTotal > 0xffff) throw new RangeError(`datagram of ${payload.length} B does not fit one IPv4 packet`);
    const frameLen = ETHERNET_BYTES + ipTotal;
    const record = Buffer.alloc(RECORD_HEADER_BYTES + frameLen);

    record.writeUInt32LE(Math.floor(meta.tsMs / 1000), 0);
    record.writeUInt32LE(Math.floor((meta.tsMs % 1000) * 1000), 4);
    record.writeUInt32LE(frameLen, 8); // incl_len (snaplen is never exceeded here)
    record.writeUInt32LE(frameLen, 12); // orig_len

    let o = RECORD_HEADER_BYTES;
    record.set(MAC_DST, o);
    record.set(MAC_SRC, o + 6);
    record.writeUInt16BE(0x0800, o + 12); // EtherType IPv4
    o += ETHERNET_BYTES;

    const ipStart = o;
    record[o] = 0x45; // version 4, IHL 5
    record[o + 1] = 0; // DSCP/ECN
    record.writeUInt16BE(ipTotal, o + 2);
    record.writeUInt16BE(this.ipId, o + 4);
    this.ipId = (this.ipId + 1) & 0xffff;
    record.writeUInt16BE(0, o + 6); // flags/fragment offset
    record[o + 8] = 64; // TTL
    record[o + 9] = 17; // protocol UDP
    record.writeUInt16BE(0, o + 10); // checksum placeholder
    record.set(parseIpv4(meta.srcIp), o + 12);
    record.set(parseIpv4(meta.dstIp), o + 16);
    const checksum = ipv4HeaderChecksum(record.subarray(ipStart, ipStart + IPV4_BYTES));
    record.writeUInt16BE(checksum, o + 10);
    o += IPV4_BYTES;

    record.writeUInt16BE(meta.srcPort, o);
    record.writeUInt16BE(meta.dstPort, o + 2);
    record.writeUInt16BE(UDP_BYTES + payload.length, o + 4);
    record.writeUInt16BE(0, o + 6); // UDP checksum: legitimately absent over IPv4
    o += UDP_BYTES;

    record.set(payload, o);
    writeSync(this.fd, record);
  }

  close(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}
