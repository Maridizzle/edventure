import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Object3D,
  type Group,
  type ShaderMaterial,
} from 'three';
import { buildMerged } from '../shape/ShapeBuilder';
import { randRange, stream, type Rng } from '../core/Rng';
import type { AreaTransform } from '../core/AreaTransform';
import type { CollectibleDef, SceneDef } from '../content/types';
import type { Placed } from './Layout';
import type { Terrain } from './Terrain';
import type { Props } from './Props';

/**
 * The hidden things, and the guidance that guarantees he can find them.
 *
 * Two ways of hiding:
 *
 *  - `tucked`  — a real object standing somewhere the terrain or a big fixture
 *                conceals it. Only possible at all because the camera is now
 *                shallow enough for hills to occlude.
 *  - `disguise` — no object at all until he bumps the ordinary prop it is
 *                pretending to be, at which point the prop vanishes and the
 *                real thing hatches out of it.
 *
 * The safety net is the warmth field: each hiding place bakes a soft radial
 * gradient into the field texture's G channel, which the ground shader already
 * samples and which was previously unused. Near a hidden thing the floor runs
 * hotter and sparkles. Hot-and-cold is the oldest wordless mechanic there is,
 * and it means a hidden object can never become a dead end.
 */

const WARMTH_RADIUS_M = 7.5;
/** How close he must get. Generous on purpose. */
const FIND_RADIUS_M = 1.9;

export interface Hidden {
  def: CollectibleDef;
  x: number;
  y: number;
  z: number;
  yaw: number;
  found: boolean;
  /** For disguised ones: the prop id standing in for it. */
  propId: number;
  kindIndex: number;
  slot: number;
}

export interface FoundEvent {
  def: CollectibleDef;
  x: number;
  y: number;
  z: number;
}

interface Kind {
  mesh: InstancedMesh;
  paintTime: InstancedBufferAttribute;
  tint: InstancedBufferAttribute;
}

const M4 = new Matrix4();
const DUMMY = new Object3D();

export class Collectibles {
  readonly items: Hidden[] = [];
  private kinds: Kind[] = [];
  private time = 0;

  constructor(
    scene: SceneDef,
    seed: number,
    terrain: Terrain,
    placed: Placed[],
    props: Props,
    material: ShaderMaterial,
    parent: Group,
    maxDetail: number,
    halfSize: number,
  ) {
    const rng = stream(seed, 'collect');
    const defs = scene.collectibles;
    if (defs.length === 0) return;

    // Group by def so each kind is a single InstancedMesh, like props.
    const perDef = new Map<number, Hidden[]>();

    for (let d = 0; d < defs.length; d++) {
      const def = defs[d]!;
      const spot =
        def.hide === 'disguise'
          ? this.pickDisguise(def, placed, props, rng)
          : this.pickTucked(placed, terrain, rng, halfSize);
      if (!spot) continue;

      const h: Hidden = {
        def,
        x: spot.x,
        y: terrain.heightAt(spot.x, spot.z),
        z: spot.z,
        yaw: randRange(rng, 0, Math.PI * 2),
        found: false,
        propId: spot.propId,
        kindIndex: d,
        slot: 0,
      };
      this.items.push(h);
      const list = perDef.get(d);
      if (list) list.push(h);
      else perDef.set(d, [h]);
    }

    // Build one mesh per def actually used.
    for (const [d, list] of perDef) {
      const def = defs[d]!;
      const geometry = buildMerged(def.shape, def.palette, maxDetail);
      const mesh = new InstancedMesh(geometry, material, list.length);
      mesh.frustumCulled = false;

      const paintTime = new InstancedBufferAttribute(new Float32Array(list.length), 1);
      const tint = new InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      paintTime.setUsage(DynamicDrawUsage);
      tint.setUsage(DynamicDrawUsage);
      paintTime.array.fill(-1);
      tint.array.fill(1);
      geometry.setAttribute('aPaintTime', paintTime);
      geometry.setAttribute('aTint', tint);

      const kindIndex = this.kinds.length;
      this.kinds.push({ mesh, paintTime, tint });

      for (let s = 0; s < list.length; s++) {
        const h = list[s]!;
        h.kindIndex = kindIndex;
        h.slot = s;
        // A disguised one has no body until it hatches; a tucked one stands
        // there from the start, drained gray like everything else.
        this.setMatrix(mesh, s, h, h.def.hide === 'disguise' ? 0 : h.def.scale);
      }
      mesh.instanceMatrix.needsUpdate = true;
      parent.add(mesh);
    }
  }

  private setMatrix(mesh: InstancedMesh, slot: number, h: Hidden, scale: number): void {
    DUMMY.position.set(h.x, h.y, h.z);
    DUMMY.rotation.set(0, h.yaw, 0);
    DUMMY.scale.setScalar(scale);
    DUMMY.updateMatrix();
    M4.copy(DUMMY.matrix);
    mesh.setMatrixAt(slot, M4);
  }

  /** Take over an existing prop of the right kind. */
  private pickDisguise(
    def: CollectibleDef,
    placed: Placed[],
    props: Props,
    rng: Rng,
  ): { x: number; z: number; propId: number } | null {
    const candidates: number[] = [];
    for (let i = 0; i < placed.length; i++) {
      if (placed[i]!.kind === def.disguiseAs && !props.isDisguised(i)) candidates.push(i);
    }
    if (candidates.length === 0) return null;
    const id = candidates[Math.floor(rng() * candidates.length)]!;
    props.markDisguised(id);
    const p = placed[id]!;
    return { x: p.x, z: p.z, propId: id };
  }

