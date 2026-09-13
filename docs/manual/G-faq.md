# G. Frequently asked questions

**Do I need an internet connection?**
Only to download the installer. Everything else — the simulation, studies, the Dashboard, MCP, DIS — runs offline. The one exception is the Dashboard's **READ THE STUDY** link, which opens a web page.

**Do I need Node.js, Python or a developer environment?**
No. The installer contains everything. A few optional tools — `dis-listen`, `terrain-export`, the open-dis cross-check — exist only in the source checkout and are marked as such wherever they appear.

**Does it run on macOS or Linux?**
The installer is Windows x64 only. The underlying browser pages (Simulation, Dashboard, 3D Viewer) are also published on the web by the fpv-sim project and run in any modern browser, without the studies runner, MCP endpoint or DIS gateway.

**Can I run two sweeps at once?**
No. One study or sweep at a time. A parallel sweep already uses all but one of your CPU cores.

**Can I change engine parameters in the interactive Simulation?**
Not from the application. Overrides apply to ad-hoc sweeps and to MCP calls. The Simulation window always runs the stock configuration, which is also what the featured scenarios assume.

**Why do my numbers match the published study exactly?**
Because the engine is deterministic and your build carries the same pinned engine version. The same seeds under the same configuration give the same engagements everywhere. If your numbers differ, compare the launcher footer with the one the study was produced with.

**How long does the full study take?**
About 25 minutes in orbit mode (22,800 engagements) and a little longer in tactical mode (24,800). The study runs single-threaded by design, so more cores do not speed it up; ad-hoc sweeps do use the worker pool.

**Why does RUN QUICK not show up in the Dashboard?**
It is a smoke test. The quick study writes its file but does not register it in the manifest, so the Dashboard never lists it. Use an ad-hoc sweep or the full study for a dataset you can analyze.

**How do I delete a dataset?**
Open the **STUDIES** panel, expand **DATASETS**, click **DELETE** on the entry (Chapter 6.7). The file and its manifest entry go together, and any open Dashboard reloads. Hand-editing `index.json` still works (Appendix B) but is no longer needed.

**Where did the charts go?**
Under **ALL EVIDENCE**, one click below the finding. The Dashboard keeps the finding, the tiles and one key-evidence card in view and folds the dose response, the timelines, the notable engagements and the provenance; the fold stays open while you switch datasets (Chapter 7.8).

**How do I share a finding?**
Click **COPY FINDINGS** in the finding card and paste: the verdict, the outcome table with intervals and deltas, and the provenance arrive as Markdown (Chapter 7.5). To share the data itself, **EXPORT** the dataset (below).

**Can I share a dataset with a colleague?**
Yes: **DATASETS ▸ EXPORT** writes a copy wherever you point the save dialog. Your colleague drops the file into their own results folder and clicks **REGISTER** in the same box — the label, date and provenance travel inside the file, so their Dashboard shows it exactly as yours does.

**Can I use the MCP endpoint from claude.ai in the browser?**
No. The endpoint listens on `127.0.0.1` only, which cloud connectors cannot reach. Use Claude Code or another MCP client running on the same PC.

**Is the DIS gateway an HLA federate?**
No. It speaks DIS over UDP. HLA federations are reached through a DIS/HLA bridge such as the Pitch DIS Adapter (Chapter 11).

**Why does the gateway forget its configuration?**
It forgets the *arming*, not the text. A staged configuration is deliberately disarmed when FPV Sim closes, so a stray configuration cannot silently transmit on the next launch. The GATEWAY box comes back holding the text you last staged; one press of **STAGE** arms it again (Chapter 10.2).

**Does a live session over DIS behave differently from the batch run?**
No. A live session run to its end produces exactly the batch result for the same seed, mode and overrides; pacing, pausing and publishing cannot change the outcome. Received DIS entities are display-only.

**Which version am I running?**
Read the launcher footer: `app 0.4.0 · engine fpv-sim-mcp 0.3.0 · ui pin f73ccb7 · …` (Chapter 3.4), or open **Help ▸ About FPV Sim**.

**Where is the source code and what is the licence?**
[github.com/wasomma/fpv-sim-app](https://github.com/wasomma/fpv-sim-app), under the PolyForm Strict License 1.0.0. The simulation and engine it wraps are [fpv-sim](https://github.com/wasomma/fpv-sim) and [fpv-sim-mcp](https://github.com/wasomma/fpv-sim-mcp).

**Is any of this real?**
No. Every number describes an invented, notional model built to teach one lesson about emissions discipline. See [1.6](01-overview.md#16-what-notional-means).
