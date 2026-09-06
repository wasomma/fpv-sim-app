# C. Gateway configuration reference

The gateway configuration is a JSON object staged from the Live Ops GATEWAY box (Chapter 10) or through the MCP tool `live_configure_gateway`. You give only the keys you want to change; every other key keeps the default listed here. Unknown keys and out-of-range values are refused with the key's path, for example `network.prot: unknown key` or `anchor.lat0Deg: -89.9..89.9`.

## C.1 Ready-to-paste configurations

**Minimal — broadcast on a flat LAN (also works on one PC)**

```json
{"network":{"mode":"broadcast","port":3000},
 "dis":{"exerciseId":1},
 "anchor":{"lat0Deg":21.35,"lon0Deg":-157.95}}
```

**Two PCs — unicast to a specific receiver**

```json
{"network":{"mode":"unicast","unicastDestinations":["192.168.1.20"],"port":3000},
 "dis":{"exerciseId":1},
 "anchor":{"lat0Deg":21.35,"lon0Deg":-157.95}}
```

**Multi-homed PC — multicast on a named adapter**

```json
{"network":{"mode":"multicast","multicastGroup":"239.1.2.3","port":3000,"interface":"192.168.1.10","ttl":1},
 "dis":{"exerciseId":1},
 "anchor":{"lat0Deg":21.35,"lon0Deg":-157.95,"h0M":0,"rotationDeg":0}}
```

**VBS4 through VBS Gateway — unicast to the VBS4 PC, emitter function 5** (the worked example in Appendix H)

```json
{"network":{"mode":"unicast","unicastDestinations":["192.168.1.20"],"port":3000},
 "dis":{"protocolVersion":6,"exerciseId":1},
 "emissions":{"uplink":{"function":5},"video":{"function":5}},
 "anchor":{"lat0Deg":21.35,"lon0Deg":-157.95}}
```

The `emissions` block spells out the emitter function VBS Gateway insists on, *Acquisition / Detection* (5). That is also the shipped default, so the block changes nothing; it stays so that the configuration says what it needs.

Replace the anchor with your own latitude and longitude in every case. The same four blocks are the **preset…** menu in the Live Ops GATEWAY box; picking one fills the text box, and **STAGE** is still yours to press. The **FORM** button in the same box shows this whole reference as an editable field table — every key in C.2 with its default, range and meaning — with edits rewriting the JSON underneath (Chapter 10.2).

## C.2 All keys

### `network` — where the PDUs go

| Key | Default | Allowed | Meaning |
|---|---|---|---|
| `mode` | `"broadcast"` | `broadcast`, `multicast`, `unicast` | Delivery mode. |
| `destination` | `"255.255.255.255"` | IPv4 | Broadcast address. |
| `port` | `3000` | 1–65535 | UDP port, used for sending and for receiving. |
| `multicastGroup` | `"239.1.2.3"` | IPv4 multicast address | Group joined and sent to in multicast mode. |
| `ttl` | `1` | 1–32 | Multicast time-to-live (hops). |
| `interface` | `null` | IPv4 or `null` | Local adapter address to bind and send from; `null` lets Windows choose. Required for multicast on a PC with several adapters. |
| `unicastDestinations` | `[]` | list of IPv4 | Receivers in unicast mode; at least one is required. |
| `loopbackTest` | `false` | boolean | Reserved. |

### `dis` — protocol identity

| Key | Default | Allowed | Meaning |
|---|---|---|---|
| `protocolVersion` | `6` | 6 or 7 | DIS protocol version written in every header (IEEE 1278.1-1995 = 6, -2012 = 7). The receive path accepts 4–7. |
| `exerciseId` | `1` | 0–255 | Exercise identifier; receivers on other exercises ignore the traffic and vice versa. |
| `siteId` | `1` | 1–65535 | Site part of every entity and event ID. |
| `applicationId` | `3001` | 1–65535 | Application part of every entity and event ID. |
| `timestampMode` | `"relative"` | `relative`, `absolute` | DIS timestamp flag. |
| `emitFirePdu` | `false` | boolean | Also send a Fire PDU immediately before each Detonation. |

### `simMgmt` — simulation management

| Key | Default | Meaning |
|---|---|---|
| `announceSession` | `true` | Send Start/Resume when a session starts. |
| `sendPauseResume` | `true` | Send Stop/Freeze (Recess) on pause and Start/Resume on resume. |
| `endVbsMissionOnStop` | `false` | Send Stop/Freeze (Termination) when the session ends. **Ends a running VBS4 mission.** |

### `ids` — entity numbering

| Key | Default | Meaning |
|---|---|---|
| `blufor.gcs` | `1` | Entity number of the BLUFOR GCS. |
| `blufor.nodes` | `[2, 3]` | Entity numbers of the two BLUFOR DF nodes (exactly two). |
| `blufor.droneBase` | `10` | BLUFOR drone *n* is `droneBase + n` (11, 12, …). |
| `opfor.gcs` | `101` | |
| `opfor.nodes` | `[102, 103]` | |
| `opfor.droneBase` | `110` | OPFOR drones are 111, 112, … |

All values are 16-bit unsigned integers.

### `entityTypes` — SISO enumerations

