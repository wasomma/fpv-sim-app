/*
 * The gateway configuration as a form: one descriptor per leaf of
 * DEFAULT_GATEWAY_CONFIG, grouped the way Appendix C groups them, with
 * the same one-line meanings. The Live Ops FORM view is generated from
 * this table; a unit test holds it to exactly the shape of the config,
 * so a config change that forgets the form fails CI, not the user.
 *
 * Electron-free on purpose (unit-testable under plain node).
 */

export type GatewayFieldType =
  | "enum" // fixed choices (options; numeric when the values are numbers)
  | "bool"
  | "int"
  | "num"
  | "ip" // IPv4 dotted quad
  | "ip-or-null" // IPv4 or empty (null = OS default)
  | "ip-list" // comma-separated IPv4 list
  | "u16-pair"; // exactly two integers, comma-separated

export interface GatewayFormField {
  /** Dot path into GatewayConfig, e.g. "network.port". */
  path: string;
  type: GatewayFieldType;
  options?: { value: string | number; label: string }[];
  min?: number;
  max?: number;
  /** The range is open at min (validator demands strictly greater). */
  minExclusive?: boolean;
  unit?: string;
  /** One line, Appendix C wording. */
  help: string;
}

export interface GatewayFormSection {
  /** Top-level config key, e.g. "network". */
  key: string;
  /** Appendix C's subtitle for the section. */
  hint: string;
  fields: GatewayFormField[];
}

const sideIds = (side: "blufor" | "opfor", first: number): GatewayFormField[] => [
  {
    path: `ids.${side}.gcs`,
    type: "int",
    min: 0,
    max: 65535,
    help: `Entity number of the ${side.toUpperCase()} GCS.`,
  },
  {
    path: `ids.${side}.nodes`,
    type: "u16-pair",
    help: `Entity numbers of the two ${side.toUpperCase()} DF nodes (exactly two, comma-separated).`,
  },
  {
    path: `ids.${side}.droneBase`,
    type: "int",
    min: 0,
    max: 65535,
    help: `${side.toUpperCase()} drone n is droneBase + n (${first + 1}, ${first + 2}, …).`,
  },
];

const entityType = (name: string, usedFor: string): GatewayFormField[] => {
  const leaf = (part: string, help: string): GatewayFormField => ({
    path: `entityTypes.${name}.${part}`,
    type: "int",
    min: 0,
    help,
  });
  return [
    leaf("kind", `SISO entity kind for ${usedFor}.`),
    leaf("domain", `SISO domain for ${usedFor}.`),
    leaf("country.BLUFOR", `SISO country code carried by BLUFOR ${usedFor}.`),
    leaf("country.OPFOR", `SISO country code carried by OPFOR ${usedFor}.`),
    leaf("category", `SISO category for ${usedFor}.`),
    leaf("subcategory", `SISO subcategory for ${usedFor}.`),
    leaf("specific", `SISO specific for ${usedFor}.`),
    leaf("extra", `SISO extra for ${usedFor}.`),
  ];
};

const emitter = (name: string, beam: string): GatewayFormField[] => [
  {
    path: `emissions.${name}.freqHz`,
    type: "num",
    min: 0,
    minExclusive: true,
    unit: "Hz",
    help: `Centre frequency of ${beam} (notional).`,
  },
  {
    path: `emissions.${name}.bandwidthHz`,
    type: "num",
    min: 0,
    unit: "Hz",
    help: `Bandwidth of ${beam}.`,
  },
  {
    path: `emissions.${name}.erpDbm`,
    type: "num",
    unit: "dBm",
    help: `Effective radiated power of ${beam} (notional).`,
  },
  {
    path: `emissions.${name}.emitterName`,
    type: "int",
    min: 0,
    help: "SISO emitter-name enumeration.",
  },
  {
    path: `emissions.${name}.function`,
    type: "int",
    min: 0,
    help: "SISO emitter-function enumeration. VBS Gateway lists a system only when this is 5 (Acquisition/Detection).",
  },
];

