# 1. What FPV Sim is

This chapter gives you the mental model that every later chapter relies on. It takes about five minutes to read and needs nothing installed.

## 1.1 The engagement in plain words

Two teams, **BLUFOR** (blue) and **OPFOR** (red), face each other across a notional 4 km × 4 km area of operations called AO KATANA. Each team fields the same equipment:

- one **ground control station (GCS)** — the operators, the radios, the thing each side is trying to destroy;
- two **counter-UAS direction-finding nodes** (DF nodes, shown as `cUAS-1` and `cUAS-2`) — radio listening posts that take a bearing on any enemy transmission they hear;
- one or more armed **FPV small-UAS** (`sUAS-1`, …) — first-person-view drones that fly a holding pattern until their side knows where the enemy GCS is, then attack it.

Every time a team transmits — the GCS keying its command-and-control uplink, or a drone sending its video downlink — the enemy DF nodes may intercept it and get a rough **line of bearing (LOB)**. Enough bearings from two different nodes, and the enemy can fuse them into a position estimate, a **fix**, with an honest error ellipse and a **CEP** (circular error probable — the radius that contains the true position half the time). When the fix is tight enough to pass the **commit gate**, the drone leaves its hold and strikes.

The game is therefore a race: **find the enemy before they find you**. The two teams have identical hardware; the only difference is how much they talk on the radio. BLUFOR keys its uplink intermittently and its video in short bursts (**EMCON INTERMITTENT**). OPFOR transmits nearly all the time (**EMCON CONTINUOUS**). The lesson the whole application dramatizes is:

> **The side that transmits less is harder to fix, and usually wins.**

## 1.2 The four phases

Every engagement moves through four phases. The Simulation window shows the current one in its header, and the Event Log narrates each transition.

| Phase | What happens |
|---|---|
| **I — Emplacement** | Each side places its GCS and its two DF nodes, with the DF baseline spread perpendicular to the expected threat axis so the two collectors produce well-crossed bearings. |
| **II — Search and Collect** | Drones launch (BLUFOR at T+00:20, OPFOR at T+00:26 in the default scenario) and hold in an endurance-optimal orbit forward of their own GCS while the DF nodes collect LOBs on enemy emissions. C2 uplink intercepts locate the enemy **GCS**; video downlink intercepts track the enemy **drone**. |
| **III — Fix** | Accumulated LOBs are fused by weighted least squares into a position estimate. The estimate is only trusted once it is built from enough bearings, from both nodes, with a good crossing angle. |
| **IV — Attack** | Once the fix meets the commit gate (or a low battery forces a "final push" on the best fix available) the drone dashes to the fix, descends below the tree canopy, visually acquires the GCS and strikes. ENDEX. |

If neither side ever reaches a commit-quality fix and both drones run out of battery, the engagement ends in a **stalemate**.

## 1.3 Orbit mode and tactical mode

Every window that shows an engagement has a **Mode** switch.

- **Orbit** is the original engagement: one FPV per side holds a forward orbit while the DF nodes work. The fight lasts up to twenty minutes of simulated time and is decided by who fixes first.
- **Tactical** keeps the terrain, the sensors and the fix mathematics but changes the air plan. There is a contested objective, **OBJ TANTO**, midway between the two GCS, and each side pushes a package of five one-way strike sorties into it, about 90 s apart, two airborne at once at most. One extra airframe per side is held back as a **hunter-killer**. Every sortie keys its GCS's uplink, so the more a side flies the more it emits, and the enemy fixes it sortie by sortie. When a side's fix reaches the commit gate its hunter-killer launches against the enemy GCS. If both packages are spent and nobody can launch a hunter, the result is a stalemate with both GCS alive.

Switching mode keeps the current seed, so the same emplacement can be watched under both air plans.

## 1.4 Seeds and determinism

Every engagement is generated from a **seed**, an integer between 0 and 4,294,967,295. The same seed always replays the identical battle — tick for tick, event for event — in the Simulation window, in the 3D Viewer, in a Live Ops session, in a Monte Carlo sweep on your PC and on anyone else's PC. That is why the Dashboard can link any statistic back to the exact battle behind it, why a live session streamed over DIS produces the same result as the batch run, and why the numbers in Chapter 7 are checkable rather than something you have to take on trust.

The default seed, **20260719**, is the "Standard Engagement (BLUFOR)" scenario: a representative disciplined win in which BLUFOR fixes at about T+02:11 and destroys the OPFOR GCS at T+05:11.

## 1.5 The six tiles

The launcher window (Chapter 3) offers six tiles. Three open pages of the original browser simulation inside application windows; three open the application's own panels.

| Tile | What it opens | Chapter |
|---|---|---|
| **SIMULATION** | The interactive 2D engagement: map, controls, Unit Detail, Event Log, featured scenarios. | 4 |
| **DASHBOARD** | The Monte Carlo results viewer: win rates with confidence intervals, dose-response, paired experiments, distributions, replayable notable engagements. | 7 |
| **3D VIEWER** | The same engagement rendered with WebGPU: terrain in relief, drones at altitude, a GPU-computed detectability field. | 5 |
| **STUDIES** | Runs the canonical Monte Carlo study or your own ad-hoc sweeps against the bundled engine, writing datasets the Dashboard reads. | 6 |
| **MCP ENDPOINT** | A local Model Context Protocol server so Claude Code or another MCP client can drive the batch and live tools. | 8 |
| **LIVE OPS** | Wall-clock-paced sessions with a live map, entity table and event feed — and the panel where the DIS gateway is staged. | 9, 10 |

## 1.6 What "notional" means

The terrain, the units, the radio frequencies (a 915 MHz uplink, a 5.8 GHz video downlink), the detection probabilities, the bearing error and every outcome are invented values chosen to make a teaching point. They are tuned to be plausible, not to represent any real system. Every screen in the application carries an "Unclassified // Notional Demonstration" banner for that reason. When this manual quotes a number, it is describing the model.
