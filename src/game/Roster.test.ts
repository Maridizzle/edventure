import { describe, expect, it } from 'vitest';
import { Roster } from './Roster';
import { candyCollectibles } from '../content/collectibles/candy';
import { ALL_COLLECTIBLES, COLLECTIBLE_BY_ID } from '../content/collectibles';
import type { CollectibleDef } from '../content/types';

/**
 * The rules that make the parade the long game.
 *
 * The one that would actually hurt is double-counting: he meets a stegosaurus
 * in room three and again in room nine, and suddenly there are two of them
 * following him around. The other is the cap — it may hide a friend, never
 * take one away.
 */
const follows = candyCollectibles.filter((c) => c.onFind === 'follow');

describe('Roster', () => {
  it('is empty to begin with', () => {
    const r = new Roster();
    expect(r.size).toBe(0);
    expect(r.parade(8)).toEqual([]);
  });

  it('never counts the same kind twice', () => {
    const r = new Roster();
    const dino = follows[0]!;
    expect(r.add(dino)).toBe(true);
    // Meeting one again in a later room is perfectly ordinary.
    expect(r.add(dino)).toBe(false);
    expect(r.add({ ...dino })).toBe(false); // a different object, the same id
    expect(r.size).toBe(1);
  });

  it('survives everything a scene rebuild does to it', () => {
    // The roster is app-level precisely so that walking through a door cannot
    // touch it. Nothing here has a scene to destroy, which IS the property:
    // there is no scene-shaped handle to lose.
    const r = new Roster();
    for (const c of follows) r.add(c);
    const before = r.parade(8).map((d) => d.id);
    // Ten rooms' worth of rebuilding, reading the same list each time.
    for (let room = 0; room < 10; room++) {
      expect(r.parade(8).map((d) => d.id)).toEqual(before);
    }
    expect(r.size).toBe(follows.length);
  });

  it('puts the newest friend nearest him', () => {
    const r = new Roster();
    for (const c of follows.slice(0, 3)) r.add(c);
    const p = r.parade(8);
    expect(p[0]!.id).toBe(follows[2]!.id);
    expect(p[2]!.id).toBe(follows[0]!.id);
  });

  it('caps what is drawn, never what he owns', () => {
    const r = new Roster();
    for (const c of follows) r.add(c);
    expect(r.parade(2)).toHaveLength(2);
    // He still has all of them.
    expect(r.size).toBe(follows.length);
    expect(r.all).toHaveLength(follows.length);
  });

  it('leaves the ones that do not follow out of the parade', () => {
    const r = new Roster();
    for (const c of candyCollectibles) r.add(c);
    expect(r.size).toBe(candyCollectibles.length);
    for (const d of r.parade(99)) expect(d.onFind).toBe('follow');
  });

  it('counts families for the collection display', () => {
    const r = new Roster();
    for (const c of candyCollectibles) r.add(c);
    const counts = r.countByFamily();
    expect(counts.dino).toBe(2);
    expect(counts.vehicle).toBe(2);
  });

  it('handles a scene whose collectibles all follow', () => {
    const r = new Roster();
    const many: CollectibleDef[] = follows.map((c, i) => ({ ...c, id: `x${i}` }));
    for (const c of many) r.add(c);
    expect(r.parade(1000)).toHaveLength(many.length);
  });
});

/**
 * The save file is this list of ids and nothing else. What matters here is that
 * a round trip is lossless and order-preserving, because a five-year-old counts
 * his dinosaurs and will notice one missing.
 */
describe('saving and restoring the collection', () => {
  it('round-trips through ids with nothing lost or reordered', () => {
    const a = new Roster();
    for (const c of candyCollectibles) a.add(c);

    const saved = a.ids();
    const b = new Roster();
    b.restore(saved.map((id) => COLLECTIBLE_BY_ID.get(id)!));

    expect(b.ids()).toEqual(saved);
    expect(b.size).toBe(a.size);
  });

  it('every id it can save can be looked up again', () => {
    // A creature missing from the catalogue would come back as a hole in his
    // collection, silently, and only for the child who had found that one.
    const r = new Roster();
    for (const c of ALL_COLLECTIBLES) r.add(c);
    for (const id of r.ids()) expect(COLLECTIBLE_BY_ID.has(id), `${id} is not in the catalogue`).toBe(true);
  });

  it('reports only the ones that were actually new', () => {
    // The caller gives each returned def a body. Returning one he is already
    // walking around with would clone it.
    const r = new Roster();
    r.add(candyCollectibles[0]!);
    const added = r.restore(candyCollectibles.slice(0, 3));
    expect(added.map((d) => d.id)).toEqual([candyCollectibles[1]!.id, candyCollectibles[2]!.id]);
    expect(r.size).toBe(3);
  });

  it('survives a save written by an older version', () => {
    // Ids that no longer exist are skipped rather than taking the rest of the
    // collection down with them.
    const known = ['candy.stego', 'gone.forever', 'candy.snail']
      .map((id) => COLLECTIBLE_BY_ID.get(id))
      .filter((d): d is NonNullable<typeof d> => d !== undefined);
    const r = new Roster();
    r.restore(known);
    expect(r.ids()).toEqual(['candy.stego', 'candy.snail']);
  });
});
