/*
 * Gateway configuration presets for the Live Ops GATEWAY box, and the
 * advisory warnings STAGE attaches to a configuration it accepted.
 *
 * The preset texts are the ready-to-paste blocks from the manual's
 * Appendix C, character for character, so the panel, the manual and the
 * VBS4 quick start (Appendix H) all show the same thing. A preset only
 * fills the text box; the user still edits the anchor and presses STAGE.
 */

import type { GatewayConfig } from "./config.js";

export interface GatewayPreset {
  id: string;
  name: string;
  /** One-line reminder shown when the preset is picked. */
  hint: string;
  text: string;
}

export const GATEWAY_PRESETS: readonly GatewayPreset[] = [
  {
    id: "broadcast-lan",
    name: "Broadcast on a flat LAN (also works on one PC)",
    hint: "reaches every receiver on the subnet, including this PC — set the anchor, then STAGE",
    text: `{"network":{"mode":"broadcast","port":3000},
 "dis":{"exerciseId":1},
 "anchor":{"lat0Deg":21.35,"lon0Deg":-157.95}}`,
  },
  {
    id: "unicast-host",
    name: "Unicast to one receiver",
    hint: "replace 192.168.1.20 with the receiving PC and set the anchor, then STAGE",
    text: `{"network":{"mode":"unicast","unicastDestinations":["192.168.1.20"],"port":3000},
 "dis":{"exerciseId":1},
 "anchor":{"lat0Deg":21.35,"lon0Deg":-157.95}}`,
  },
  {
    id: "multicast",
    name: "Multicast on a named adapter (multi-homed PC)",
    hint: "set interface to this PC's LAN address and the anchor, then STAGE",
    text: `{"network":{"mode":"multicast","multicastGroup":"239.1.2.3","port":3000,"interface":"192.168.1.10","ttl":1},
 "dis":{"exerciseId":1},
 "anchor":{"lat0Deg":21.35,"lon0Deg":-157.95,"h0M":0,"rotationDeg":0}}`,
  },
  {
    id: "vbs4-gateway",
    name: "VBS4 through VBS Gateway (unicast, emitter function 5)",
    hint: "replace 192.168.1.20 with the VBS4 PC and set the anchor, then STAGE — Appendix H walks through the VBS side",
    text: `{"network":{"mode":"unicast","unicastDestinations":["192.168.1.20"],"port":3000},
 "dis":{"protocolVersion":6,"exerciseId":1},
 "emissions":{"uplink":{"function":5},"video":{"function":5}},
 "anchor":{"lat0Deg":21.35,"lon0Deg":-157.95}}`,
  },
];

/**
 * Things a valid configuration can still get wrong in practice. Advisory:
 * STAGE accepts the configuration and shows these beside the status line.
 */
export function gatewayWarnings(config: GatewayConfig): string[] {
  const out: string[] = [];
  if (config.anchor.lat0Deg === 0 && config.anchor.lon0Deg === 0) {
    out.push("anchor is 0°, 0° (the Gulf of Guinea) — set anchor.lat0Deg and anchor.lon0Deg to your AO");
  }
  if (config.network.mode === "unicast" && config.network.unicastDestinations.some((d) => d.startsWith("127."))) {
    out.push("unicast to a loopback address reaches this PC only");
  }
  return out;
}
