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

/* ------------------------------------------------------------------ *
 * Scenes
 * ------------------------------------------------------------------ */

/**
 * Where an object goes on the stage.
 *
 * This vocabulary is the difference between a composed room and a field with
 * things sprinkled on it. A 5-year-old reads a place from a few big objects in
 * deliberate positions — a bed against a wall, a rug in the middle — not from
 * hundreds of scattered ones.
 */
export type Placement =
  /** `along` is 0..1 across that wall, left to right as the camera sees it. */
  | { at: 'backWall'; along: number; count?: number }
  | { at: 'leftWall'; along: number; count?: number }
  | { at: 'rightWall'; along: number; count?: number }
  | { at: 'corner'; which: 'backLeft' | 'backRight' }
  | { at: 'center'; jitter?: number }
  | { at: 'ring'; radius: number; count: number; jitter?: number }
  | { at: 'scatter'; region: 'open' | 'edge'; count: [number, number] }
  | { at: 'flankDoor'; offset: number };

export interface Fixture {
  kind: string;
  shape: ShapeRecipe;
  palette: number[];
  /** Uniform scale range; the layout solver picks per instance from the seed. */
  scale: [number, number];
  /** Reserved radius in metres. Nothing else may overlap it. */
  footprint: number;
  place: Placement;
  /** Scale degrees this object may sound when painted. null = silent. */
  note: number[] | null;
}

export interface StageDef {
  width: number;
  depth: number;
  floor: 'flat' | 'terrain';
  /** `solid` = real walls. `ring` = enclosed by scenery instead. */
  walls: 'solid' | 'ring' | 'none';
  wallHeight: number;
  /** Only used when floor is 'terrain'. */
  terrain?: {
    octaves: Octave[];
    warp: { freq: number; amp: number };
    maxSlopeDeg: number;
  };
}

export interface ScenePalette {
  floorA: number;
  floorB: number;
  accent: number;
  grayTint: number;
  wall: number;
  trim: number;
}

export interface DoorDef {
  shape: ShapeRecipe;
  palette: number[];
  wall: 'back' | 'left' | 'right';
  /** 0..1 along that wall. */
  along: number;
  scale: number;
}

export interface SceneDef {
  id: string;
  kit: 'candy' | 'indoor' | 'nature' | 'tiny';

  stage: StageDef;
  palette: ScenePalette;
  sky: { horizon: number; fogColor: number; fogNear: number; fogFar: number };
  light: { dir: [number, number, number] };

  /** Few, big, recognizable, individually placed. These make it read as a place. */
  fixtures: Fixture[];
  /** Many, small, instanced filler. These make it read as full. */
  scatter: Fixture[];

  door: DoorDef;
  audio: { scale: string; rootHz: number };
  nextScenes: string[];
}

/* ------------------------------------------------------------------ *
 * Characters and collectibles
 * ------------------------------------------------------------------ */

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
  timbre: {
    wave: 'sine' | 'triangle' | 'square' | 'sawtooth';
    attack: number;
    decay: number;
    octave: number;
  };
  face: { lookAhead: number };
  wobble: { stiffness: number; damping: number; kick: number };
}
