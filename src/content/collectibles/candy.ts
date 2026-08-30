import type { CollectibleDef } from '../types';

/**
 * The things hidden in Candy Land.
 *
 * Two ways of hiding, deliberately mixed. `disguise` ones look exactly like an
 * ordinary gumdrop or gumball until he rolls into them, which rewards touching
 * everything and needs no new rule taught. `tucked` ones are real objects
 * standing where the hills or a big fixture conceal them, which rewards going
 * to look. Between them the whole room is worth combing.
 */

const SHELL = 0xfff4e2;
const SPOT = 0xff7fb0;
const LEAF = 0x74d6a2;
const DEEP = 0x3d2f52;
const GOLD = 0xffd24a;
const SKY = 0x6fc7ff;

export const candyCollectibles: CollectibleDef[] = [
  // --- dinosaurs: he loves them, and they follow him afterwards -------------
  {
    id: 'candy.brontosaurus',
    family: 'dino',
    hide: 'tucked',
    onFind: 'follow',
    note: [0, 7],
    scale: 1.0,
    palette: [LEAF, SHELL, DEEP, SPOT],
    shape: {
      parts: [
        { prim: 'sphere', pos: [0, 0.55, 0], scale: [0.62, 0.46, 0.85], color: 0, detail: 1 },
        { prim: 'sphere', pos: [0, 0.95, 0.62], scale: [0.19, 0.19, 0.3], color: 0, detail: 1 },
        { prim: 'sphere', pos: [0, 1.32, 0.82], scale: [0.15, 0.15, 0.22], color: 0, detail: 1 },
        { prim: 'sphere', pos: [0, 1.6, 0.95], scale: [0.2, 0.17, 0.25], color: 0, detail: 1 },
        { prim: 'sphere', pos: [0.09, 1.68, 1.1], scale: [0.05, 0.05, 0.04], color: 2, detail: 1 },
        { prim: 'sphere', pos: [-0.09, 1.68, 1.1], scale: [0.05, 0.05, 0.04], color: 2, detail: 1 },
        { prim: 'cone', pos: [0, 0.6, -0.95], scale: [0.16, 0.5, 0.16], rot: [1.35, 0, 0], color: 0 },
        {
          prim: 'cyl',
          pos: [0.34, 0.24, 0.3],
          scale: [0.15, 0.26, 0.15],
          color: 0,
          repeat: { count: 4, mode: 'mirrorX', step: [0, 0, -0.6] },
        },
        {
          prim: 'sphere',
          pos: [0, 0.98, 0.2],
          scale: [0.1, 0.07, 0.1],
          color: 3,
          repeat: { count: 4, mode: 'stackZ', step: [0, -0.03, -0.32] },
        },
      ],
    },
  },
  {
    id: 'candy.stego',
    family: 'dino',
    hide: 'disguise',
    disguiseAs: 'gumdrop',
    onFind: 'follow',
    note: [4, 9],
    scale: 1.0,
    palette: [SPOT, SHELL, DEEP, GOLD],
    shape: {
      parts: [
        { prim: 'sphere', pos: [0, 0.5, 0], scale: [0.5, 0.42, 0.78], color: 0, detail: 1 },
        { prim: 'sphere', pos: [0, 0.62, 0.72], scale: [0.26, 0.24, 0.3], color: 0, detail: 1 },
        { prim: 'sphere', pos: [0.11, 0.68, 0.94], scale: [0.05, 0.05, 0.04], color: 2, detail: 1 },
        { prim: 'sphere', pos: [-0.11, 0.68, 0.94], scale: [0.05, 0.05, 0.04], color: 2, detail: 1 },
        { prim: 'cone', pos: [0, 0.5, -0.85], scale: [0.14, 0.42, 0.14], rot: [1.5, 0, 0], color: 0 },
        {
          prim: 'cone',
          pos: [0, 0.95, 0.34],
          scale: [0.06, 0.26, 0.18],
          color: 3,
          repeat: { count: 5, mode: 'stackZ', step: [0, 0.02, -0.3] },
        },
        {
          prim: 'cyl',
          pos: [0.3, 0.2, 0.26],
          scale: [0.13, 0.22, 0.13],
          color: 0,
          repeat: { count: 4, mode: 'mirrorX', step: [0, 0, -0.52] },
        },
      ],
    },
  },

  // --- other creatures ------------------------------------------------------
  {
    id: 'candy.snail',
    family: 'creature',
    hide: 'disguise',
    disguiseAs: 'sugarcube',
    onFind: 'follow',
    note: [2, 5],
    scale: 1.0,
    palette: [GOLD, SPOT, DEEP, SHELL],
    shape: {
      parts: [
        { prim: 'sphere', pos: [0, 0.22, -0.05], scale: [0.34, 0.22, 0.5], color: 3, detail: 1 },
        { prim: 'torus', pos: [0, 0.46, -0.12], scale: [0.34, 0.34, 0.2], rot: [0, 1.57, 0], color: 0, detail: 1 },
        { prim: 'torus', pos: [0, 0.46, -0.12], scale: [0.2, 0.2, 0.21], rot: [0, 1.57, 0], color: 1, detail: 1 },
        { prim: 'sphere', pos: [0, 0.28, 0.42], scale: [0.16, 0.16, 0.2], color: 3, detail: 1 },
        { prim: 'cyl', pos: [0.08, 0.5, 0.46], scale: [0.02, 0.14, 0.02], rot: [0.3, 0, 0.2], color: 3 },
        { prim: 'cyl', pos: [-0.08, 0.5, 0.46], scale: [0.02, 0.14, 0.02], rot: [0.3, 0, -0.2], color: 3 },
        { prim: 'sphere', pos: [0.1, 0.64, 0.5], scale: [0.04, 0.04, 0.04], color: 2, detail: 1 },
        { prim: 'sphere', pos: [-0.1, 0.64, 0.5], scale: [0.04, 0.04, 0.04], color: 2, detail: 1 },
      ],
    },
  },
  {
    id: 'candy.butterfly',
    family: 'creature',
    hide: 'tucked',
    onFind: 'follow',
    note: [7, 12],
    scale: 1.0,
    palette: [SKY, SPOT, DEEP, SHELL],
    shape: {
      parts: [
        { prim: 'capsule', pos: [0, 0.4, 0], scale: [0.09, 0.12, 0.09], color: 2 },
        { prim: 'sphere', pos: [0, 0.62, 0.02], scale: [0.11, 0.11, 0.11], color: 2, detail: 1 },
        { prim: 'sphere', pos: [0.36, 0.52, 0.06], scale: [0.3, 0.34, 0.05], rot: [0, 0, 0.35], color: 0, detail: 1 },
        { prim: 'sphere', pos: [-0.36, 0.52, 0.06], scale: [0.3, 0.34, 0.05], rot: [0, 0, -0.35], color: 0, detail: 1 },
        { prim: 'sphere', pos: [0.3, 0.26, 0.04], scale: [0.2, 0.22, 0.05], rot: [0, 0, 0.6], color: 1, detail: 1 },
        { prim: 'sphere', pos: [-0.3, 0.26, 0.04], scale: [0.2, 0.22, 0.05], rot: [0, 0, -0.6], color: 1, detail: 1 },
        { prim: 'cyl', pos: [0.05, 0.74, 0.02], scale: [0.012, 0.1, 0.012], rot: [0, 0, 0.4], color: 2 },
        { prim: 'cyl', pos: [-0.05, 0.74, 0.02], scale: [0.012, 0.1, 0.012], rot: [0, 0, -0.4], color: 2 },
      ],
    },
  },

  // --- treasure -------------------------------------------------------------
  {
    id: 'candy.gem',
    family: 'treasure',
    hide: 'tucked',
    onFind: 'collect',
    note: [12, 16],
    scale: 1.0,
    palette: [SKY, SHELL, GOLD],
    shape: {
      parts: [
        { prim: 'cone', pos: [0, 0.34, 0], scale: [0.3, 0.34, 0.3], rot: [3.14, 0, 0], color: 0 },
        { prim: 'cone', pos: [0, 0.62, 0], scale: [0.3, 0.22, 0.3], color: 1 },
      ],
    },
  },
  {
    id: 'candy.coin',
    family: 'treasure',
    hide: 'disguise',
    disguiseAs: 'gumball',
    onFind: 'collect',
    note: [9, 14],
    scale: 1.0,
    palette: [GOLD, SHELL],
    shape: {
      parts: [
        { prim: 'cyl', pos: [0, 0.34, 0], scale: [0.3, 0.06, 0.3], rot: [1.4, 0, 0.2], color: 0, detail: 1 },
        { prim: 'cyl', pos: [0, 0.34, 0.01], scale: [0.2, 0.07, 0.2], rot: [1.4, 0, 0.2], color: 1, detail: 1 },
      ],
    },
  },

  // --- vehicles -------------------------------------------------------------
  {
    id: 'candy.digger',
    family: 'vehicle',
    hide: 'tucked',
    onFind: 'park',
    note: [0, 5],
    scale: 1.0,
    palette: [GOLD, DEEP, SPOT, SHELL],
    shape: {
      parts: [
        { prim: 'box', pos: [0, 0.42, 0], scale: [0.36, 0.24, 0.56], color: 0 },
        { prim: 'box', pos: [0, 0.78, -0.12], scale: [0.28, 0.24, 0.28], color: 2 },
        { prim: 'box', pos: [0, 0.78, 0.14], scale: [0.22, 0.16, 0.04], color: 3 },
        { prim: 'cyl', pos: [0, 0.86, 0.5], scale: [0.07, 0.4, 0.07], rot: [0.9, 0, 0], color: 2 },
        { prim: 'box', pos: [0, 0.46, 0.86], scale: [0.22, 0.18, 0.2], rot: [0.4, 0, 0], color: 0 },
        {
          prim: 'cyl',
          pos: [0.4, 0.24, 0.34],
          scale: [0.22, 0.1, 0.22],
          rot: [0, 0, 1.57],
          color: 1,
          repeat: { count: 4, mode: 'mirrorX', step: [0, 0, -0.68] },
        },
      ],
    },
  },
  {
    id: 'candy.rocket',
    family: 'vehicle',
    hide: 'disguise',
    disguiseAs: 'candycane',
    onFind: 'park',
    note: [4, 11],
    scale: 1.0,
    palette: [SHELL, SPOT, SKY, GOLD],
    shape: {
      parts: [
        { prim: 'capsule', pos: [0, 0.85, 0], scale: [0.24, 0.4, 0.24], color: 0 },
        { prim: 'cone', pos: [0, 1.5, 0], scale: [0.24, 0.3, 0.24], color: 1 },
        { prim: 'sphere', pos: [0, 0.95, 0.22], scale: [0.11, 0.11, 0.06], color: 2, detail: 1 },
        {
          prim: 'cone',
          pos: [0.26, 0.34, 0],
          scale: [0.08, 0.3, 0.18],
          color: 1,
          repeat: { count: 3, mode: 'radialY', step: [0, 0, 0] },
        },
        { prim: 'cone', pos: [0, 0.36, 0], scale: [0.16, 0.22, 0.16], rot: [3.14, 0, 0], color: 3 },
      ],
    },
  },
];
