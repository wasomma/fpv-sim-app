# VBS4 lab checklist

End-to-end verification of fpv-sim-app ⇄ VBS4 over DIS via VBS Gateway.
Prereqs: VBS4 (Gateway ships standard), both machines on one subnet (or
one machine — `reuseAddr` lets the gateway, `dis-listen`, and VBS share
a port), Windows Firewall allowing UDP on the DIS port (default 3000)
inbound on both ends.

A worked, installer-only version of this checklist — fresh PC, the exact
VBS Gateway settings, the acceptance list, the reverse path — is the
manual's [Appendix H](manual/H-vbs4-quick-start.md).

Fill in per-site values first: anchor lat/lon (pick the AO location —
flat coastal terrain correlates best), exercise ID, network mode
(broadcast for a flat lab LAN; multicast with an explicit interface on
multi-homed hosts).

## 0. Dry run without VBS (any second machine, or the same one)

```bash
npm run dis-listen -- --port=3000 --mode=broadcast --anchor=21.35,-157.95
```

Start a live session with the gateway armed (Live Ops panel or
`live_start_session {..., gateway: {...}}`). Expect: START/RESUME once,
6 ESPDUs immediately (both GCS + 4 DF nodes) then drones on launch, EE
lines flipping KEYED/SILENT with the EMCON schedule, exactly one
DETONATION at the kill, wreck heartbeats after ENDEX. No MALFORMED
lines. Optionally confirm in Wireshark (`udp.port == 3000`, DIS
dissector) — no malformed-packet warnings across a full engagement.

## 1. VBS Gateway configuration

- DIS adapter ONLY (never DIS + HLA simultaneously — documented VBS
  limitation; inconsistent behavior).
- DIS version matching `dis.protocolVersion` (default 6), exercise ID
  matching `dis.exerciseId` (default 1), UDP port matching
  `network.port` (default 3000), same broadcast/multicast scheme.
- Geofilter: off, or a region enclosing the anchor's 4×4 km box.
- Site ID 1 (`dis.siteId`; VBS Gateway ignores traffic from other site
  IDs) and a Gateway Application ID other than 3001 (it ignores its own).
- Emitter function 5: leave `emissions.uplink.function` and
  `emissions.video.function` at their shipped default of `5`
  (Acquisition / Detection). VBS Gateway keeps only incoming emitter
  systems with that function (VBS Gateway manual 26.1.1, §10.6.1); with
  any other value the EE acceptance line in step 4 cannot pass.

## 2. Terrain correlation (optional but the better demo)

Export the terrain from the installed app: stage the gateway
configuration with the real anchor (including `geoidOffsetM`) and press
EXPORT TERRAIN in the Live Ops GATEWAY box (manual 11.3), or script it
from the installed copy:

```bat
"%LocalAppData%\Programs\FPV Sim\FPV Sim.exe" --terrain-export --seed=<featured seed> --lat=<lat> --lon=<lon> --geoid=<N> --out=C:\terrain
```

(`npm run terrain-export -- <the same flags>` in a developer checkout.)
Either way five files land in the folder: the elevation in both
vertical datums, each with a `.json` of the grid, and the canopy.

N is the EGM96 geoid undulation at the anchor in metres (GeographicLib's
GeoidEval page set to EGM96, or `gdaltransform -s_srs EPSG:4979 -t_srs
EPSG:4326+5773` in an OSGeo4W shell, whose third output is minus N).
Compute it; do not guess. The same N goes into the gateway's
`anchor.geoidOffsetM`, whichever file VBS Geo turns out to want: DIS
positions are ellipsoidal, and without it every entity sits N metres
below the imported surface.

VBS Geo's DEM import takes GeoTIFF in EPSG:4326 only (no Esri ASCII
Grid, no projected CRS), honours the nodata value and negative posts,
ignores the vertical-datum tag, and assumes either EGM96 or ellipsoidal
heights without the manual saying which. The two elevation files are
that GeoTIFF; they differ only by N. VBS4's ocean sits at mean sea level and
cannot be moved, so the water line is the test:

- Import `seed-<n>-elevation-egm96.tif` first. If the sim map's
  coastline falls on the water line, VBS Geo assumes EGM96. Keep it.
- Land drowned by a constant N (shoreline moved inland) means VBS Geo
  assumes ellipsoidal heights: import `seed-<n>-elevation-ellipsoid.tif`
  instead.
- Seabed exposed by a constant N (shoreline moved seaward) means the
  ellipsoid file went into an EGM96 importer.

Record which datum VBS Geo assumed here: ____________ (undetermined as
of 2026-10-01). Then verify correlation at three grid references: the
sim map's SW corner, the ridge spine, the coastline. Negative posts are
real seabed; do not clamp them. The canopy `.tif` (density 0 to 1 on the
same grid) is a reference layer for manual vegetation painting.

## 3. Entity mapping

Check VBS Gateway's mapping view resolves the four enumerations to
visible models (defaults are generic surrogates chosen for fuzzy
mapping): FPV `1.2.x.50.1.1.0`, GCS `1.1.x.6.1.0.0`, DF node
`1.1.x.6.2.0.0`, warhead `2.9.x.1.1.0.0`. Re-map per site in the
gateway config (`entityTypes`) or the VBS side — whichever the site
prefers — and record the mapping used.

## 4. Live engagement

Start a featured seed at **1×** with the gateway armed. Verify in VBS4:

- [ ] 6 entities appear at the correct grid references; 8 after both
      launches (orbit) / more in tactical mode.
- [ ] Drones move smoothly. Rubber-banding → lower
      `deadReckoning.drone.posThresholdM`/`oriThresholdDeg`, or switch
      `algorithm` 2 → 4 for orbiting flight.
- [ ] Markings visible (`B-GCS`, `O-sUAS-1`, …); force sides correct.
- [ ] EE systems listed in the Gateway UI while keyed (in-world RF
      rendering is not expected — the Gateway UI is the acceptance
      criterion).
- [ ] Detonation effect at the GCS kill; wreck persists with destroyed
      appearance; battery-crash drones show destroyed without an
      explosion.
- [ ] Pause/resume from Live Ops freezes/resumes VBS-side entities
      (Stop/Freeze / Start/Resume with immediate-action semantics).
- [ ] A 4× session: entities move 4× faster, still smooth (update rate
      rises with speed by design).

## 5. Reverse path (overlay)

Place a VBS4 entity inside the AO box. Expect it in the app's Live Ops
overlay (gray diamond + marking) within ~5 s, moving smoothly
(extrapolated between its updates), expiring ~12 s after deletion.
Confirm the engagement itself is untouched (same seed replays
identically afterward — the overlay is display-only).

## 6. Capture the tuned values

Feed any threshold/enumeration adjustments back into the shipped
defaults (`src/main/gateway/config.ts`) or the site config, and archive
a reference `.pcapng` of a clean run in `docs/captures/`.

Captures: a committed golden reference already exists at
`docs/captures/seed-20260719-orbit.pcap` (first 60 s of seed 20260719
at 1x, fabricated headers on UDP port 3000, opens directly in
Wireshark). See the README "Captures" section for how it is generated;
`npm run dis-listen -- --pcap=<file>` records live traffic the same
way for comparison against it.
