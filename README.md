# fpv-sim-app

Installable Windows desktop application for the
[fpv-sim](https://github.com/wasomma/fpv-sim) engagement simulation.
It wraps the existing ecosystem unmodified — the browser sim, results
dashboard and WebGPU 3D viewer are served exactly as published, and the
simulation engine is the golden-master-verified TypeScript port from
[fpv-sim-mcp](https://github.com/wasomma/fpv-sim-mcp) — and adds what an
installed, offline tool needs:

- **Interactive seed runs** — the single-file sim, dashboard and 3D
  viewer in app windows, sharing one `app://ui/` origin so every
  relative fetch and `?seed=` deep link works unchanged.
- **Monte Carlo locally** — the canonical study and ad-hoc sweep runners
  executed against the bundled engine (plus a parallel worker-pool
  runner proven byte-equivalent), writing datasets the dashboard reads
  from `%APPDATA%\fpv-sim-app\results`.
- **MCP endpoint** — the five fpv-sim-mcp batch tools plus live-session
  tools (`live_start_session`, `live_get_snapshot`,
  `live_configure_gateway`, …) on loopback HTTP with bearer auth; the
  MCP panel shows copy-paste connection snippets for Claude Code.
- **Live sessions** — wall-clock-paced engagements in a utility process
  with a hard determinism guarantee: a session run to its end produces
  the identical result as the batch run (CI-enforced).
- **Native DIS gateway** — IEEE 1278.1 over UDP (Entity State, EM
  Emission, Detonation, optional Fire, Start/Resume, Stop/Freeze),
  wall-apparent kinematics at accelerated speeds, receive-as-overlay,
  georeferenced by a configurable anchor. Stage it from the Live Ops
  panel's JSON editor — **STAGE** validates the configuration and names
  the exact path of any bad value — or over MCP with
  `live_configure_gateway`. VBS4 connects through its
  standard VBS Gateway; HLA federations via bridging (Pitch DIS
  Adapter). See [docs/INTEROP.md](docs/INTEROP.md) and
  [docs/VBS4_CHECKLIST.md](docs/VBS4_CHECKLIST.md); new to the
  standards, start with [docs/DIS_HLA_PRIMER.md](docs/DIS_HLA_PRIMER.md).
- **Terrain export** — any seed's heightfield as a georeferenced DEM
  (Esri ASCII Grid + UTM .prj + canopy raster) for VBS Geo import, so
  the remote terrain correlates with the engagement.
- **Shareable lab brief** —
  [docs/fpv-sim-vbs4-interop-brief.pdf](docs/fpv-sim-vbs4-interop-brief.pdf),
  a 3-page summary (architecture, wire contract, lab procedure) for
  colleagues ahead of a VBS4 session; regenerate with
  `python docs/brief/generate_brief.py` (requires reportlab).

All simulation data is notional and unclassified.

## Install

Grab `fpv-sim-app-setup-<version>.exe` from Releases and run it
(per-user, no admin). The installer is unsigned: SmartScreen will warn —
"More info" → "Run anyway". Fully offline once installed.

**New here? Read the [User Manual](docs/manual/README.md)** — installing,
every window and panel, running Monte Carlo studies, reading the dashboard,
sending entities over DIS, and a worked VBS4 quick start (Appendix H),
with screenshots regenerated from each build.
A single-file PDF of the same manual is attached to every release.
Release history is in [CHANGELOG.md](CHANGELOG.md).

## Development

```
git clone --recurse-submodules https://github.com/wasomma/fpv-sim-app
cd fpv-sim-app
npm install        # builds the fpv-sim-mcp git dependency via its prepare script
npm run vendor     # vendor the pinned fpv-sim UI + engine copy into build/resources
npm run build      # tsc
npm test           # engine parity smoke, codec/geo/publisher/receive, settings/window/studies/menu/results suites (125 tests)
npm run self-check # headless end-to-end: protocol, engine, studies, MCP, live, DIS loopback
npm run screenshots # regenerate docs/manual/images from the app itself (scratch profile)
npm run manual:pdf # build docs/manual/fpv-sim-manual.pdf with the bundled Electron
npm start          # launch the app
npm run dist       # NSIS installer -> out/ (builds the manual PDF first; Help ▸ User Manual opens it)
```

`npm install` runs the git dependency's build through npm's script
approval; the approval is pre-recorded in `package.json` (`allowScripts`).
Node ≥ 20 (`.nvmrc` says 24).

## Independent DIS cross-check

Everything else that decodes the DIS stream (dis-listen, the loopback
self-check) uses the app's own codec, so it can only prove the codec
agrees with itself. `npm run interop-check` closes that circle with
[open-dis-python](https://github.com/open-dis/open-dis-python), a
second, independent implementation of IEEE 1278.1:

1. The real publisher stack streams the full seed 20260719 orbit
   engagement over UDP loopback to `tools/dis-crosscheck.py receive`,
   which decodes every datagram with open-dis and scores the stream
   (PDU types and wire lengths, site:app identity, entity numbers,
   force IDs, markings, geodetic positions near the anchor, EE beam
   frequencies), with zero datagram loss required.
2. `tools/dis-crosscheck.py send` then emits an Entity State orbit
   encoded by open-dis's own encoder at the app's receive path, which
   must surface it as a Live Ops overlay track.

CI runs the same check on every change. Requires Python 3.12+ with
open-dis-python. PyPI's `opendis` 1.0 package pins `numpy<2`, which
does not install on Python 3.13, so install the pinned upstream commit
instead (it needs no numpy at all):

```
pip install "git+https://github.com/open-dis/open-dis-python@732b6655bb47e34ccc73722eefe0f4706fd0032f"
```

### Captures

`docs/captures/seed-20260719-orbit.pcap` is a committed golden capture:
the first 60 s of the seed 20260719 orbit engagement (Start/Resume, the
initial entity census, EMCON keying) as a classic pcap with fabricated
Ethernet/IPv4/UDP headers on port 3000, so Wireshark's DIS dissector
opens it with zero setup. It is generated through the same publisher
path as the interop check, at 1x with a fixed epoch, so regeneration
via `node scripts/interop-check.mjs --write-pcap
docs/captures/seed-20260719-orbit.pcap` is byte-identical. To capture
live traffic the same way, pass `--pcap=<file>` to `npm run
dis-listen`.

Useful CLIs (plain node, no Electron):

```
npm run dis-listen -- --port=3000 --mode=broadcast --anchor=21.35,-157.95
npm run terrain-export -- --seed=20260719 --lat=21.35 --lon=-157.95
```

## Upstream pins

The three UI files come from the `upstream/fpv-sim` git submodule and the
engine from a commit-pinned `fpv-sim-mcp` git dependency. The pair must be
parity-consistent: CI verifies that `index.html` is unchanged between the
engine's golden-fixture source commit and the submodule pin, and replays
all 11 golden engagements (both modes) against the bundled engine with
byte-equal event logs. Bump the two pins together, never separately.
