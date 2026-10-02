/*
 * Live-session MCP tools, registered on top of fpv-sim-mcp's five batch
 * tools via the host's ServerExtender. The tools close over the
 * main-process session singleton, so the stateless per-request MCP
 * servers stay correct.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  liveConfigureGateway,
  liveGatewayStatus,
  livePause,
  liveResume,
  liveSetSpeed,
  liveSnapshot,
  liveStart,
  liveStatus,
  liveStop,
} from "../sessions/session-manager.js";
import { exportTerrainSet } from "../terrain-export.js";

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export function registerLiveTools(server: McpServer): void {
  server.registerTool(
    "live_start_session",
    {
      title: "Start a live real-time session",
      description:
        "Start a wall-clock-paced live engagement in the app (one at a time). The engine steps its fixed 0.1 s " +
        "ticks at the given speed factor; a session that runs to its end produces the identical result as the " +
        "batch run_engagement of the same seed/mode/overrides. Poll live_session_status / live_get_snapshot to " +
        "follow it. Speed 1 = real time (use for DIS interop); up to 60 for accelerated replays.",
      inputSchema: {
        seed: z.number().int().min(0).max(4294967295),
        mode: z.enum(["orbit", "tactical"]).default("orbit"),
        config_overrides: z
          .record(z.unknown())
          .optional()
          .describe("Partial CONFIG overrides, same shape the batch tools accept (see get_config_schema)."),
        speed: z.number().min(0.25).max(60).default(1).describe("Wall-clock speed factor."),
        max_sim_s: z.number().min(60).max(14400).default(3600),
        gateway: z
          .record(z.unknown())
          .optional()
          .describe(
            "DIS gateway config for this session (partial; merged over defaults — network, dis IDs, anchor, " +
              "entity types, dead reckoning, emissions). Omit to use the config staged via " +
              "live_configure_gateway, or run gateway-less.",
          ),
      },
    },
    async ({ seed, mode, config_overrides, speed, max_sim_s, gateway }) =>
      json(liveStart({ seed, mode, overrides: config_overrides, speed, maxSimS: max_sim_s, gateway })),
  );

  server.registerTool(
    "live_configure_gateway",
    {
      title: "Stage the DIS gateway config",
      description:
        "Validate and stage a DIS gateway configuration (partial JSON merged over defaults) for the NEXT live " +
        "session: network mode/port, exercise & site/app IDs, geo anchor (lat/lon/alt/rotation of the sim " +
        "origin), entity-type mapping, dead-reckoning thresholds, notional emitter parameters, sim-management " +
        "behavior. Returns precise per-path errors on invalid values.",
      inputSchema: { config: z.record(z.unknown()) },
    },
    async ({ config }) => json(liveConfigureGateway(config)),
  );

  server.registerTool(
    "live_stop_session",
    {
      title: "Stop the live session",
      description:
        "Stop the running live session and return its (partial or complete) EngagementResult plus the stop reason.",
      inputSchema: {},
    },
    async () => json(await liveStop()),
  );

  server.registerTool(
    "live_session_status",
    {
      title: "Live session status",
      description:
        "State of the live session host: idle/running/paused/ended, sim clock and tick, phase, speed, pacing lag, " +
        "winner when decided, and gateway status.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => json(liveStatus()),
  );

  server.registerTool(
    "live_get_snapshot",
    {
      title: "Live state snapshot",
      description:
        "Latest entity-level snapshot of the live session (positions, headings, battery, emitters keyed, fixes) " +
        "plus the event log from the given cursor. Pass next_cursor back to page events without repeats.",
      inputSchema: {
        events_after: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ events_after }) => json(liveSnapshot(events_after)),
  );

  server.registerTool(
    "live_pause",
    { title: "Pause the live session", description: "Pause wall-clock pacing (sim state holds).", inputSchema: {} },
    async () => json({ ok: livePause(), status: liveStatus() }),
  );
  server.registerTool(
    "live_resume",
    { title: "Resume the live session", description: "Resume wall-clock pacing.", inputSchema: {} },
    async () => json({ ok: liveResume(), status: liveStatus() }),
  );
  server.registerTool(
    "live_set_speed",
    {
      title: "Change live session speed",
      description:
        "Change the wall-clock speed factor mid-session. Pacing only — determinism is unaffected. (When the DIS " +
        "gateway is armed, published kinematics rescale to the wall-apparent frame with a refresh volley.)",
      inputSchema: { speed: z.number().min(0.25).max(60) },
    },
    async ({ speed }) => json(liveSetSpeed(speed)),
  );

  server.registerTool(
    "live_gateway_status",
    {
      title: "Interop gateway status",
      description:
        "DIS gateway status: state, PDU counters by type (tx/rx), peers heard, external overlay track count, " +
        "last error, and whether a config is staged for the next session.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => json(liveGatewayStatus()),
  );

  server.registerTool(
    "live_export_terrain",
    {
      title: "Export a seed's terrain for VBS Geo",
      description:
        "Write a seed's procedural terrain as GeoTIFFs for VBS Geo's DEM import so VBS4's terrain correlates " +
        "with the engagement: single-band Float32, geographic WGS 84 (EPSG:4326), 200x200 pixels of 20.1 m over " +
        "the 4 km box, nodata -9999. Writes the whole set: the elevation in both vertical datums " +
        "(seed-<n>-elevation-egm96.tif = mean-sea-level heights, seed-<n>-elevation-ellipsoid.tif = plus the " +
        "anchor's geoidOffsetM) each with a .json of the grid's metadata, and seed-<n>-canopy.tif (density 0..1). " +
        "VBS Geo ignores the vertical tag: import both and keep the one whose coastline lands on VBS4's water " +
        "line. The anchor defaults to the staged gateway config's (live_configure_gateway), so terrain and DIS " +
        "stream share one place on Earth.",
      inputSchema: {
        seed: z.number().int().min(0).max(4294967295),
        anchor: z
          .object({
            lat0Deg: z.number(),
            lon0Deg: z.number(),
            h0M: z.number().optional(),
            rotationDeg: z.number().optional(),
            geoidOffsetM: z.number().optional(),
          })
          .optional()
          .describe(
            "Anchor to use instead of the staged gateway config's: south-west corner of the box (degrees), " +
              "h0M and rotationDeg as in Appendix C, geoidOffsetM = EGM96 undulation at the anchor (metres).",
          ),
        out_dir: z
          .string()
          .optional()
          .describe("Absolute folder to write into (created if needed); default the profile's terrain folder."),
      },
    },
    async ({ seed, anchor, out_dir }) => json(exportTerrainSet({ seed, anchor, dir: out_dir })),
  );
}