export const GATEWAY_FORM_SECTIONS: readonly GatewayFormSection[] = [
  {
    key: "network",
    hint: "where the PDUs go",
    fields: [
      {
        path: "network.mode",
        type: "enum",
        options: [
          { value: "broadcast", label: "broadcast" },
          { value: "multicast", label: "multicast" },
          { value: "unicast", label: "unicast" },
        ],
        help: "Delivery mode.",
      },
      { path: "network.destination", type: "ip", help: "Broadcast address." },
      {
        path: "network.port",
        type: "int",
        min: 1,
        max: 65535,
        help: "UDP port, used for sending and for receiving.",
      },
      { path: "network.multicastGroup", type: "ip", help: "Group joined and sent to in multicast mode." },
      { path: "network.ttl", type: "int", min: 1, max: 32, help: "Multicast time-to-live (hops)." },
      {
        path: "network.interface",
        type: "ip-or-null",
        help: "Local adapter address to bind and send from; empty lets Windows choose. Required for multicast on a PC with several adapters.",
      },
      {
        path: "network.unicastDestinations",
        type: "ip-list",
        help: "Receivers in unicast mode, comma-separated; at least one is required.",
      },
      { path: "network.loopbackTest", type: "bool", help: "Reserved." },
    ],
  },
  {
    key: "dis",
    hint: "protocol identity",
    fields: [
      {
        path: "dis.protocolVersion",
        type: "enum",
        options: [
          { value: 6, label: "6 (IEEE 1278.1-1995)" },
          { value: 7, label: "7 (IEEE 1278.1-2012)" },
        ],
        help: "DIS protocol version written in every header; the receive path accepts 4–7.",
      },
      {
        path: "dis.exerciseId",
        type: "int",
        min: 0,
        max: 255,
        help: "Exercise identifier; receivers on other exercises ignore the traffic and vice versa.",
      },
      { path: "dis.siteId", type: "int", min: 1, max: 65535, help: "Site part of every entity and event ID." },
      {
        path: "dis.applicationId",
        type: "int",
        min: 1,
        max: 65535,
        help: "Application part of every entity and event ID.",
      },
      {
        path: "dis.timestampMode",
        type: "enum",
        options: [
          { value: "relative", label: "relative" },
          { value: "absolute", label: "absolute" },
        ],
        help: "DIS timestamp flag.",
      },
      { path: "dis.emitFirePdu", type: "bool", help: "Also send a Fire PDU immediately before each Detonation." },
    ],
  },
  {
    key: "simMgmt",
    hint: "simulation management",
    fields: [
      { path: "simMgmt.announceSession", type: "bool", help: "Send Start/Resume when a session starts." },
      {
        path: "simMgmt.sendPauseResume",
        type: "bool",
        help: "Send Stop/Freeze (Recess) on pause and Start/Resume on resume.",
      },
      {
        path: "simMgmt.endVbsMissionOnStop",
        type: "bool",
        help: "Send Stop/Freeze (Termination) when the session ends — ends a running VBS4 mission.",
      },
    ],
  },
  {
    key: "ids",
    hint: "entity numbering (16-bit)",
    fields: [...sideIds("blufor", 10), ...sideIds("opfor", 110)],
  },
  {
    key: "entityTypes",
    hint: "SISO enumerations — generic surrogates, re-map to your receiver's SISO-REF-010",
    fields: [
      ...entityType("fpv", "drones"),
      ...entityType("gcs", "ground control stations"),
      ...entityType("dfNode", "DF nodes"),
      ...entityType("warhead", "the munition in Detonation (and Fire) PDUs"),
    ],
  },
  {
    key: "deadReckoning",
    hint: "update thresholds",
    fields: [
      {
        path: "deadReckoning.drone.algorithm",
        type: "enum",
        options: [
          { value: 2, label: "2 — DRM(F,P,W): fixed orientation, constant velocity" },
          { value: 4, label: "4 — DRM(R,V,W): rotating, with acceleration" },
        ],
        help: "Dead-reckoning model receivers extrapolate with. Try 4 if drones rubber-band in VBS.",
      },
      {
        path: "deadReckoning.drone.posThresholdM",
        type: "num",
        min: 0,
        minExclusive: true,
        max: 100,
        unit: "m",
        help: "Re-send when the receiver's extrapolated position would be off by more than this.",
      },
      {
        path: "deadReckoning.drone.oriThresholdDeg",
        type: "num",
        min: 0,
        minExclusive: true,
        max: 90,
        unit: "°",
        help: "Same for orientation.",
      },
      {
        path: "deadReckoning.drone.heartbeatS",
        type: "num",
        min: 1,
        max: 60,
        unit: "s",
        help: "Maximum interval between drone updates.",
      },
      {
        path: "deadReckoning.static.heartbeatS",
        type: "num",
        min: 1,
        max: 60,
        unit: "s",
        help: "Maximum interval between updates of GCS, DF nodes and wrecks.",
      },
    ],
  },
  {
    key: "publish",
    hint: "what and when",
    fields: [
      { path: "publish.publishStandby", type: "bool", help: "Also publish drones before launch." },
      {
        path: "publish.flamingS",
        type: "num",
        min: 0,
        max: 600,
        unit: "s",
        help: "Seconds of wall time a destroyed entity shows the flaming and smoke appearance bits.",
      },
      {
        path: "publish.maxSpeedFactor",
        type: "num",
        min: 1,
        max: 60,
        help: "Advisory only: above this session speed the status line warns that remote smoothing will degrade.",
      },
    ],
  },
  {
    key: "emissions",
    hint: "the radios",
    fields: [
      {
        path: "emissions.heartbeatS",
        type: "num",
        min: 1,
        max: 60,
        unit: "s",
        help: "Emission PDU heartbeat while a radio is keyed.",
      },
      ...emitter("uplink", "the GCS C2 uplink beam"),
      ...emitter("video", "the drone video downlink beam"),
    ],
  },
  {
    key: "anchor",
    hint: "placing the box on the Earth",
    fields: [
      {
        path: "anchor.lat0Deg",
        type: "num",
        min: -89.9,
        max: 89.9,
        unit: "°",
        help: "Latitude of the AO's south-west corner — set this.",
      },
      {
        path: "anchor.lon0Deg",
        type: "num",
        min: -180,
        max: 180,
        unit: "°",
        help: "Longitude of the south-west corner — set this.",
      },
      {
        path: "anchor.h0M",
        type: "num",
        min: -500,
        max: 9000,
        unit: "m",
        help: "Height of the sim's sea level above mean sea level; normally 0.",
      },
      {
        path: "anchor.rotationDeg",
        type: "num",
        min: -360,
        max: 360,
        unit: "°",
        help: "Azimuth of the sim's +y (north) axis, degrees clockwise from true north.",
      },
      {
        path: "anchor.geoidOffsetM",
        type: "num",
        unit: "m",
        help: "EGM96 geoid undulation at the anchor; added to wire heights so entities carry ellipsoidal positions.",
      },
    ],
  },
  {
    key: "receive",
    hint: "the overlay",
    fields: [
      { path: "receive.enabled", type: "bool", help: "Track Entity State PDUs from other senders." },
      { path: "receive.exerciseFilter", type: "bool", help: "Ignore PDUs from other exercise IDs." },
      {
        path: "receive.timeoutS",
        type: "num",
        min: 2,
        max: 300,
        unit: "s",
        help: "A silent track is dropped after this many seconds.",
      },
      { path: "receive.extrapolate", type: "bool", help: "Dead-reckon received tracks between updates (capped at 5 s)." },
    ],
  },
];
