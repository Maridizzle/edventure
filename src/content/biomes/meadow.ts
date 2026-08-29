import type { BiomeDef } from '../types';

export const meadow: BiomeDef = {
  id: 'meadow',
  order: 0,

  sky: { top: 0x8fd6ff, horizon: 0xdff4ff, fogColor: 0xcfeaff, fogNear: 60, fogFar: 190 },
  light: { dir: [0.45, 0.8, 0.32] },

  palette: {
    groundA: 0x74c95c, // low / valley
    groundB: 0xa9e07a, // high / hilltop
    accent: 0xffe680, // speckle, fresh-paint rim, sparkle
    grayTint: 0x9aa3ad, // the drained tint
  },

  terrain: {
    // TUNING DIAL (risk #3, "coverage feels like homework"). Coverage cost is
    // area/brush-width: at 100m a 1.8m brush needs ~2km of driving to reach
    // 70%, which is 15+ minutes. 70m brings that to ~7. Once props land in M3
    // each one bursts 6m of ground and this can grow again. Re-tune from his
    // actual play, not from this arithmetic.
    worldSize: 70,
    octaves: [
      { freq: 0.014, amp: 5.2 },
      { freq: 0.038, amp: 1.9 },
      { freq: 0.095, amp: 0.6 },
    ],
    warp: { freq: 0.008, amp: 8.0 },
    maxSlopeDeg: 26,
    edgeFalloff: { start: 0.8, power: 2.0 },
  },

  props: [
    {
      kind: 'grassTuft',
      density: 0.085,
      scale: [0.5, 0.9],
      slopeMax: 0.85,
      heightBand: [0, 1],
      note: null,
      large: false,
      shape: {
        parts: [
          { prim: 'cone', pos: [0, 0.18, 0], scale: [0.07, 0.22, 0.07], color: 0 },
          { prim: 'cone', pos: [0.09, 0.14, 0.04], scale: [0.05, 0.17, 0.05], rot: [0.3, 0, 0.35], color: 1 },
          { prim: 'cone', pos: [-0.08, 0.13, -0.05], scale: [0.05, 0.15, 0.05], rot: [-0.25, 0, -0.4], color: 0 },
        ],
      },
    },
    {
      kind: 'flower',
      density: 0.026,
      scale: [0.7, 1.2],
      slopeMax: 0.75,
      heightBand: [0, 0.7],
      note: [0, 2, 4],
      large: false,
      shape: {
        parts: [
          { prim: 'cyl', pos: [0, 0.2, 0], scale: [0.02, 0.2, 0.02], color: 0 },
          { prim: 'sphere', pos: [0, 0.42, 0], scale: [0.07, 0.06, 0.07], color: 2 },
          {
            prim: 'sphere',
            pos: [0.11, 0.42, 0],
            scale: [0.07, 0.03, 0.05],
            color: 1,
            repeat: { count: 5, mode: 'radialY', step: [0, 0, 0] },
          },
        ],
      },
    },
    {
      kind: 'mushroom',
      density: 0.012,
      scale: [0.6, 1.5],
      slopeMax: 0.6,
      heightBand: [0, 0.5],
      note: [0, 4, 7],
      large: true,
      shape: {
        parts: [
          { prim: 'cyl', pos: [0, 0.16, 0], scale: [0.07, 0.16, 0.07], color: 3 },
          { prim: 'sphere', pos: [0, 0.34, 0], scale: [0.24, 0.17, 0.24], color: 1, detail: 1 },
          { prim: 'sphere', pos: [0.09, 0.44, 0.06], scale: [0.05, 0.03, 0.05], color: 3 },
          { prim: 'sphere', pos: [-0.1, 0.42, -0.05], scale: [0.04, 0.025, 0.04], color: 3 },
        ],
      },
    },
    {
      kind: 'rock',
      density: 0.01,
      scale: [0.5, 1.8],
      slopeMax: 1.0,
      heightBand: [0, 1],
      note: [7, 9],
      large: true,
      shape: {
        parts: [
          { prim: 'icos', pos: [0, 0.18, 0], scale: [0.32, 0.24, 0.28], color: 0, detail: 0 },
          { prim: 'icos', pos: [0.2, 0.1, 0.12], scale: [0.15, 0.12, 0.14], color: 1, detail: 0 },
        ],
      },
    },
    {
      kind: 'bush',
      density: 0.009,
      scale: [0.8, 1.6],
      slopeMax: 0.7,
      heightBand: [0, 0.8],
      note: [2, 5],
      large: true,
      shape: {
        parts: [
          { prim: 'sphere', pos: [0, 0.26, 0], scale: [0.3, 0.26, 0.3], color: 0, detail: 1 },
          { prim: 'sphere', pos: [0.22, 0.18, 0.1], scale: [0.19, 0.17, 0.19], color: 1, detail: 1 },
          { prim: 'sphere', pos: [-0.18, 0.16, -0.12], scale: [0.16, 0.15, 0.16], color: 1, detail: 1 },
        ],
      },
    },
    {
      kind: 'tree',
      density: 0.0035,
      scale: [1.0, 2.2],
      slopeMax: 0.55,
      heightBand: [0.1, 0.9],
      note: [0, 12],
      large: true,
      shape: {
        parts: [
          { prim: 'cyl', pos: [0, 0.7, 0], scale: [0.13, 0.7, 0.13], color: 3 },
          { prim: 'sphere', pos: [0, 1.6, 0], scale: [0.68, 0.6, 0.68], color: 0, detail: 1 },
          { prim: 'sphere', pos: [0.4, 1.25, 0.18], scale: [0.36, 0.32, 0.36], color: 1, detail: 1 },
          { prim: 'sphere', pos: [-0.34, 1.35, -0.22], scale: [0.32, 0.29, 0.32], color: 1, detail: 1 },
        ],
      },
    },
  ],

  audio: { scale: 'majorPentatonic', rootHz: 261.63 },
  collectiblesPerArea: [5, 7],
  nextBiomes: ['shore', 'dunes'],
};
