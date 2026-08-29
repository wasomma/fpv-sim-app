# DIS and HLA: a primer

Background for this app's interoperability features: what the two
standards are, how they differ, and why the gateway is built the way it
is. Nothing here is normative — the wire contract lives in
[INTEROP.md](INTEROP.md) and the lab procedure in
[VBS4_CHECKLIST.md](VBS4_CHECKLIST.md). This is orientation for anyone
meeting the acronyms for the first time.

## The problem both standards solve

In the late 1980s DARPA's **SIMNET** program networked tank trainers so
crews at different sites could fight one shared battle. It proved a
radical idea: independently built simulators, each authoritative over
its own vehicles, can share a coherent world by exchanging state over a
network — no central server owning the truth. Everything since is an
industrialization of that idea, under the banner of **LVC
interoperability** (Live, Virtual, Constructive: real instrumented
assets, human-in-the-loop simulators, and computer-generated forces in
one exercise).

Two generations of standard came out of it:

- **DIS** (Distributed Interactive Simulation, IEEE 1278, early 1990s)
  — a *wire protocol*: exact bytes in UDP datagrams.
- **HLA** (High Level Architecture, IEEE 1516, late 1990s) — an
  *architecture and API*: services a simulator calls, with the wire
  format left to middleware.

The US DoD mandated HLA in 1996 expecting it to retire DIS. Decades
later both are everywhere, DIS remains the lingua franca of real-time
platform simulation, and the ecosystem's working answer is gateways
between the two — the topologies INTEROP.md documents.

## DIS: the shared world as a broadcast of state

### Wire model

There is no server, no session, no handshake. Every simulator emits
**PDUs** (Protocol Data Units — fixed big-endian binary structures)
over UDP, conventionally broadcast or multicast on port 3000, and
listens for everyone else's. Joining an exercise means starting to
send; leaving means going quiet. An **exercise ID** in every header
lets multiple exercises share a network — receivers filter on it, as
this app's receive path does.

That statelessness is DIS's superpower: `dis-listen`, Wireshark's
built-in DIS dissector, and VBS Gateway can all watch the same traffic
with zero coordination. The committed golden capture
(`docs/captures/seed-20260719-orbit.pcap`) is the best study aid this
repo has — open it in Wireshark and you are looking at the protocol.

### The PDUs that matter

IEEE 1278.1 defines roughly seventy PDU types; a handful carry almost
all real traffic. This app's set:

| PDU | Carries | Here |
|---|---|---|
| Entity State (1) | identity, type, ECEF position/velocity/orientation, appearance bits, an 11-char marking | The workhorse; carries the `B-GCS` / `O-sUAS-n` markings |
| Fire (2) / Detonation (3) | the warfare pair | A Detonation is legal without a preceding Fire — why `dis.emitFirePdu` defaults off for a one-way FPV whose airframe *is* the munition |
| EM Emission (23) | emitter systems and beams: the electromagnetic order of battle | C2 uplink / video downlink keying |
| Transmitter/Signal/Receiver (25–27) | radio *content* — voice audio, data streams | Not used; this is the family audio interop (e.g. VBS Radio / Pitch Talk) would ride on |
| Start/Resume (13) / Stop/Freeze (14) | simulation management | Announced on start/pause/resume; received ones are logged, never obeyed |

### Identity and enumerations

Every entity is named by a **site : application : entity** triplet,
unique by convention across the exercise. *What* an entity is comes
from a 7-field **entity type** record — Kind, Domain, Country,
Category, Subcategory, Specific, Extra — with values from
**SISO-REF-010**, a living enumerations document maintained by SISO
(the Simulation Interoperability Standards Organization, steward of
this whole ecosystem). The FPV's `1.2.x.50.1.1.0` reads: Kind 1 =
Platform, Domain 2 = Air, per-site country, then category and
subcategory from the air-platform table.

Enumeration agreement is the eternal DIS pain point: two simulators
disagreeing on a value render different vehicles. Hence gateway
mapping tables — see VBS4_CHECKLIST.md step 3.

