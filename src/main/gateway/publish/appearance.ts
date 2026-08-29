/*
 * DIS platform appearance bits. The sim's binary states map narrowly:
 * destroyed GCS / downed or impacted drones show Damage=Destroyed, and a
 * kill additionally burns (flaming + smoke) for a configured window so
 * the effect reads in a 3D viewer. State bit 23 stays 0 (active) so
 * wrecks keep rendering.
 */

import { APPEARANCE_DESTROYED, APPEARANCE_FLAMING, APPEARANCE_SMOKE_EMITTING } from "../types.js";

export function appearanceFor(dead: boolean, sinceKillS: number | null, flamingS: number): number {
  let bits = 0;
  if (dead) bits |= APPEARANCE_DESTROYED;
  if (sinceKillS !== null && sinceKillS >= 0 && sinceKillS <= flamingS) {
    bits |= APPEARANCE_FLAMING | APPEARANCE_SMOKE_EMITTING;
  }
  return bits >>> 0;
}
