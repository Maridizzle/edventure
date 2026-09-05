import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { instancesOf } from '../shape/ShapeBuilder';
import type { Prim, ShapeRecipe } from '../content/types';

/**
 * The second renderer.
 *
 * `ShapeBuilder` turns a recipe into 3D geometry; this turns the SAME recipe
 * into a flat 2D shape, on the CPU, with no WebGL and no new artwork. That is
 * the whole reason the collection row can show a recognisable brontosaurus
 * rather than a coloured dot: the picture is derived from the creature itself,
 * so adding a creature still means adding one data file and nothing else.
 *
 * The view is CHOSEN, not fixed. Most creatures read best in side profile
 * (horizontal = world Z): a dinosaur seen head-on is a blob, and in profile
 * `mirrorX` repeats like legs land on top of each other, which is what a
 * silhouette wants. But flat things -- a butterfly's wings, a coin's face --
 * are edge-on from the side and come out as slivers. So each recipe is
 * projected both ways and the view with the larger footprint wins. It is one
 * extra projection of nine shapes, once, at startup.
 *
 * Every part is filled in one flat colour, so overlapping parts merge into a
 * single shape instead of reading as a pile of blobs.
 */

/**
 * Half-extents of each UNIT primitive, in its own local space, before the
 * part's own scale is applied.
 *
 * These are the numbers that make or break this file, and not one of them is 1
 * by accident -- they are read straight off the `unit()` constructors in
 * ShapeBuilder. A box is TWO units across, a cone is two tall with its apex at
 * +1, a capsule is 3.4 tall, a torus is 1.35 across and 0.7 thick. Assume unit
 * cubes and unit spheres here and the silhouettes come out subtly wrong with
 * nothing anywhere to say so.
 */
const EXTENT: Record<Prim, [number, number, number]> = {
  sphere: [1, 1, 1],
  box: [1, 1, 1],
  cone: [1, 1, 1],
  cyl: [1, 1, 1],
  torus: [1.35, 1.35, 0.35],
  icos: [1, 1, 1],
  capsule: [1, 1.7, 1],
};

/** Round prims project to a true ellipse; the rest are hulls of sample points. */
const ROUND: ReadonlySet<Prim> = new Set<Prim>(['sphere', 'icos', 'capsule', 'torus']);

interface Ellipse {
  kind: 'ellipse';
  x: number;
  y: number;
  rx: number;
  ry: number;
  angle: number;
}

interface Poly {
  kind: 'poly';
  pts: number[]; // flat x,y pairs
}

type Shape2D = Ellipse | Poly;

const M4 = new Matrix4();
const QUAT = new Quaternion();
const EUL = new Euler();
const POS = new Vector3();
const SCL = new Vector3();
const V = new Vector3();

/**
 * World -> screen. Y runs up and canvas Y runs down, so vertical is always
 * negated; horizontal is Z from the side and X from the front.
 */
type Plane = 'side' | 'front';

function px(v: Vector3, plane: Plane): number {
  return plane === 'side' ? v.z : v.x;
}
function py(v: Vector3): number {
  return -v.y;
}

/**
 * The exact outline of an ellipsoid under orthographic projection.
 *
 * The image of a unit ball under the 2x3 map formed by the three projected axis
 * vectors is an ellipse whose semi-axes are that map's singular values. For a
 * 2x3 those fall out of the eigenvalues of the 2x2 `M * Mt`, which is four
 * multiplies and a square root -- far cheaper, and smoother at 28 pixels, than
 * sampling a sphere and hulling it.
 */
