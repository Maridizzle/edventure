import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Object3D,
  SRGBColorSpace,
  type Group,
  type ShaderMaterial,
} from 'three';
import { buildMerged } from '../shape/ShapeBuilder';
import type { Fixture, SceneDef } from '../content/types';
import type { Placed } from './Layout';
import type { Terrain } from './Terrain';

/**
 * Every prop and fixture in the scene.
 *
 * One InstancedMesh per kind — a unique centrepiece is simply count = 1. That
 * keeps fixtures and scatter on a single code path with a single material, and
 * keeps draw calls proportional to the number of KINDS (about 9) rather than
 * the number of objects (about 150).
 */

const CELL = 4; // spatial-hash cell size, metres

interface Kind {
  mesh: InstancedMesh;
  paintTime: InstancedBufferAttribute;
  tint: InstancedBufferAttribute;
}

export interface PropTouch {
  x: number;
  z: number;
  y: number;
  note: number[] | null;
  color: number;
}

export class Props {
  readonly kinds: Kind[] = [];
  total = 0;
  paintedCount = 0;

  /** Flat per-object arrays; index is the global prop id. */
  private px: Float32Array;
  private pz: Float32Array;
  private pr: Float32Array;
  private painted: Uint8Array;
  private kindOf: Uint16Array;
  private slotOf: Uint16Array;
  private noteOf: (number[] | null)[] = [];
  private colorOf: Int32Array;
  private py: Float32Array;
  /** Collision radius. 0 means he rolls straight through. */
  private solid: Float32Array;
  /** Ids of painted props, so twinkles can pick one without scanning. */
  private paintedIds: number[] = [];

  /** Uniform grid: cell key -> prop ids. Never raycast against 150 objects. */
  private hash = new Map<number, number[]>();
  private hashCols: number;

  constructor(
    scene: SceneDef,
    placed: Placed[],
    terrain: Terrain,
    material: ShaderMaterial,
    parent: Group,
    maxDetail: number,
  ) {
    this.total = placed.length;
    this.px = new Float32Array(this.total);
    this.pz = new Float32Array(this.total);
    this.pr = new Float32Array(this.total);
    this.painted = new Uint8Array(this.total);
    this.kindOf = new Uint16Array(this.total);
    this.slotOf = new Uint16Array(this.total);
    this.colorOf = new Int32Array(this.total);
    this.py = new Float32Array(this.total);
    this.solid = new Float32Array(this.total);
    this.hashCols = Math.ceil(Math.max(scene.stage.width, scene.stage.depth) / CELL) + 4;

    // Group placements by (isScatter, defIndex) so each kind gets one mesh.
    const groups = new Map<string, Placed[]>();
    for (const p of placed) {
      const key = `${p.isScatter ? 's' : 'f'}${p.defIndex}`;
      const g = groups.get(key);
      if (g) g.push(p);
      else groups.set(key, [p]);
    }

    const dummy = new Object3D();
    const m4 = new Matrix4();
    let id = 0;

    for (const [key, items] of groups) {
      const isScatter = key[0] === 's';
      const defIndex = Number(key.slice(1));
      const def: Fixture = isScatter ? scene.scatter[defIndex]! : scene.fixtures[defIndex]!;

      const geometry = buildMerged(def.shape, def.palette, maxDetail);
      const mesh = new InstancedMesh(geometry, material, items.length);
      // The stage is small enough that everything is on screen anyway, and
      // InstancedMesh culls as a single unit regardless.
      mesh.frustumCulled = false;

      const paintTime = new InstancedBufferAttribute(new Float32Array(items.length), 1);
      const tint = new InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
      paintTime.setUsage(DynamicDrawUsage);
      tint.setUsage(DynamicDrawUsage);
      paintTime.array.fill(-1); // -1 = never painted
      tint.array.fill(1);
      geometry.setAttribute('aPaintTime', paintTime);
      geometry.setAttribute('aTint', tint);

      const kindIndex = this.kinds.length;
      this.kinds.push({ mesh, paintTime, tint });

      for (let s = 0; s < items.length; s++) {
        const it = items[s]!;
        const y = terrain.heightAt(it.x, it.z);
        dummy.position.set(it.x, y, it.z);
        dummy.rotation.set(0, it.yaw, 0);
        dummy.scale.setScalar(it.scale);
        dummy.updateMatrix();
        m4.copy(dummy.matrix);
        mesh.setMatrixAt(s, m4);

        this.px[id] = it.x;
        this.pz[id] = it.z;
        this.py[id] = y;
        this.colorOf[id] = def.palette[0] ?? 0xffffff;
        // Big things block; small things do not. Without that distinction
        // "go around it" means nothing and hills are just scenery.
        this.solid[id] = (def.solid ?? 0) * it.scale;
        // Touch radius is generous: a 5-year-old aiming at a lollipop should
        // hit it. Being too forgiving is invisible; being too strict is not.
        this.pr[id] = it.footprint * 0.85 + 0.6;
        this.kindOf[id] = kindIndex;
        this.slotOf[id] = s;
        this.noteOf.push(def.note);
        this.addToHash(id, it.x, it.z);
        id++;
      }

      mesh.instanceMatrix.needsUpdate = true;
      parent.add(mesh);
    }
  }

