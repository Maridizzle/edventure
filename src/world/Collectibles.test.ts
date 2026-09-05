import { describe, expect, it } from 'vitest';
import { Group, ShaderMaterial } from 'three';
import { layoutScene } from './Layout';
import { Terrain } from './Terrain';
import { Props } from './Props';
import { Collectibles, type FoundEvent } from './Collectibles';
import { AreaTransform } from '../core/AreaTransform';
import { candy } from '../content/scenes/candy';
import { starterFriend } from '../content/collectibles/friend';

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

/** A real room, meshes and all. No GL context needed to build geometry. */
function room(seed: number): { props: Props; collectibles: Collectibles } {
  const terrain = terrainFor(seed);
  const placed = layoutScene(candy, seed).placed;
  const props = new Props(candy, placed, terrain, new ShaderMaterial(), new Group(), 0);
  const collectibles = new Collectibles(
    candy,
    seed,
    terrain,
    placed,
    props,
    new ShaderMaterial(),
    new Group(),
    0,
    candy.stage.width / 2,
  );
  return { props, collectibles };
}

describe('the warmth field', () => {
  /**
   * The hot/cold guidance, which for the whole life of the feature was baked
   * correctly and then multiplied by paint coverage in the ground shader --
   * making it invisible on every bit of floor he had not already driven over,
   * which is exactly where hidden things are. These pin the CPU half.
   */
  it('glows around every unfound thing', () => {
    const { props, collectibles } = room(11);
    const transform = AreaTransform.centered(candy.stage.width, 96);
    const field = new Uint8Array(96 * 96 * 2);
    collectibles.bakeWarmth(field, transform);

    for (const h of collectibles.items) {
      // cellX/cellZ are fractional; the field is indexed by whole cells.
      const i = (Math.floor(transform.cellZ(h.z)) * 96 + Math.floor(transform.cellX(h.x))) * 2 + 1;
      expect(field[i], `no glow over ${h.def.id}`).toBeGreaterThan(0);
    }
    props.dispose();
    collectibles.dispose();
  });

  it('goes out once he has found it, and leaves the rest alone', () => {
    const { props, collectibles } = room(11);
    const transform = AreaTransform.centered(candy.stage.width, 96);
    const field = new Uint8Array(96 * 96 * 2);

    const target = collectibles.items[0]!;
    const at = (h: { x: number; z: number }) =>
      field[(Math.floor(transform.cellZ(h.z)) * 96 + Math.floor(transform.cellX(h.x))) * 2 + 1]!;

    target.found = true;
    collectibles.bakeWarmth(field, transform);
    // Its own glow is gone -- unless a neighbour's disc happens to reach it,
    // which is legitimate, so only assert the ones far from everything else.
    const others = collectibles.items.filter((h) => h !== target && !h.found);
    const isolated = others.every((h) => Math.hypot(h.x - target.x, h.z - target.z) > 16);
    if (isolated) expect(at(target)).toBe(0);
    for (const h of others) expect(at(h), `${h.def.id} lost its glow too`).toBeGreaterThan(0);

    props.dispose();
    collectibles.dispose();
  });

  it('warmthAt agrees with what it baked', () => {
    const { props, collectibles } = room(11);
    const h = collectibles.items[0]!;
    expect(collectibles.warmthAt(h.x, h.z)).toBeGreaterThan(0.9);
    expect(collectibles.warmthAt(h.x + 40, h.z)).toBe(0);
    props.dispose();
    collectibles.dispose();
  });
});

