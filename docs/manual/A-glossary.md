# A. Glossary

Terms are grouped by topic. Inside the application every term below appears with the spelling shown here.

## The engagement

| Term | Meaning |
|---|---|
| **BLUFOR** / **OPFOR** | The two teams: blue force and opposing force. Identical equipment; in the stock configuration BLUFOR practises emissions discipline and OPFOR transmits continuously. |
| **GCS** — ground control station | The operators' station for a team. It keys the command-and-control (C2) uplink to its drone, and it is the target each side is hunting. |
| **sUAS** / **FPV** | Small uncrewed aircraft system flown first-person-view — the armed drone. Shown as `sUAS-1`, `sUAS-2`, … |
| **cUAS** / **DF node** | Counter-UAS direction-finding node: a listening post that takes bearings on enemy transmissions. Each team has two, `cUAS-1` and `cUAS-2`. |
| **LOB** — line of bearing | The direction from a DF node to an emitter it intercepted. LOBs from two nodes can be crossed to estimate a position. |
| **Intercept** | One scan on which a DF node detected an emitter. |
| **Fix** | A position estimate for the enemy GCS, fused from LOBs by weighted least squares. |
| **CEP** — circular error probable | The radius of the circle, centred on the fix, that contains the true position half the time. Smaller is better. |
| **Error ellipse** | The fix's uncertainty drawn as an ellipse; its shape reflects the crossing angle of the bearings. |
| **EMCON** — emission control | A team's radio posture. **INTERMITTENT**: uplink and video keyed in short cycles. **CONTINUOUS**: video keyed all the time. |
| **Duty cycle** | The share of time a radio is keyed, for example 4 s on / 13 s off. |
| **Commit gate** | The fix quality (CEP and number of LOBs) a side needs before its drone leaves its hold to attack. |
| **Final push** | A commit on the best fix available, forced by a low battery rather than by fix quality. |
| **Hold** | The drone's fuel-efficient orbit forward of its own GCS while the DF nodes collect. |
| **Hunter-killer** | Tactical mode: the airframe held in reserve to strike the enemy GCS once it is fixed. |
| **Sortie** / **package** | Tactical mode: one strike flight to the objective; the package is the set of sorties a side has (five by default). |
| **OBJ TANTO** | Tactical mode: the contested objective between the two GCS. |
| **NAI** — named area of interest | A box where a side expects the enemy GCS to be emplaced (`NAI 1`, `NAI 2` on the map). |
| **Stalemate** | An engagement that ends with both GCS alive: both drones down (orbit) or both packages spent (tactical). |
| **ENDEX** | End of exercise — the engagement is over. |
| **Phase** | I Emplacement, II Search and Collect, III Fix, IV Attack. |

## Runs and results

| Term | Meaning |
|---|---|
| **Seed** | The integer (0 to 4,294,967,295) that generates an engagement. Same seed, same battle, everywhere. |
| **Engagement** | One battle from one seed. |
| **Sweep** | Many consecutive seeds run under one configuration and aggregated. |
| **Ad-hoc sweep** | A sweep you define in the Studies panel: label, seed range, mode, optional overrides. |
| **Study** (canonical) | The fixed set of experiments E1–E3 behind the published results: 22,800 engagements in orbit mode, 24,800 in tactical. |
| **Dataset** | One results file in `%APPDATA%\fpv-sim-app\results`. |
| **Manifest** | `index.json` in the same folder — the list of datasets the Dashboard shows. |
| **Overrides** | JSON that changes engine parameters for a sweep or an MCP call, for example `{"CUAS":{"BRG_SIGMA_DEG":8}}`. |
| **Baseline** | The stock configuration, or the aggregate of a sweep over it. |
| **Paired comparison** | The same seeds run twice with one change, so per-seed luck cancels. |
| **Dose response** | Win rate plotted against one parameter swept in steps (OPFOR's uplink duty cycle). |
| **Decisive fight** | An engagement someone won (not a stalemate). |
| **95% CI** (Wilson) | The interval within which the true rate lies with 95% confidence, given the sample size. |
| **Time to fix / time to kill** | Simulated seconds from T+00:00 to a side's first trusted fix, and to the winning strike. |

## Interoperability

| Term | Meaning |
|---|---|
| **DIS** | Distributed Interactive Simulation, IEEE 1278.1 — the UDP-based protocol the gateway speaks. |
| **PDU** | Protocol data unit — one DIS message. |
| **Entity State PDU** (ESPDU) | Position, velocity, orientation, appearance and marking of one entity. |
| **Electromagnetic Emission PDU** (EE) | The radios an entity is transmitting with. One beam while keyed, none when silent. |
| **Detonation** / **Fire** | The strike. Fire PDUs are off by default. |
| **Start/Resume**, **Stop/Freeze** | Simulation-management PDUs sent at session start, pause and resume. |
| **Exercise ID** | The number that groups a DIS exercise; receivers ignore other exercises. Default 1. |
| **Site / application / entity ID** | The three-part identity of every entity. FPV Sim uses site 1, application 3001. |
| **Marking** | The 11-character label on an entity: `B-GCS`, `O-sUAS-1`. |
| **Force ID** | 1 for BLUFOR, 2 for OPFOR. |
| **Entity type** | The seven-number SISO enumeration describing what an entity is; FPV Sim sends generic surrogates. |
| **Dead reckoning** | The rule receivers use to extrapolate an entity between updates; the gateway re-sends when the truth drifts beyond a threshold. |
| **Heartbeat** | The maximum interval between updates for an unchanged entity (5 s) or a keyed emitter (10 s). |
| **Anchor** | The latitude, longitude, height and rotation that place the 4 km box on the Earth. |
| **ECEF** | Earth-centred, Earth-fixed X/Y/Z metres — how DIS expresses positions. |
| **Overlay track** | An entity received from another DIS sender, drawn on the Live Ops map for display only. |
| **VBS4** / **VBS Gateway** | Bohemia Interactive Simulations' virtual battlespace and its DIS/HLA adapter. |
| **HLA** / **RPR-FOM** | High Level Architecture and its real-time platform reference federation object model; reached from DIS through a bridge. |

## The application

| Term | Meaning |
|---|---|
| **Launcher** | The window with the six tiles (Chapter 3). |
| **Panel** | One of the application's own windows: Studies, MCP Endpoint, Live Ops. |
| **Live session** | A wall-clock-paced engagement run from Live Ops or through MCP. |
| **Gateway** | The DIS publisher/receiver attached to a live session once a configuration is staged. |
| **Staged** | A gateway configuration validated and held in memory for the next session. |
| **MCP** | Model Context Protocol — how an AI assistant such as Claude Code calls the application's tools. |
| **Bearer token** | The secret in the MCP connection snippet. |
| **Loopback** | `127.0.0.1`, the address only your own PC can reach. |
| **WebGPU** | The browser graphics API the 3D Viewer needs. |
| **Notional** | Invented for demonstration; describes the model, not any real system. |
