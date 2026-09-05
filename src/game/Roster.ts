import type { CollectibleDef } from '../content/types';

/**
 * Everyone he has found, for as long as the app is open.
 *
 * This lives at APP level, next to the audio engine, and that placement is the
 * entire point: a scene is thrown away every time he walks through a door, so
 * a list of friends owned by the scene would reset every couple of minutes.
 * Friends that survive a door are what turns collecting into the long game.
 *
 * It holds pure content data and imports nothing from the engine, so the parade
 * can be reasoned about — and tested — without a WebGL context.
 */
export class Roster {
  /** Insertion-ordered, oldest friend first. */
  private order: CollectibleDef[] = [];
  private seen = new Set<string>();

  /**
   * Returns true only the first time. Finding the same kind again in a later
   * room is a perfectly ordinary thing to do and must not clone anybody.
   */
  add(def: CollectibleDef): boolean {
    if (this.seen.has(def.id)) return false;
    this.seen.add(def.id);
    this.order.push(def);
    return true;
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  get size(): number {
    return this.order.length;
  }

  /** Everything found, in the order he found it. */
  get all(): readonly CollectibleDef[] {
    return this.order;
  }

  /**
   * The parade, newest friend nearest him.
   *
   * `onFind` is content data: `follow` walks behind him, `collect` flies away,
   * `park` stays where it was. Only followers are bodies that need carrying
   * from room to room.
   *
   * `limit` caps what is DRAWN, never what he owns — he must never lose a
   * friend he found, and the tail beyond the cap is simply out of sight.
   */
  parade(limit: number): CollectibleDef[] {
    const followers = this.order.filter((d) => d.onFind === 'follow');
    const tail = followers.slice(Math.max(0, followers.length - limit));
    // Newest first, so a friend found a minute ago is the one at his heels.
    return tail.reverse();
  }

  /**
   * The ids he owns, oldest first. This is the entire save file.
   *
   * The roster stays a plain data structure and does no storage of its own --
   * `core/Save.ts` owns that, the way `Audio/Voice.ts` owns the recording. It
   * keeps this testable without a fake IndexedDB, and it keeps every write to
   * the device in one file.
   */
  ids(): string[] {
    return this.order.map((d) => d.id);
  }

  /**
   * Put a saved collection back. Returns only the ones that were actually new,
   * so the caller can give each of them a body without cloning anyone he is
   * already walking around with.
   */
  restore(defs: readonly CollectibleDef[]): CollectibleDef[] {
    const added: CollectibleDef[] = [];
    for (const d of defs) if (this.add(d)) added.push(d);
    return added;
  }

  /** How many of each family. The silhouette pips will want this later. */
  countByFamily(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const d of this.order) out[d.family] = (out[d.family] ?? 0) + 1;
    return out;
  }
}
