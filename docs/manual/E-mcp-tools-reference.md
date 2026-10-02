# E. MCP tools reference

The MCP endpoint (Chapter 8) serves **fourteen tools**. Five are *batch* tools: they run a fresh simulation, return the answer and keep nothing. Nine are *live* tools: they drive the one real-time session the application hosts, the same session the Live Ops panel shows (Chapter 9) and the DIS gateway publishes from (Chapter 10).

You do not normally type tool names. You ask in plain language and the assistant picks the tool; the names and arguments below are for checking what it did, for scripting a client of your own, and for phrasing a request precisely when the assistant guesses wrong.

## E.1 The fifteen tools at a glance

| Tool | Kind | What it does | Changes state |
|---|---|---|---|
| `run_engagement` | batch | One engagement, complete record including the event log | No |
| `sweep_seeds` | batch | Many seeds under one configuration, aggregates only | No |
| `compare_configs` | batch | Two configurations over the same seeds, paired | No |
| `describe_model` | batch | The modeling assumptions and known simplifications | No |
| `get_config_schema` | batch | Every overridable parameter with unit, default and range | No |
| `live_start_session` | live | Start the wall-clock-paced session | Yes |
| `live_configure_gateway` | live | Stage a DIS gateway config for the next session | Yes |
| `live_stop_session` | live | Stop the session, return its result | Yes |
| `live_session_status` | live | State, sim clock, phase, speed, pacing lag | No |
| `live_get_snapshot` | live | Entity positions and paged events | No |
| `live_pause` | live | Hold wall-clock pacing | Yes |
| `live_resume` | live | Release wall-clock pacing | Yes |
| `live_set_speed` | live | Change the speed factor mid-session | Yes |
| `live_gateway_status` | live | Gateway state, PDU counters, peers, last error | No |
| `live_export_terrain` | live | Write a seed's terrain as GeoTIFFs for VBS Geo | Yes (writes files) |

