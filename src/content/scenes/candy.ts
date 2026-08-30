import type { SceneDef } from '../types';

/**
 * Candy Land — the first scene.
 *
 * Chosen first because nothing in it has to obey real-world colour, so the
 * drained-gray → full-colour transformation is at its most dramatic, and every
 * object is a big simple silhouette that primitives render well.
 *
 * The rule that makes this read as a place rather than a field: a handful of
 * LARGE recognizable shapes in deliberate positions. Scatter is filler, not
 * content. If it stops reading as a place, the fix is bigger and fewer
 * fixtures, never more scatter.
 */

// Shared palettes, so a lollipop and a gumdrop feel like they belong together.
const PINK = 0xff6fb5;
const CREAM = 0xfff2e0;
const RED = 0xff4d5e;
const MINT = 0x7fe3c4;
const LILAC = 0xb98cff;
const LEMON = 0xffd85e;
const COCOA = 0x8a5a3c;

export const candy: SceneDef = {
  id: 'candy',
  kit: 'candy',

  stage: {
    // Square for now: AreaTransform and PaintMask are square and well tested,
    // and a square diorama is no less a room. Generalize only if a rectangular
    // stage turns out to matter visually.
    width: 30,
    depth: 30,
    floor: 'flat',
    walls: 'solid',
    // Tall enough to enclose, short enough not to eat a portrait frame at a
    // 50-degree camera pitch. Expect to tune this.
    wallHeight: 5.5,
  },

  palette: {
    floorA: 0xff86c4, // pink sugar
    floorB: 0xffd6ea, // icing highlights
    accent: 0xfff275, // sherbet sparkle
    grayTint: 0x8b929c,
    wall: 0xffd9ec,
    trim: 0xff7ab8,
  },

  sky: { horizon: 0xffe3f2, fogColor: 0xffe3f2, fogNear: 55, fogFar: 130 },
  light: { dir: [0.4, 0.85, 0.35] },

  fixtures: [
    // --- lollipop trees: the silhouette that says "candy" fastest -----------
    {
      kind: 'lollipop',
      footprint: 1.5,
      scale: [1.5, 2.3],
      note: [0, 4, 7],
      palette: [CREAM, PINK, RED, MINT],
      place: { at: 'ring', radius: 10.5, count: 5, jitter: 1.6 },
      shape: {
        parts: [
          { prim: 'cyl', pos: [0, 1.5, 0], scale: [0.12, 1.5, 0.12], color: 0 },
          // The disc reads as a swirl from three offset rings.
          { prim: 'cyl', pos: [0, 3.1, 0], scale: [1.15, 0.16, 1.15], rot: [1.57, 0, 0], color: 1, detail: 1 },
          { prim: 'cyl', pos: [0, 3.1, 0.02], scale: [0.78, 0.18, 0.78], rot: [1.57, 0, 0], color: 0, detail: 1 },
          { prim: 'cyl', pos: [0, 3.1, 0.04], scale: [0.42, 0.2, 0.42], rot: [1.57, 0, 0], color: 2, detail: 1 },
        ],
      },
    },

    // --- gumdrop hills: big soft masses, break up the floor -----------------
    {
      kind: 'gumdrop',
      footprint: 1.9,
      scale: [1.0, 1.5],
      note: [0, 2, 5],
      palette: [LILAC, MINT, LEMON],
      place: { at: 'scatter', region: 'open', count: [3, 4] },
      shape: {
        parts: [
          { prim: 'sphere', pos: [0, 0.75, 0], scale: [1.5, 1.05, 1.5], color: 0, detail: 1 },
          { prim: 'sphere', pos: [0.55, 1.15, 0.35], scale: [0.3, 0.22, 0.3], color: 1, detail: 1 },
          { prim: 'sphere', pos: [-0.6, 0.95, -0.3], scale: [0.24, 0.18, 0.24], color: 2, detail: 1 },
        ],
      },
    },

    // --- a giant cupcake as the centrepiece ---------------------------------
    {
      kind: 'cupcake',
      footprint: 1.9,
      scale: [1.25, 1.25],
      note: [7, 12],
      palette: [CREAM, PINK, RED, COCOA],
      place: { at: 'center', jitter: 1.8 },
      shape: {
        parts: [
          // fluted wrapper
          { prim: 'cyl', pos: [0, 0.7, 0], scale: [1.3, 0.7, 1.3], color: 3, detail: 1 },
          {
            prim: 'box',
            pos: [1.25, 0.7, 0],
            scale: [0.08, 0.68, 0.16],
            color: 0,
            repeat: { count: 10, mode: 'radialY', step: [0, 0, 0] },
          },
          // swirled icing, three stacked shrinking spheres
          { prim: 'sphere', pos: [0, 1.55, 0], scale: [1.25, 0.6, 1.25], color: 1, detail: 1 },
          { prim: 'sphere', pos: [0, 2.05, 0], scale: [0.92, 0.5, 0.92], color: 1, detail: 1 },
          { prim: 'sphere', pos: [0, 2.45, 0], scale: [0.58, 0.42, 0.58], color: 1, detail: 1 },
          // cherry
          { prim: 'sphere', pos: [0, 2.85, 0], scale: [0.3, 0.3, 0.3], color: 2, detail: 1 },
          { prim: 'cyl', pos: [0, 3.15, 0], scale: [0.04, 0.22, 0.04], rot: [0, 0, 0.3], color: 3 },
        ],
      },
    },

    // --- candy canes flanking the door: frames the way out ------------------
    {
      kind: 'candycane',
      footprint: 0.9,
      scale: [1.4, 1.6],
      note: [4, 9],
      palette: [CREAM, RED],
      place: { at: 'flankDoor', offset: 3.9 },
      shape: {
        parts: [
          { prim: 'cyl', pos: [0, 1.6, 0], scale: [0.22, 1.6, 0.22], color: 0 },
          // stripes
          {
            prim: 'cyl',
            pos: [0, 0.35, 0],
            scale: [0.235, 0.14, 0.235],
            rot: [0.35, 0, 0],
            color: 1,
            repeat: { count: 6, mode: 'stackZ', step: [0, 0.5, 0] },
          },
          // hook
          { prim: 'torus', pos: [0.42, 3.2, 0], scale: [0.42, 0.42, 0.22], rot: [1.57, 0, 0], color: 0 },
        ],
      },
    },

    // --- liquorice allsort blocks along the side walls ----------------------
    {
      kind: 'allsort',
      footprint: 1.1,
      scale: [1.0, 1.5],
      note: [2, 5, 9],
      palette: [0x2b2233, LEMON, PINK, CREAM],
      place: { at: 'leftWall', along: 0.35, count: 3 },
      shape: {
        parts: [
          { prim: 'box', pos: [0, 0.25, 0], scale: [0.8, 0.25, 0.8], color: 0 },
          { prim: 'box', pos: [0, 0.72, 0], scale: [0.8, 0.24, 0.8], color: 1 },
          { prim: 'box', pos: [0, 1.18, 0], scale: [0.8, 0.24, 0.8], color: 0 },
          { prim: 'box', pos: [0, 1.62, 0], scale: [0.8, 0.22, 0.8], color: 2 },
        ],
      },
    },
    {
      kind: 'donut',
      footprint: 1.2,
      scale: [1.1, 1.6],
      note: [0, 7],
      palette: [0xf0a860, PINK, CREAM],
      place: { at: 'rightWall', along: 0.4, count: 3 },
      shape: {
        parts: [
          { prim: 'torus', pos: [0, 0.85, 0], scale: [0.85, 0.85, 0.85], rot: [1.57, 0, 0], color: 0, detail: 1 },
          { prim: 'torus', pos: [0, 1.0, 0], scale: [0.83, 0.83, 0.6], rot: [1.57, 0, 0], color: 1, detail: 1 },
          {
            prim: 'box',
            pos: [0.6, 1.18, 0],
            scale: [0.12, 0.04, 0.05],
            color: 2,
            repeat: { count: 7, mode: 'radialY', step: [0, 0, 0], rotStep: 0.7 },
          },
        ],
      },
    },
  ],

  scatter: [
    {
      kind: 'gumball',
      footprint: 0.45,
      scale: [0.5, 1.0],
      note: [0, 2, 4, 7, 9],
      palette: [PINK, MINT, LEMON, LILAC],
      place: { at: 'scatter', region: 'open', count: [16, 24] },
      shape: {
        parts: [{ prim: 'sphere', pos: [0, 0.32, 0], scale: [0.32, 0.32, 0.32], color: 0, detail: 1 }],
      },
    },
    {
      kind: 'sprinkle',
      footprint: 0.25,
      scale: [0.7, 1.3],
      note: null,
      palette: [CREAM, RED, MINT, LEMON],
      place: { at: 'scatter', region: 'open', count: [26, 38] },
      shape: {
        parts: [
          { prim: 'cyl', pos: [0, 0.07, 0], scale: [0.05, 0.16, 0.05], rot: [0, 0, 1.4], color: 0 },
        ],
      },
    },
    {
      kind: 'sugarcube',
      footprint: 0.35,
      scale: [0.6, 1.1],
      note: [12],
      palette: [CREAM, 0xffe9f4],
      place: { at: 'scatter', region: 'edge', count: [8, 12] },
      shape: {
        parts: [{ prim: 'box', pos: [0, 0.22, 0], scale: [0.22, 0.22, 0.22], color: 0 }],
      },
    },
  ],

  // An oversized wrapped sweet, stood on end and opened down the middle.
  door: {
    wall: 'back',
    along: 0.5,
    scale: 1.0,
    palette: [PINK, CREAM, LEMON, RED],
    shape: {
      parts: [
        { id: 'postL', prim: 'cyl', pos: [-1.9, 2.1, 0], scale: [0.34, 2.1, 0.34], color: 0 },
        { id: 'postR', prim: 'cyl', pos: [1.9, 2.1, 0], scale: [0.34, 2.1, 0.34], color: 0 },
        { id: 'arch', prim: 'torus', pos: [0, 4.2, 0], scale: [1.9, 1.9, 0.34], rot: [0, 0, 0], color: 1, detail: 1 },
        // wrapper twists either side, so it reads as a sweet not a doorway
        { prim: 'cone', pos: [-2.9, 4.2, 0], scale: [0.5, 0.8, 0.5], rot: [0, 0, 1.57], color: 2 },
        { prim: 'cone', pos: [2.9, 4.2, 0], scale: [0.5, 0.8, 0.5], rot: [0, 0, -1.57], color: 2 },
        { prim: 'sphere', pos: [0, 5.6, 0], scale: [0.42, 0.42, 0.42], color: 3, detail: 1 },
      ],
    },
  },

  audio: { scale: 'majorPentatonic', rootHz: 293.66 },
  nextScenes: ['candy'],
};
