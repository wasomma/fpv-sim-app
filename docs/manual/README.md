# FPV Sim — User Manual

*Describes FPV Sim **0.3.0** with engine fpv-sim-mcp **0.3.0** and UI pin `a442897` (Electron 44). Your own versions are printed in the footer of the launcher window (see [Figure 3-1](03-launcher.md)). Figures were regenerated from this build on 2026-09-12.*

FPV Sim is a Windows desktop application for a **force-on-force engagement between two teams, each fielding an armed FPV small-UAS and two counter-UAS direction-finding nodes**. Both teams hunt each other's ground control station by its radio emissions. The application bundles the interactive simulation, a Monte Carlo study runner, a results dashboard, a WebGPU 3D viewer, a local MCP endpoint for AI-assistant control, and a native DIS gateway that streams the live engagement to other simulators such as VBS4.

> [!NOTE]
> **All data is notional.** The area of operations ("AO KATANA"), unit positions, sensor parameters, radio numbers and every outcome are invented for demonstration. Nothing in this manual or in the application describes a real system. Unclassified throughout.

## Who this manual is for

Analysts, trainers and interoperability engineers who run FPV Sim on a Windows PC. No programming, Node.js or Python is required for anything in the numbered chapters. A few optional tools (`dis-listen`, `terrain-export`, the open-dis cross-check) live only in the developer checkout of the source repository; every place that needs one says so explicitly.

## Five paths through this manual

Each of the five outcomes below is covered by one self-contained chapter or appendix. Each of those chapters starts with a "Before you start" box and can be followed from top to bottom without reading anything else.

| I want to… | Read | Time |
|---|---|---|
| Get and install the software on a PC | [Chapter 2 — Installing FPV Sim](02-install.md) | 10 min |
| Run a Monte Carlo simulation myself | [Chapter 6 — Running Monte Carlo studies](06-studies.md) | 5 min for the guided sweep, ~25 min for the full study |
| Analyze the results in the dashboard | [Chapter 7 — Analyzing results in the Dashboard](07-dashboard.md) | 10 min |
| Send my entities out over DIS | [Chapter 10 — Sending your entities over DIS](10-dis.md) | 20 min plus network setup |
| Put my engagement inside VBS4, or another live virtual simulation, starting from a fresh PC | [Appendix H — Use case: quick start with an external live virtual simulation (VBS4)](H-vbs4-quick-start.md) | about 1 hour, including the install |

## Contents

1. [What FPV Sim is](01-overview.md) — the engagement, the four phases, the EMCON lesson, the six tiles
2. [Installing FPV Sim](02-install.md) — requirements, download, SmartScreen, the installer, first launch, upgrading, uninstalling
3. [The launcher window](03-launcher.md) — tiles, the launch bar, the status strip, the version footer, window behaviour, the menu and keyboard shortcuts
4. [The Simulation window](04-simulation.md) — every control, reading the map, Unit Detail, the Event Log, ENDEX, tactical mode
5. [The 3D Viewer](05-viewer3d.md) — camera, scene layers, the detectability field, the WebGPU requirement
6. [Running Monte Carlo studies](06-studies.md) — the guided sweep, the canonical study, ad-hoc sweeps, overrides, managing datasets
7. [Analyzing results in the Dashboard](07-dashboard.md) — the finding, COPY FINDINGS, tiles, the vs-stock and paired cards, and under ALL EVIDENCE the dose response, histograms, notable engagements and provenance
8. [The MCP Endpoint and Claude Code](08-mcp.md) — connecting an AI assistant to the batch and live tools
9. [Live Ops: real-time sessions](09-live-ops.md) — wall-clock-paced engagements, the map, entities, events
10. [Sending your entities over DIS](10-dis.md) — stage the gateway, start a session, verify the PDUs, receive overlay tracks
11. [VBS4, HLA federations and terrain export](11-vbs4-and-federations.md) — where to go next

Appendices

- [A. Glossary](A-glossary.md)
- [B. Files and settings](B-files-and-settings.md)
- [C. Gateway configuration reference](C-gateway-config-reference.md)
- [D. Engine override quick reference](D-overrides-quick-reference.md)
- [E. MCP tools reference](E-mcp-tools-reference.md)
- [F. Troubleshooting](F-troubleshooting.md)
- [G. Frequently asked questions](G-faq.md)
- [H. Use case: quick start with an external live virtual simulation (VBS4)](H-vbs4-quick-start.md)

## How this manual is written

- **On-screen text** is shown in bold with its exact on-screen spelling and case: click **RUN PARALLEL**, choose **1× (real time)**, press **STAGE**.
- **Keys** look like <kbd>Ctrl</kbd>+<kbd>R</kbd>.
- **File paths, JSON keys, tool names and log lines** are set in `monospace`. Windows paths use backslashes and environment variables, for example `%APPDATA%\fpv-sim-app\results`.
- **Procedures** are numbered lists, one action per step. When the screen changes, the next line tells you what to expect: → *You should see …*
- **Callouts** use five labels. *Note* is behaviour that may surprise you. *Tip* is an optional shortcut. *Important* is required for the procedure to work. *Warning* means lost work or wasted time. *Caution* means an effect on another system, such as a running VBS4 mission.
- **Figures** are numbered per chapter (Figure 6-2 is the second figure of Chapter 6). Every figure of the application itself is regenerated from the build by the `npm run screenshots` command in the developer checkout, so what you see here is what the software draws.
- **Terminology.** An *engagement* is one battle from one seed. A *sweep* is many engagements under one configuration. The *study* is the canonical experiment set. A *dataset* is one results file. The *manifest* is the index of datasets the Dashboard reads. BLUFOR and OPFOR are the two teams. See the [Glossary](A-glossary.md) for the rest.

## Where to get help

The source repository is [github.com/wasomma/fpv-sim-app](https://github.com/wasomma/fpv-sim-app). The engine and the browser simulation it wraps are [fpv-sim-mcp](https://github.com/wasomma/fpv-sim-mcp) and [fpv-sim](https://github.com/wasomma/fpv-sim); their own documentation covers the model in depth. The application is licensed under the PolyForm Strict License 1.0.0 (see `LICENSE.md` in the repository).
