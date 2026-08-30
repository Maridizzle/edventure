import { describe, expect, it } from 'vitest';
import { Celebration, type CelebrationPhase } from './Celebration';

/**
 * The one rule: it always finishes.
 *
 * A celebration stuck in "run" forever is a room that never settles and a door
 * whose crowd never arrives, and the state machine is the only place that can
 * be guaranteed. The zero-followers path is not an edge case — it is the very
 * first room he ever finishes.
 */
function run(c: Celebration, seconds: number, allArrived: boolean): void {
  for (let i = 0; i < seconds * 60; i++) c.update(1 / 60, allArrived);
}

describe('Celebration', () => {
  it('does nothing until the room is finished', () => {
    const c = new Celebration();
    expect(c.current).toBe('idle');
    expect(c.active).toBe(false);
    run(c, 10, true);
    expect(c.current).toBe('idle');
    expect(c.takePulse()).toBe(false);
  });

  it('reaches waiting with no followers at all', () => {
    const c = new Celebration();
    c.start();
    expect(c.current).toBe('cheer');
    // Nobody to arrive: `allArrived` is vacuously true from the first frame.
    run(c, 3, true);
    expect(c.current).toBe('wait');
  });

  it('reaches waiting even if nobody ever arrives', () => {
    const c = new Celebration();
    c.start();
    // A friend wedged behind a gumdrop must not strand the celebration.
    run(c, 30, false);
    expect(c.current).toBe('wait');
  });

  it('cheers before it runs, and runs before it waits', () => {
    const seen: CelebrationPhase[] = [];
    const c = new Celebration();
    c.onPhase = (p) => seen.push(p);
    c.start();
    run(c, 0.5, true);
    expect(c.current).toBe('cheer');
    run(c, 3, true);
    expect(seen).toEqual(['cheer', 'run', 'wait']);
  });

  it('can only be started once', () => {
    const seen: CelebrationPhase[] = [];
    const c = new Celebration();
    c.onPhase = (p) => seen.push(p);
    c.start();
    c.start();
    run(c, 3, true);
    c.start();
    expect(seen).toEqual(['cheer', 'run', 'wait']);
  });

  it('throws fireworks all through the cheer, and stops after it', () => {
    const c = new Celebration();
    c.start();
    let pulses = 0;
    // One goes up immediately -- not a quarter-second after the door opens.
    while (c.takePulse()) pulses++;
    expect(pulses).toBe(1);

    for (let i = 0; i < 1.2 * 60; i++) {
      c.update(1 / 60, false);
      while (c.takePulse()) pulses++;
    }
    expect(pulses).toBeGreaterThanOrEqual(4);

    const after = pulses;
    run(c, 5, true);
    while (c.takePulse()) pulses++;
    expect(pulses).toBe(after);
  });
});
