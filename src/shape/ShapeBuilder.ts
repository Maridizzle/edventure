import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Euler,
  Quaternion,
  Vector3,
} from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Part, Prim, ShapeRecipe } from '../content/types';

/**
 * THE asset pipeline. All ~200 lines of it.
 *
 * Every prop, collectible, gate and player character in the game is built from
 * cached unit primitives merged into a single BufferGeometry with baked vertex
 * colours. No models, no rigs, no textures, no Blender step, no loader — which
 * is the only reason one person plus an agent can produce endless content for
 * this game in evenings.
 */

const cache = new Map<string, BufferGeometry>();

function unit(prim: Prim, detail: number): BufferGeometry {
  const key = `${prim}:${detail}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let g: BufferGeometry;
  switch (prim) {
    case 'sphere':
      g = new SphereGeometry(1, 6 + detail * 4, 4 + detail * 3);
      break;
    case 'box':
      g = new BoxGeometry(2, 2, 2);
      break;
    case 'cone':
      g = new ConeGeometry(1, 2, 6 + detail * 4);
      break;
    case 'cyl':
      g = new CylinderGeometry(1, 1, 2, 6 + detail * 3);
      break;
    case 'torus':
      g = new TorusGeometry(1, 0.35, 4 + detail * 2, 8 + detail * 6);
      break;
    case 'icos':
      g = new IcosahedronGeometry(1, detail);
      break;
    case 'capsule':
      g = new CapsuleGeometry(1, 1.4, 2 + detail, 6 + detail * 4);
      break;
  }
  // Strip everything we do not use — uv and tangents are pure memory here.
  g.deleteAttribute('uv');
  cache.set(key, g);
  return g;
}

const M = new Matrix4();
const Q = new Quaternion();
const E = new Euler();
const P = new Vector3();
const S = new Vector3();

function linear(hex: number): Color {
  return new Color().setHex(hex, SRGBColorSpace);
}

/**
 * Expand a part's `repeat` into concrete transforms.
 *
 * Exported because the 2D silhouette renderer in `ui/Silhouette.ts` projects the
 * very same recipes and must expand repeats identically. Two of these rules are
 * easy to get wrong from a reading of the type alone: `mirrorX` mirrors only
 * `pos[0]` while adding `step[0] * k` unmirrored (with `k = floor(i / 2)`, so
 * instances go +,-,+,- in pairs) and flips only `rot[2]`; and `radialY`
 * DISCARDS the authored x and z, replacing them with a ring of radius
 * `hypot(pos[0], pos[2])`. A second implementation would drift from this one
 * silently, and the only symptom would be a slightly wrong little picture.
 */
export function* instancesOf(part: Part): Generator<{ pos: number[]; rot: number[]; scale: number[] }> {
  const rot = part.rot ?? [0, 0, 0];
  if (!part.repeat) {
    yield { pos: part.pos, rot, scale: part.scale };
    return;
  }
  const { count, mode, step, rotStep } = part.repeat;
  for (let i = 0; i < count; i++) {
    if (mode === 'mirrorX') {
      const sign = i % 2 === 0 ? 1 : -1;
      const k = Math.floor(i / 2);
      yield {
        pos: [part.pos[0] * sign + step[0] * k, part.pos[1] + step[1] * k, part.pos[2] + step[2] * k],
        rot: [rot[0], rot[1], rot[2] * sign],
        scale: part.scale,
      };
    } else if (mode === 'radialY') {
      const a = (i / count) * Math.PI * 2;
      const r = Math.hypot(part.pos[0], part.pos[2]);
      yield {
        pos: [Math.cos(a) * r, part.pos[1], Math.sin(a) * r],
        rot: [rot[0], rot[1] + a + (rotStep ?? 0) * i, rot[2]],
        scale: part.scale,
      };
    } else {
      yield {
        pos: [part.pos[0] + step[0] * i, part.pos[1] + step[1] * i, part.pos[2] + step[2] * i],
        rot,
        scale: part.scale,
      };
    }
  }
}

function partGeometry(part: Part, palette: number[], maxDetail: number): BufferGeometry[] {
  const detail = Math.min(part.detail ?? 0, maxDetail);
  const src = unit(part.prim, detail);
  const col = linear(palette[part.color] ?? 0xffffff);
  const out: BufferGeometry[] = [];

  for (const inst of instancesOf(part)) {
    const g = src.clone();
    E.set(inst.rot[0]!, inst.rot[1]!, inst.rot[2]!);
    Q.setFromEuler(E);
    P.set(inst.pos[0]!, inst.pos[1]!, inst.pos[2]!);
    S.set(inst.scale[0]!, inst.scale[1]!, inst.scale[2]!);
    M.compose(P, Q, S);
    g.applyMatrix4(M);

    const n = g.attributes.position!.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    out.push(g);
  }
  return out;
}

export interface BuiltShape {
  geometry: BufferGeometry;
  /** Named sub-geometries, kept separate for springs and hatch animation. */
  parts: Map<string, BufferGeometry>;
}

/**
 * Merge a whole recipe into one geometry. Used for props and collectibles,
 * where a single draw call per kind is what keeps us inside the draw budget.
 */
export function buildMerged(recipe: ShapeRecipe, palette: number[], maxDetail = 2): BufferGeometry {
  const geos: BufferGeometry[] = [];
  for (const part of recipe.parts) geos.push(...partGeometry(part, palette, maxDetail));
  const merged = BufferGeometryUtils.mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Build with named parts kept separate. Used for the player character, whose
 * parts each need their own lag spring — 5-8 extra draw calls for the single
 * on-screen character, which is well within budget and is what makes a pile of
 * primitives feel alive.
 */
export interface NamedPart {
  id: string;
  geometry: BufferGeometry;
  rest: Vector3;
  billboard: boolean;
}

export function buildParts(
  recipe: ShapeRecipe,
  palette: number[],
  maxDetail = 2,
): { named: NamedPart[]; body: BufferGeometry | null } {
  const named: NamedPart[] = [];
  const anon: BufferGeometry[] = [];

  for (const part of recipe.parts) {
    const geos = partGeometry(part, palette, maxDetail);
    if (part.id) {
      // Re-centre so the spring moves the part around its own origin.
      const merged = geos.length === 1 ? geos[0]! : BufferGeometryUtils.mergeGeometries(geos, false);
      if (geos.length > 1) for (const g of geos) g.dispose();
      const rest = new Vector3(part.pos[0], part.pos[1], part.pos[2]);
      merged.translate(-rest.x, -rest.y, -rest.z);
      merged.computeBoundingSphere();
      named.push({ id: part.id, geometry: merged, rest, billboard: part.billboard === true });
    } else {
      anon.push(...geos);
    }
  }

  let body: BufferGeometry | null = null;
  if (anon.length) {
    body = BufferGeometryUtils.mergeGeometries(anon, false);
    for (const g of anon) g.dispose();
    body.computeBoundingSphere();
  }
  return { named, body };
}

/** Free the shared primitive cache. Only for teardown in tests. */
export function disposeShapeCache(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