function ellipseFromAxes(cx: number, cy: number, a: number[], b: number[], c: number[]): Ellipse {
  const g11 = a[0]! * a[0]! + b[0]! * b[0]! + c[0]! * c[0]!;
  const g12 = a[0]! * a[1]! + b[0]! * b[1]! + c[0]! * c[1]!;
  const g22 = a[1]! * a[1]! + b[1]! * b[1]! + c[1]! * c[1]!;

  const mid = (g11 + g22) / 2;
  const dev = Math.sqrt(Math.max(0, ((g11 - g22) / 2) ** 2 + g12 * g12));
  return {
    kind: 'ellipse',
    x: cx,
    y: cy,
    rx: Math.sqrt(Math.max(0, mid + dev)),
    ry: Math.sqrt(Math.max(0, mid - dev)),
    angle: 0.5 * Math.atan2(2 * g12, g11 - g22),
  };
}

/** Monotone chain. Small inputs -- at most 22 points from a cylinder. */
function hull(pts: number[]): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts;
  const idx = [...Array(n).keys()].sort(
    (i, j) => pts[i * 2]! - pts[j * 2]! || pts[i * 2 + 1]! - pts[j * 2 + 1]!,
  );
  const cross = (o: number, a: number, b: number): number =>
    (pts[a * 2]! - pts[o * 2]!) * (pts[b * 2 + 1]! - pts[o * 2 + 1]!) -
    (pts[a * 2 + 1]! - pts[o * 2 + 1]!) * (pts[b * 2]! - pts[o * 2]!);

  const build = (order: number[]): number[] => {
    const out: number[] = [];
    for (const i of order) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, i) <= 0) out.pop();
      out.push(i);
    }
    out.pop();
    return out;
  };
  const lower = build(idx);
  const upper = build([...idx].reverse());
  const flat: number[] = [];
  for (const i of [...lower, ...upper]) flat.push(pts[i * 2]!, pts[i * 2 + 1]!);
  return flat;
}

/** Points whose hull is the silhouette, in the unit primitive's local space. */
function samplePoints(prim: Prim, out: number[][]): void {
  out.length = 0;
  const RING = 10;
  if (prim === 'box') {
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push([x, y, z]);
    return;
  }
  if (prim === 'cone') {
    out.push([0, 1, 0]);
    for (let i = 0; i < RING; i++) {
      const a = (i / RING) * Math.PI * 2;
      out.push([Math.cos(a), -1, Math.sin(a)]);
    }
    return;
  }
  // cyl
  for (let i = 0; i < RING; i++) {
    const a = (i / RING) * Math.PI * 2;
    out.push([Math.cos(a), 1, Math.sin(a)], [Math.cos(a), -1, Math.sin(a)]);
  }
}

/** Project a whole recipe into flat shapes, in world units. */
function project(recipe: ShapeRecipe, plane: Plane): Shape2D[] {
  const shapes: Shape2D[] = [];
  const pts: number[][] = [];

  for (const part of recipe.parts) {
    const ext = EXTENT[part.prim];
    for (const inst of instancesOf(part)) {
      EUL.set(inst.rot[0]!, inst.rot[1]!, inst.rot[2]!);
      QUAT.setFromEuler(EUL);
      POS.set(inst.pos[0]!, inst.pos[1]!, inst.pos[2]!);
      SCL.set(inst.scale[0]!, inst.scale[1]!, inst.scale[2]!);
      // Scale, then rotate, then translate -- the order partGeometry composes.
      M4.compose(POS, QUAT, SCL);

      if (ROUND.has(part.prim)) {
        // Three axis vectors, each the primitive's half-extent along one axis
        // carried through the same transform with the translation removed.
        const axes: number[][] = [];
        for (const [i, e] of ext.entries()) {
          V.set(i === 0 ? e : 0, i === 1 ? e : 0, i === 2 ? e : 0);
          V.applyMatrix4(M4).sub(POS);
          axes.push([px(V, plane), py(V)]);
        }
        V.copy(POS);
        shapes.push(ellipseFromAxes(px(V, plane), py(V), axes[0]!, axes[1]!, axes[2]!));
        continue;
      }

      samplePoints(part.prim, pts);
      const flat: number[] = [];
      for (const p of pts) {
        V.set(p[0]! * ext[0], p[1]! * ext[1], p[2]! * ext[2]).applyMatrix4(M4);
        flat.push(px(V, plane), py(V));
      }
      shapes.push({ kind: 'poly', pts: hull(flat) });
    }
  }
  return shapes;
}

