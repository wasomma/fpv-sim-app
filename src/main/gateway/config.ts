/*
 * Gateway configuration: one JSON object, validated with a hand-rolled
 * zero-dep validator producing precise error paths, deep-merged over the
 * defaults (the same posture the engine takes with CONFIG overrides).
 * All RF numbers are notional — the engine models booleans, not link
 * budgets — and every identity value (enumerations, IDs) is re-mappable
 * per site without code.
 */

export interface GatewayConfig {
  network: {
    mode: "broadcast" | "multicast" | "unicast";
    destination: string;
    port: number;
    multicastGroup: string;
    ttl: number;
    /** Local interface address to bind/send from; null = OS default. */
    interface: string | null;
    unicastDestinations: string[];
    loopbackTest: boolean;
  };
  dis: {
    protocolVersion: 6 | 7;
    exerciseId: number;
    siteId: number;
    applicationId: number;
    timestampMode: "relative" | "absolute";
    emitFirePdu: boolean;
  };
  simMgmt: {
    announceSession: boolean;
    sendPauseResume: boolean;
    endVbsMissionOnStop: boolean;
  };
  ids: {
    blufor: { gcs: number; nodes: [number, number]; droneBase: number };
    opfor: { gcs: number; nodes: [number, number]; droneBase: number };
  };
  entityTypes: {
    fpv: EntityTypeCfg;
    gcs: EntityTypeCfg;
    dfNode: EntityTypeCfg;
    warhead: EntityTypeCfg;
  };
  deadReckoning: {
    drone: { algorithm: 2 | 4; posThresholdM: number; oriThresholdDeg: number; heartbeatS: number };
    static: { heartbeatS: number };
  };
  publish: {
    publishStandby: boolean;
    flamingS: number;
    maxSpeedFactor: number;
  };
  emissions: {
    heartbeatS: number;
    uplink: EmitterCfg;
    video: EmitterCfg;
  };
  anchor: {
    lat0Deg: number;
    lon0Deg: number;
    /** Ellipsoidal height of sim z = 0 (sim sea level), meters. */
    h0M: number;
    /** Azimuth of the sim +y axis, degrees clockwise from true north. */
    rotationDeg: number;
    geoidOffsetM: number;
  };
  receive: {
    enabled: boolean;
    exerciseFilter: boolean;
    timeoutS: number;
    extrapolate: boolean;
  };
}

export interface EntityTypeCfg {
  kind: number;
  domain: number;
  country: { BLUFOR: number; OPFOR: number };
  category: number;
  subcategory: number;
  specific: number;
  extra: number;
}

export interface EmitterCfg {
  freqHz: number;
  bandwidthHz: number;
  erpDbm: number;
  emitterName: number;
  function: number;
}

export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  network: {
    mode: "broadcast",
    destination: "255.255.255.255",
    port: 3000,
    multicastGroup: "239.1.2.3",
    ttl: 1,
    interface: null,
    unicastDestinations: [],
    loopbackTest: false,
  },
  dis: {
    protocolVersion: 6,
    exerciseId: 1,
    siteId: 1,
    applicationId: 3001,
    timestampMode: "relative",
    emitFirePdu: false,
  },
  simMgmt: {
    announceSession: true,
    sendPauseResume: true,
    endVbsMissionOnStop: false,
  },
  ids: {
    blufor: { gcs: 1, nodes: [2, 3], droneBase: 10 },
    opfor: { gcs: 101, nodes: [102, 103], droneBase: 110 },
  },
  entityTypes: {
    /* Generic mappable surrogates; verify leaf values against the pinned
       SISO-REF-010 and re-map per site as needed (VBS fuzzy-maps). */
    fpv: { kind: 1, domain: 2, country: { BLUFOR: 0, OPFOR: 0 }, category: 50, subcategory: 1, specific: 1, extra: 0 },
    gcs: { kind: 1, domain: 1, country: { BLUFOR: 0, OPFOR: 0 }, category: 6, subcategory: 1, specific: 0, extra: 0 },
    dfNode: { kind: 1, domain: 1, country: { BLUFOR: 0, OPFOR: 0 }, category: 6, subcategory: 2, specific: 0, extra: 0 },
    warhead: { kind: 2, domain: 9, country: { BLUFOR: 0, OPFOR: 0 }, category: 1, subcategory: 1, specific: 0, extra: 0 },
  },
  deadReckoning: {
    drone: { algorithm: 2, posThresholdM: 2.0, oriThresholdDeg: 3.0, heartbeatS: 5 },
    static: { heartbeatS: 5 },
  },
  publish: {
    publishStandby: false,
    flamingS: 60,
    maxSpeedFactor: 8,
  },
  emissions: {
    heartbeatS: 10,
    uplink: { freqHz: 915e6, bandwidthHz: 5e6, erpDbm: 30, emitterName: 0, function: 5 },
    video: { freqHz: 5.8e9, bandwidthHz: 20e6, erpDbm: 27, emitterName: 0, function: 5 },
  },
  anchor: { lat0Deg: 0, lon0Deg: 0, h0M: 0, rotationDeg: 0, geoidOffsetM: 0 },
  receive: { enabled: true, exerciseFilter: true, timeoutS: 12, extrapolate: true },
};

/* ------------------------------ validation ------------------------------ */

