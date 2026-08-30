/**
 * The moment the room is finished.
 *
 * Cheer, then run, then wait. Four seconds of it, and not one word anywhere:
 * his own animals jumping up and down and then bolting for a doorway is not
 * something a five-year-old needs told to him.
 *
 * Deliberately pure logic with no three.js in it, for two reasons. It can be
 * tested without a WebGL context, and — more importantly — the rule that it can
 * never strand him is a rule about this state machine alone. Every path leads
 * to `wait`, including the one where he has found nobody at all and there is no
 * parade to arrive.
 */

export type CelebrationPhase = 'idle' | 'cheer' | 'run' | 'wait';

/** Everybody leaps on the spot while the room pops around them. */
const CHEER_S = 1.2;
/**
 * The parade gets this long to reach the door before we stop waiting for it.
 *
 * Purely a safety net: a friend wedged behind a gumdrop must not leave the
 * celebration hanging half-finished forever.
 */
const RUN_TIMEOUT_S = 8;

/** Seconds between fireworks during the cheer. */
const PULSE_S = 0.26;

export class Celebration {
  private phase: CelebrationPhase = 'idle';
  private t = 0;
  private pulseT = 0;
  private pending = 0;

  /** Fires once on each phase change, never on the frames between. */
  onPhase: ((phase: CelebrationPhase) => void) | null = null;

  get current(): CelebrationPhase {
    return this.phase;
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** Once only. A room can be finished exactly once. */
  start(): void {
    if (this.phase !== 'idle') return;
    this.enter('cheer');
    // The first firework goes up immediately, not a quarter-second late.
    this.pulseT = 0;
    this.pending = 1;
  }

  private enter(phase: CelebrationPhase): void {
    this.phase = phase;
    this.t = 0;
    this.onPhase?.(phase);
  }

  /**
   * `allArrived` is the parade's answer to "is everyone at the door yet".
   * With no followers it is vacuously true, which is exactly what makes the
   * no-friends-yet path work rather than needing a special case.
   */
  update(dt: number, allArrived: boolean): void {
    if (this.phase === 'idle' || this.phase === 'wait') return;
    this.t += dt;

    if (this.phase === 'cheer') {
      this.pulseT -= dt;
      if (this.pulseT <= 0) {
        this.pulseT = PULSE_S;
        this.pending++;
      }
      if (this.t >= CHEER_S) this.enter('run');
      return;
    }

    if (allArrived || this.t >= RUN_TIMEOUT_S) this.enter('wait');
  }

  /** One queued firework, or false. Drained rather than sampled, so none is lost. */
  takePulse(): boolean {
    if (this.pending <= 0) return false;
    this.pending--;
    return true;
  }
}