function bounds(shapes: Shape2D[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const hit = (x: number, y: number): void => {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };
  for (const s of shapes) {
    if (s.kind === 'ellipse') {
      // An axis-aligned box around a rotated ellipse.
      const c = Math.abs(Math.cos(s.angle));
      const sn = Math.abs(Math.sin(s.angle));
      const ex = Math.hypot(s.rx * c, s.ry * sn);
      const ey = Math.hypot(s.rx * sn, s.ry * c);
      hit(s.x - ex, s.y - ey);
      hit(s.x + ex, s.y + ey);
    } else {
      for (let i = 0; i < s.pts.length; i += 2) hit(s.pts[i]!, s.pts[i + 1]!);
    }
  }
  return { x0, y0, x1, y1 };
}

/**
 * Whichever way round the creature shows the most of itself.
 *
 * Scored on the area of the projection's bounding box rather than the summed
 * area of its parts, deliberately: a flat thing seen edge-on stacks all its
 * parts on top of each other, and summing them would score that pile HIGHER
 * than the view that actually shows the wings.
 */
function pickPlane(recipe: ShapeRecipe): { plane: Plane; shapes: Shape2D[] } {
  let best: { plane: Plane; shapes: Shape2D[]; area: number } | null = null;
  for (const plane of ['side', 'front'] as const) {
    const shapes = project(recipe, plane);
    if (shapes.length === 0) continue;
    const b = bounds(shapes);
    const area = (b.x1 - b.x0) * (b.y1 - b.y0);
    if (!best || area > best.area) best = { plane, shapes, area };
  }
  return best ?? { plane: 'side', shapes: [] };
}

/** The projected extent of a recipe, for tests and for fitting. */
export function silhouetteBounds(recipe: ShapeRecipe): {
  width: number;
  height: number;
  shapes: number;
  plane: Plane;
} {
  const { plane, shapes } = pickPlane(recipe);
  if (shapes.length === 0) return { width: 0, height: 0, shapes: 0, plane };
  const b = bounds(shapes);
  return { width: b.x1 - b.x0, height: b.y1 - b.y0, shapes: shapes.length, plane };
}

/**
 * Draw a recipe as one flat shape, scaled to fit a box of `size` pixels.
 *
 * Auto-fitting is not optional: recipes range from a 0.6 m coin to a 3 m
 * dinosaur, and a shared scale would render half the collection as specks.
 */
export function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  recipe: ShapeRecipe,
  style: string,
  size: number,
  pad = 0.1,
): void {
  const { shapes } = pickPlane(recipe);
  if (shapes.length === 0) return;
  const b = bounds(shapes);
  const w = Math.max(1e-4, b.x1 - b.x0);
  const h = Math.max(1e-4, b.y1 - b.y0);
  const inner = size * (1 - pad * 2);
  const k = Math.min(inner / w, inner / h);

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(k, k);
  ctx.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2);
  ctx.fillStyle = style;

  for (const s of shapes) {
    ctx.beginPath();
    if (s.kind === 'ellipse') {
      ctx.ellipse(s.x, s.y, Math.max(1e-4, s.rx), Math.max(1e-4, s.ry), s.angle, 0, Math.PI * 2);
    } else {
      for (let i = 0; i < s.pts.length; i += 2) {
        if (i === 0) ctx.moveTo(s.pts[0]!, s.pts[1]!);
        else ctx.lineTo(s.pts[i]!, s.pts[i + 1]!);
      }
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.restore();
}

/** `#rrggbb` from the hex numbers content files use. */
export function cssHex(hex: number): string {
  return `#${(hex >>> 0).toString(16).padStart(6, '0')}`;
}
