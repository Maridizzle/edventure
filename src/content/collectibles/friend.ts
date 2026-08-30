import type { CollectibleDef } from '../types';

/**
 * The friend he starts with.
 *
 * A five-year-old cannot be told "find things and they will follow you". He has
 * to see it happen once, and the cheapest way to show him is for it to already
 * be true: a little dog trotting behind him from the first frame. Every find
 * after that adds to something he already understands, instead of introducing
 * it.
 *
 * Deliberately not candy-themed — it comes with him into every room forever, so
 * it has to belong everywhere. And deliberately absent from every scene's
 * `collectibles` list: `hide: 'given'` means it is never hidden anywhere, and
 * the world must never place a second copy of a creature already at his heels.
 */

const CREAM = 0xffe7c4;
const COCOA = 0xb87a4e;
const DEEP = 0x3d2f52;
const TONGUE = 0xff8fae;

export const starterFriend: CollectibleDef = {
  id: 'friend.pup',
  family: 'creature',
  hide: 'given',
  onFind: 'follow',
  // A little three-note bark, which in a pentatonic scale is a chord.
  note: [0, 4, 7],
  scale: 1.0,
  palette: [CREAM, COCOA, DEEP, TONGUE],
  shape: {
    parts: [
      // Body, front to back. +Z is forward, same as every other creature.
      { prim: 'sphere', pos: [0, 0.44, -0.04], scale: [0.29, 0.26, 0.42], color: 0, detail: 1 },
      { prim: 'sphere', pos: [0.15, 0.5, -0.14], scale: [0.17, 0.16, 0.22], color: 1, detail: 1 },

      // Head and snout.
      { prim: 'sphere', pos: [0, 0.68, 0.33], scale: [0.24, 0.23, 0.22], color: 0, detail: 1 },
      { prim: 'sphere', pos: [0, 0.6, 0.51], scale: [0.13, 0.11, 0.15], color: 0, detail: 1 },
      { prim: 'sphere', pos: [0, 0.63, 0.63], scale: [0.055, 0.05, 0.045], color: 2, detail: 1 },
      { prim: 'sphere', pos: [0, 0.53, 0.56], scale: [0.05, 0.02, 0.07], color: 3, detail: 1 },

      // Eyes, mirrored.
      {
        prim: 'sphere',
        pos: [0.1, 0.75, 0.47],
        scale: [0.048, 0.048, 0.04],
        color: 2,
        detail: 1,
        repeat: { count: 2, mode: 'mirrorX', step: [0, 0, 0] },
      },

      // Floppy ears, mirrored -- the z-rotation flips with the sign, so one
      // recipe gives a matched pair.
      {
        prim: 'sphere',
        pos: [0.22, 0.71, 0.28],
        scale: [0.07, 0.17, 0.11],
        rot: [0, 0, 0.35],
        color: 1,
        detail: 1,
        repeat: { count: 2, mode: 'mirrorX', step: [0, 0, 0] },
      },

      // Four legs: two mirrored pairs, stepped back along Z.
      {
        prim: 'cyl',
        pos: [0.17, 0.16, 0.22],
        scale: [0.075, 0.16, 0.075],
        color: 0,
        repeat: { count: 4, mode: 'mirrorX', step: [0, 0, -0.42] },
      },

      // Tail, up and wagging-ish.
      { prim: 'cone', pos: [0, 0.62, -0.4], scale: [0.06, 0.22, 0.06], rot: [-0.8, 0, 0], color: 1 },
    ],
  },
};
