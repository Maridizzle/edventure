import { describe, expect, it } from 'vitest';
import { ShaderMaterial } from 'three';
import { Door } from './Door';
import { candy } from '../content/scenes/candy';

/**
 * The gate rules. These are the ones that would strand him: a door that opens
 * twice, or a trigger that fires before the door has actually opened, drops him
 * into a new room without warning.
 */
function makeDoor(): Door {
  return new Door(candy, new ShaderMaterial(), { x: 0, z: -20, yaw: 0 }, 0, 0);
}

function openFully(d: Door): void {
  d.open();
  for (let i = 0; i < 200; i++) d.update(1 / 60);
}

describe('Door', () => {
  it('starts shut and un-enterable', () => {
    const d = makeDoor();
    expect(d.isOpen).toBe(false);
    expect(d.ready).toBe(false);
    // Standing right on it means nothing while it is shut.
    expect(d.reached(0, -20, 0.55)).toBe(false);
  });

  it('cannot be triggered until it has actually opened', () => {
    const d = makeDoor();
    d.open();
    // One frame in, it is open in intent but not yet passable.
    d.update(1 / 60);
    expect(d.isOpen).toBe(true);
    expect(d.reached(0, -20, 0.55)).toBe(false);
  });

  it('opens once and stays open', () => {
    const d = makeDoor();
    openFully(d);
    expect(d.ready).toBe(true);
    // A second open() must not restart the animation or re-fire anything.
    d.open();
    expect(d.ready).toBe(true);
  });

  it('is enterable only from close by', () => {
    const d = makeDoor();
    openFully(d);
    expect(d.reached(0, -20, 0.55)).toBe(true);
    expect(d.reached(0, -12, 0.55)).toBe(false);
    expect(d.reached(20, -20, 0.55)).toBe(false);
  });

  it('beckons on a repeating cadence, and never before it opens', () => {
    const d = makeDoor();
    // Shut: silent no matter how long we wait.
    let beckons = 0;
    for (let i = 0; i < 600; i++) if (d.update(1 / 60)) beckons++;
    expect(beckons).toBe(0);

    // Open: keeps pointing the way, because he may never have seen it open.
    d.open();
    for (let i = 0; i < 60 * 20; i++) if (d.update(1 / 60)) beckons++;
    expect(beckons).toBeGreaterThanOrEqual(3);
  });
});
