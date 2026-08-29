/*
 * UDP transport for DIS traffic (node:dgram).
 *
 * One socket sends, one receives (the same underlying port). reuseAddr
 * stays on so the gateway, dis-listen, and a co-located simulator can
 * share the port on one host. Multicast requires an explicit local
 * interface on Windows — the OS default routinely picks the wrong NIC
 * on multi-homed machines, so the config surfaces it.
 */

import dgram from "node:dgram";
import type { GatewayConfig } from "../config.js";

export interface UdpStats {
  txPdus: number;
  txBytes: number;
  rxPdus: number;
  rxBytes: number;
  lastError: string | null;
}

export class DisSocket {
  private tx: dgram.Socket | null = null;
  private rx: dgram.Socket | null = null;
  private readonly cfg: GatewayConfig["network"];
  readonly stats: UdpStats = { txPdus: 0, txBytes: 0, rxPdus: 0, rxBytes: 0, lastError: null };
  private onPacketCb: ((data: Buffer, from: string) => void) | null = null;

  constructor(cfg: GatewayConfig["network"]) {
    this.cfg = cfg;
  }

  async open(): Promise<void> {
    const bindAddr = this.cfg.interface ?? "0.0.0.0";

    this.rx = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.rx.on("error", (err) => {
      this.stats.lastError = `rx: ${err.message}`;
    });
    this.rx.on("message", (data, rinfo) => {
      this.stats.rxPdus++;
      this.stats.rxBytes += data.length;
      this.onPacketCb?.(data, `${rinfo.address}:${rinfo.port}`);
    });
    await new Promise<void>((resolve, reject) => {
      const onErr = (err: Error) => reject(err);
      this.rx!.once("error", onErr);
      this.rx!.bind({ port: this.cfg.port, address: bindAddr }, () => {
        this.rx!.removeListener("error", onErr);
        if (this.cfg.mode === "multicast") {
          try {
            this.rx!.addMembership(this.cfg.multicastGroup, this.cfg.interface ?? undefined);
          } catch (err) {
            this.stats.lastError = `addMembership: ${(err as Error).message}`;
          }
        }
        resolve();
      });
    });

    this.tx = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.tx.on("error", (err) => {
      this.stats.lastError = `tx: ${err.message}`;
    });
    await new Promise<void>((resolve) => {
      this.tx!.bind({ address: bindAddr }, () => {
        if (this.cfg.mode === "broadcast") this.tx!.setBroadcast(true);
        if (this.cfg.mode === "multicast") {
          this.tx!.setMulticastTTL(this.cfg.ttl);
          if (this.cfg.interface !== null) {
            try {
              this.tx!.setMulticastInterface(this.cfg.interface);
            } catch (err) {
              this.stats.lastError = `setMulticastInterface: ${(err as Error).message}`;
            }
          }
        }
        resolve();
      });
    });
  }

  onPacket(cb: (data: Buffer, from: string) => void): void {
    this.onPacketCb = cb;
  }

  send(payload: Uint8Array): void {
    if (this.tx === null) return;
    const targets =
      this.cfg.mode === "unicast"
        ? this.cfg.unicastDestinations
        : [this.cfg.mode === "multicast" ? this.cfg.multicastGroup : this.cfg.destination];
    for (const addr of targets) {
      this.tx.send(payload, this.cfg.port, addr, (err) => {
        if (err) this.stats.lastError = `send ${addr}: ${err.message}`;
      });
    }
    this.stats.txPdus++;
    this.stats.txBytes += payload.length;
  }

  async close(): Promise<void> {
    const closeOne = (s: dgram.Socket | null) =>
      new Promise<void>((resolve) => {
        if (s === null) {
          resolve();
          return;
        }
        try {
          s.close(() => resolve());
        } catch {
          resolve();
        }
      });
    await closeOne(this.rx);
    await closeOne(this.tx);
    this.rx = null;
    this.tx = null;
  }
}
