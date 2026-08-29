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
  georeferenced by a configurable anchor. VBS4 connects through its
  standard VBS Gateway; HLA federations via bridging (Pitch DIS
  Adapter). See [docs/INTEROP.md](docs/INTEROP.md) and
  [docs/VBS4_CHECKLIST.md](docs/VBS4_CHECKLIST.md).
- **Terrain export** — any seed's heightfield as a georeferenced DEM
  (Esri ASCII Grid + UTM .prj + canopy raster) for VBS Geo import, so
  the remote terrain correlates with the engagement.

All simulation data is notional and unclassified.

## Install

Grab `fpv-sim-app-setup-<version>.exe` from Releases and run it
(per-user, no admin). The installer is unsigned: SmartScreen will warn —
"More info" → "Run anyway". Fully offline once installed.

## Development

```
git clone --recurse-submodules https://github.com/wasomma/fpv-sim-app
cd fpv-sim-app
npm install        # builds the fpv-sim-mcp git dependency via its prepare script
npm run vendor     # vendor the pinned fpv-sim UI + engine copy into build/resources
npm run build      # tsc
npm test           # engine parity smoke, codec/geo/publisher/receive suites (58 tests)
npm run self-check # headless end-to-end: protocol, engine, studies, MCP, live, DIS loopback
npm start          # launch the app
npm run dist       # NSIS installer -> out/
```

`npm install` runs the git dependency's build through npm's script
approval; the approval is pre-recorded in `package.json` (`allowScripts`).
Node ≥ 20 (`.nvmrc` says 24).

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