  /**
   * Find somewhere genuinely out of sight.
   *
   * Because the camera's yaw is fixed, "behind" is a constant direction: -Z is
   * away from the viewer. So a good hiding place is one that sits on the far
   * side of a tall thing, or down in a hollow where the ground in front of it
   * rises. Both are scored and the best of many candidates wins.
   */
  private pickTucked(
    placed: Placed[],
    terrain: Terrain,
    rng: Rng,
    halfSize: number,
  ): { x: number; z: number; propId: number } | null {
    let best: { x: number; z: number; score: number } | null = null;
    const lim = halfSize - 4;

    for (let attempt = 0; attempt < 90; attempt++) {
      const x = randRange(rng, -lim, lim);
      const z = randRange(rng, -lim, lim);

      // Never on the spawn apron -- he must have to go somewhere.
      if (Math.hypot(x, z - (halfSize - 4.5)) < 12) continue;

      const here = terrain.heightAt(x, z);
      let score = 0;

      // Concealed by a rise between him and it: sample the ground toward the
      // viewer and reward anything that stands taller than this spot.
      for (const ahead of [4, 7, 10]) {
        const rise = terrain.heightAt(x, z + ahead) - here;
        if (rise > 0) score += rise * 2.2;
      }

      // Or tucked behind a big object.
      for (const p of placed) {
        if (p.isScatter) continue;
        const dx = p.x - x;
        const dz = p.z - z;
        const d = Math.hypot(dx, dz);
        if (d < 6 && dz > 1.2) score += (6 - d) * 1.4;
      }

      // A little jitter so identical scores do not always pick the same corner.
      score += rng() * 0.4;

      if (!best || score > best.score) best = { x, z, score };
    }

    return best ? { x: best.x, z: best.z, propId: -1 } : null;
  }

  /**
   * Bake the hot/cold guidance into the field texture's G channel.
   * Call once after placement; re-call when one is found to clear its glow.
   */
  bakeWarmth(field: Uint8Array, transform: AreaTransform): void {
    const n = transform.cells;
    for (let i = 0; i < n * n; i++) field[i * 2 + 1] = 0;

    for (const h of this.items) {
      if (h.found) continue;
      const cx = transform.cellX(h.x);
      const cz = transform.cellZ(h.z);
      const rc = transform.radiusCells(WARMTH_RADIUS_M);
      const x0 = Math.max(0, Math.floor(cx - rc));
      const x1 = Math.min(n - 1, Math.ceil(cx + rc));
      const z0 = Math.max(0, Math.floor(cz - rc));
      const z1 = Math.min(n - 1, Math.ceil(cz + rc));

      for (let z = z0; z <= z1; z++) {
        const dz = z - cz;
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const d = Math.sqrt(dx * dx + dz * dz) / rc;
          if (d >= 1) continue;
          const t = 1 - d;
          const v = Math.round(255 * t * t);
          const i = (z * n + x) * 2 + 1;
          if (v > field[i]!) field[i] = v;
        }
      }
    }
  }

  /** 0..1, how close he is to the nearest unfound thing. Drives the audio tell. */
  warmthAt(x: number, z: number): number {
    let best = 0;
    for (const h of this.items) {
      if (h.found) continue;
      const d = Math.hypot(h.x - x, h.z - z) / WARMTH_RADIUS_M;
      if (d < 1) {
        const t = 1 - d;
        if (t * t > best) best = t * t;
      }
    }
    return best;
  }

  setTime(t: number): void {
    this.time = t;
  }

  /** A disguised prop was just painted: hatch whatever was pretending to be it. */
  onPropPainted(propId: number, out: FoundEvent[]): void {
    for (const h of this.items) {
      if (h.found || h.propId !== propId) continue;
      this.reveal(h, out);
    }
  }

  /** Proximity check for tucked ones. Cheap: there are only a handful. */
  checkProximity(x: number, z: number, radius: number, out: FoundEvent[]): void {
    for (const h of this.items) {
      if (h.found || h.def.hide !== 'tucked') continue;
      const d = Math.hypot(h.x - x, h.z - z);
      if (d <= FIND_RADIUS_M + radius) this.reveal(h, out);
    }
  }

  private reveal(h: Hidden, out: FoundEvent[]): void {
    h.found = true;
    const k = this.kinds[h.kindIndex]!;
    // Disguised ones have to grow a body; tucked ones already have one.
    this.setMatrix(k.mesh, h.slot, h, h.def.scale);
    k.mesh.instanceMatrix.needsUpdate = true;
    // Reuse the props' paint animation: setting the time triggers the pop.
    k.paintTime.array[h.slot] = this.time;
    k.paintTime.addUpdateRange(h.slot, 1);
    k.paintTime.needsUpdate = true;
    out.push({ def: h.def, x: h.x, y: h.y, z: h.z });
  }

  get foundCount(): number {
    let c = 0;
    for (const h of this.items) if (h.found) c++;
    return c;
  }

  dispose(): void {
    for (const k of this.kinds) {
      k.mesh.geometry.dispose();
      k.mesh.removeFromParent();
      k.mesh.dispose();
    }
    this.kinds.length = 0;
  }
}
