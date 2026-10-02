# 11. VBS4, HLA federations and terrain export

Chapter 10 got your PDUs onto the wire. This short chapter points you to the documents that take them into a specific simulator. They live in the source repository next to this manual and are written for interoperability engineers.

## 11.1 VBS4 through the VBS Gateway

VBS4 speaks DIS through its standard **VBS Gateway**. The lab procedure is `docs/VBS4_CHECKLIST.md`, a seven-step checklist:

0. **Dry run without VBS** — exactly Chapter 10 with `dis-listen`: one Start/Resume, six Entity States immediately, drones on launch, emissions keying and unkeying, exactly one Detonation, no `MALFORMED` lines.
1. **VBS Gateway configuration** — DIS adapter only; DIS version, exercise ID, UDP port and broadcast/multicast scheme matched to `dis.protocolVersion`, `dis.exerciseId`, `network.port`; geofilter off or enclosing the 4 km box.
2. **Terrain correlation (optional)** — import the exported DEM (11.3) at the same anchor so the remote terrain matches the engagement.
3. **Entity mapping** — check the Gateway resolves the four surrogate entity types (Chapter 10.7) or re-map them.
4. **Live engagement at 1×** — an acceptance list: six then eight entities at the right grid references, smooth motion (rubber-banding means tighten `deadReckoning.drone.posThresholdM` / `oriThresholdDeg` or switch algorithm 2 → 4), markings and force sides, emitter systems listed in the Gateway UI, the detonation effect and a persistent wreck, pause and resume freezing the VBS entities, a 4× session still smooth.
5. **Reverse path** — a VBS entity inside the AO appears in Live Ops as a grey diamond within about five seconds and expires about 12 s after deletion.
6. **Capture the tuned values** — feed adjustments back into the configuration and archive a reference capture.

> [!IMPORTANT]
> Do not run the VBS Gateway's DIS and HLA adapters at the same time.

> [!TIP]
> [Appendix H](H-vbs4-quick-start.md) walks the same checklist as a worked example, from a fresh PC to a VBS4 vehicle on the Live Ops map, with the exact VBS Gateway settings and the one value VBS Gateway insists on for emitter systems.

## 11.2 HLA federations

FPV Sim has no native HLA federate. `docs/INTEROP.md` describes the bridged topology — FPV Sim → DIS → a DIS/HLA bridge such as the Pitch DIS Adapter → the RTI, under RPR-FOM 2.0 — with a table mapping each PDU to its RPR-FOM object or interaction class, and the seam where a native federate could be added later. The same document is the reference for the wire contract: every PDU type, the time-scaling rules across the DIS boundary, the receive path and the georeferencing.

## 11.3 Terrain export

For the remote simulator's terrain to correlate with the engagement, FPV Sim exports any seed's terrain as a georeferenced DEM in the form VBS Geo's import accepts. Three ways run the same export:

- **Live Ops ▸ GATEWAY ▸ EXPORT TERRAIN.** Stage a gateway configuration first (Chapter 10.2): the export takes its place on Earth from the staged `anchor`, so the terrain and the DIS stream cannot disagree. Set the seed in the header, press **EXPORT TERRAIN** and choose a folder. The box then reads `terrain exported: 5 files for seed … in …`; with nothing staged it reads `export refused: no gateway config staged`.
- **The MCP tool `live_export_terrain`** ([Appendix E.7](E-mcp-tools-reference.md)): the same export, with the anchor from the staged configuration unless the call passes one and the folder `%APPDATA%\fpv-sim-app\terrain` unless the call names one.
- **The command line**, for scripts, from the installed copy (the summary prints in the console window you launch it from):
  ```bat
  "%LocalAppData%\Programs\FPV Sim\FPV Sim.exe" --terrain-export --seed=20260719 --lat=21.35 --lon=-157.95 --geoid=<N> --out=C:\terrain
  ```
  `--h0`, `--rotation` and `--geoid` match the gateway's `anchor` keys (Appendix C); `--out` defaults to an `export` folder under the current directory; `--vdatum=egm96` or `--vdatum=ellipsoid` narrows the set to one elevation variant. A developer checkout runs the same code as `npm run terrain-export -- <the same flags>`.

![EXPORT TERRAIN](images/live-ops-terrain-export.png)
*Figure 11-1. EXPORT TERRAIN in the GATEWAY box: the staged anchor and the seed become the five files below.*

Every export writes five files, named by seed:

| File | Content |
|---|---|
| `seed-<n>-elevation-egm96.tif` | Heights above mean sea level (EPSG:4326 + EPSG:5773). The sim's zero is sea level, so these are the engine's own values. |
| `seed-<n>-elevation-ellipsoid.tif` | The same heights plus the anchor's `geoidOffsetM`, declared as WGS 84 ellipsoidal heights (EPSG:4979). |
| `seed-<n>-elevation-<vdatum>.json` | One per variant: the grid's metadata (bounds, pixel size, datum, offset, anchor). |
| `seed-<n>-canopy.tif` | Canopy density 0 to 1 on the same grid, a reference layer for vegetation work. |

Each `.tif` is a single-band Float32 GeoTIFF in geographic WGS 84 (EPSG:4326) with 200 × 200 pixels over the 4,000 m box, one pixel per engine post, nodata `-9999`. The grid is written directly on the gateway's own mapping, so the centre of every pixel is exactly where the DIS stream places that sim point; no projection or resampling is involved.

Both vertical-datum variants are written every time because VBS Geo ignores the GeoTIFF's vertical tag and assumes one of two datums its manual does not name. VBS4's ocean sits at mean sea level and cannot be moved, so the import that puts the sim's coastline on the water line is the right one: import the `egm96` file first and keep it if the coastline lands on the water line; land drowned by a constant offset means VBS Geo assumes ellipsoidal heights, so import the `ellipsoid` file instead; seabed exposed by a constant offset means the reverse. Negative posts are real seabed and must not be clamped.

> [!NOTE]
> The geoid undulation N belongs in the gateway configuration as `anchor.geoidOffsetM` before you export, whichever file VBS Geo turns out to want: the `ellipsoid` file is built from it, and DIS positions are ellipsoidal, so without it every entity sits N metres below the terrain. GeographicLib's GeoidEval page (EGM96) gives N for any latitude and longitude; it is positive at the example anchor. With `geoidOffsetM` left at 0 the export still runs, but the box adds the line *exported, but check: anchor.geoidOffsetM is 0*, and the two elevation files hold the same heights.

> [!TIP]
> Need another format? GDAL converts the GeoTIFF losslessly, for example `gdal_translate -of AAIGrid seed-20260719-elevation-egm96.tif seed-20260719-elevation.asc` for an Esri ASCII Grid. TerraTools and Mantle read the GeoTIFF and its vertical tag directly.

## 11.4 The shareable brief

`docs/fpv-sim-vbs4-interop-brief.pdf` is a three-page summary — architecture, wire contract, lab procedure, versions and links — intended for colleagues ahead of a VBS4 session.

## 11.5 Independent verification

Everything else that decodes the DIS stream shares the application's own codec. The repository's `npm run interop-check` scores the full seed-20260719 stream with [open-dis-python](https://github.com/open-dis/open-dis-python), an independent IEEE 1278.1 implementation, in both directions, and runs on every change in CI. If you need to convince a sceptical integrator, that check and the committed golden capture `docs/captures/seed-20260719-orbit.pcap` are the evidence.
