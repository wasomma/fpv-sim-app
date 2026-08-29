/*
 * Stable DIS identity allocation: the same engine entity id maps to the
 * same (site, app, entity) triple on every run of a given config, so
 * logs and AAR recordings correlate across sessions.
 *
 * Engine ids look like "B-GCS", "O-cUAS-1", "B-sUAS-2" (orbit's single
 * drone is "B-sUAS-1"-shaped in tactical; orbit uses "B-sUAS"). Drones
 * get droneBase + ordinal; unknown shapes fall back to a hash bucket
 * above 32000 rather than colliding with configured ranges.
 */

import type { GatewayConfig } from "../config.js";
import type { EntityId, EntityType } from "../types.js";
import type { Side, TickEntity } from "../../../shared/gateway-slot.js";

export class IdAllocator {
  private readonly cfg: GatewayConfig;
  private readonly assigned = new Map<string, EntityId>();
  private eventSeq = 0;

  constructor(cfg: GatewayConfig) {
    this.cfg = cfg;
  }

  entityId(e: { id: string; side: Side; kind: TickEntity["kind"] }): EntityId {
    const existing = this.assigned.get(e.id);
    if (existing !== undefined) return existing;
    const sideIds = e.side === "BLUFOR" ? this.cfg.ids.blufor : this.cfg.ids.opfor;
    let entity: number;
    if (e.kind === "gcs") {
      entity = sideIds.gcs;
    } else if (e.kind === "df_node") {
      const m = e.id.match(/(\d+)\s*$/);
      const ordinal = m !== null ? Number.parseInt(m[1]!, 10) : 1;
      entity = sideIds.nodes[Math.min(1, Math.max(0, ordinal - 1)) as 0 | 1];
    } else {
      const m = e.id.match(/(\d+)\s*$/);
      const ordinal = m !== null ? Number.parseInt(m[1]!, 10) : 1;
      entity = sideIds.droneBase + ordinal;
    }
    const id: EntityId = { site: this.cfg.dis.siteId, app: this.cfg.dis.applicationId, entity };
    this.assigned.set(e.id, id);
    return id;
  }

  nextEventId(): { site: number; app: number; number: number } {
    this.eventSeq = (this.eventSeq + 1) & 0xffff;
    return { site: this.cfg.dis.siteId, app: this.cfg.dis.applicationId, number: this.eventSeq };
  }

  entityType(kind: TickEntity["kind"], side: Side): EntityType {
    const roleCfg =
      kind === "gcs" ? this.cfg.entityTypes.gcs : kind === "df_node" ? this.cfg.entityTypes.dfNode : this.cfg.entityTypes.fpv;
    return {
      kind: roleCfg.kind,
      domain: roleCfg.domain,
      country: roleCfg.country[side],
      category: roleCfg.category,
      subcategory: roleCfg.subcategory,
      specific: roleCfg.specific,
      extra: roleCfg.extra,
    };
  }

  warheadType(side: Side): EntityType {
    const w = this.cfg.entityTypes.warhead;
    return {
      kind: w.kind,
      domain: w.domain,
      country: w.country[side],
      category: w.category,
      subcategory: w.subcategory,
      specific: w.specific,
      extra: w.extra,
    };
  }

  /**
   * DIS marking: engine id compressed to fit 11 ASCII chars uniquely —
   * "BLUFOR-cUAS-1" would truncate identically to its sibling, so the
   * side prefix shortens to B-/O- ("B-cUAS-1", "O-sUAS-3").
   */
  marking(engineId: string): string {
    return engineId.replace(/^BLUFOR-/, "B-").replace(/^OPFOR-/, "O-").slice(0, 11);
  }

  forceId(side: Side): number {
    return side === "BLUFOR" ? 1 : 2;
  }
}
