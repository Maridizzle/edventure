import type { CharacterDef } from '../types';

/**
 * The first character. A squishy ball of living colour.
 *
 * Everything that makes it feel alive comes from the lag springs on the named
 * parts plus the roll flavor's squash-and-stretch — there is no rig and no
 * animation data anywhere in this file, which is the point.
 */
export const blob: CharacterDef = {
  id: 'blob',
  unlock: { kind: 'default' },
  radius: 0.55,
  palette: [0xff5fa2, 0xffe066, 0x1a1030, 0xff9ecb],
  shape: {
    parts: [
      { id: 'body', prim: 'icos', pos: [0, 0, 0], scale: [0.55, 0.55, 0.55], color: 0, detail: 2 },
      { id: 'blobA', prim: 'sphere', pos: [0.3, 0.22, 0.18], scale: [0.2, 0.2, 0.2], color: 3, detail: 1 },
      { id: 'blobB', prim: 'sphere', pos: [-0.26, -0.14, 0.28], scale: [0.15, 0.15, 0.15], color: 3, detail: 1 },
      // billboard: the body tumbles, the face does not.
      { id: 'eyeL', prim: 'sphere', pos: [-0.17, 0.16, 0.46], scale: [0.1, 0.12, 0.07], color: 2, detail: 1, billboard: true },
      { id: 'eyeR', prim: 'sphere', pos: [0.17, 0.16, 0.46], scale: [0.1, 0.12, 0.07], color: 2, detail: 1, billboard: true },
    ],
  },
  movement: { flavor: 'roll', maxSpeed: 7.0, accel: 26, drag: 0.9, slopeAssist: 0.35 },
  trail: { radiusM: 1.8, softness: 1.0 },
  timbre: { wave: 'triangle', attack: 0.005, decay: 0.55, octave: 0 },
  face: { lookAhead: 0.35 },
  wobble: { stiffness: 90, damping: 13, kick: 0.06 },
};