### Coordinates

Positions are geocentric **ECEF** (Earth-Centered Earth-Fixed, WGS-84,
meters): one unambiguous global frame, no zones or datums, cheap
extrapolation math. Orientation is Euler angles *relative to the
geocentric frame* — everyone's least favorite part of implementing
DIS. The anchor / flat-geodetic machinery in INTEROP.md exists because
a local-frame sim must round-trip local ↔ geodetic ↔ ECEF
consistently. Terrain correlation is the half of world-coherence the
protocol does not solve — that is what the DEM export is for.

### Dead reckoning

Broadcasting every entity at frame rate would melt the network, so DIS
specifies mirrored extrapolation: sender and receivers run the same
**dead-reckoning model** (DRM), and the sender transmits only when its
true state diverges from its own mirror beyond thresholds, or on a
heartbeat. Receivers extrapolate smoothly between updates.

This app's numbers are the standard's defaults: 5 s is the IEEE
platform heartbeat, and the standard timeout multiplier of 2.4× yields
the 12 s overlay expiry. The DRM choices are canonical too — DRM 1
(static) for fixed sites, DRM 2 (constant velocity, fixed orientation)
for steady flight, DRM 4 (adds rotation) for orbits — and
"rubber-banding → tighten thresholds or switch 2 → 4" is the universal
field remedy.

### What DIS does not have

- **Reliability** — best-effort UDP; the design assumes a LAN.
- **Interest management** — everyone receives everything, which caps
  practical federation size.
- **Extensibility** — the object model is frozen in the PDU formats
  plus enumeration politics.
- **A model of time** — PDUs carry timestamps (relative orders them
  within a sender; absolute places them on a shared NTP-disciplined
  clock) but the exercise simply runs at wall clock. The
  wall-apparent-kinematics scheme in INTEROP.md is a deliberate
  workaround for exactly this hole; HLA's first-class answer to it is
  below.

## HLA: the shared world as a managed federation

HLA starts over at a different layer. A simulator becomes a
**federate**; federates join a **federation** by connecting to an
**RTI** (Run-Time Infrastructure) — middleware providing well over a
hundred services in seven groups. IEEE 1516 standardizes the *API and
rules*, not the wire: each RTI's network protocol is proprietary, so a
federation runs one RTI product (Pitch pRTI and MAK RTI are the
commercial mainstays; Portico and CERTI the open-source options).
That is also why there is no "Wireshark for HLA" — debugging happens
in RTI-side tooling.

### The FOM

A federation's vocabulary is not fixed by the standard; it is declared
in a **Federation Object Model**: XML defining **object classes**
(persistent, attribute-bearing things — entities) and **interaction
classes** (transient events — a weapon firing). This is HLA's answer
to DIS's frozen PDU set. In practice, real-time platform federations
overwhelmingly use **RPR-FOM** (Real-time Platform Reference FOM, the
SISO-STD-001 family) — which is, candidly, *DIS re-expressed in HLA*:
`BaseEntity.PhysicalEntity.Platform.Aircraft` with a spatial struct
carrying the same dead-reckoning fields, `WeaponFire` and
`MunitionDetonation` interactions, the same SISO-REF-010
enumerations. The DIS ↔ RPR 2.0 table in INTEROP.md is exactly this
mapping. NATO's **NETN FOM** layers modules on top of RPR
(aggregates, logistics, transfer of control), and STANAG 4603 is why
European programs ask for HLA by name.

### What the services buy over DIS

- **Declaration / object management** — publish/subscribe per class
  and per attribute: you receive only what you subscribed to, updates
  can carry only the changed attributes, and each attribute can be
  reliable or best-effort.
- **Ownership management** — attributes of one object can be handed
  between federates at runtime (a drone launching under one
  simulator's control and transferring mid-flight to another's flight
  model). Structurally impossible in DIS, where the publisher owns
  its entities, full stop.
