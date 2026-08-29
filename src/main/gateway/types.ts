/*
 * Shared vocabulary of the DIS gateway: codec-facing PDU models (SI
 * units, WGS-84 ECEF meters, radians) and the identifiers DIS traffics
 * in. The publisher builds these from engine TickViews via the geo
 * pipeline; the codec encodes/decodes them byte-exactly; nothing in here
 * imports Electron or the engine.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface EntityId {
  site: number;
  app: number;
  entity: number;
}

export interface EventId {
  site: number;
  app: number;
  number: number;
}

/** SISO-REF-010 7-tuple. */
export interface EntityType {
  kind: number;
  domain: number;
  country: number;
  category: number;
  subcategory: number;
  specific: number;
  extra: number;
}

/** DIS Euler angles: body relative to the ECEF axes, radians (psi, theta, phi). */
export interface DisEuler {
  psi: number;
  theta: number;
  phi: number;
}

export const PduType = {
  EntityState: 1,
  Fire: 2,
  Detonation: 3,
  StartResume: 13,
  StopFreeze: 14,
  ElectromagneticEmission: 23,
} as const;
export type PduTypeValue = (typeof PduType)[keyof typeof PduType];

export const ProtocolFamily = {
  EntityInformation: 1,
  Warfare: 2,
  SimulationManagement: 5,
  DistributedEmissionRegeneration: 6,
} as const;

export const DrAlgorithm = {
  Other: 0,
  Static: 1,
  /** DRM(F,P,W): fixed orientation, constant velocity, world coords. */
  Fpw: 2,
  /** DRM(R,V,W): rotating, rate of velocity (accel), world coords. */
  Rvw: 4,
} as const;

export interface PduHeader {
  protocolVersion: number;
  exerciseId: number;
  pduType: number;
  protocolFamily: number;
  /** Raw 32-bit DIS timestamp field (already shifted+flagged). */
  timestamp: number;
  length: number;
}

export interface EspduModel {
  header: PduHeader;
  entityId: EntityId;
  forceId: number;
  entityType: EntityType;
  altEntityType: EntityType;
  /** ECEF m/s. */
  linearVelocity: Vec3;
  /** ECEF meters. */
  location: Vec3;
  orientation: DisEuler;
  appearance: number;
  drAlgorithm: number;
  /** ECEF m/s^2 (DR). */
  linearAcceleration: Vec3;
  /** Body-axis rad/s (DR). */
  angularVelocity: Vec3;
  /** Up to 11 ASCII chars. */
  marking: string;
  capabilities: number;
}

export interface EmitterBeamModel {
  beamIdNumber: number;
  parameterIndex: number;
  frequencyHz: number;
  frequencyRangeHz: number;
  erpDbm: number;
  prfHz: number;
  pulseWidthUs: number;
  azimuthCenterRad: number;
  azimuthSweepRad: number;
  elevationCenterRad: number;
  elevationSweepRad: number;
  sweepSync: number;
  beamFunction: number;
  highDensityTrackJam: number;
  jammingModeSequence: number;
}

export interface EmitterSystemModel {
  emitterName: number;
  emitterFunction: number;
  emitterIdNumber: number;
  /** Entity-relative meters (body frame). */
  location: Vec3;
  beams: EmitterBeamModel[];
}

export interface EmissionModel {
  header: PduHeader;
  emittingEntityId: EntityId;
  eventId: EventId;
  /** 0 = heartbeat/state update, 1 = changed data update. */
  stateUpdateIndicator: number;
  systems: EmitterSystemModel[];
}

export interface BurstDescriptor {
  munitionType: EntityType;
  warhead: number;
  fuse: number;
  quantity: number;
  rate: number;
}

export interface FireModel {
  header: PduHeader;
  firingEntityId: EntityId;
  targetEntityId: EntityId;
  munitionEntityId: EntityId;
  eventId: EventId;
  fireMissionIndex: number;
  /** ECEF meters. */
  location: Vec3;
  burst: BurstDescriptor;
  /** ECEF m/s. */
  velocity: Vec3;
  rangeM: number;
}

export interface DetonationModel {
  header: PduHeader;
  firingEntityId: EntityId;
  targetEntityId: EntityId;
  munitionEntityId: EntityId;
  eventId: EventId;
  /** ECEF m/s. */
  velocity: Vec3;
  /** ECEF meters. */
  location: Vec3;
  burst: BurstDescriptor;
  /** Meters, target body frame (zeros when no target). */
  locationRelativeToEntity: Vec3;
  detonationResult: number;
}

export interface ClockTime {
  hour: number;
  timePastHour: number;
}

export interface StartResumeModel {
  header: PduHeader;
  originatingEntityId: EntityId;
  receivingEntityId: EntityId;
  realWorldTime: ClockTime;
  simulationTime: ClockTime;
  requestId: number;
}

export interface StopFreezeModel {
  header: PduHeader;
  originatingEntityId: EntityId;
  receivingEntityId: EntityId;
  realWorldTime: ClockTime;
  reason: number;
  frozenBehavior: number;
  requestId: number;
}

export type AnyPdu =
  | { kind: "espdu"; pdu: EspduModel }
  | { kind: "emission"; pdu: EmissionModel }
  | { kind: "fire"; pdu: FireModel }
  | { kind: "detonation"; pdu: DetonationModel }
  | { kind: "startResume"; pdu: StartResumeModel }
  | { kind: "stopFreeze"; pdu: StopFreezeModel };

export const NO_ENTITY: EntityId = { site: 0, app: 0, entity: 0 };
export const ALL_ENTITIES = 0xffff;

/** DIS destroyed appearance for platforms: damage bits 3-4 = 3. */
export const APPEARANCE_DESTROYED = 3 << 3;
export const APPEARANCE_FLAMING = 1 << 15;
export const APPEARANCE_SMOKE_EMITTING = 2 << 5;

export const DetonationResult = {
  EntityImpact: 1,
  GroundImpact: 3,
} as const;

export const StopFreezeReason = {
  Recess: 1,
  Termination: 2,
} as const;
