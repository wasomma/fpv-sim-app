# F. Troubleshooting

Symptoms are grouped by where you meet them. Include the launcher footer line (`app 0.3.0 · engine fpv-sim-mcp 0.3.0 · …`) in any report.

## Installing and starting

| Symptom | Cause | Fix |
|---|---|---|
| SmartScreen blocks the installer | The installer is unsigned. | **More info ▸ Run anyway** (Chapter 2.3). Only for installers from the project's Releases page. |
| Starting FPV Sim a second time seems to do nothing | Single instance: the launcher was brought to the front (or reopened), possibly behind another window. | Look for **FPV Sim** in the taskbar; every panel also has a **◂ LAUNCHER** button. |
| The launcher footer reads `version info unavailable` | The bundled version files could not be read — a damaged install. | Reinstall over the top. |

## Simulation and 3D Viewer

| Symptom | Cause | Fix |
|---|---|---|
| **3D VIEWER** shows **WEBGPU UNAVAILABLE** | No WebGPU-capable GPU or driver. | Update the graphics driver; otherwise use the 2D **SIMULATION**. Nothing else is affected. |
| The 3D Viewer is slow or stutters | An older GPU. | Turn off **TREES** and the **DETECTABILITY FIELD**; lower the speed. |
| Two people see different battles for the same seed | Different modes, or different engine versions. | Compare the launcher footers and the **MODE** buttons. |

## Studies

| Symptom | Cause | Fix |
|---|---|---|
| `refused: a label is required` | Empty **label** (the field is outlined in red). | Type one. |
| `refused: overrides is not valid JSON` | A syntax error in the overrides box. | Check braces and quotes; copy an example from Appendix D. |
| `refused: count must be an integer in 1..1000000` (or `start …`) | An empty or non-numeric field. Nothing is assumed for you. | Fill it in. |
| `refused: an adhoc run is already active` | One run at a time. | Wait, or **CANCEL**. |
| The DATASETS buttons are greyed out | A run is active; it rewrites the manifest when it finishes. | Wait, or **CANCEL**. |
| The study seems frozen | The progress bar advances once per finished experiment, and E1 (about half the run) takes ten minutes or more. | Watch the elapsed time in the status row; the log prints a line when each experiment finishes. |
| A sweep with overrides matches the stock numbers exactly | The dataset was made by a 0.2.x build, which ignored misspelled keys silently. Current builds refuse them by path. | Re-run the sweep; the line under the overrides box confirms the keys before you start. |
| `refused: overrides: CUAS.BRG_SIGMA: unknown key` (or `…: must be in 0.5..15`) | A key the engine does not have, or a value outside its range. | Open the **parameter reference** under the box and click the key you meant. |
| My sweep is much slower than the manual suggests | **RUN SINGLE-THREADED** uses one core. | Use **RUN PARALLEL**. |

## Dashboard

| Symptom | Cause | Fix |
|---|---|---|
| My sweep is not in the **DATASET** list | It was a **RUN QUICK** study, which is never registered (the LAST DATASET box says *not registered in the manifest*); or the dataset file was copied in by hand, so no manifest entry exists. | For a quick study, run an ad-hoc sweep or the full study instead; for a hand-copied file, **STUDIES ▸ DATASETS ▸ REGISTER** (Chapter 6.7) — the Dashboard reloads by itself. |
| No **Dose response** or **Paired comparisons** card | An ad-hoc dataset is selected. | Expected. Those cards exist only for the canonical study. |
| "Could not load `results/index.json`" | The manifest is missing or invalid JSON (usually after hand-editing). | The DATASETS box (Chapter 6.7) names the parse error. Fix the JSON, or restore the factory store (Appendix B). |
| **WATCH ▸** opened a new window and the Dashboard stayed behind it | By design: the battle plays in its own Simulation window so the Dashboard keeps its dataset and scroll position. | Arrange the two windows side by side, or close the Simulation window when done. |
| **READ THE STUDY** does nothing | It opens your web browser and needs internet. | |

## MCP Endpoint

| Symptom | Cause | Fix |
|---|---|---|
| **DOWN — port 8765 is in use** | Another program owns the port. | Change the port, **APPLY & RESTART**, re-add the server in your client. |
| Client reports `401 Unauthorized` | The token was regenerated, or the snippet pasted incompletely. | Copy and add the server again. |
| `/mcp` in Claude Code shows the server failed | FPV Sim is not running or the port changed. | Start FPV Sim; check **STATUS**. |
| A cloud connector cannot reach the endpoint | It listens on `127.0.0.1` only. | Use a client on the same PC. |

## Live Ops and DIS

