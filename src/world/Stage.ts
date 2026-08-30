import {
  BoxGeometry,
  BufferAttribute,
  Color,
  Group,
  Mesh,
  SRGBColorSpace,
  type ShaderMaterial,
} from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneDef } from '../content/types';

/**
 * The diorama shell: walls on back, left and right, and nothing on the near
 * side.
 *
 * The open front falls straight out of the camera's fixed yaw — "toward the
 * viewer" is a constant world direction, so there is simply no near wall to
 * build. That means nothing can ever come between the camera and the player,
 * with no wall fading, no camera collision and no transparency sorting.
 *
 * All three walls merge into ONE geometry, so the entire shell is a single
 * draw call.
 */

function linear(hex: number): Color {
  return new Color().setHex(hex, SRGBColorSpace);
}

function slab(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  c: Color,
): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  g.translate(x, y, z);
  const n = g.attributes.position!.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

export interface StageBuild {
  group: Group;
  dispose(): void;
}

const THICK = 0.6;
const TRIM_H = 0.45;
/** Depth of the tray the stage sits on. */
const BASE_H = 1.6;
/** How far the tray juts past the open front edge. */
const BASE_LIP = 1.2;
/** Clearance below the floor, so the two surfaces never z-fight. */
const BASE_DROP = 0.12;

export function buildStage(scene: SceneDef, material: ShaderMaterial): StageBuild {
  const group = new Group();
  if (scene.stage.walls !== 'solid') return { group, dispose: () => {} };

  const halfX = scene.stage.width / 2;
  const halfZ = scene.stage.depth / 2;
  const h = scene.stage.wallHeight;
  const wall = linear(scene.palette.wall);
  const trim = linear(scene.palette.trim);

  const parts: BoxGeometry[] = [
    // The tray the diorama sits on.
    //
    // Without this the camera looks straight past the open front edge of the
    // floor into empty sky, which reads as a rendering bug rather than a
    // design. A solid base turns that edge into the front of a shoebox — the
    // thing the whole diorama idea is trading on.
    slab(
      scene.stage.width + THICK * 2,
      BASE_H,
      scene.stage.depth + THICK * 2 + BASE_LIP,
      0,
      // Top face sits just BELOW the floor. Coplanar surfaces z-fight, which
      // shows up as jagged interleaved speckle across the whole room.
      -BASE_H / 2 - BASE_DROP,
      BASE_LIP / 2,
      trim,
    ),

    // back wall, wide enough to close both corners
    slab(scene.stage.width + THICK * 2, h, THICK, 0, h / 2, -halfZ - THICK / 2, wall),
    // side walls
    slab(THICK, h, scene.stage.depth, -halfX - THICK / 2, h / 2, 0, wall),
    slab(THICK, h, scene.stage.depth, halfX + THICK / 2, h / 2, 0, wall),

    // skirting: a darker band at the base grounds the walls against the floor
    slab(scene.stage.width + THICK * 2, TRIM_H, THICK * 1.35, 0, TRIM_H / 2, -halfZ - THICK / 2, trim),
    slab(THICK * 1.35, TRIM_H, scene.stage.depth, -halfX - THICK / 2, TRIM_H / 2, 0, trim),
    slab(THICK * 1.35, TRIM_H, scene.stage.depth, halfX + THICK / 2, TRIM_H / 2, 0, trim),

    // top rail: caps the wall so it reads as a built box, not a cut plane
    slab(scene.stage.width + THICK * 2, TRIM_H * 0.7, THICK * 1.35, 0, h, -halfZ - THICK / 2, trim),
    slab(THICK * 1.35, TRIM_H * 0.7, scene.stage.depth, -halfX - THICK / 2, h, 0, trim),
    slab(THICK * 1.35, TRIM_H * 0.7, scene.stage.depth, halfX + THICK / 2, h, 0, trim),
  ];

  const merged = BufferGeometryUtils.mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();

  const mesh = new Mesh(merged, material);
  mesh.frustumCulled = false;
  group.add(mesh);

  return {
    group,
    dispose() {
      merged.dispose();
      mesh.removeFromParent();
    },
  };
}
