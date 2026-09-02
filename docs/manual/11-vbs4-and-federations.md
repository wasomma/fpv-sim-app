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

## 11.2 HLA federations

FPV Sim has no native HLA federate. `docs/INTEROP.md` describes the bridged topology — FPV Sim → DIS → a DIS/HLA bridge such as the Pitch DIS Adapter → the RTI, under RPR-FOM 2.0 — with a table mapping each PDU to its RPR-FOM object or interaction class, and the seam where a native federate could be added later. The same document is the reference for the wire contract: every PDU type, the time-scaling rules across the DIS boundary, the receive path and the georeferencing.

## 11.3 Terrain export

For the remote simulator's terrain to correlate with the engagement, the developer checkout can export any seed's heightfield as a georeferenced DEM:

```bash
npm run terrain-export -- --seed=20260719 --lat=21.35 --lon=-157.95
```

It writes five files into `./export`: `seed-20260719-elevation.asc` and `.prj` (Esri ASCII Grid, 200 × 200 posts over 4,000 m, WGS 84 / UTM), `seed-20260719-canopy.asc` and `.prj` (canopy density 0–1 on the same grid) and `seed-20260719-meta.json`. Optional flags `--h0`, `--rotation`, `--geoid` and `--out` match the gateway's `anchor` keys, so entities and terrain share one frame by construction.

> [!NOTE]
> Set the importing tool's water level at elevation 0. Negative posts are real seabed and must not be clamped.

## 11.4 The shareable brief

`docs/fpv-sim-vbs4-interop-brief.pdf` is a three-page summary — architecture, wire contract, lab procedure, versions and links — intended for colleagues ahead of a VBS4 session.

## 11.5 Independent verification

Everything else that decodes the DIS stream shares the application's own codec. The repository's `npm run interop-check` scores the full seed-20260719 stream with [open-dis-python](https://github.com/open-dis/open-dis-python), an independent IEEE 1278.1 implementation, in both directions, and runs on every change in CI. If you need to convince a sceptical integrator, that check and the committed golden capture `docs/captures/seed-20260719-orbit.pcap` are the evidence.