Each entry is `{kind, domain, country: {BLUFOR, OPFOR}, category, subcategory, specific, extra}`; `country` may differ per side.

| Key | Default (kind.domain.country.category.subcategory.specific.extra) | Used for |
|---|---|---|
| `fpv` | `1.2.0.50.1.1.0` | Drones |
| `gcs` | `1.1.0.6.1.0.0` | Ground control stations |
| `dfNode` | `1.1.0.6.2.0.0` | DF nodes |
| `warhead` | `2.9.0.1.1.0.0` | The munition type in Detonation (and Fire) PDUs |

These are generic, mappable surrogates. Verify them against the SISO-REF-010 revision your receiver uses and re-map as needed.

### `deadReckoning` — update thresholds

| Key | Default | Allowed | Meaning |
|---|---|---|---|
| `drone.algorithm` | `2` | 2 or 4 | 2 = DRM(F,P,W): fixed orientation, constant velocity. 4 = DRM(R,V,W): rotating, with acceleration. Try 4 if drones rubber-band in VBS. |
| `drone.posThresholdM` | `2.0` | 0–100 | Re-send when the receiver's extrapolated position would be off by more than this. |
| `drone.oriThresholdDeg` | `3.0` | 0–90 | Same for orientation. |
| `drone.heartbeatS` | `5` | 1–60 | Maximum interval between drone updates. |
| `static.heartbeatS` | `5` | 1–60 | Maximum interval between updates of GCS, DF nodes and wrecks. |

### `publish` — what and when

| Key | Default | Allowed | Meaning |
|---|---|---|---|
| `publishStandby` | `false` | boolean | Also publish drones before launch. |
| `flamingS` | `60` | 0–600 | Seconds of wall time a destroyed entity shows the flaming and smoke appearance bits. |
| `maxSpeedFactor` | `8` | 1–60 | Advisory only: above this session speed the status line warns that remote smoothing will degrade. |

### `emissions` — the radios

| Key | Default | Meaning |
|---|---|---|
| `heartbeatS` | `10` (1–60) | Emission PDU heartbeat while a radio is keyed. |
| `uplink.freqHz` / `bandwidthHz` / `erpDbm` | `915e6` / `5e6` / `30` | The GCS C2 uplink beam. |
| `video.freqHz` / `bandwidthHz` / `erpDbm` | `5.8e9` / `20e6` / `27` | The drone video downlink beam. |
| `uplink.emitterName`, `video.emitterName` | `0` | SISO emitter name enumeration; `0` leaves the emitter type unspecified. |
| `uplink.function`, `video.function` | `5` | SISO emitter function enumeration. The default, *Acquisition / Detection* (5), is the only function VBS Gateway lists for an incoming emitter system (VBS Gateway manual 26.1.1, §10.6.1); change it only for a receiver that expects another function (Appendix H). |

### `anchor` — placing the box on the Earth

| Key | Default | Allowed | Meaning |
|---|---|---|---|
| `lat0Deg` | `0` | −89.9 to 89.9 | Latitude of the AO's south-west corner. **Set this.** |
| `lon0Deg` | `0` | −180 to 180 | Longitude of the south-west corner. **Set this.** |
| `h0M` | `0` | −500 to 9000 | Ellipsoidal height of the sim's sea level, metres. |
| `rotationDeg` | `0` | −360 to 360 | Azimuth of the sim's +y (north) axis, degrees clockwise from true north. |
| `geoidOffsetM` | `0` | | Added to every height. |

The mapping is a flat-geodetic frame at the anchor's curvature radii: within the 4 km box it differs from a rigorous projection by under 2 cm, and the terrain export (Chapter 11.3) uses the identical mapping, so entities and terrain always agree.

### `receive` — the overlay

| Key | Default | Allowed | Meaning |
|---|---|---|---|
| `enabled` | `true` | boolean | Track Entity State PDUs from other senders. |
| `exerciseFilter` | `true` | boolean | Ignore PDUs from other exercise IDs. |
| `timeoutS` | `12` | 2–300 | A silent track is dropped after this many seconds. |
| `extrapolate` | `true` | boolean | Dead-reckon received tracks between updates (capped at 5 s). |

## C.3 What identifies your entities

| Entity | Entity number | Marking | Force ID | Entity type |
|---|---|---|---|---|
| BLUFOR GCS | 1 | `B-GCS` | 1 | `gcs` |
| BLUFOR DF nodes | 2, 3 | `B-cUAS-1`, `B-cUAS-2` | 1 | `dfNode` |
| BLUFOR drones | 11, 12, … | `B-sUAS-1`, … | 1 | `fpv` |
| OPFOR GCS | 101 | `O-GCS` | 2 | `gcs` |
| OPFOR DF nodes | 102, 103 | `O-cUAS-1`, `O-cUAS-2` | 2 | `dfNode` |
| OPFOR drones | 111, 112, … | `O-sUAS-1`, … | 2 | `fpv` |

Site `dis.siteId`, application `dis.applicationId`. An entity keeps its number for the whole session. Destroyed entities carry the *Destroyed* damage appearance (plus flaming and smoke for `publish.flamingS` seconds) and keep heart-beating as wrecks; a drone lost to battery exhaustion is marked destroyed without a Detonation.
