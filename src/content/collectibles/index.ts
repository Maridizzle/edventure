import type { CollectibleDef } from '../types';
import { candyCollectibles } from './candy';
import { starterFriend } from './friend';

/**
 * Every creature in the game, and a way to look one up by id.
 *
 * A save file holds ids and nothing else -- storing whole recipes would mean a
 * five-year-old's collection was frozen at whatever the shapes looked like on
 * the day he found them, and a tweak to a dinosaur would either be invisible to
 * him or corrupt his save. Ids are the only durable thing here, so restoring
 * needs a catalogue to turn them back into creatures.
 *
 * An id that is no longer in this list is simply skipped on load: a creature
 * that has been renamed or removed must never stop the rest of his collection
 * coming back.
 */
export const ALL_COLLECTIBLES: readonly CollectibleDef[] = [starterFriend, ...candyCollectibles];

export const COLLECTIBLE_BY_ID: ReadonlyMap<string, CollectibleDef> = new Map(
  ALL_COLLECTIBLES.map((c) => [c.id, c]),
);
