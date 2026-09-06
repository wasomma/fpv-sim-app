# Interoperability

fpv-sim-app natively speaks **DIS (IEEE 1278.1)** over UDP. HLA
federations are reached by **bridging** the DIS stream; a documented seam
exists for a native HLA federate later. All simulation data is notional.

## What goes on the wire

| PDU | When | Notes |
|---|---|---|
| Entity State (1) | first sighting; dead-reckoning threshold trips (2 m / 3° vs a DRM mirror); heartbeat (5 s); appearance changes; final state at death | Statics DRM 1; drones DRM 2 (FPW) default, DRM 4 (RVW) configurable. Wrecks keep heartbeating with Destroyed appearance (+ ~60 s flaming/smoke on kills) until session stop. Markings: `B-GCS`, `O-sUAS-3`, … |
| EM Emission (23) | every keyed↔unkeyed edge of the GCS C2 uplink / per-drone video downlink; 10 s heartbeat while keyed; zero-beam EE at unkey | One omni beam per system. RF values are **notional config** (defaults: uplink 915 MHz / 5 MHz / 30 dBm; video 5.8 GHz / 20 MHz / 27 dBm) — the engine models keying booleans, not a link budget. Emitter function defaults to 5 (Acquisition / Detection), the only function VBS Gateway lists for incoming emitter systems; emitter name defaults to 0. |
| Detonation (3) | the tick a one-way FPV impacts | GCS kill → Entity Impact with the target's ID; tactical objective strike → Ground Impact. The airframe is the munition (no separate munition entity). In-tick order: killer's final ESPDU → [Fire] → Detonation → target's destroyed ESPDU → consequent EE unkeys. |
| Fire (2) | **off by default** (`dis.emitFirePdu`) | A one-way FPV has no separate launch event; the Detonation stands alone legally. Enable for consumers that insist on Fire/Detonation pairing (same event ID). |
| Start/Resume (13) / Stop/Freeze (14) | session start (announce), pause (Recess) / resume when `simMgmt.sendPauseResume`; session stop sends **nothing** unless `simMgmt.endVbsMissionOnStop` (then Stop/Freeze reason Termination — **this ends a running VBS4 mission**) | Real-World Time = 0 → "immediate action" semantics. Received sim-management PDUs are logged, never obeyed. |

Protocol version 6 on the wire by default (`dis.protocolVersion: 7`
available); receive accepts v4–7. Timestamps relative by default
(`dis.timestampMode: "absolute"` for NTP-disciplined sites). Worst-case
rate at 1×: ~25–30 PDU/s (~4–5 kB/s).

## Time across the boundary

DIS has no time-scale message, so no peer can be *commanded* to a speed —
and none needs to be. At accelerated session speeds the gateway publishes
**wall-apparent kinematics**: velocity and angular-rate fields scale by
the speed factor (attitude stays physical), and every speed change fires
a full ESPDU refresh volley. Receivers extrapolate in wall time, so they
render the engagement at the app's speed with correct smoothing.
`publish.maxSpeedFactor` (default 8) is an advisory ceiling — beyond it,
remote interpolation degrades (VBS documents the same limitation for its
own accelerated time).

## Receive path

Remote Entity State PDUs (exercise-ID-filtered, own site:app ignored)
feed a read-only overlay track store: linear extrapolation between
updates (capped 5 s), expiry after 12 s of silence, positions inverted
into the sim's local frame. Overlay tracks render in Live Ops and **never
influence the engagement** — determinism is preserved by construction.

## Georeferencing

The sim's 4×4 km local frame maps to Earth through a configured anchor:
`anchor: { lat0Deg, lon0Deg, h0M, rotationDeg, geoidOffsetM }` — the
geodetic position of the sim origin (SW corner), the ellipsoidal height
of sim sea level, and the azimuth of sim +y. A small-offset
"flat-geodetic" mapping (< 2 cm across the box) keeps entity positions
and the DEM export mutually consistent. `npm run terrain-export --
--seed=<n> --lat=.. --lon=..` writes the seed's heightfield as a
georeferenced Esri ASCII Grid (+ canopy raster + UTM .prj) for import
into the remote tool's terrain pipeline — set the water level there to
elevation 0; negative posts are real seabed.

## Reaching VBS4 (topology B — direct DIS)

```
fpv-sim-app ──DIS/UDP──► VBS Gateway (ships with VBS4) ──► VBS4
```

VBS Gateway supports DIS v4–v7 and the full PDU set above. Do **not**
run its DIS and HLA adapters simultaneously (documented VBS limitation).
See `VBS4_CHECKLIST.md` for the lab procedure, including importing the
exported DEM via VBS Geo so terrains correlate.

## Reaching HLA federations (topology A — bridged)

```
fpv-sim-app ──DIS/UDP──► Pitch DIS Adapter ──► pRTI ──► RPR-FOM 2.0 federation
```

Pitch DIS Adapter (Pitch Infrastructure family) bridges DIS "islands"
onto an HLA backbone. VBS Gateway can likewise join HLA federations
(RPR 1/2, NETN 3/4) using Pitch pRTI or MAK RTI — one adapter at a time.

RPR-FOM 2.0 correspondence of this app's stream, for FOM-side planning:

| DIS | RPR-FOM 2.0 |
|---|---|
| Entity State (drones) | `BaseEntity.PhysicalEntity.Platform.Aircraft` (spatial struct carries the DR fields) |
| Entity State (GCS, DF nodes) | `BaseEntity.PhysicalEntity.Platform.GroundVehicle` |
| EM Emission | `EmitterSystem` / `EmitterBeam` objects |
| Detonation | `MunitionDetonation` interaction |
| Fire | `WeaponFire` interaction |
| Start/Resume, Stop/Freeze | federation management conventions (bridge-dependent) |

## Native-HLA seam

The publisher and receiver are protocol-neutral consumers of engine
TickViews; `DisGateway` is one binding of the gateway slot. A native HLA
federate would be another — realistically a Java/C++ sidecar speaking an
RTI's Evolved API (e.g. Pitch pRTI), driven over local IPC, publishing
the same derived state. No publisher logic would change.

## Known limitations

- Emissions are keying booleans with notional RF parameters — no
  waveforms, no real link budget.
- No IFF PDUs (force ID carries side affiliation).
- One live session at a time; the DIS entity count is small (≤ ~18).
- Received entities are display-only by design.