| Symptom | Cause | Fix |
|---|---|---|
| `refused: session live-… is running; stop it first` | One session at a time. | **STOP** the current one. |
| **START** says `refused: overrides: CUAS.BRG_SIGMA: unknown key` (or `…: must be in 0.5..15`) | A key the engine does not have, or a value outside its range, in the SETUP box. | Open the **parameter reference** under the box and click the key you meant; the line under the box names the problem before you start. |
| `lag` turns red | The PC cannot keep pace at that speed. | Choose a lower speed. |
| **STAGE** says `invalid JSON: …` | Syntax error in the gateway box. | Fix braces, quotes and commas. |
| **STAGE** says `refused: <path>: unknown key` | A misspelled key. Unknown keys are errors, for gateway configs and engine overrides alike. | Correct it against Appendix C. |
| **STAGE** says `refused: a session is active; …` | Staging is refused while a session runs or is paused. | **STOP**, then **STAGE**. |
| **STAGE** says `refused: network.unicastDestinations: at least one destination in unicast mode` | Unicast without a receiver address. | Add the receiver's IP. |
| The GATEWAY box reads `gateway inactive for this session` | The session was started before any configuration was staged. | **STOP**, **STAGE**, **START**. |
| The GATEWAY box shows `no gateway config staged` after a restart | Arming is memory-only; the box already holds the text you last staged. | Press **STAGE** (Chapter 10.2). |
| The session ends at once with `ABORTED — error: …` mentioning a socket or bind | The port or interface could not be opened: another process holds the port exclusively, or `network.interface` names an address this PC does not have. | Change the port, fix the interface, or use unicast. |
| The header reads `ABORTED — host exited unexpectedly` | The session process died. | Start the session again; if it repeats, report it with the launcher footer line. |
| Nothing arrives at the receiver | Firewall, subnet, adapter, port or exercise ID. | Receiver: inbound UDP 3000 allowed; same subnet; sender allowed through Windows Security Alert; `dis.exerciseId` equal on both ends; on multi-homed PCs use unicast or set `network.interface`. Verify on the sending PC with Wireshark first. |
| Entities appear at 0° N 0° E (the Gulf of Guinea) | The anchor was left at its default; **STAGE** shows a yellow *staged, but check: anchor is 0°, 0°* line when that happens. | Set `anchor.lat0Deg` and `anchor.lon0Deg`. |
| Nothing arrives and the GATEWAY box's `rx` row shows `other exercise` counting up | The receiver is sending on a different exercise ID than `dis.exerciseId`; its traffic is set aside, and yours is set aside at its end for the same reason. | Make `dis.exerciseId` equal on both sides. |
| Entities rubber-band in VBS | Dead-reckoning thresholds too loose for the receiver. | Lower `deadReckoning.drone.posThresholdM` / `oriThresholdDeg`, or set `algorithm` to 4. Keep the speed at 1×. |
| Emitter systems never appear in the VBS Gateway UI | VBS Gateway keeps only incoming emitter systems whose function is *Acquisition / Detection* (5). That is the shipped default, so the staged JSON overrides `emissions.uplink.function` or `emissions.video.function`, or no radio has keyed yet. | Remove the override (or set both keys back to `5`), then **STOP**, **STAGE**, **START**. A climbing `emission` counter in the GATEWAY box confirms the radios are keying (Appendix H). |
| VBS Gateway lists nothing although Wireshark on the VBS4 PC shows DIS rows | The Gateway side: DIS adapter off, **Receive Port** not 3000, **Exercise ID** or **Site ID** different from the app's, or **Application ID** equal to 3001. | Correct them under **Settings ▸ DIS**, **Apply**, DIS **ON** (Appendix H.4). |
| The status line warns `speed Nx exceeds publish.maxSpeedFactor 8` | The session runs faster than remote smoothing tolerates. | Lower the speed. |
| An external entity never shows as an overlay | `receive.enabled` false; different exercise ID; the sender uses FPV Sim's own site/application pair (1/3001); or the entity is outside the 4 km box. | Check each in turn; the GATEWAY box's `peers` count tells you whether anything is being heard at all. |
| Wireshark shows the packets as plain UDP | A port other than 3000. | Right-click ▸ **Decode As…** ▸ DIS. |

## Data

| Symptom | Cause | Fix |
|---|---|---|
| I want the factory datasets back | | A deleted bundled dataset: **STUDIES ▸ DATASETS ▸ RESTORE** (Chapter 6.7). The whole store: close FPV Sim, delete `%APPDATA%\fpv-sim-app\results`, start FPV Sim (Appendix B). |
| The results folder is large | Many sweeps. | **STUDIES ▸ DATASETS ▸ DELETE** the ones you no longer need (Chapter 6.7). |