type Issue = { path: string; message: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown, path: string, issues: Issue[]): T {
  if (patch === undefined) return base;
  if (isPlainObject(base)) {
    if (!isPlainObject(patch)) {
      issues.push({ path, message: "expected an object" });
      return base;
    }
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const key of Object.keys(patch)) {
      if (!(key in (base as Record<string, unknown>))) {
        issues.push({ path: path === "" ? key : `${path}.${key}`, message: "unknown key" });
        continue;
      }
      out[key] = deepMerge(
        (base as Record<string, unknown>)[key],
        patch[key],
        path === "" ? key : `${path}.${key}`,
        issues,
      ) as unknown;
    }
    return out as T;
  }
  return patch as T;
}

function check(cond: boolean, path: string, message: string, issues: Issue[]): void {
  if (!cond) issues.push({ path, message });
}

const isIp = (s: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
const u16ok = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 0xffff;

export function validateGatewayConfig(patch: unknown): { config: GatewayConfig; issues: Issue[] } {
  const issues: Issue[] = [];
  const cfg = deepMerge(structuredClone(DEFAULT_GATEWAY_CONFIG), patch ?? {}, "", issues);

  check(["broadcast", "multicast", "unicast"].includes(cfg.network.mode), "network.mode", "broadcast|multicast|unicast", issues);
  check(Number.isInteger(cfg.network.port) && cfg.network.port >= 1 && cfg.network.port <= 65535, "network.port", "1..65535", issues);
  check(isIp(cfg.network.destination), "network.destination", "IPv4 dotted quad", issues);
  check(isIp(cfg.network.multicastGroup), "network.multicastGroup", "IPv4 multicast group", issues);
  check(Number.isInteger(cfg.network.ttl) && cfg.network.ttl >= 1 && cfg.network.ttl <= 32, "network.ttl", "1..32", issues);
  check(cfg.network.interface === null || isIp(cfg.network.interface), "network.interface", "IPv4 address or null", issues);
  check(Array.isArray(cfg.network.unicastDestinations) && cfg.network.unicastDestinations.every(isIp), "network.unicastDestinations", "IPv4 list", issues);
  if (cfg.network.mode === "unicast") {
    check(cfg.network.unicastDestinations.length > 0, "network.unicastDestinations", "at least one destination in unicast mode", issues);
  }

  check(cfg.dis.protocolVersion === 6 || cfg.dis.protocolVersion === 7, "dis.protocolVersion", "6 or 7", issues);
  check(Number.isInteger(cfg.dis.exerciseId) && cfg.dis.exerciseId >= 0 && cfg.dis.exerciseId <= 255, "dis.exerciseId", "0..255", issues);
  check(u16ok(cfg.dis.siteId) && cfg.dis.siteId > 0, "dis.siteId", "1..65535", issues);
  check(u16ok(cfg.dis.applicationId) && cfg.dis.applicationId > 0, "dis.applicationId", "1..65535", issues);
  check(["relative", "absolute"].includes(cfg.dis.timestampMode), "dis.timestampMode", "relative|absolute", issues);

  for (const side of ["blufor", "opfor"] as const) {
    const ids = cfg.ids[side];
    check(u16ok(ids.gcs), `ids.${side}.gcs`, "u16", issues);
    check(Array.isArray(ids.nodes) && ids.nodes.length === 2 && ids.nodes.every(u16ok), `ids.${side}.nodes`, "[u16,u16]", issues);
    check(u16ok(ids.droneBase), `ids.${side}.droneBase`, "u16", issues);
  }

  const dr = cfg.deadReckoning.drone;
  check(dr.algorithm === 2 || dr.algorithm === 4, "deadReckoning.drone.algorithm", "2 (FPW) or 4 (RVW)", issues);
  check(dr.posThresholdM > 0 && dr.posThresholdM <= 100, "deadReckoning.drone.posThresholdM", "(0,100]", issues);
  check(dr.oriThresholdDeg > 0 && dr.oriThresholdDeg <= 90, "deadReckoning.drone.oriThresholdDeg", "(0,90]", issues);
  check(dr.heartbeatS >= 1 && dr.heartbeatS <= 60, "deadReckoning.drone.heartbeatS", "1..60", issues);
  check(cfg.deadReckoning.static.heartbeatS >= 1 && cfg.deadReckoning.static.heartbeatS <= 60, "deadReckoning.static.heartbeatS", "1..60", issues);

  check(cfg.publish.flamingS >= 0 && cfg.publish.flamingS <= 600, "publish.flamingS", "0..600", issues);
  check(cfg.publish.maxSpeedFactor >= 1 && cfg.publish.maxSpeedFactor <= 60, "publish.maxSpeedFactor", "1..60", issues);
  check(cfg.emissions.heartbeatS >= 1 && cfg.emissions.heartbeatS <= 60, "emissions.heartbeatS", "1..60", issues);
  for (const [name, e] of [["uplink", cfg.emissions.uplink], ["video", cfg.emissions.video]] as const) {
    check(e.freqHz > 0, `emissions.${name}.freqHz`, "> 0", issues);
    check(e.bandwidthHz >= 0, `emissions.${name}.bandwidthHz`, ">= 0", issues);
  }

  const a = cfg.anchor;
  check(a.lat0Deg >= -89.9 && a.lat0Deg <= 89.9, "anchor.lat0Deg", "-89.9..89.9", issues);
  check(a.lon0Deg >= -180 && a.lon0Deg <= 180, "anchor.lon0Deg", "-180..180", issues);
  check(a.h0M >= -500 && a.h0M <= 9000, "anchor.h0M", "-500..9000", issues);
  check(a.rotationDeg >= -360 && a.rotationDeg <= 360, "anchor.rotationDeg", "-360..360", issues);

  check(cfg.receive.timeoutS >= 2 && cfg.receive.timeoutS <= 300, "receive.timeoutS", "2..300", issues);

  return { config: cfg, issues };
}
