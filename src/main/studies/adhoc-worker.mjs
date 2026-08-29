/*
 * Worker for the parallel ad-hoc runner: runs one engagement per message,
 * posts the result back with the event log stripped (the aggregation
 * never reads it, and it is ~99% of the payload). A null message means
 * no more work.
 */

import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

const engine = await import(pathToFileURL(workerData.enginePath).href);

parentPort.on("message", (seed) => {
  if (seed === null) {
    parentPort.close();
    return;
  }
  const result = engine.runEngagement(seed, workerData.overrides, { mode: workerData.mode });
  result.events = [];
  parentPort.postMessage({ seed, result });
});
