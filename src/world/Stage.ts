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
 * build. Nothing can ever come between the camera and the player, with no wall
 * fading, no camera collision and no transparency sorting.
 *
 * Everything merges into ONE geometry, so the entire shell is a single draw
 * call.
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
/**
 * How far the tray reaches past the stage on every side.
 *
 * Generous on purpose. At a ~30 degree camera pitch with a 42 degree FOV the
 * bottom edge of the frame strikes the ground about 13m in front of the
 * CAMERA, which is several metres beyond the stage itself — with a small lip
 * the nearest strip of screen showed bare sky. The tray is never explored, so
 * the radial fog hazes its far reaches out and it reads as the ground the
 * diorama rests on rather than a visible platform.
 */
const BASE_APRON = 16;
/** Clearance below the floor, so the two surfaces never z-fight. */
const BASE_DROP = 0.12;
/** Width of the opening left in the back wall for the doorway. */
const DOOR_GAP = 6.5;

export function buildStage(
  scene: SceneDef,
  material: ShaderMaterial,
  doorX: number,
): StageBuild {
  const group = new Group();
  if (scene.stage.walls !== 'solid') return { group, dispose: () => {} };

  const halfX = scene.stage.width / 2;
  const halfZ = scene.stage.depth / 2;
  const h = scene.stage.wallHeight;
  const wall = linear(scene.palette.wall);
  const trim = linear(scene.palette.trim);

  const backZ = -halfZ - THICK / 2;

  // The back wall is split either side of the door, so the doorway is a real
  // opening rather than an ornament stuck to a solid wall.
  const gapL = doorX - DOOR_GAP / 2;
  const gapR = doorX + DOOR_GAP / 2;
  const leftW = Math.max(0, gapL - -(halfX + THICK));
  const rightW = Math.max(0, halfX + THICK - gapR);
  const leftCx = -(halfX + THICK) + leftW / 2;
  const rightCx = gapR + rightW / 2;

  const parts: BoxGeometry[] = [
    slab(
      scene.stage.width + BASE_APRON * 2,
      BASE_H,
      scene.stage.depth + BASE_APRON * 2,
      0,
      -BASE_H / 2 - BASE_DROP,
      0,
      trim,
    ),

    // back wall, in two pieces around the doorway
    ...(leftW > 0.01 ? [slab(leftW, h, THICK, leftCx, h / 2, backZ, wall)] : []),
    ...(rightW > 0.01 ? [slab(rightW, h, THICK, rightCx, h / 2, backZ, wall)] : []),

    // side walls
    slab(THICK, h, scene.stage.depth, -halfX - THICK / 2, h / 2, 0, wall),
    slab(THICK, h, scene.stage.depth, halfX + THICK / 2, h / 2, 0, wall),

    // skirting grounds the walls against the floor
    ...(leftW > 0.01 ? [slab(leftW, TRIM_H, THICK * 1.35, leftCx, TRIM_H / 2, backZ, trim)] : []),
    ...(rightW > 0.01 ? [slab(rightW, TRIM_H, THICK * 1.35, rightCx, TRIM_H / 2, backZ, trim)] : []),
    slab(THICK * 1.35, TRIM_H, scene.stage.depth, -halfX - THICK / 2, TRIM_H / 2, 0, trim),
    slab(THICK * 1.35, TRIM_H, scene.stage.depth, halfX + THICK / 2, TRIM_H / 2, 0, trim),

    // top rail caps the wall so it reads as a built box, not a cut plane
    ...(leftW > 0.01 ? [slab(leftW, TRIM_H * 0.7, THICK * 1.35, leftCx, h, backZ, trim)] : []),
    ...(rightW > 0.01 ? [slab(rightW, TRIM_H * 0.7, THICK * 1.35, rightCx, h, backZ, trim)] : []),
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
