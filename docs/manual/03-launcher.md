# 3. The launcher window

The launcher is the small window that opens when you start FPV Sim. Everything else in the application is reached from it. This chapter names each of its parts so later chapters can refer to them.

![The launcher window](images/shell-launcher.png)
*Figure 3-1. The launcher window: six tiles, the launch bar, and the version footer.*

## 3.1 The six tiles

Each tile is a button. Clicking it opens a **new window**; the launcher stays open, and you may have several windows open at once (two Simulation windows on different seeds, for example).

| Tile | Opens | Window size | Chapter |
|---|---|---|---|
| **SIMULATION** | The interactive 2D engagement page | 1440 × 920 | 4 |
| **DASHBOARD** | The Monte Carlo results page | 1440 × 920 | 7 |
| **3D VIEWER** | The WebGPU 3D rendering | 1440 × 920 | 5 |
| **STUDIES** | The Studies panel (Monte Carlo runner) | 1100 × 780 | 6 |
| **MCP ENDPOINT** | The MCP Endpoint panel | 1100 × 780 | 8 |
| **LIVE OPS** | The Live Ops panel (real-time sessions and the DIS gateway) | 1100 × 780 | 9, 10 |

The first three tiles show the original browser pages of the fpv-sim project, served unchanged from inside the application. The last three are the application's own panels. All windows can be resized; the sizes above are what they open at.

## 3.2 The launch bar

The launch bar is a shortcut into the **SIMULATION** tile with parameters:

- **SEED** — the engagement to load. Any integer from 0 to 4,294,967,295. Default **20260719**, the "Standard Engagement (BLUFOR)" scenario.
- **MODE** — **orbit** or **tactical** (see [1.3](01-overview.md#13-orbit-mode-and-tactical-mode)).
- **autoplay** — when ticked, the engagement starts playing immediately at the Simulation window's default 4× speed; when unticked it opens paused at T+00:00.
- **LAUNCH** — opens the Simulation window with those settings.

![Launch bar with tactical selected](images/shell-tactical.png)
*Figure 3-2. The launch bar with MODE set to tactical.*

> [!TIP]
> To watch a specific battle from the Dashboard, you do not need the launch bar: every **WATCH ▸** link there opens the Simulation at the right seed and mode (Chapter 7).

## 3.3 The footer

The footer is the application's version stamp:

```text
app 0.2.1 · engine fpv-sim-mcp 0.3.0 · ui pin 7050617 · electron 44.0.0 · node 24.18.1 · chrome 152.0.7977.54
```

| Field | Meaning |
|---|---|
| `app` | The FPV Sim application version. |
| `engine fpv-sim-mcp` | The version of the bundled simulation engine — the code that actually runs every engagement, sweep and live session. |
| `ui pin` | The first seven characters of the fpv-sim commit whose three pages (Simulation, Dashboard, 3D Viewer) are bundled. Engine and UI are pinned as a pair and verified to agree tick for tick. |
| `electron`, `node`, `chrome` | The runtime versions. |

Quote the whole line when you report a problem.

## 3.4 Window behaviour worth knowing

- **Single instance.** Starting FPV Sim while it is already running does not open a second copy; it brings the existing launcher to the front.
- **Closing windows.** Closing a Simulation, Dashboard or panel window never stops anything running in the background: a sweep started in the Studies panel keeps running, and a Live Ops session keeps going. Reopen the panel to see its progress.
- **Closing the last window quits the application** — and *that* does stop a running sweep or live session. Keep the launcher open while long runs are in progress.
- **Links to the web** (for example **READ THE STUDY** in the Dashboard) open in your default browser, not inside the application.

## 3.5 The hidden menu and Developer Tools

FPV Sim keeps no log files. If you are asked for diagnostics, use the browser Developer Tools built into every window:

1. Click inside the window in question and press <kbd>Alt</kbd>.
   → *A menu bar appears at the top of the window.*
2. Choose **View ▸ Toggle Developer Tools** (or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>).
   → *A developer pane opens; its **Console** tab shows any error messages from that window.*

Press <kbd>Alt</kbd> again, or click elsewhere, to hide the menu bar.
