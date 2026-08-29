/*
 * Wall-clock pacer for live sessions.
 *
 * Sim time is DEFINED as ticks x 0.1 s; the wall clock only decides when
 * the next step() runs. The pacer answers one question — "how many ticks
 * should have elapsed by wall time T?" — via an anchor (tick count +
 * wall ms) that re-bases on every speed change, pause, and resume, so
 * rate changes never retroactively re-price past ticks. The session host
 * bounds catch-up per wakeup and reports lag; the pacer itself never
 * skips or invents ticks, which is what keeps a live run's buildResult()
 * deep-equal to the batch runEngagement() of the same inputs.
 */

export const TICK_S = 0.1;

export class TickPacer {
  private anchorTick = 0;
  private anchorWallMs: number;
  private speedFactor: number;
  private paused = false;

  constructor(nowMs: number, speed: number) {
    this.anchorWallMs = nowMs;
    this.speedFactor = speed;
  }

  get speed(): number {
    return this.speedFactor;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Ticks that should have completed by wall time nowMs. */
  targetTick(nowMs: number): number {
    if (this.paused) return this.anchorTick;
    const elapsedS = Math.max(0, nowMs - this.anchorWallMs) / 1000;
    return this.anchorTick + Math.floor((elapsedS * this.speedFactor) / TICK_S);
  }

  /** Re-anchor after the host actually performed steps up to doneTick. */
  private rebase(doneTick: number, nowMs: number): void {
    this.anchorTick = doneTick;
    this.anchorWallMs = nowMs;
  }

  setSpeed(speed: number, doneTick: number, nowMs: number): void {
    this.rebase(doneTick, nowMs);
    this.speedFactor = speed;
  }

  pause(doneTick: number, nowMs: number): void {
    this.rebase(doneTick, nowMs);
    this.paused = true;
  }

  resume(doneTick: number, nowMs: number): void {
    this.rebase(doneTick, nowMs);
    this.paused = false;
  }

  /** Wall-clock lag in ms between where the sim is and where it should be. */
  lagMs(doneTick: number, nowMs: number): number {
    const behind = this.targetTick(nowMs) - doneTick;
    if (behind <= 0) return 0;
    return Math.round((behind * TICK_S * 1000) / this.speedFactor);
  }
}
