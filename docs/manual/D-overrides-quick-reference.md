# D. Engine override quick reference

Overrides are a JSON object whose sections mirror the engine's configuration. They apply to ad-hoc sweeps (Chapter 6), to Live Ops sessions (Chapter 9) and to the MCP tools that accept `config_overrides` (Appendix E). The interactive Simulation window always runs the stock configuration.

The keys below are the ones most worth changing. The complete table — every tunable with its unit, default, range and rationale — is `PARAMETERS.md` in the fpv-sim project; the **parameter reference** under the overrides box in Studies and in Live Ops SETUP, and the MCP tool `get_config_schema`, return the same table.

> [!NOTE]
> Overrides are checked against that table wherever they are accepted — the Studies and Live Ops boxes as you type, and every batch and live MCP tool. An unknown key or an out-of-range value is refused with its path (`CUAS.BRG_SIGMA: unknown key`, `CUAS.BRG_SIGMA_DEG: must be in 0.5..15`); nothing is ignored silently.

## D.1 Validated examples

| Purpose | Overrides |
|---|---|
| Double the DF bearing error | `{"CUAS":{"BRG_SIGMA_DEG":8}}` |
| OPFOR adopts BLUFOR's discipline (E2 arm) | `{"TEAMS":{"OPFOR":{"uplinkOn":4,"uplinkOff":13,"videoOn":3,"videoOff":7}}}` |
| Swap the two postures (E2 arm) | `{"TEAMS":{"BLUFOR":{"uplinkOn":10,"uplinkOff":4,"videoOn":1,"videoOff":0},"OPFOR":{"uplinkOn":4,"uplinkOff":13,"videoOn":3,"videoOff":7}}}` |
| Equalize the launch times (E2 arm) | `{"TEAMS":{"OPFOR":{"launchT":20}}}` |
| One E3 dose-response cell (14% uplink duty, continuous video) | `{"TEAMS":{"OPFOR":{"uplinkOn":2,"uplinkOff":12,"videoOn":1,"videoOff":0}}}` |
| Looser commit gate | `{"FIX":{"COMMIT_CEP_M":200,"MIN_LOBS_COMMIT":8}}` |
| Tactical: no reserve hunter, bigger packages | `{"TACTICAL":{"RESERVE_HUNTER":false,"SORTIES":{"BLUFOR":7,"OPFOR":7}}}` |

## D.2 `CUAS` — the direction-finding sensors

| Key | Default | Unit | Range | Meaning |
|---|---|---|---|---|
| `SCAN_S` | 1.5 | s | 0.5–10 | DF scan revisit interval. |
| `MAX_RANGE_M` | 3600 | m | 1000–6000 | Maximum detection range. Below about 3000 m the sides struggle to hear each other at all. |
| `BRG_SIGMA_DEG` | 4 | deg (1σ) | 0.5–15 | Bearing error in clean conditions; path attenuation inflates it further. |
| `P_DETECT_UL` | 0.4 | per scan | 0.02–1 | Base detection probability against the C2 uplink. |
| `P_DETECT_DL` | 0.65 | per scan | 0.02–1 | Base detection probability against the video downlink. |
| `CANOPY_HGT_M` | 18 | m | 5–40 | Canopy height used for radio masking. |

## D.3 `FIX` — the estimator's gates

| Key | Default | Unit | Range | Meaning |
|---|---|---|---|---|
| `FIX_CEP_M` | 240 | m | 50–600 | CEP required to declare FIX ESTABLISHED. |
| `COMMIT_CEP_M` | 120 | m | 30–400 | CEP required to commit the attack. Looser means earlier, riskier commits. |
| `PUSH_CEP_M` | 260 | m | 50–800 | CEP acceptable on a low-battery final push. |
| `MIN_LOBS_SOLVE` | 6 | count | 3–30 | LOBs (from two or more nodes) before a cut is attempted. |
| `MIN_LOBS_2ND` | 3 | count | 1–20 | LOBs from the second node before a fix is trusted. |
| `MIN_LOBS_FIX` | 10 | count | 4–40 | LOBs before FIX can be declared. |
| `MIN_LOBS_COMMIT` | 12 | count | 4–60 | LOBs before attack commit. |
| `GOOD_CUT_DEG` | 35 | deg | 10–90 | Crossing angle giving full-confidence geometry. |

## D.4 `TEAMS.BLUFOR` / `TEAMS.OPFOR` — doctrine

| Key | BLUFOR default | OPFOR default | Unit | Range | Meaning |
|---|---|---|---|---|---|
| `uplinkOn` | 4 | 10 | s | 0.5–60 | C2 uplink keyed per cycle. |
| `uplinkOff` | 13 | 4 | s | 0–120 | C2 uplink silent per cycle. 0 = continuous. |
| `videoOn` | 3 | 1 | s | 0.5–60 | Video keyed per cycle. |
| `videoOff` | 7 | 0 | s | 0–120 | Video silent per cycle. 0 = continuous (and the posture label becomes CONTINUOUS). Video is always on during COMMIT and TERMINAL. |
| `launchT` | 20 | 26 | s | 0–300 | Drone launch time. |

## D.5 `DRONE` — the aircraft

| Key | Default | Unit | Range | Meaning |
|---|---|---|---|---|
| `CRUISE_MPS` | 18 | m/s | 5–60 | Transit airspeed. |
| `LOITER_MPS` | 12 | m/s | 4–40 | Holding-orbit airspeed. |
| `DASH_MPS` | 36 | m/s | 10–80 | Attack-run airspeed after commit. |
| `ENDURANCE_S` | 1200 | s | 180–3600 | Battery endurance at cruise — the clock pressure on the whole engagement. |
| `PUSH_BATT_PCT` | 45 | % | 0–90 | Battery level that forces a final push. |
| `HOLD_STANDOFF_M` | 600 | m | 100–1500 | Holding orbit distance forward of own GCS. |
| `ACQ_RANGE_M` | 220 | m | 50–600 | Range at which the operator visually identifies the GCS in the terminal phase. |

## D.6 `TACTICAL` — the sortie-stream air plan (tactical mode only)

| Key | Default | Unit | Range | Meaning |
|---|---|---|---|---|
| `SORTIES.BLUFOR` / `.OPFOR` | 5 / 5 | count | 1–12 | Strike airframes per side. |
| `PILOTS.BLUFOR` / `.OPFOR` | 2 / 2 | count | 1–6 | Pilot stations = drones airborne at once. |
| `RESERVE_HUNTER` | true | flag | true/false | Hold a dedicated hunter-killer. `false` retasks the next strike airframe when the fix commits. |
| `LAUNCH_INTERVAL_S` | 90 | s | 10–600 | Spacing between strike launches. |
| `LAUNCH_JITTER_S` | 20 | s | 0–120 | ± jitter on the spacing. |
| `STRIKE_TERMINAL_M` | 380 | m | 100–1500 | Distance at which a sortie hands from autonomous transit to manual control (which keys the uplink continuously). |
| `AIM_SIGMA_M` | 90 | m | 10–400 | Scatter of aim points about the objective centre. |
| `OBJ_X`, `OBJ_Y` | 1830, 1975 | m | 400–3600 | Objective position. |
| `OBJ_RADIUS_M` | 260 | m | 60–800 | Objective radius. |

## D.7 Not overridable

`WORLD_M` (the 4000 m box), `SIM_DT` (the 0.1 s tick), `SEED` (pass the seed itself), `TEAMS.*.emconLabel` (derived from `videoOff`) and `TACTICAL.OBJ_NAME` (cosmetic) are fixed. Overrides cannot move the emplacements or the NAI geometry.