  private cellKey(x: number, z: number): number {
    const cx = Math.floor(x / CELL) + 512;
    const cz = Math.floor(z / CELL) + 512;
    return cz * this.hashCols * 4 + cx;
  }

  private addToHash(id: number, x: number, z: number): void {
    const k = this.cellKey(x, z);
    const bucket = this.hash.get(k);
    if (bucket) bucket.push(id);
    else this.hash.set(k, [id]);
  }

  /**
   * Returns props newly touched this step. Queries the 9 cells around the
   * player rather than testing all of them.
   */
  collectTouched(x: number, z: number, radius: number, out: PropTouch[]): void {
    out.length = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.hash.get(this.cellKey(x + dx * CELL, z + dz * CELL));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const id = bucket[i]!;
          if (this.painted[id]) continue;
          const ddx = this.px[id]! - x;
          const ddz = this.pz[id]! - z;
          const r = this.pr[id]! + radius;
          if (ddx * ddx + ddz * ddz > r * r) continue;
          this.painted[id] = 1;
          this.paintedCount++;
          this.paintedIds.push(id);
          out.push({
            x: this.px[id]!,
            z: this.pz[id]!,
            y: this.py[id]!,
            note: this.noteOf[id]!,
            color: this.colorOf[id]!,
          });
          this.markPainted(id);
        }
      }
    }
  }

  /** Four floats and a tight update range. No matrix work. */
  private markPainted(id: number): void {
    const k = this.kinds[this.kindOf[id]!]!;
    const slot = this.slotOf[id]!;
    k.paintTime.array[slot] = this.time;
    k.paintTime.addUpdateRange(slot, 1);
    k.paintTime.needsUpdate = true;

    // A slight per-instance tint variation so a row of gumballs isn't uniform.
    const t = 0.88 + ((id * 2654435761) % 1000) / 1000 * 0.24;
    k.tint.array[slot * 3] = t;
    k.tint.array[slot * 3 + 1] = t;
    k.tint.array[slot * 3 + 2] = t;
    k.tint.addUpdateRange(slot * 3, 3);
    k.tint.needsUpdate = true;
  }

  private time = 0;
  setTime(t: number): void {
    this.time = t;
  }

  /**
   * Push a circle out of every nearby solid prop.
   *
   * Queries the same 9 spatial-hash cells as touch detection. Obstacles are
   * convex and never overlap each other, so a single pass cannot wedge him.
   */
  resolveSolids(pos: { x: number; z: number }, vel: { x: number; z: number }, radius: number): void {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.hash.get(this.cellKey(pos.x + dx * CELL, pos.z + dz * CELL));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const id = bucket[i]!;
          const sr = this.solid[id]!;
          if (sr <= 0) continue;
          const ox = pos.x - this.px[id]!;
          const oz = pos.z - this.pz[id]!;
          const min = sr + radius;
          const d2 = ox * ox + oz * oz;
          if (d2 >= min * min) continue;

          const d = Math.sqrt(d2);
          // Dead centre: shove in an arbitrary but deterministic direction.
          const nx = d > 1e-4 ? ox / d : 1;
          const nz = d > 1e-4 ? oz / d : 0;
          pos.x = this.px[id]! + nx * min;
          pos.z = this.pz[id]! + nz * min;

          // Cancel only the velocity going INTO the obstacle, so he slides
          // around it rather than stopping dead against it.
          const into = vel.x * nx + vel.z * nz;
          if (into < 0) {
            vel.x -= into * nx;
            vel.z -= into * nz;
          }
        }
      }
    }
  }

  /** A painted prop to sparkle, or null. Keeps a finished room feeling alive. */
  randomPainted(): { x: number; y: number; z: number; color: number } | null {
    if (this.paintedIds.length === 0) return null;
    const id = this.paintedIds[(Math.random() * this.paintedIds.length) | 0]!;
    return { x: this.px[id]!, y: this.py[id]! + 0.6, z: this.pz[id]!, color: this.colorOf[id]! };
  }

  solidRadiusOf(defIndex: number, isScatter: boolean, scene: SceneDef, scale: number): number {
    const def = isScatter ? scene.scatter[defIndex]! : scene.fixtures[defIndex]!;
    return (def.solid ?? 0) * scale;
  }

  get coverage(): number {
    return this.total === 0 ? 0 : this.paintedCount / this.total;
  }

  dispose(): void {
    for (const k of this.kinds) {
      k.mesh.geometry.dispose();
      k.mesh.removeFromParent();
      k.mesh.dispose();
    }
    this.kinds.length = 0;
    this.hash.clear();
  }
}

/** Shared scratch so the frame loop allocates nothing. */
export const TOUCH_SCRATCH: PropTouch[] = [];
export const TINT_COLOR = new Color().setHex(0xffffff, SRGBColorSpace);
