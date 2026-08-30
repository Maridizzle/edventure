import { describe, expect, it } from 'vitest';
import { doorApron, layoutScene } from './Layout';
import { candy } from '../content/scenes/candy';

describe('layoutScene', () => {
  it('is deterministic for a given seed', () => {
    const a = layoutScene(candy, 12345);
    const b = layoutScene(candy, 12345);
    expect(a.placed.length).toBe(b.placed.length);
    for (let i = 0; i < a.placed.length; i++) {
      expect(a.placed[i]).toEqual(b.placed[i]);
    }
  });

  it('produces different layouts for different seeds', () => {
    const a = layoutScene(candy, 1);
    const b = layoutScene(candy, 2);
    const same = a.placed.every(
      (p, i) => b.placed[i] && p.x === b.placed[i]!.x && p.z === b.placed[i]!.z,
    );
    expect(same).toBe(false);
  });

  it('never overlaps two footprints', () => {
    for (const seed of [1, 7, 42, 999, 123456]) {
      const { placed } = layoutScene(candy, seed);
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i]!;
          const b = placed[j]!;
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          expect(d).toBeGreaterThanOrEqual(a.footprint + b.footprint - 1e-6);
        }
      }
    }
  });

  it('keeps the door frontage clear across many seeds', () => {
    // The way out must never be visually buried.
    const halfX = candy.stage.width / 2;
    for (let seed = 0; seed < 200; seed++) {
      const { placed, door } = layoutScene(candy, seed);
      const { minX, maxX, minZ, maxZ } = doorApron(door, halfX);
      for (const p of placed) {
        const intrudes =
          p.x + p.footprint > minX &&
          p.x - p.footprint < maxX &&
          p.z + p.footprint > minZ &&
          p.z - p.footprint < maxZ;
        expect(intrudes, `seed ${seed}: ${p.kind} blocks the way out`).toBe(false);
      }
    }
  });

  it('keeps everything inside the stage', () => {
    const halfX = candy.stage.width / 2;
    const halfZ = candy.stage.depth / 2;
    for (const seed of [3, 17, 256]) {
      for (const p of layoutScene(candy, seed).placed) {
        expect(p.x - p.footprint).toBeGreaterThanOrEqual(-halfX);
        expect(p.x + p.footprint).toBeLessThanOrEqual(halfX);
        expect(p.z - p.footprint).toBeGreaterThanOrEqual(-halfZ);
        expect(p.z + p.footprint).toBeLessThanOrEqual(halfZ);
      }
    }
  });

  it('always leaves the spawn point in open floor', () => {
    // He must never arrive embedded in a gumdrop and get shoved out by the
    // collision pass.
    for (let seed = 0; seed < 200; seed++) {
      const { placed, spawn } = layoutScene(candy, seed);
      for (const p of placed) {
        const d = Math.hypot(p.x - spawn.x, p.z - spawn.z);
        expect(d, `seed ${seed}: ${p.kind} sits on the spawn`).toBeGreaterThan(p.footprint);
      }
    }
  });

  it('places the big fixtures, not just scatter', () => {
    const { placed } = layoutScene(candy, 2024);
    const fixtures = placed.filter((p) => !p.isScatter);
    // A room reads from its big objects. If these get dropped the scene is a
    // field again, so this is the test that actually matters.
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
    for (const kind of ['lollipop', 'cupcake', 'gumdrop', 'candycane']) {
      expect(fixtures.some((p) => p.kind === kind), `missing ${kind}`).toBe(true);
    }
  });
});
