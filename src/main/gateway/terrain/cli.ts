/*
 * The terrain-export command line, shared by the developer entry
 * (export-cli.ts under plain node) and the installed app
 * ("FPV Sim.exe --terrain-export ..."). Electron-free; the caller passes
 * argv and where to print.
 *
 *   --seed=<int> --lat=<deg> --lon=<deg> [--geoid=<N>] [--h0=0] [--rotation=0]
 *   [--out=./export] [--vdatum=egm96|ellipsoid]
 *
 * Both datum variants are written unless --vdatum picks one. Use
 * --key=value: a bare negative number after a space reads as a flag.
 */

import path from "node:path";
import { parseArgs } from "node:util";
import type { VerticalDatum } from "./geotiff.js";
import { VERTICAL_DATUMS, validateTerrainExportRequest, writeTerrainExportSet } from "./export-set.js";

export interface CliIo {
  log(line: string): void;
  error(line: string): void;
}

export const USAGE =
  "usage: --seed=<int> --lat=<deg> --lon=<deg> [--geoid=<N>] [--h0=<m>] [--rotation=<deg>] " +
  "[--out=<folder>] [--vdatum=egm96|ellipsoid]";

/** Run the export; returns the process exit code. */
export function runTerrainExportCli(argv: readonly string[], io: CliIo): number {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        seed: { type: "string" },
        lat: { type: "string" },
        lon: { type: "string" },
        h0: { type: "string", default: "0" },
        rotation: { type: "string", default: "0" },
        geoid: { type: "string", default: "0" },
        vdatum: { type: "string" },
        out: { type: "string", default: "./export" },
      },
      // Under Electron the argv also carries the app path and the mode
      // flag; neither is this tool's business.
      allowPositionals: true,
      strict: false,
    }));
  } catch (err) {
    io.error(err instanceof Error ? err.message : String(err));
    io.error(USAGE);
    return 1;
  }
  const str = (k: string): string | undefined => (typeof values[k] === "string" ? (values[k] as string) : undefined);
  if (str("seed") === undefined || str("lat") === undefined || str("lon") === undefined) {
    io.error(USAGE);
    return 1;
  }
  const check = validateTerrainExportRequest(Number(str("seed")), {
    lat0Deg: Number(str("lat")),
    lon0Deg: Number(str("lon")),
    h0M: Number(str("h0")),
    rotationDeg: Number(str("rotation")),
    geoidOffsetM: Number(str("geoid")),
  });
  if (!check.ok) {
    io.error(check.error);
    io.error(USAGE);
    return 1;
  }
  const vdatumArg = str("vdatum");
  let vdatums: readonly VerticalDatum[] = VERTICAL_DATUMS;
  if (vdatumArg !== undefined) {
    if (!(VERTICAL_DATUMS as readonly string[]).includes(vdatumArg)) {
      io.error(`--vdatum must be egm96 or ellipsoid (got ${vdatumArg})`);
      return 1;
    }
    vdatums = [vdatumArg as VerticalDatum];
  }

  let result;
  try {
    result = writeTerrainExportSet(check.seed, check.anchor, path.resolve(str("out")!), { vdatums });
  } catch (err) {
    io.error(`export failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  for (const w of result.warnings) io.error(`warning: ${w}`);
  for (const f of result.files) {
    if (f.layer !== "elevation") continue;
    const m = result.meta[f.vdatum!]!;
    io.log(
      `wrote ${f.path}: ${m.cols}x${m.rows} @ ${m.cellsizeM.toFixed(4)} m, EPSG:4326 pixels ` +
        `${m.pixelSizeDeg.lon.toFixed(7)}° x ${m.pixelSizeDeg.lat.toFixed(7)}°, heights ${m.verticalDatum} ` +
        `(${m.verticalCrs}), offset ${m.verticalOffsetM >= 0 ? "+" : ""}${m.verticalOffsetM.toFixed(2)} m`,
    );
  }
  io.log(`wrote ${result.files.length} files in ${result.dir} (elevation per datum with .json metadata, plus canopy)`);
  io.log(
    "VBS Geo: import as-is. VBS4's ocean is mean sea level and the sim's zero is sea level: keep the vdatum variant " +
      "whose coastline lands on the water line. Run the gateway with anchor.geoidOffsetM = the EGM96 undulation at the anchor.",
  );
  return 0;
}