- **Time management** — federates advance in coordinated *logical*
  time with timestamp-ordered delivery and lookahead contracts: the
  federation runs faster or slower than real time coherently, with
  causal ordering guaranteed and repeatable results. This is the
  federation-wide version of the determinism guarantee this app's CI
  enforces, and the first-class answer to what wall-apparent
  kinematics work around. (Most training federations skip it and run
  real-time, like DIS; it matters for analysis, test, and
  faster-than-real-time runs.)
- **Data distribution management** — spatial interest filtering for
  very large federations.
- **Federation management** — join/resign, synchronization points (a
  principled version of the Start/Resume announcement), coordinated
  save/restore.

### Versions

HLA 1.3 (DoD, pre-IEEE) → IEEE 1516-2000 → **IEEE 1516-2010 "HLA
Evolved"** (the deployed baseline: standardized C++/Java APIs, modular
FOMs, fault tolerance) → **HLA 4**, the mid-2020s revision now
arriving in products. Relevant locally: VBS documents its HLA 4 /
NETN 4 path as requiring an HLA 4-capable RTI (current Pitch pRTI or
MAK RTI releases).

## Side by side

| | DIS | HLA |
|---|---|---|
| Standardizes | Bytes on the wire | API + services + rules (wire is per-RTI) |
| Topology | Peer broadcast/multicast UDP, serverless | Federates ↔ RTI middleware |
| Object model | Fixed PDUs + SISO enumerations | Per-federation FOM (usually RPR, which mirrors DIS) |
| Joining | Start transmitting | Join federation, declare pub/sub |
| Filtering | None — everyone hears everything | Subscription + DDM regions |
| Time | Wall clock only | Optional coordinated logical time, repeatable runs |
| Ownership | Publisher owns its entities forever | Transferable per attribute |
| Debugging | Wireshark, tcpdump, any codec | RTI vendor tooling |
| Cost of entry | A UDP socket and a codec | An RTI (commercial licenses; thinner open-source options) |
| Sweet spot | Real-time LAN exercises, small-to-mid entity counts | Large, mixed, WAN, analytical, or NATO-mandated federations |

## How they coexist

Real exercises are plumbing diagrams: DIS islands bridged onto HLA
backbones through gateways (INTEROP.md topology A — Pitch DIS Adapter
onto pRTI / RPR 2.0 — is the canonical picture), and dual-mode
gateways like VBS Gateway running one adapter at a time (the
"never DIS + HLA simultaneously" caution). Adjacent acronyms you will
hear: **TENA** (US test- and training-range world), **WebLVC**
(JSON-over-WebSocket for browser clients, always via a bridge), and
**DDS** (general pub/sub middleware, not simulation-specific).

## Where this app sits

1. **Native DIS first** — the lowest-friction path to VBS4,
   independently verifiable (the open-dis-python cross-check is how
   codec correctness should be proven), observable with commodity
   tools, and sufficient for this app's small entity count on a LAN.
2. **HLA by bridging** — costs nothing in code and reaches RPR
   federations today; the semantic mapping is mechanical because RPR
   is DIS-shaped.
3. **The native-HLA seam** (INTEROP.md) — a Java/C++ sidecar speaking
   an RTI's Evolved API over local IPC, since no production-grade
   JS/TS RTI binding exists. Worth building only when a requirement
   arrives that bridges cannot satisfy: time-managed synchronized runs
   (retiring wall-apparent kinematics), ownership transfer of a drone
   to another federate, or a NETN-compliance ask.

## Further reading

- IEEE 1278.1-2012 — DIS application protocols (v7; v6 = 1278.1a-1998
  remains the field lingua franca and this app's wire default).
- IEEE 1516 / 1516.1 / 1516.2-2010 — HLA Evolved (framework, federate
  interface, OMT).
- SISO-REF-010 — enumerations (entity types, appearance bits, …).
- SISO-STD-001 family — RPR-FOM and its GRIM companion (the DIS ↔ HLA
  correspondence rules).
- NETN FOM — NATO modules layered on RPR.
- [open-dis](https://github.com/open-dis) — open-source DIS codecs in
  several languages; the Python one backs `npm run interop-check`.
