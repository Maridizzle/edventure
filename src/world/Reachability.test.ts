import { describe, expect, it } from 'vitest';
import { computeReachable } from './Reachability';
import { layoutScene } from './Layout';
import { AreaTransform } from '../core/AreaTransform';
import { candy } from '../content/scenes/candy';
import type { Placed } from './Layout';

const PLAYER_R = 0.55;

function solidOf(p: Placed): number {
  const d = p.isScatter ? candy.scatter[p.defIndex]! : candy.fixtures[p.defIndex]!;
  return (d.solid ?? 0) * p.scale;
}

function run(seed: number) {
  const t = AreaTransform.centered(candy.stage.width, 128);
  const { placed, spawn } = layoutScene(candy, seed);
  return { t, placed, spawn, reach: computeReachable(t, placed, solidOf, spawn, PLAYER_R) };
}

describe('computeReachable', () => {
  it('marks a healthy majority of the floor reachable', () => {
    // If solids were eating most of the room, the coverage target would be
    // technically achievable but miserable.
    for (const seed of [1, 42, 777]) {
      const { reach } = run(seed);
      const open = reach.reduce((a, v) => a + v, 0);
      expect(open / reach.length).toBeGreaterThan(0.6);
    }
  });

  it('never marks a cell inside a solid as reachable', () => {
    const { t, placed, reach } = run(2024);
    for (const p of placed) {
      const r = solidOf(p);
      if (r <= 0) continue;
      const cx = Math.round(t.cellX(p.x));
      const cz = Math.round(t.cellZ(p.z));
      if (cx < 0 || cz < 0 || cx >= t.cells || cz >= t.cells) continue;
      expect(reach[cz * t.cells + cx]).toBe(0);
    }
  });

  it('reaches the spawn point itself', () => {
    const { t, spawn, reach } = run(99);
    const cx = Math.round(t.cellX(spawn.x));
    const cz = Math.round(t.cellZ(spawn.z));
    expect(reach[cz * t.cells + cx]).toBe(1);
  });

  it('is one connected region — no isolated pockets counted', () => {
    // The whole point: floor he cannot walk to must not sit in the coverage
    // denominator, or the door threshold becomes unreachable and the game
    // acquires a dead end.
    for (let seed = 0; seed < 40; seed++) {
      const { t, reach } = run(seed);
      const n = t.cells;
      // Re-flood from the first reachable cell and confirm we find them all.
      const first = reach.indexOf(1);
      expect(first).toBeGreaterThanOrEqual(0);
      const seen = new Uint8Array(n * n);
      const stack = [first];
      seen[first] = 1;
      let count = 0;
      while (stack.length) {
        const i = stack.pop()!;
        count++;
        const x = i % n;
        const z = (i / n) | 0;
        const nb = [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, z > 0 ? i - n : -1, z < n - 1 ? i + n : -1];
        for (const j of nb) {
          if (j < 0 || seen[j] || reach[j] !== 1) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
      const total = reach.reduce((a: number, v) => a + v, 0);
      expect(count, `seed ${seed} has disconnected reachable cells`).toBe(total);
    }
  });
});