describe('hiding inside several props', () => {
  it('claims more than one prop, and never the same one twice', () => {
    for (const seed of [3, 19, 404]) {
      const { props, collectibles } = room(seed);
      const seen = new Set<number>();
      for (const h of collectibles.items) {
        if (h.def.hide !== 'disguise') {
          expect(h.propIds, `${h.def.id} is tucked and should claim nothing`).toHaveLength(0);
          continue;
        }
        expect(h.propIds.length, `${h.def.id} claimed nothing`).toBeGreaterThan(1);
        for (const id of h.propIds) {
          expect(seen.has(id), `prop ${id} claimed by two creatures`).toBe(false);
          seen.add(id);
        }
      }
      props.dispose();
      collectibles.dispose();
    }
  });

  it('hatches out of the one he touched, and hides only that one', () => {
    const { props, collectibles } = room(3);
    const h = collectibles.items.find((i) => i.def.hide === 'disguise')!;
    expect(h.propIds.length).toBeGreaterThan(1);

    const touched = h.propIds[1]!; // deliberately NOT the first claim
    const hidden: number[] = [];
    const out: FoundEvent[] = [];
    // The prop's own position, so the creature appears where he actually is.
    collectibles.onPropPainted(
      { id: touched, x: 12.5, y: 1.25, z: -7.5, note: null, color: 0 },
      out,
      (id) => hidden.push(id),
    );

    expect(out).toHaveLength(1);
    expect(out[0]!.x).toBe(12.5);
    expect(out[0]!.z).toBe(-7.5);
    // Its siblings stay ordinary props: the room must not visibly lose scenery.
    expect(hidden).toEqual([touched]);

    // And it cannot be found a second time out of another of its claims.
    out.length = 0;
    collectibles.onPropPainted(
      { id: h.propIds[0]!, x: 0, y: 0, z: 0, note: null, color: 0 },
      out,
      (id) => hidden.push(id),
    );
    expect(out).toHaveLength(0);
    expect(hidden).toEqual([touched]);

    props.dispose();
    collectibles.dispose();
  });
});

describe('the friend he starts with', () => {
  it('is hidden nowhere, because he already has it', () => {
    expect(starterFriend.hide).toBe('given');
    expect(starterFriend.onFind).toBe('follow');
  });

  it('appears in no scene list, so the world never places a second copy', () => {
    // A duplicate would not clone a follower -- the roster dedupes by id -- but
    // finding it would fire fireworks and a sound for a creature already
    // walking behind him.
    for (const c of candy.collectibles) expect(c.id).not.toBe(starterFriend.id);
  });

  it('is skipped even if someone does drop it into a scene', () => {
    const scene = { ...candy, collectibles: [...candy.collectibles, starterFriend] };
    const terrain = terrainFor(5);
    const placed = layoutScene(candy, 5).placed;
    const props = new Props(candy, placed, terrain, new ShaderMaterial(), new Group(), 0);
    const collectibles = new Collectibles(
      scene,
      5,
      terrain,
      placed,
      props,
      new ShaderMaterial(),
      new Group(),
      0,
      candy.stage.width / 2,
    );
    for (const h of collectibles.items) expect(h.def.id).not.toBe(starterFriend.id);
    props.dispose();
    collectibles.dispose();
  });
});

describe('what the collection row counts', () => {
  /**
   * The pip row draws one slot per entry in `items`, and every one of those
   * slots has to be fillable. A slot for something that was never placed is a
   * permanent empty box, and he will keep combing the room for a creature that
   * does not exist in it.
   */
  it('every slot in the row can actually be filled', () => {
    for (const seed of [2, 33, 512]) {
      const { props, collectibles } = room(seed);
      expect(collectibles.items.length).toBeGreaterThan(0);
      for (const h of collectibles.items) {
        expect(h.def.hide, 'a given creature must never be placed').not.toBe('given');
        if (h.def.hide === 'disguise') {
          expect(h.propIds.length, `${h.def.id} hides in no prop`).toBeGreaterThan(0);
        }
      }
      props.dispose();
      collectibles.dispose();
    }
  });

  it('never claims more slots than the scene actually placed', () => {
    // `def.collectibles.length` over-counts: it includes `given` creatures and
    // any whose placement failed. `items.length` is the honest denominator.
    for (const seed of [2, 33, 512]) {
      const { props, collectibles } = room(seed);
      expect(collectibles.items.length).toBeLessThanOrEqual(candy.collectibles.length);
      expect(collectibles.foundCount).toBe(0);
      props.dispose();
      collectibles.dispose();
    }
  });
});
