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
  executed against the bundled engine, writing datasets the dashboard
  reads from `%APPDATA%\fpv-sim-app\results`.
- **MCP endpoint** — the five fpv-sim-mcp batch tools plus live-session
  control tools, served on loopback for Claude Code and other MCP
  clients.
- **DIS gateway** — a native IEEE 1278.1 publisher/receiver so a live,
  real-time-paced engagement streams into external simulators (VBS4 via
  its standard VBS Gateway); HLA federations are reachable by bridging
  (see INTEROP.md when it lands).

All simulation data is notional and unclassified.

## Development

```
git clone --recurse-submodules https://github.com/wasomma/fpv-sim-app
cd fpv-sim-app
npm install        # builds the fpv-sim-mcp git dependency via its prepare script
npm run vendor     # copies the pinned fpv-sim UI + scripts + results into build/resources
npm run build      # tsc
npm run self-check # headless smoke: engine ticks, dashboard data, protocol serving
npm start          # launch the app
```

`npm install` runs the git dependency's build through npm's script
approval; the approval is pre-recorded in `package.json` (`allowScripts`),
so no interactive step is needed. Node ≥ 20 (`.nvmrc` says 24).

## Upstream pins

The three UI files come from the `upstream/fpv-sim` git submodule and the
engine from a commit-pinned `fpv-sim-mcp` git dependency. The pair must be
parity-consistent: CI verifies that `index.html` is unchanged between the
engine's golden-fixture source commit and the submodule pin. Bump the two
pins together, never separately.
