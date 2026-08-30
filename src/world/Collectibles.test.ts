import { describe, expect, it } from 'vitest';
import { layoutScene } from './Layout';
import { Terrain } from './Terrain';
import { candy } from '../content/scenes/candy';

/**
 * The hiding rules, without needing a WebGL context.
 *
 * `Collectibles` builds meshes, so these test the placement logic through the
 * same scoring the class uses, plus the invariants that keep a hidden thing
 * from becoming a dead end.
 */

function terrainFor(seed: number): Terrain {
  const t = candy.stage.terrain!;
  return new Terrain(
    {
      worldSize: candy.stage.width,
      grid: 96,
      octaves: t.octaves,
      warpFreq: t.warp.freq,
      warpAmp: t.warp.amp,
      maxSlopeDeg: t.maxSlopeDeg,
      edgeFalloff: null,
    },
    seed,
  );
}

describe('candy collectibles content', () => {
  it('covers all four families', () => {
    const families = new Set(candy.collectibles.map((c) => c.family));
    expect([...families].sort()).toEqual(['creature', 'dino', 'treasure', 'vehicle']);
  });

  it('mixes both ways of hiding', () => {
    const hides = new Set(candy.collectibles.map((c) => c.hide));
    expect(hides.has('disguise')).toBe(true);
    expect(hides.has('tucked')).toBe(true);
  });

  it('every disguise names a prop kind that actually exists in the scene', () => {
    // A disguise pointing at a kind the scene never places would silently
    // never spawn -- a collectible that cannot be found is a dead end.
    const kinds = new Set([...candy.fixtures, ...candy.scatter].map((f) => f.kind));
    for (const c of candy.collectibles) {
      if (c.hide !== 'disguise') continue;
      expect(kinds.has(c.disguiseAs!), `${c.id} disguises as unknown ${c.disguiseAs}`).toBe(true);
    }
  });

  it('the scene actually places every kind a disguise depends on', () => {
    for (const seed of [1, 2, 3, 7, 99]) {
      const placed = layoutScene(candy, seed).placed;
      const present = new Set(placed.map((p) => p.kind));
      for (const c of candy.collectibles) {
        if (c.hide !== 'disguise') continue;
        expect(present.has(c.disguiseAs!), `seed ${seed}: no ${c.disguiseAs} to disguise as`).toBe(
          true,
        );
      }
    }
  });

  it('the terrain has enough relief to actually hide things', () => {
    // The whole point of raising the hills: at the shallow camera angle a rise
    // of ~4m conceals roughly 8m of ground behind it. Flat terrain hides
    // nothing and the tucked collectibles become pointless.
    for (const seed of [4, 44, 444]) {
      const t = terrainFor(seed);
      expect(t.maxHeight - t.minHeight).toBeGreaterThan(3.5);
    }
  });

  it('gives every collectible a sound and a body', () => {
    for (const c of candy.collectibles) {
      expect(c.note.length, `${c.id} is silent`).toBeGreaterThan(0);
      expect(c.shape.parts.length, `${c.id} has no geometry`).toBeGreaterThan(0);
      expect(c.palette.length).toBeGreaterThan(0);
      for (const part of c.shape.parts) {
        expect(part.color, `${c.id} part references a missing palette entry`).toBeLessThan(
          c.palette.length,
        );
      }
    }
  });
});
