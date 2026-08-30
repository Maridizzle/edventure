import { stream, randRange, type Rng } from '../core/Rng';
import type { Fixture, Placement, SceneDef } from '../content/types';

/**
 * Solves placement rules into concrete positions.
 *
 * This module is the difference between a composed room and a field with
 * things sprinkled on it. Everything is derived from one seeded stream, so a
 * scene is byte-identical every time it is rebuilt — which is what lets a
 * painting be saved and restored later.
 *
 * The stage's local axes, as the camera sees them (yaw is fixed forever):
 *   -X left, +X right, -Z back (far), +Z front (open side, toward the viewer)
 */

export interface Placed {
  kind: string;
  x: number;
  z: number;
  yaw: number;
  scale: number;
  footprint: number;
  /** Index into the scene's fixtures/scatter, for looking up the recipe. */
  defIndex: number;
  isScatter: boolean;
}

export interface LayoutResult {
  placed: Placed[];
  door: { x: number; z: number; yaw: number };
  spawn: { x: number; z: number };
}

/** Keeps the way out walkable. Nothing may ever be placed inside it. */
interface Corridor {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const MARGIN = 2.2; // keep objects off the walls
/** Nothing may be placed within this of the spawn point. */
const SPAWN_CLEAR = 3.6;
const CORRIDOR_HALF_WIDTH = 3.2;
/** How far in front of the door to keep clear. */
const DOOR_CLEAR = 7;
const MAX_TRIES = 24;

export function layoutScene(scene: SceneDef, seed: number): LayoutResult {
  const rng = stream(seed, 'layout');
  const halfX = scene.stage.width / 2;
  const halfZ = scene.stage.depth / 2;

  const door = doorPosition(scene, halfX, halfZ);

  // The player always enters from the open front edge, facing into the stage.
  const spawn = { x: 0, z: halfZ - 4.5 };

  // 1. Reserve the door's frontage FIRST, before anything competes for space.
  //
  // Deliberately only a short apron, not a lane running the length of the
  // stage: a full-length corridor forbids the centre of the room, which
  // silently drops the centrepiece, and the centrepiece is most of what makes
  // a room read as composed.
  //
  // Big fixtures are solid now, so this matters more than it used to — the
  // apron is what keeps the way out both visible and walkable. Reachability
  // is the backstop for everything else.
  const corridor = doorApron(door, halfX);

  const placed: Placed[] = [];

  // 2. Wall-anchored, corner and door-flanking fixtures: deterministic spots.
  // 3. Then ring and centre. 4. Then scatter, which fills what is left.
  const order: Placement['at'][] = [
    'backWall',
    'leftWall',
    'rightWall',
    'corner',
    'flankDoor',
    'ring',
    'center',
    'scatter',
  ];

  const all: { f: Fixture; i: number; scatter: boolean }[] = [
    ...scene.fixtures.map((f, i) => ({ f, i, scatter: false })),
    ...scene.scatter.map((f, i) => ({ f, i, scatter: true })),
  ];

  for (const phase of order) {
    for (const entry of all) {
      if (entry.f.place.at !== phase) continue;
      placeFixture(
        entry.f,
        entry.i,
        entry.scatter,
        rng,
        halfX,
        halfZ,
        door,
        corridor,
        spawn,
        placed,
      );
    }
  }

  return { placed, door, spawn };
}

/** The keep-clear apron directly in front of the door. */
export function doorApron(
  door: { x: number; z: number },
  halfX: number,
): Corridor {
  const w = CORRIDOR_HALF_WIDTH;
  if (Math.abs(door.x) > halfX - 1) {
    // Side wall: the apron reaches inward along X.
    const inward = door.x > 0 ? -1 : 1;
    return {
      minX: Math.min(door.x, door.x + inward * DOOR_CLEAR),
      maxX: Math.max(door.x, door.x + inward * DOOR_CLEAR),
      minZ: door.z - w,
      maxZ: door.z + w,
    };
  }
  // Back wall: the apron reaches forward along Z.
  return {
    minX: door.x - w,
    maxX: door.x + w,
    minZ: door.z,
    maxZ: door.z + DOOR_CLEAR,
  };
}

function doorPosition(scene: SceneDef, halfX: number, halfZ: number) {
  const t = scene.door.along * 2 - 1; // -1..1
  switch (scene.door.wall) {
    case 'left':
      return { x: -halfX + 0.4, z: t * (halfZ - 5), yaw: Math.PI / 2 };
    case 'right':
      return { x: halfX - 0.4, z: t * (halfZ - 5), yaw: -Math.PI / 2 };
    default:
      return { x: t * (halfX - 6), z: -halfZ + 0.4, yaw: 0 };
  }
}

function placeFixture(
  f: Fixture,
  defIndex: number,
  isScatter: boolean,
  rng: Rng,
  halfX: number,
  halfZ: number,
  door: { x: number; z: number },
  corridor: Corridor,
  spawn: { x: number; z: number },
  placed: Placed[],
): void {
  const p = f.place;

  const add = (x: number, z: number, yaw: number): boolean => {
    const scale = randRange(rng, f.scale[0], f.scale[1]);
    const footprint = f.footprint * scale;
    if (!fits(x, z, footprint, halfX, halfZ, corridor, spawn, placed)) return false;
    placed.push({ kind: f.kind, x, z, yaw, scale, footprint, defIndex, isScatter });
    return true;
  };

  /**
   * Retry on a deterministic outward spiral, then give up. Dropping one
   * lollipop is invisible; a lollipop standing inside the cupcake is not.
   */
  const addNear = (x: number, z: number, yaw: number): void => {
    if (add(x, z, yaw)) return;
    for (let i = 1; i <= MAX_TRIES; i++) {
      const a = i * 2.399963; // golden angle, so tries spread rather than cluster
      const r = 0.9 * Math.sqrt(i);
      if (add(x + Math.cos(a) * r, z + Math.sin(a) * r, yaw)) return;
    }
  };

  switch (p.at) {
    case 'backWall':
    case 'leftWall':
    case 'rightWall': {
      const count = p.count ?? 1;
      for (let i = 0; i < count; i++) {
        // Spread instances around the declared `along` position.
        const spread = count === 1 ? 0 : (i / (count - 1) - 0.5) * 0.5;
        const t = clamp01(p.along + spread) * 2 - 1;
        if (p.at === 'backWall') {
          addNear(t * (halfX - MARGIN), -halfZ + MARGIN, 0);
        } else if (p.at === 'leftWall') {
          addNear(-halfX + MARGIN, t * (halfZ - MARGIN), Math.PI / 2);
        } else {
          addNear(halfX - MARGIN, t * (halfZ - MARGIN), -Math.PI / 2);
        }
      }
      break;
    }

    case 'corner': {
      const sx = p.which === 'backLeft' ? -1 : 1;
      addNear(sx * (halfX - MARGIN - 1), -halfZ + MARGIN + 1, 0);
      break;
    }

    case 'center': {
      const j = p.jitter ?? 0;
      addNear(randRange(rng, -j, j), randRange(rng, -j, j), randRange(rng, 0, Math.PI * 2));
      break;
    }

    case 'ring': {
      const j = p.jitter ?? 0;
      // Start the ring at a seeded angle so scenes don't all line up.
      const phase = randRange(rng, 0, Math.PI * 2);
      for (let i = 0; i < p.count; i++) {
        const a = phase + (i / p.count) * Math.PI * 2;
        const r = p.radius + randRange(rng, -j, j);
        addNear(Math.cos(a) * r, Math.sin(a) * r, randRange(rng, 0, Math.PI * 2));
      }
      break;
    }

    case 'flankDoor': {
      // Sit just outside the corridor so the door stays framed but walkable.
      const off = Math.max(p.offset, CORRIDOR_HALF_WIDTH + 0.6);
      addNear(door.x - off, door.z + 1.4, 0);
      addNear(door.x + off, door.z + 1.4, 0);
      break;
    }

    case 'scatter': {
      const n = Math.round(randRange(rng, p.count[0], p.count[1]));
      for (let i = 0; i < n; i++) {
        // Rejection sampling; a scatter item that cannot fit is simply skipped.
        for (let t = 0; t < 12; t++) {
          const edge = p.region === 'edge';
          const rx = edge
            ? (rng() < 0.5 ? -1 : 1) * randRange(rng, halfX * 0.66, halfX - MARGIN)
            : randRange(rng, -halfX + MARGIN, halfX - MARGIN);
          const rz = edge
            ? randRange(rng, -halfZ + MARGIN, halfZ - MARGIN)
            : randRange(rng, -halfZ + MARGIN, halfZ - MARGIN);
          if (add(rx, rz, randRange(rng, 0, Math.PI * 2))) break;
        }
      }
      break;
    }
  }
}

function fits(
  x: number,
  z: number,
  r: number,
  halfX: number,
  halfZ: number,
  corridor: Corridor,
  spawn: { x: number; z: number },
  placed: Placed[],
): boolean {
  if (x - r < -halfX + 0.5 || x + r > halfX - 0.5) return false;
  if (z - r < -halfZ + 0.5 || z + r > halfZ - 0.5) return false;

  // Never intrude on the way out.
  if (
    x + r > corridor.minX &&
    x - r < corridor.maxX &&
    z + r > corridor.minZ &&
    z - r < corridor.maxZ
  ) {
    return false;
  }

  // He must always arrive standing in open floor, never embedded in a gumdrop
  // and shoved out by the collision pass.
  const sx = x - spawn.x;
  const sz = z - spawn.z;
  const sMin = r + SPAWN_CLEAR;
  if (sx * sx + sz * sz < sMin * sMin) return false;

  for (let i = 0; i < placed.length; i++) {
    const o = placed[i]!;
    const dx = o.x - x;
    const dz = o.z - z;
    const min = o.footprint + r;
    if (dx * dx + dz * dz < min * min) return false;
  }
  return true;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
