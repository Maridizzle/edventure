/**
 * PURE DATA CONTRACTS.
 *
 * Hard architectural rule: nothing in `content/` may import `three` or any
 * engine module. It exports plain objects and hex numbers, and `ShapeBuilder`
 * is the only thing that turns them into geometry. That rule is what makes
 * "adding content = adding a data file" actually true instead of aspirational.
 */

export type Prim = 'sphere' | 'box' | 'cone' | 'cyl' | 'torus' | 'icos' | 'capsule';

export interface PartRepeat {
  count: number;
  mode: 'mirrorX' | 'radialY' | 'stackZ';
  step: [number, number, number];
  rotStep?: number;
}

export interface Part {
  /** Named parts can be addressed by hatch animations and lag springs. */
  id?: string;
  prim: Prim;
  pos: [number, number, number];
  scale: [number, number, number];
  rot?: [number, number, number];
  /** Index into the recipe's palette. */
  color: number;
  /** 0..2 subdivision; ShapeBuilder clamps this by quality tier. */
  detail?: number;
  repeat?: PartRepeat;
  /**
   * Stay world-aligned instead of inheriting the body's rotation.
   *
   * For faces. A rolling character whose eyes tumble away every revolution
   * reads as an object, not a creature — and a 5-year-old needs to see a face.
   * Because the camera's yaw is fixed for the whole game, "world-aligned" and
   * "facing the player" are the same thing, for free.
   */
  billboard?: boolean;
}

export interface ShapeRecipe {
  parts: Part[];
}

export interface Octave {
  freq: number;
  amp: number;
}

export interface PropKind {
  kind: string;
  shape: ShapeRecipe;
  density: number;
  scale: [number, number];
  slopeMax: number;
  heightBand: [number, number];
  /** Scale degrees this prop may sound. null = silent (grass). */
  note: number[] | null;
  /** Only `large` props can hide a collectible. */
  large: boolean;
}

export interface BiomeDef {
  id: string;
  order: number;

  sky: { top: number; horizon: number; fogColor: number; fogNear: number; fogFar: number };
  light: { dir: [number, number, number] };

  palette: {
    groundA: number;
    groundB: number;
    accent: number;
    grayTint: number;
  };

  terrain: {
    worldSize: number;
    octaves: Octave[];
    warp: { freq: number; amp: number };
    maxSlopeDeg: number;
    edgeFalloff: { start: number; power: number };
  };

  props: PropKind[];

  audio: {
    scale: string;
    rootHz: number;
  };

  collectiblesPerArea: [number, number];
  nextBiomes: string[];
}

export interface CollectibleDef {
  id: string;
  /** Which ordinary prop kind it masquerades as while hidden. */
  disguise: string;
  hatch: 'pop' | 'unfold' | 'wingsOpen';
  note: number;
  palette: number[];
  shape: ShapeRecipe;
}

export interface CharacterDef {
  id: string;
  unlock: { kind: 'default' } | { kind: 'finds'; count: number } | { kind: 'set'; biomeId: string };
  radius: number;
  palette: number[];
  shape: ShapeRecipe;
  movement: {
    flavor: 'roll' | 'hop' | 'hover' | 'glide';
    maxSpeed: number;
    accel: number;
    drag: number;
    slopeAssist: number;
    hopHeight?: number;
    hopPerMetre?: number;
  };
  trail: { radiusM: number; softness: number };
  timbre: { wave: 'sine' | 'triangle' | 'square' | 'sawtooth'; attack: number; decay: number; octave: number };
  face: { lookAhead: number };
  wobble: { stiffness: number; damping: number; kick: number };
}
