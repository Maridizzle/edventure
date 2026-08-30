import { describe, expect, it } from 'vitest';
import { Roster } from './Roster';
import { candyCollectibles } from '../content/collectibles/candy';
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
