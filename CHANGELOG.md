# Changelog

Notable changes to fpv-sim-app. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release attaches two assets: the NSIS installer
(`fpv-sim-app-setup-<version>.exe`) and a single-file PDF of the user
manual.

All simulation data is notional and unclassified.

## [Unreleased]

### Fixed

- The development section claimed 58 tests; the suite has 60.

## [0.2.0] — 2026-09-02

### Added

- **User manual** — `docs/manual/`, nineteen documents covering install,
  every window and panel, Monte Carlo studies, the dashboard, the MCP
  endpoint, live sessions and DIS interop, plus seven appendices
  (glossary, files and settings, gateway configuration, engine
  overrides, MCP tools, troubleshooting, FAQ). 53 figures, all but the
  Windows-level ones regenerated from the build itself.
- **DIS gateway editor in Live Ops** — a JSON text box and a **STAGE**
  button that validate a gateway configuration and stage it for the next
  session, reporting the exact path of any bad value. Before this, the
  gateway could only be staged over MCP with `live_configure_gateway`.
- **Screenshot harness** — `electron . --screenshots` captures every
  application figure into `docs/manual/images` with a manifest. It
  redirects `userData` to a scratch directory and writes a placeholder
  MCP token, so a run never touches the real profile and no live bearer
  token can reach a committed figure. `scripts/check-screenshots.mjs`
  fails CI if a committed figure no longer reproduces.
- **Manual PDF build** — `npm run manual:pdf` renders the manual through
  the bundled Electron. The PDF is gitignored and attached to releases.
- **Independent DIS cross-check** — `npm run interop-check` scores the
  publisher stack against [open-dis-python](https://github.com/open-dis/open-dis-python),
  a second implementation of IEEE 1278.1, and feeds an open-dis-encoded
  entity back through the receive path. Runs in CI.
- **Golden pcap capture** — `docs/captures/seed-20260719-orbit.pcap`,
  the first 60 s of the seed 20260719 orbit engagement, byte-identically
  regenerable, so Wireshark's DIS dissector opens it with no setup.
- **DIS/HLA primer** — `docs/DIS_HLA_PRIMER.md`, background on the
  standards for readers new to them.
- **VBS4 interop brief** — `docs/fpv-sim-vbs4-interop-brief.pdf`, a
  three-page summary with a reproducible generator.

### Changed

- The MCP panel no longer claims live-session tools "join in a later
  phase". They were already served in 0.1.0; only the note was stale. It
  now lists all fourteen tools.
- `openAppPanel` and `createShellWindow` take `{show,
  backgroundThrottling}`, so headless capture runs can suppress paint
  and keep background windows ticking.
- Gateway status detail follows the live session speed.

### Fixed

- `release.yml` attached assets with `gh release upload`, which requires
  the Release to exist; a tag push creates only the tag. A tagged build
  therefore produced both artifacts and then failed with "release not
  found". The workflow now creates the Release when a tag push finds
  none, and checks each `gh` call rather than trusting the last exit
  code of a multi-line block.
- Screenshot waits defaulted to 15 s, ample on a developer machine but
  not on a GPU-less CI runner rendering the 24,800-run tactical study.
  The default is now 45 s, and a timeout names the expression that gave
  up instead of reporting a bare `last value: false`.

## [0.1.0] — 2026-08-29

First installable build.

### Added

- **Interactive sim, dashboard and WebGPU 3D viewer** — the unmodified
  fpv-sim pages (pin `7050617`) served from the application's own
  origin, with working deep links and a per-user results store.
- **Monte Carlo locally** — the canonical study and ad-hoc sweep runners
  against the bundled golden-master engine (fpv-sim-mcp 0.3.0), plus a
  parallel worker-pool runner proven byte-equivalent.
- **MCP endpoint** — loopback HTTP with bearer auth, serving the five
  fpv-sim-mcp batch tools and nine live-session tools.
- **Live sessions** — wall-clock-paced engagements in a utility process
  with a determinism guarantee: a session run to its end reproduces the
  batch result exactly, enforced in CI.
- **Native DIS gateway** — IEEE 1278.1 over UDP: Entity State with
  dead-reckoning thresholds and wall-apparent kinematics at accelerated
  speeds, EM Emission tracking the EMCON keying edges, Detonation
  ordered on the kill tick, Start/Resume and Stop/Freeze session
  control, receive-as-overlay, and a configurable geo anchor.
- **Terrain export** — any seed's heightfield as a georeferenced DEM
  with a canopy raster, for VBS Geo import.

### Known limitations

- The Live Ops panel has no gateway editor; stage a gateway with the
  `live_configure_gateway` MCP tool. Added in 0.2.0.
- The MCP panel wrongly states that live-session tools arrive in a later
  phase. All fourteen tools work. Corrected in 0.2.0.

[Unreleased]: https://github.com/wasomma/fpv-sim-app/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/wasomma/fpv-sim-app/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/wasomma/fpv-sim-app/releases/tag/v0.1.0
