# F. Troubleshooting

Symptoms are grouped by where you meet them. Include the launcher footer line (`app 0.2.0 · engine fpv-sim-mcp 0.3.0 · …`) in any report.

## Installing and starting

| Symptom | Cause | Fix |
|---|---|---|
| SmartScreen blocks the installer | The installer is unsigned. | **More info ▸ Run anyway** (Chapter 2.3). Only for installers from the project's Releases page. |
| "FPV Sim is already running" behaviour — nothing opens | Single instance: the existing launcher was brought to the front, possibly on another monitor or minimized. | Look for it in the taskbar. |
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
| `refused: a label is required` | Empty **label**. | Type one. |
| `refused: overrides is not valid JSON` | A syntax error in the overrides box. | Check braces and quotes; copy an example from Appendix D. |
| `refused: a adhoc run is already active` | One run at a time. | Wait, or **CANCEL**. |
| The study seems frozen | Studies show no progress bar by design. | Watch the log: each experiment prints a line when it finishes; E1 is about half the run. |
| A sweep with overrides matches the stock numbers exactly | A misspelled key was ignored. | Compare against Appendix D. |
| My sweep is much slower than the manual suggests | **RUN SINGLE-THREADED** uses one core. | Use **RUN PARALLEL**. |

## Dashboard

| Symptom | Cause | Fix |
|---|---|---|
| My sweep is not in the **DATASET** list | The Dashboard was open before the run finished; or it was a **RUN QUICK** study, which is never registered. | Press <kbd>Ctrl</kbd>+<kbd>R</kbd>; for a quick study, run an ad-hoc sweep or the full study instead. |
| No **Dose response** or **Paired comparisons** card | An ad-hoc dataset is selected. | Expected. Those cards exist only for the canonical study. |
| "Could not load `results/index.json`" | The manifest is missing or invalid JSON (usually after hand-editing). | Fix the JSON or restore the factory datasets (Appendix B). |
| **WATCH ▸** took me away from the Dashboard | It opens the Simulation in the same window. | Use the Simulation's **RESULTS** link, or open a fresh Dashboard from the launcher. |
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
| `lag` turns red | The PC cannot keep pace at that speed. | Choose a lower speed. |
| **STAGE** says `invalid JSON: …` | Syntax error in the gateway box. | Fix braces, quotes and commas. |
| **STAGE** says `refused: <path>: unknown key` | A misspelled key. Unknown keys are errors for gateway configs (unlike engine overrides). | Correct it against Appendix C. |
| **STAGE** says `refused: a session is active; …` | Staging is refused while a session runs or is paused. | **STOP**, then **STAGE**. |
| **STAGE** says `refused: network.unicastDestinations: at least one destination in unicast mode` | Unicast without a receiver address. | Add the receiver's IP. |
| The GATEWAY box reads `gateway inactive for this session` | The session was started before any configuration was staged. | **STOP**, **STAGE**, **START**. |
| The GATEWAY box shows `no gateway config staged` after a restart | The staged configuration lives in memory only. | Stage it again (Chapter 10.2). |
| The session ends at once with `ENDEX — error: …` mentioning a socket or bind | The port or interface could not be opened: another process holds the port exclusively, or `network.interface` names an address this PC does not have. | Change the port, fix the interface, or use unicast. |
| Nothing arrives at the receiver | Firewall, subnet, adapter, port or exercise ID. | Receiver: inbound UDP 3000 allowed; same subnet; sender allowed through Windows Security Alert; `dis.exerciseId` equal on both ends; on multi-homed PCs use unicast or set `network.interface`. Verify on the sending PC with Wireshark first. |
| Entities appear at 0° N 0° E (the Gulf of Guinea) | The anchor was left at its default. | Set `anchor.lat0Deg` and `anchor.lon0Deg`. |
| Entities rubber-band in VBS | Dead-reckoning thresholds too loose for the receiver. | Lower `deadReckoning.drone.posThresholdM` / `oriThresholdDeg`, or set `algorithm` to 4. Keep the speed at 1×. |
| The status line warns `speed Nx exceeds publish.maxSpeedFactor 8` | The session runs faster than remote smoothing tolerates. | Lower the speed. |
| An external entity never shows as an overlay | `receive.enabled` false; different exercise ID; the sender uses FPV Sim's own site/application pair (1/3001); or the entity is outside the 4 km box. | Check each in turn; the GATEWAY box's `peers` count tells you whether anything is being heard at all. |
| Wireshark shows the packets as plain UDP | A port other than 3000. | Right-click ▸ **Decode As…** ▸ DIS. |

## Data

| Symptom | Cause | Fix |
|---|---|---|
| I want the factory datasets back | | Close FPV Sim, delete `%APPDATA%\fpv-sim-app\results`, start FPV Sim (Appendix B). |
| The results folder is large | Many sweeps. | Retire datasets you no longer need (Appendix B). |
