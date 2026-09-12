# CLAUDE.md — working notes for fpv-sim-app

Windows desktop application (Electron 44, TypeScript main process) that
wraps the fpv-sim engagement simulation unmodified — three browser pages
plus the golden-master engine — and adds a Monte Carlo study runner, a
loopback MCP endpoint, live wall-clock sessions and a native DIS gateway
for VBS4. All data is notional. Start with README.md; deep docs:
CHANGELOG.md, docs/INTEROP.md, docs/VBS4_CHECKLIST.md,
docs/DIS_HLA_PRIMER.md, and the user manual index docs/manual/README.md.

## The one invariant that matters

**The vendored UI and the bundled engine are a parity-verified pair, and
this repo edits neither.** The three pages (`index.html`,
`dashboard.html`, `viewer3d.html`) come from the `upstream/fpv-sim` git
submodule (pin `f73ccb7`) and are served byte-identical from the
`app://ui/` origin; the engine is the commit-pinned `fpv-sim-mcp` git
dependency in package.json (`github:wasomma/fpv-sim-mcp#f848528…`, the
same pin under `allowScripts`). Consequences:

- Never edit anything under `upstream/` or `build/resources/`. A change
  to the sim, dashboard or viewer belongs in the fpv-sim repo (e.g. the
  wording of the dashboard's finding); this repo's own UI is `src/renderer/`.
- Bump the two pins together, never separately. `npm run check-pins`
  (`scripts/check-pins.mjs`) asserts `git diff <fixtures'
  _meta.source_commit>..<submodule HEAD> -- index.html` is empty and
  that `build/resources/ui` matches the submodule byte-for-byte.
- `npm test` carries the golden replay, `test/parity.smoke.test.ts`: the
  bundled engine must reproduce all 11 golden fixtures committed in that
  dependency (5 orbit, 6 tactical) — outcome, clock, phase timeline and
  byte-equal event strings — and `test/adhoc-equivalence.test.ts`: the
  parallel ad-hoc runner matches upstream's `run-sweep.mjs` byte-for-byte
  minus the timestamp and provenance-commit fields.
- CI (`.github/workflows/ci.yml`) runs both on every push, PR and a
  Monday cron; `release.yml` repeats them before building. A red weekly
  run means this repo's environment broke, not that upstream drifted.
- Determinism carries through the app: a live session run to its end
  equals the batch result (self-check proves it at 60x); the gateway is
  read-only against the engine and overlay tracks never influence it.

## Layout

- `src/main/` — main process (tsc → `dist/`, ESM NodeNext): `index.ts`,
  `mode.ts` (`--self-check` / `--screenshots`), `protocol.ts` (the
  `app://` scheme: `ui/*` vendored pages + writable results, `app/*`
  panels), `paths.ts` (dev vs packaged; runtime-read files ship as
  extraResources, never inside the asar), windows/menu/settings
  (`DEFAULT_MCP_PORT` 8765), `self-check.ts` (11 steps), `screenshots.ts`.
  - `studies/` — `study-runner.ts` spawns the vendored canonical scripts
    and the worker-pool `adhoc-runner.mjs` as `ELECTRON_RUN_AS_NODE`
    children of the app binary (no fork of experiment or manifest
    logic); `overrides-schema.ts`, `validate.ts`.
  - `results-manifest.ts` — electron-free management of the per-user
    results store (`%APPDATA%\fpv-sim-app\results`, manifest
    `index.json`): atomic temp+rename writes, unknown fields preserved,
    plain file names only.
  - `mcp/host.ts` — loopback Streamable HTTP host (127.0.0.1, bearer
    auth, a fresh stateless server per request) composing upstream's
    five batch tools with `live-tools.ts`.
  - `sessions/` — `session-manager.ts` (main-process handle; spawns the
    utilityProcess `session-host.ts`), `pacer.ts`, `tick-view.ts`.
  - `gateway/` — DIS: `index.ts` (`DisGateway`), codec/geo/net/publish/
    receive/terrain, `config.ts` (defaults), `presets.ts`, `form-schema.ts`.
- `src/renderer/` — the app's own panels: `shell/` (launcher),
  `studies/`, `mcp/`, `live-ops/`, `shared/app.css` + `app.js`.
  `src/preload/index.cjs` (plain CJS), `src/shared/gateway-slot.ts`.
- `upstream/fpv-sim` — the submodule. `npm run vendor`
  (`scripts/vendor-ui.mjs`) copies the pages, `scripts/*.mjs` runners
  and `results/` into `build/resources/ui` and writes
  `build/resources/upstream-pins.json` beside it.
- `scripts/` — `vendor-ui`, `check-pins`, `check-screenshots`,
  `interop-check`, `build-manual` (+ `manual-pdf-main.cjs`), `make-icon`.
- `test/` — node:test suites (132 tests) run by `npm test`; `util.ts`.
- `tools/dis-crosscheck.py` — open-dis-python, an independent IEEE
  1278.1 implementation pinned by commit, behind `npm run interop-check`.
- `docs/` — INTEROP.md, VBS4_CHECKLIST.md, DIS_HLA_PRIMER.md, `captures/`
  (the golden pcap), `brief/`, and `manual/` (chapters 01–11, appendices
  A–H, `images/` with its `manifest.json`; the PDF is gitignored).
- `electron-builder.yml` (NSIS → `out/`, extraResources), `assets/icon/`.

## Conventions

- **One run at a time.** `study-runner.ts` holds a single active slot and
  `session-manager.ts` one session: the canonical scripts write their
  dataset and manifest entry only at the very end, so cancel (kill) never
  leaves a half-written store, and manifest mutations are refused while
  a run is active. The live API carries `session_id`; widen deliberately.
- **Worktrees:** the general bootstrap and teardown live in
  `~/.claude/rules/worktrees.md` and the `worktree-bootstrap` skill. The
  repo-specific step is `git submodule update --init upstream/fpv-sim`
  before `npm run vendor`. `main` is in the primary tree:
  `git -C <root> merge --ff-only origin/main` there.
- **Verification ladder = the CI order:** `npm run check-pins` →
  `npm test` → `npm run interop-check` (Python 3.12+, pinned open-dis) →
  `npm run self-check` (10 headless steps; exits 1 on failure, or when
  another instance holds the lock) → `npm run screenshots` →
  `node scripts/check-screenshots.mjs`.
- **UI changes are verified by the screenshot harness.** `npm run
  screenshots` regenerates every manual figure from the app into
  `docs/manual/images` (scratch profile, placeholder MCP token); commit
  the regenerated figures with the change — CI fails when a committed
  figure no longer reproduces (viewer3d excepted: no GPU on the runner).
  Only live-ops, studies-running and viewer3d figures churn between runs.
  Screenshots and self-check need MCP port 8765 free — close the
  installed FPV Sim first. Panel buttons can be smoke-tested over CDP.
- **Installed copy:** the NSIS installer and uninstaller both exit 2 when
  run silently (`/S`) on this PC. Refresh it with `npm run dist` then
  `robocopy out\win-unpacked "%LocalAppData%\Programs\FPV Sim" /MIR /XF
  "Uninstall FPV Sim.exe"`; the HKCU uninstall entry lags (says 0.2.0).
  When the installer itself matters, ask Wes to run it interactively.
- **CHANGELOG.md:** Keep a Changelog + semver; accumulate under
  `[Unreleased]`, roll into a version on release. A release bumps
  `package.json`, regenerates the manual figures (footers carry the
  version) and tags `vX.Y.Z`; `release.yml` attaches installer + PDF.
- **Gateway config changes** touch `config.ts`, `form-schema.ts` (a unit
  test holds the form to the schema), `presets.ts`, Appendix C, and the
  golden pcap — regenerate it with `node scripts/interop-check.mjs
  --write-pcap docs/captures/seed-20260719-orbit.pcap` (byte-identical).
- **Panel palette:** `src/renderer/shared/app.css` tokens follow the sim;
  `--dim #7d8f96` / `#7b8a90` are deliberate WCAG departures; no light theme.
- **Parallel sessions work these repos.** `git fetch` and check
  `git worktree list` before acting; commit and push only when asked.

## Open work

Check the repo's open issues first (`gh issue list`) — owner actions are
tracked there, not in this file. Standing items:

- **VBS4 lab test pending.** Wes is testing the DIS gateway against VBS4
  on a fresh lab PC from `out/fpv-sim-app-setup-0.3.0.exe` (v0.3.0 =
  `91d1b7c`), following manual Appendix H. The emitter-function 0→5
  default is merged (`6d87714`, in 0.3.0; branch
  `claude/nostalgic-borg-f1dda3` and its worktree are gone). Feed what
  VBS Gateway showed into docs/VBS4_CHECKLIST.md step 6; if emitter
  systems still do not list, suspect emitter name 0 or Gateway filtering.
- The 2026-09-05/06 UI/UX programme (P0–P2) is on main. Left: Wes's
  interactive DATASETS checklist pass.
- The dashboard's finding (2026-09-12, fpv-sim PR #32 + this repo's
  follow-up) is upstream's golden-tested contract:
  `scripts/check-dashboard-stats.mjs` in fpv-sim holds the exact text for
  the three bundled datasets. `src/main/results-headline.ts` mirrors its
  reference rule (newest same-mode study) and displayed-rate delta rule;
  change them together. Plan: docs/plan-dashboard-findings.md.
- Known limitation: manual Figure 2-1 still shows the 0.2.0 installer.
