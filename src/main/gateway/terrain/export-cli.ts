/*
 * terrain-export under plain node (the developer checkout):
 *   npm run terrain-export -- --seed=20260719 --lat=21.35 --lon=-157.95 --geoid=<N> [--out=./export]
 * The installed app runs the same code as "FPV Sim.exe --terrain-export ...".
 * See cli.ts for the flags; both vertical-datum variants are written.
 */

import { runTerrainExportCli } from "./cli.js";

process.exit(runTerrainExportCli(process.argv.slice(2), console));