The seven tools marked "No" are annotated read-only, so a well-behaved client may call them without asking you each time. The eight marked "Yes" start, alter or stop a session, or write files — and a session with a staged gateway **transmits on your network**. See [E.9](#e9-safety-and-limits).

## E.2 Conventions

- Every tool returns a single JSON document as text. There are no streaming or binary results.
- Argument names are exactly as written, in `snake_case`.
- Every `seed` and `start_seed` is an integer in `0`–`4294967295`.
- `mode` is `"orbit"` or `"tactical"` and defaults to `"orbit"` everywhere.
- `config_overrides` (and `config_a` / `config_b`) take the override object described in [Appendix D](D-overrides-quick-reference.md). `{}` means the stock configuration.
- Out-of-range arguments are rejected before the simulation runs, with a message naming the argument.

> [!NOTE]
> Every tool that takes overrides — batch and live alike — validates the *keys* and *ranges* against the parameter table before anything runs. `live_start_session` with a misspelled key returns `{"ok": false, "error": "overrides: CUAS.BRG_SIGMA: unknown key"}` rather than starting a stock session. Copy keys from [Appendix D](D-overrides-quick-reference.md) or call `get_config_schema`.

## E.3 `run_engagement`

Runs one deterministic engagement to completion and returns the full record: winner (or `STALEMATE`) with reason, duration, the phase timeline, per-team fix quality with the CEP breakdown, LOB and intercept counts per DF node, key event timestamps, drone and GCS end states, and the complete event log. Tactical mode adds the objective, the sortie tallies and the per-airframe package state.

| Argument | Required | Type | Meaning |
|---|---|---|---|
| `seed` | yes | integer `0`–`4294967295` | The engagement. The same seed always replays identically. |
| `mode` | no | `"orbit"` \| `"tactical"` | Engagement plan. Default `"orbit"`. |
| `config_overrides` | no | object | Partial CONFIG overrides. |

Featured seeds, quoted from the tool's own schema, are worth knowing because the rest of the manual uses them:

| Mode | Seed | Outcome |
|---|---|---|
| orbit | `20260719` | Standard BLUFOR win — the manual's reference engagement |
| orbit | `66` | Fast BLUFOR win |
| orbit | `57` | Deliberate BLUFOR win |
| orbit | `41` | OPFOR win |
| orbit | `59` | Close race, OPFOR |
| tactical | `12` | Standard BLUFOR win |
| tactical | `26` | Fast BLUFOR win |
| tactical | `5` | Final-push BLUFOR win |
| tactical | `18` | Close race, BLUFOR |
| tactical | `41` | OPFOR win |
| tactical | `14` | Stalemate |

## E.4 `sweep_seeds`

Runs `count` consecutive seeds — `start_seed` through `start_seed + count - 1` — under one configuration and returns **aggregate statistics only**: win rates by team including `STALEMATE`, time-to-fix and time-to-kill distributions (mean, median, p10, p90), the duration distribution, stalemate reasons, and notable seeds worth drilling into with `run_engagement`. Per-run event logs are not returned; aggregation happens before the answer is built.

| Argument | Required | Type | Meaning |
|---|---|---|---|
| `start_seed` | yes | integer `0`–`4294967295` | First seed of the range. |
| `count` | yes | integer `1`–`1000` | How many consecutive seeds to run. |
| `mode` | no | `"orbit"` \| `"tactical"` | Default `"orbit"`. |
| `config_overrides` | no | object | Partial CONFIG overrides. |

> [!IMPORTANT]
> `count` is capped at **1000**. A larger request is rejected rather than truncated. For studies bigger than that, use the Studies panel (Chapter 6), which writes a dataset the Dashboard can read — `sweep_seeds` never touches your results folder.

## E.5 `compare_configs`

Runs two configuration variants over the **same** consecutive seed range and returns each variant's aggregates, the paired outcome deltas, the seeds whose outcome flipped, and a plain-language summary generated from those numbers.

The design is paired: because both arms see the same terrain and the same emplacement luck, that noise cancels and a few hundred seeds resolve effect sizes that would otherwise need far more runs.

| Argument | Required | Type | Meaning |
|---|---|---|---|
| `start_seed` | yes | integer `0`–`4294967295` | First seed of the range. |
| `count` | yes | integer `1`–`500` | Seeds run under **both** variants. |
| `mode` | no | `"orbit"` \| `"tactical"` | Default `"orbit"`. |
| `config_a` | yes | object | Variant A overrides. `{}` for stock. |
| `config_b` | yes | object | Variant B overrides. `{}` for stock. |
| `label_a` | no | string, ≤ 80 chars | Name for variant A. Default `variant A`. |
| `label_b` | no | string, ≤ 80 chars | Name for variant B. Default `variant B`. |

`config_a` and `config_b` are both required — pass `{}` explicitly for the stock arm rather than omitting it. Total work is `2 × count` engagements, which is why the cap here is **500**, not 1000.

> [!TIP]
> Always set `label_a` and `label_b`. They appear in the generated summary, which is much easier to read as "EMCON discipline beats continuous transmission" than as "variant B beats variant A".

## E.6 `describe_model` and `get_config_schema`

Neither takes any arguments.

`describe_model` returns the modeling assumptions: the DF measurement and bearing-error model, RF propagation, fix estimation and its quality gates, the drone state machine, EMCON semantics, outcome definitions, and the known simplifications. It states what the model can and cannot support.

> [!WARNING]
> Read `describe_model` before drawing conclusions from any sweep. The simulation is notional throughout; its numbers describe the model, not any real system.

`get_config_schema` returns every parameter accepted in `config_overrides` — path, unit, default, sane range and description — plus the parameters that are deliberately fixed and why. It is generated from the same table that validates tool inputs, so it cannot drift from actual behaviour. [Appendix D](D-overrides-quick-reference.md) is the curated subset of that table; `get_config_schema` is the whole of it, as data.

## E.7 Live session tools

All ten live tools act on the single session the application hosts (the terrain export reads only its staged configuration). Only one session exists at a time.

### `live_start_session`

Starts a wall-clock-paced engagement. The engine steps its fixed 0.1 s ticks at the given speed factor, and a session allowed to run to its end produces the **identical** result as `run_engagement` on the same seed, mode and overrides.

| Argument | Required | Type | Meaning |
|---|---|---|---|
| `seed` | yes | integer `0`–`4294967295` | The engagement. |
| `mode` | no | `"orbit"` \| `"tactical"` | Default `"orbit"`. |
| `config_overrides` | no | object | Partial CONFIG overrides. |
| `speed` | no | number `0.25`–`60` | Wall-clock speed factor. Default `1`. |
| `max_sim_s` | no | number `60`–`14400` | Sim-time ceiling in seconds. Default `3600`. |
| `gateway` | no | object | DIS gateway config for this session, merged over defaults. |

Returns `{ "ok": true, "sessionId": "live-…" }`, or `{ "ok": false, "error": … }` if a session is already running or paused — stop it first.

`gateway` takes the same object as `live_configure_gateway` and is described in [Appendix C](C-gateway-config-reference.md). Omit it to use whatever was staged with `live_configure_gateway`, or to run with no gateway at all.

> [!IMPORTANT]
> Use `speed: 1` whenever the DIS gateway is armed. Other simulators expect real-time kinematics; an accelerated session publishes a rescaled wall-apparent frame that most federates will not interpret as you intend. Speeds above 1 are for reviewing an engagement quickly, not for interop.

### `live_configure_gateway`

Validates a DIS gateway configuration and stages it for the **next** session: network mode and port, exercise and site/application IDs, the geo anchor (latitude, longitude, altitude and rotation of the sim origin), entity-type mapping, dead-reckoning thresholds, notional emitter parameters and sim-management behaviour.

| Argument | Required | Type | Meaning |
|---|---|---|---|
| `config` | yes | object | Partial gateway config, merged over the defaults. |

Returns `{ "ok": true }`, or `{ "ok": false, "error": … }` listing each bad value by its path, so a message like `network.port: must be 1024..65535` tells you exactly what to fix. Staging while a session is running is refused — a staged config only ever applies to the next session.

This is the same operation as the **STAGE** button in the Live Ops panel's gateway editor, and the two share one staged config: staging here makes the panel's gateway box read **configured for next session**. Every field is documented in [Appendix C](C-gateway-config-reference.md).

### `live_stop_session`

No arguments. Stops the running session and returns `{ "ok": true, "reason": …, "result": … }`, where `result` is the `EngagementResult` — complete if the engagement had already decided, partial if you stopped it early.

### `live_session_status`

No arguments. Returns the state of the session host: `state` (`idle`, `running`, `paused` or `ended`), `sessionId`, `seed`, `mode`, the sim clock `t` and `tick`, `phase`, `speed`, the pacing lag `lagMs`, `winner` once decided, `endedReason`, `overrideKeys` (how many override values the session was started with; `0` is the stock configuration), `maxSimS` (its sim-time ceiling), and a `gateway` object with its `enabled` flag and `state`.

`lagMs` is the honest measure of whether your PC is keeping up: it reports how far behind the wall clock the engine has fallen. A few tens of milliseconds is normal; a lag that climbs steadily means the speed factor is too high for the machine.

### `live_get_snapshot`

Returns the latest entity-level snapshot — positions, headings, battery, which emitters are keyed, current fixes — together with the event log from a cursor.

| Argument | Required | Type | Meaning |
|---|---|---|---|
| `events_after` | no | integer ≥ `0` | Return only events after this cursor. Default `0`, meaning from the beginning. |

The reply carries `nextCursor`. Pass that back as `events_after` on the following call and you page through the log without repeats — the intended way to follow a session without re-reading everything on each poll.

### `live_pause` and `live_resume`

Neither takes arguments. `live_pause` holds wall-clock pacing with the sim state intact; `live_resume` releases it. Both return `{ "ok": …, "status": … }`, where `status` is the same document `live_session_status` returns.

Pausing stops the gateway publishing new positions. Federates holding your entities will dead-reckon them onward until you resume, so a long pause makes remote views drift away from the truth.

### `live_set_speed`

Changes the wall-clock speed factor mid-session. Pacing only — determinism is unaffected, and the engagement still ends the way `run_engagement` says it does.

| Argument | Required | Type | Meaning |
|---|---|---|---|
| `speed` | yes | number `0.25`–`60` | New wall-clock speed factor. |

Returns `{ "ok": true, "speed": … }`, or `{ "ok": false, "error": "no active session" }` when nothing is running. When the DIS gateway is armed, published kinematics rescale to the new wall-apparent frame and the gateway sends a refresh volley so federates resynchronise rather than dead-reckoning on stale velocities.

### `live_gateway_status`

No arguments. Returns the gateway `state`, PDU counters by type for both transmit and receive, the peers heard, the external overlay track count, the last error, and `pendingConfig` — `true` when a config is staged for the next session.

With no session running and nothing staged, the status detail reads **no gateway config staged**; after a successful `live_configure_gateway` it reads **configured for next session**. This is the quickest check that staging actually took effect.

### `live_export_terrain`

Writes a seed's terrain as GeoTIFFs for VBS Geo's DEM import (Chapter 11.3): the elevation in both vertical datums, each with a `.json` of the grid's metadata, and the canopy density, five files named `seed-<n>-…`.

| Argument | Required | Type | Meaning |
|---|---|---|---|
| `seed` | yes | integer `0` to `4294967295` | The terrain to export. |
| `anchor` | no | object | `lat0Deg` and `lon0Deg` (both required inside the object), `h0M`, `rotationDeg` and `geoidOffsetM` as in [Appendix C](C-gateway-config-reference.md). Default: the staged gateway configuration's anchor. |
| `out_dir` | no | string | Absolute folder, created if needed. Default `%APPDATA%\fpv-sim-app\terrain`. |

Returns `{ "ok": true, "dir": …, "files": [ { "path", "layer", "vdatum", "bytes" }, … ], "meta": { "egm96": …, "ellipsoid": … }, "warnings": [ … ] }`, or `{ "ok": false, "error": … }` when nothing is staged and no anchor was passed, when the seed or anchor is out of range, or when the folder cannot be written. A warning rather than an error flags `geoidOffsetM` at 0 (the two elevation files then hold the same heights) and the untouched 0°, 0° anchor.

This is the same operation as **EXPORT TERRAIN** in the Live Ops panel's GATEWAY box, minus the folder picker.

## E.8 Resources

Besides the tools, the endpoint publishes two documents an MCP client can read directly:

| URI | Contents |
|---|---|
| `fpv-sim://design-notes` | The original browser simulation's design notes: terrain and RF models, the DF fix math and its honesty gates, drone behaviour, the tuning guide, known simplifications. |
| `fpv-sim://mcp-design-notes` | How the browser simulation became a headless engine, how determinism parity is verified, and why the MCP interface is shaped as it is. |

Both are Markdown. Ask for them by name — "read the fpv-sim design notes resource" — rather than by URI.

## E.9 Safety and limits

| Limit | Value |
|---|---|
| `sweep_seeds` `count` | 1000 |
| `compare_configs` `count` | 500 (so 1000 engagements) |
| Seed range | `0`–`4294967295` |
| Live `speed` | `0.25`–`60` |
| Live `max_sim_s` | `60`–`14400` (4 hours of sim time) |
| Concurrent live sessions | 1 |

> [!CAUTION]
> An assistant with this endpoint can start a live session, and a live session with a staged gateway transmits DIS PDUs on your network — which other simulators on that network will act on. Chapter 10 is exactly this behaviour used deliberately. If you do not want it to happen on request, stop the session and clear the staged gateway before handing the endpoint to an assistant, or keep the machine off the exercise network. `live_export_terrain` is the one tool that writes files: into the folder the call names, or the profile's terrain folder; it transmits nothing.

Batch tools are stateless and cheap: each call builds a fresh simulation, so concurrent calls cannot contaminate one another and identical inputs always return identical outputs. They never write to your results folder. Use the Studies panel (Chapter 6) when you want a dataset the Dashboard can open.

## E.10 A worked sequence

Staging a gateway and running a real-time session entirely from an assistant, with the Live Ops panel open to watch:

1. Ask for the gateway to be staged: *"Stage the DIS gateway for broadcast on port 3000, exercise 1, anchor at 21.35, −157.95."*
   → *The assistant calls `live_configure_gateway` and reports `{ "ok": true }`. In the Live Ops panel the gateway box reads **configured for next session**.*
2. Confirm it took: *"What is the gateway status?"*
   → *`live_gateway_status` returns `pendingConfig: true` with the same detail.*
3. Start the session: *"Start a live session on seed 20260719 at real time."*
   → *`live_start_session` returns `ok: true` with a `sessionId`. The Live Ops map begins moving and the gateway state changes to **publishing**.*
4. Follow it: *"Tell me when BLUFOR establishes its fix."*
   → *The assistant polls `live_get_snapshot`, paging with `nextCursor`, and reports the FIX ESTABLISHED event with its timestamp.*
5. Stop when you have seen enough: *"Stop the session."*
   → *`live_stop_session` returns the `EngagementResult` and the stop reason; the gateway sends its stop PDU and returns to idle.*

Because the session was paced but not perturbed, the result at step 5 matches `run_engagement` on seed `20260719` exactly — the guarantee that makes a live DIS feed trustworthy as evidence rather than merely as a demonstration.
