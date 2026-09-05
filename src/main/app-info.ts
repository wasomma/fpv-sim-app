/*
 * The version facts the launcher footer, the About box and bug reports
 * share: app, engine, UI pin and runtime versions, plus the one-line
 * rendering of them.
 */

import { app } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";
import { type VersionFacts, versionLine } from "./menu-spec.js";
import { engineRoot, pinsFile } from "./paths.js";

export interface AppInfo extends VersionFacts {
  versionLine: string;
}

export function appInfo(): AppInfo {
  let pins: unknown = null;
  try {
    pins = JSON.parse(readFileSync(pinsFile(), "utf8"));
  } catch {
    /* vendor step not run yet */
  }
  let engineVersion = "unknown";
  try {
    // The dependency's exports map blocks specifier access to its
    // package.json — read it by filesystem path instead.
    engineVersion = (JSON.parse(readFileSync(path.join(engineRoot(), "package.json"), "utf8")) as { version: string })
      .version;
  } catch {
    /* dependency not installed */
  }
  const facts: VersionFacts = {
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? "unknown",
    node: process.versions.node,
    chrome: process.versions.chrome ?? "unknown",
    engineVersion,
    pins,
  };
  return { ...facts, versionLine: versionLine(facts) };
}
