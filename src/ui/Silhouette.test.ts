import { describe, expect, it } from 'vitest';
import { silhouetteBounds } from './Silhouette';
import { ALL_COLLECTIBLES } from '../content/collectibles';

/**
 * The pips are the only place in the game where a picture is derived from a
 * recipe rather than built from it, and a silhouette that comes out blank is
 * invisible AND silent -- an empty slot for a creature he has actually found,
 * with nothing anywhere to say so. That is the failure this file exists for.
 */
describe('creature silhouettes', () => {
  it('every creature in the game projects to something visible', () => {
    for (const def of ALL_COLLECTIBLES) {
      const b = silhouetteBounds(def.shape);
      expect(b.shapes, `${def.id} projected to no shapes at all`).toBeGreaterThan(0);
      expect(b.width, `${def.id} has no width`).toBeGreaterThan(0.05);
      expect(b.height, `${def.id} has no height`).toBeGreaterThan(0.05);
      expect(Number.isFinite(b.width) && Number.isFinite(b.height)).toBe(true);
    }
  });

  it('never comes out as a sliver, whichever way it is turned', () => {
    // A shape more than eight times longer than it is tall reads as a stick at
    // 28 pixels. This is the check that would have caught the butterfly and the
    // coin, both of which were edge-on before the view became a choice.
    for (const def of ALL_COLLECTIBLES) {
      const b = silhouetteBounds(def.shape);
      const ratio = Math.max(b.width, b.height) / Math.min(b.width, b.height);
      expect(ratio, `${def.id} is a ${ratio.toFixed(1)}:1 sliver`).toBeLessThan(8);
    }
  });

  it('turns the flat ones to face us and leaves the long ones in profile', () => {
    // The whole point of scoring the two views. A butterfly seen side-on is a
    // twig; a brontosaurus seen head-on is a blob.
    const plane = (id: string): string =>
      silhouetteBounds(ALL_COLLECTIBLES.find((c) => c.id === id)!.shape).plane;

    expect(plane('candy.butterfly')).toBe('front');
    expect(plane('candy.coin')).toBe('front');
    expect(plane('candy.brontosaurus')).toBe('side');
    expect(plane('candy.digger')).toBe('side');
    expect(plane('friend.pup')).toBe('side');
  });

  it('expands repeats, so legs and plates are actually drawn', () => {
    // The stegosaurus is five plates and four legs on top of a body. If the
    // repeat expansion were skipped it would still produce a bounded shape --
    // just a much simpler and wronger one.
    const stego = ALL_COLLECTIBLES.find((c) => c.id === 'candy.stego')!;
    const parts = stego.shape.parts.length;
    expect(silhouetteBounds(stego.shape).shapes).toBeGreaterThan(parts);
  });
});
