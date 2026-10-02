# Changelog

Notable changes to fpv-sim-app. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release attaches two assets: the NSIS installer
(`fpv-sim-app-setup-<version>.exe`) and a single-file PDF of the user
manual.

All simulation data is notional and unclassified.

## [Unreleased]

### Added

- **Terrain export from the installed app** (#4). **EXPORT TERRAIN** in
  the Live Ops panel's GATEWAY box writes the seed's terrain for VBS Geo
  into a folder you choose, placed on Earth by the staged gateway
  configuration's anchor so terrain and DIS stream cannot disagree. The
  same export is the MCP tool `live_export_terrain` (anchor from the
  staged configuration unless passed, folder `%APPDATA%\fpv-sim-app\terrain`
  unless named) and the command line `"FPV Sim.exe" --terrain-export
  --seed=… --lat=… --lon=… --geoid=N --out=…` from the installed copy,
  which no longer needs a developer checkout. One call writes the whole
  set: the elevation in both vertical datums, each with a `.json` of the
  grid's metadata, and the canopy density, five files named `seed-<n>-…`;
  `npm run terrain-export` writes the same set, `--vdatum` narrowing it
  to one variant. A self-check step exports from the staged anchor and
  reads the files back. Chapter 11.3 is rewritten for users of the
  installed app, with a new figure, and Appendices B, E and H, chapters
  9 and 10, the VBS4 checklist, INTEROP.md and the lab brief follow.

### Changed

- **Terrain export writes GeoTIFF for VBS Geo.** `npm run terrain-export`
  now writes `seed-<n>-elevation-<vdatum>.tif` (with a `.json` of the
  grid's metadata) and `seed-<n>-canopy.tif`: single-band Float32
  GeoTIFFs in geographic WGS 84 (EPSG:4326), the only format and CRS
  VBS Geo's DEM import accepts, with an explicit vertical CRS and the
  GDAL nodata and metadata tags. The grid is written straight from the
  engine on the gateway's own flat-geodetic mapping, so each pixel is one
  20.1 m post and its centre is exactly where the DIS stream puts that
  sim point. The former UTM Esri ASCII Grid followed UTM grid north and
  was skewed against the entities by grid convergence: 27 to 39 m at the
  far edges of the box at the example anchor. The `.asc`/`.prj` pair is
  gone; `gdal_translate -of AAIGrid` recovers one from the GeoTIFF. A
  rotated anchor now exports a north-aligned grid covering the whole
  rotated box rather than its overlap with the unrotated one.
- **The vertical datum is explicit.** `--vdatum=egm96` (default) writes
  mean-sea-level heights (EPSG:5773); `--vdatum=ellipsoid` adds the
  anchor's `geoidOffsetM` and declares WGS 84 ellipsoidal heights
  (EPSG:4979). VBS Geo ignores the tag and assumes one of the two without
  documenting which, so the lab imports both and keeps the one whose
  coastline lands on VBS4's water line. The anchor keys are restated to
  match: `h0M` is the height of the sim's sea level above mean sea level
  (normally 0) and `geoidOffsetM` the EGM96 geoid undulation at the
  anchor, applied to the DIS stream so ESPDUs carry true ellipsoidal
  heights. The wire math, the defaults and the golden capture are
  unchanged.
- Chapter 11.3, Appendices C and H, INTEROP.md, the VBS4 checklist and
  the lab brief describe the GeoTIFF, the datum rule and the geoid
  offset. The "set the water level at 0" instruction is gone: VBS4's
  ocean is at mean sea level and cannot be moved, which is what makes
  the datum rule work.

## [0.4.0] — 2026-09-13

### Known limitations

- Figure 2-1 (Choose Install Location) still shows **FPV Sim 0.2.0** in
  the wizard corner; it is shot from a built installer rather than
  regenerated, and the page it documents is otherwise unchanged.

### Added

- **The Dashboard leads with the finding.** The bundled results page
  (fpv-sim pin `f73ccb7`) now opens on a FINDING card — plain-English
  verdict lines generated from the dataset itself, nothing stored — with
  the summary tiles under it, one KEY EVIDENCE card (the paired
  comparisons for a study; a new VS STOCK BASELINE dumbbell for an ad-hoc
  sweep, measured against the canonical study of the same mode in the
  manifest) and everything else — dose response, timelines, notable
  engagements, provenance — folded into one ALL EVIDENCE section. Ad-hoc
  tiles carry a Δ-vs-stock line; every delta is read against a 95%
  Newcombe interval on the difference and tagged *clear*, *slight* or *no
  measurable difference*. **COPY FINDINGS** puts the verdict, the tiles,
  the deltas and the provenance on the clipboard as Markdown. Chapter 7 of
  the manual was rewritten around the three layers.
- **Deep links to a dataset.** `dashboard.html` accepts `?dataset=<file>`
  (unknown files fall back to the newest) and keeps the parameter in step
  with the DATASET selector, so a reload lands on the dataset you were
  looking at. The Studies panel uses it: the LAST DATASET box shows the
  finished run's headline — `B … / O … / S …` and, for a sweep, the delta
  against the same-mode study — with **OPEN IN DASHBOARD**, and every
  DATASETS row shows the same headline and gains **OPEN**. Opening a
  dataset while the Dashboard is open switches that window to it instead
  of only bringing it forward; a finished run switches it to the new
  dataset; a rename, delete or register reloads it where it was. **OPEN
  DASHBOARD** and the DASHBOARD tile still open the newest. The
  self-check gained an 11th step proving the deep link is honoured through
  the `app://` origin.

### Changed

- fpv-sim UI pin `7050617` → `f73ccb7` (`dashboard.html` only;
  `index.html` and the engine pin `f848528` are unchanged, so the parity
  pair holds). Three new manual figures (`dashboard-finding`,
  `dashboard-finding-full`, `dashboard-vs-baseline`); the dashboard and
  Studies figures were regenerated for the new layout.

## [0.3.0] — 2026-09-06

### Known limitations

- Figure 2-1 (Choose Install Location) still shows **FPV Sim 0.2.0** in
  the wizard corner; it is shot from a built installer rather than
  regenerated, and the page it documents is otherwise unchanged.

### Added

- **An application menu with shortcuts.** <kbd>Ctrl</kbd>+<kbd>0</kbd>
  brings the launcher back and <kbd>Ctrl</kbd>+<kbd>1</kbd> …
  <kbd>Ctrl</kbd>+<kbd>6</kbd> open the six tiles from any window; **File**
  also opens the results and settings folders; **View** has Reload, zoom,
  full screen and Developer Tools; **Help** opens the user manual
  (<kbd>F1</kbd> — the PDF bundled with the installer, or the online copy),
  the changelog, the issue tracker, and an **About** box that copies the
  version line. The bar stays hidden until <kbd>Alt</kbd>, as before.
  **Actual Size** is <kbd>Ctrl</kbd>+<kbd>Numpad 0</kbd>: <kbd>Ctrl</kbd>+<kbd>0</kbd>
  now opens the launcher, and Windows reserves
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>0</kbd> for switching keyboard
  layouts, so an app never receives it.
- **A status strip on the launcher.** Three cells say what the study
  runner, the live session and the MCP endpoint are doing (`running ·
  parallel sweep "…" · 1:23`, `orbit · seed 20260719 · T+02:13 · … · DIS`,
  `RUNNING · 127.0.0.1:8765`, or the failure), refreshed every second
  while something runs; each cell opens its panel. **RANDOM** picks a seed
  on the launch bar, <kbd>Enter</kbd> in the seed field launches, and the
  footer gained **COPY** (the version line) and **MANUAL**.
- **An app icon.** A top-down FPV quad held in a sensor reticle, drawn in
  the panels' palette, replaces the stock Electron icon on the installer,
  the exe and every window (a simplified variant keeps the small taskbar
  sizes legible). Masters live in `assets/icon/`; `npm run icon`
  regenerates `icon.ico` from them.

- **The panels remember their inputs.** The launcher's seed, mode and
  autoplay, the Studies label, seed range, mode and overrides, and the
  Live Ops seed, mode and speed come back as you left them, and the
  GATEWAY box reopens with the last configuration that passed **STAGE**.
  Arming stays explicit and memory-only: the restored text still has to
  be staged. `settings.json` is now versioned (`"version": 2`) with a
  `ui` section; files written by 0.2.x are upgraded in place.
- A shared stylesheet and helper script for the app's own panels
  (`src/renderer/shared/`), replacing four copies of the same palette.
- **Windows remember where they were.** Each kind of window comes back at
  the size and position it was left at, clamped to the connected displays,
  and every window now has a minimum size.
- **One window per panel.** DASHBOARD, STUDIES, MCP ENDPOINT and LIVE OPS
  bring their existing window forward instead of stacking a second copy;
  SIMULATION and 3D VIEWER still open a new window per click.
- **The launcher comes back.** Every panel has a **◂ LAUNCHER** button,
  and starting FPV Sim a second time reopens the launcher when it had been
  closed (it used to focus whichever window happened to be first).
- **Quit guard.** Closing the last window or quitting while a study or a
  live session is active asks first — *Cancel run and quit* or *Keep
  running* — instead of silently killing the run.
- Window titles name their content: `Studies — FPV Sim`, `Simulation ·
  seed 20260719 (orbit) — FPV Sim`, and so on, so two sim windows can be
  told apart in the taskbar. Upstream windows are painted in their own
  background colour before the page loads (no green flash).
- **Studies feedback.** An elapsed-time counter beside the status (with
  the expected duration for a study); a progress bar for every kind of run
  — per seed for the parallel sweep, per experiment for the canonical
  study, indeterminate for the single-threaded sweep; a red exit line when
  a run fails or is cancelled; refusals repeated under the field that
  caused them; a **LAST DATASET** box with the file's path, **COPY PATH**,
  **REVEAL IN EXPLORER** and **OPEN RESULTS FOLDER**, plus a note saying
  whether the file is registered in the manifest (quick runs are not).
  Open Dashboard windows reload by themselves when a run registers a
  dataset. **RUN FULL** asks before it overwrites the bundled dataset.
  Reopening the panel during or after a run brings back the log, the
  progress bar and the dataset box.
- **Override keys are checked.** The Studies panel validates the overrides
  JSON against the engine's own parameter table as you type — an unknown
  key or an out-of-range value is named by path (`CUAS.BRG_SIGMA: unknown
  key`, `CUAS.BRG_SIGMA_DEG: must be in 0.5..15`) and refused at run time —
  and a collapsible **parameter reference** under the box lists every key
  with its default, unit, range and meaning; clicking a row adds it.
  `live_start_session` over MCP applies the same check. A misspelled key
  no longer runs the stock configuration silently anywhere.
- **MCP panel feedback.** **APPLY & RESTART** reports its result on the
  panel (`restarted on port 8766 …`, or the refusal) instead of silently
  snapping the field back; **REGENERATE TOKEN** asks first and says that
  clients must be re-added; a **REFRESH** button and a five-second re-check
  while the window is visible catch a host that has died; the bearer token
  is masked in the on-screen snippets behind **SHOW TOKEN** (COPY still
  copies the real one); the buttons are disabled while a restart is in
  flight; a failed status query reads *STATUS UNAVAILABLE* instead of a
  permanent *checking…*.
- **Live Ops diagnostics.** While a gateway-armed session runs, the
  GATEWAY box shows a status line plus a small table: PDUs sent by type,
  what arrived on the socket and why anything was set aside (other
  exercise, own echo, malformed, other PDU types — counters the gateway
  always kept but never showed), the peers heard with their addresses, the
  overlay count and the last error (the editor gives way to this display
  until the session ends). A **preset…** menu fills the box with
  one of Appendix C's four configurations (broadcast, unicast, multicast,
  VBS4 through VBS Gateway with emitter function 5); **STAGE** warns —
  without refusing — when the anchor is still 0°, 0° or unicast points at
  loopback. A legend under the map explains the symbols. **RANDOM** picks
  a seed. Refusals and abnormal ends go to a message line under the
  header, and a session whose process failed reads `ABORTED — …` in red
  rather than a green ENDEX. A panel opened mid-session replays the whole
  event feed so far, without duplicates.
- **Live Ops takes overrides and a sim-time limit.** A folded **SETUP**
  row under the header holds an overrides box with the Studies panel's
  as-you-type check and parameter reference, and a sim-time limit (15 min
  to 4 h; 1 h, as before). Both apply at **START**, are locked while a
  session runs, and are remembered. The row's one visible line reports
  what the running session actually carries — `this session · 1 override ·
  sim-time limit 1 h` — whoever started it, and `live_session_status`
  returns the same facts as `overrideKeys` and `maxSimS`. The MCP tool
  could already do this; the panel could not. The self-check gained a
  step proving a misspelled key is refused before a session starts.
- **Datasets are managed from the app.** A collapsible **DATASETS** box
  on the Studies panel lists every manifest entry — label, kind, mode,
  run count, date, file — with **RENAME** (edits the label in place),
  **EXPORT** (copies the file through a save dialog), **REVEAL**, and
  **DELETE** (file and manifest entry together, after a confirm). Files
  in the results folder the manifest does not list — quick runs,
  hand-copied datasets — appear below with **REGISTER**, which rebuilds
  a manifest entry from the provenance inside the file, and a deleted
  bundled dataset gets a **RESTORE** button that brings the factory copy
  back. Every change reloads any open Dashboard; while a run is active
  the manifest belongs to the runner and mutations are refused; the
  manifest is rewritten atomically, unknown fields preserved. Retiring,
  restoring or moving a dataset no longer means hand-editing
  `index.json`, and the manual's recipes now go through the box. The
  self-check deletes its probe dataset through the same code path.
- **The gateway configuration as a form.** A **FORM** button in the
  GATEWAY box swaps the JSON text for a field editor: the ~60 keys of
  Appendix C in their ten groups, each with its default, allowed range,
  unit and one-line meaning as a tooltip. Edits rewrite the JSON
  underneath in the presets' own compact style — keys at their default
  stay out of the text, keys the text already spelled out stay in — so
  **STAGE**, the **preset…** menu and the remembered text all work
  unchanged, and **JSON** swaps the text back. Keys that differ from the
  defaults are highlighted and counted per group, and every value is
  checked as you type by the same validator **STAGE** uses, refusals
  named at the exact field. The field table is held to the config schema
  by a unit test, so a config change that forgets the form fails CI.
- Manual **Appendix H** — a worked quick start for putting the engagement
  inside an external live virtual simulation, with VBS4 through VBS
  Gateway as the example: a fresh PC, the eight values both sides must
  agree on, the exact VBS Gateway settings, the acceptance list and the
  reverse path.

### Changed

- **Windows never change kind.** The Dashboard's **WATCH ▸** and **OPEN
  SIMULATION** now open the Simulation in its own window — the Dashboard
  keeps its dataset and scroll position, and two WATCH clicks give two
  battles side by side — instead of replacing the Dashboard in place. In
  the other direction, a Simulation or 3D Viewer window's **RESULTS**
  link brings the one Dashboard window forward (opening it if none)
  rather than turning the battle window into a second dashboard, and the
  viewer's **2D SIM** opens a new Simulation window. Each window stays
  the kind it was opened as, which is what the one-window-per-tile rule
  and the per-kind remembered bounds always assumed.
- **The panels look like the sim.** The launcher, Studies, MCP Endpoint
  and Live Ops adopt the Simulation window's palette — slate ground,
  orange accent, outlined uppercase buttons — and its BLUFOR/OPFOR blue
  and red replace the panels' own pair, so nothing but the content changes
  when you cross from a panel to the sim. Success is now green, errors
  red, throughout. Every text colour clears WCAG 4.5:1 on its background
  (the dim label grey and the destroyed-unit grey on the Live Ops map were
  lifted for that). The app icon was redrawn in the same palette.
- `npm run dist` builds the manual PDF first and the installer ships it,
  so **Help ▸ User Manual** works offline.
- An empty **start** or **count** in the Studies panel is refused by name
  instead of silently becoming 1 or 1000.
- The shipped default for `emissions.uplink.function` and
  `emissions.video.function` is now `5` (SISO emitter function
  Acquisition / Detection) instead of `0`. VBS Gateway (VBS4 26.1.1
  manual, §10.6.1) lists an incoming emitter system only with that
  function, so with the old default the app's radios never appeared in
  the Gateway UI unless a session staged the function by hand. The VBS4
  checklist and Appendices C, F and H describe the default; the **VBS4
  through VBS Gateway** preset and the Appendix H configuration still
  spell the function out, so they say what they need whatever the
  default is. Callers of the MCP tool `live_configure_gateway` that omit
  `emissions` now get `5`.
- `docs/captures/seed-20260719-orbit.pcap` was regenerated with the new
  default. It differs from the 0.2.1 capture in exactly one byte of each
  of its 23 Electromagnetic Emission PDUs (emitter function `0` → `5`);
  the PDU count, sizes and timestamps are unchanged, and regeneration
  via `--write-pcap` remains byte-identical.

### Fixed

- `refused: a adhoc run is already active` now reads `an adhoc run`.

## [0.2.1] — 2026-09-02

### Added

- `CHANGELOG.md`, and the README now names the Live Ops **STAGE**
  editor alongside the `live_configure_gateway` route.

### Fixed

- `--self-check` quit silently when another instance held the
  single-instance lock, so `npm run self-check` exited 0 having run no
  checks at all — a vacuous pass, and precisely when you would reach for
  it locally. Headless modes now abort with a message and exit 1.
- The development section claimed 58 tests; the suite has 60.

### Known limitations

- Figure 2-1 (Choose Install Location) still shows **FPV Sim 0.2.0** in
  the wizard corner; it is shot from a built installer rather than
  regenerated, and the page it documents is otherwise unchanged.

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

[Unreleased]: https://github.com/wasomma/fpv-sim-app/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/wasomma/fpv-sim-app/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/wasomma/fpv-sim-app/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/wasomma/fpv-sim-app/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/wasomma/fpv-sim-app/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/wasomma/fpv-sim-app/releases/tag/v0.1.0
