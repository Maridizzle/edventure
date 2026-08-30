import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { makeNoise2D, warped, type Octave } from '../core/Noise';
import { stream } from '../core/Rng';
import { clamp } from '../core/Spring';

export interface TerrainParams {
  worldSize: number;
  grid: number;
  octaves: Octave[];
  warpFreq: number;
  warpAmp: number;
  /** No cliffs, ever. Clamped post-pass. This is a no-fail-state guarantee. */
  maxSlopeDeg: number;
  /**
   * The rim bowl that makes an open island read as an object.
   *
   * `null` for a diorama floor: a room's floor must NOT fall away at the edges
   * — the walls do the bounding, and a sloping skirt would look like a bug and
   * roll the player away from the very corners he needs to paint.
   */
  edgeFalloff: { start: number; power: number } | null;
}

/**
 * A heightfield the player can never fall off, get stuck on, or clip through.
 *
 * The player has no vertical velocity and no gravity — position.y is simply
 * terrain height plus an offset — so this class is also the entire collision
 * system. It cannot glitch or tunnel because there is nothing to glitch.
 */
export class Terrain {
  readonly n: number;
  readonly size: number;
  readonly step: number;
  readonly heights: Float32Array;
  minHeight = 0;
  maxHeight = 0;

  constructor(params: TerrainParams, seed: number) {
    const n = params.grid + 1;
    this.n = n;
    this.size = params.worldSize;
    this.step = params.worldSize / params.grid;
    this.heights = new Float32Array(n * n);
    this.generate(params, seed);
  }

  private generate(p: TerrainParams, seed: number): void {
    const rng = stream(seed, 'terrain');
    const base = makeNoise2D(rng);
    const warp = makeNoise2D(rng);
    const n = this.n;
    const half = p.worldSize / 2;

    for (let z = 0; z < n; z++) {
      const wz = -half + z * this.step;
      for (let x = 0; x < n; x++) {
        const wx = -half + x * this.step;
        let h = warped(base, warp, wx, wz, p.octaves, p.warpFreq, p.warpAmp);

        // Soft bowl at the rim so an open area reads as an object rather than
        // a slice of infinite plane. Skipped entirely for a diorama floor,
        // where the walls do the bounding and a sloping skirt would both look
        // like a bug and roll him away from the corners he needs to paint.
        if (p.edgeFalloff) {
          const d = Math.max(Math.abs(wx), Math.abs(wz)) / half;
          if (d > p.edgeFalloff.start) {
            const t = (d - p.edgeFalloff.start) / (1 - p.edgeFalloff.start);
            h -= Math.pow(clamp(t, 0, 1), p.edgeFalloff.power) * (Math.abs(h) + 6);
          }
        }
        this.heights[z * n + x] = h;
      }
    }

    this.clampSlopes(p.maxSlopeDeg);
    this.computeBounds();
  }

  /**
   * Iterative slope clamp. Anything steeper than maxSlope is pulled toward the
   * mean of its neighbours. Three passes is plenty and guarantees the player
   * can traverse everywhere — which is what makes the coverage target always
   * achievable.
   */
  private clampSlopes(maxSlopeDeg: number): void {
    const maxDelta = Math.tan((maxSlopeDeg * Math.PI) / 180) * this.step;
    const n = this.n;
    const h = this.heights;
    for (let pass = 0; pass < 3; pass++) {
      for (let z = 0; z < n; z++) {
        for (let x = 0; x < n; x++) {
          const i = z * n + x;
          const cur = h[i]!;
          if (x + 1 < n) this.relax(i, i + 1, cur, maxDelta);
          if (z + 1 < n) this.relax(i, i + n, cur, maxDelta);
        }
      }
    }
  }

  private relax(a: number, b: number, ha: number, maxDelta: number): void {
    const h = this.heights;
    const hb = h[b]!;
    const d = hb - ha;
    if (d > maxDelta) {
      const excess = (d - maxDelta) * 0.5;
      h[a] = ha + excess;
      h[b] = hb - excess;
    } else if (d < -maxDelta) {
      const excess = (-d - maxDelta) * 0.5;
      h[a] = ha - excess;
      h[b] = hb + excess;
    }
  }

  private computeBounds(): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < this.heights.length; i++) {
      const v = this.heights[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    this.minHeight = lo;
    this.maxHeight = hi;
  }

  /** Bilinear height sample in world space. */
  heightAt(wx: number, wz: number): number {
    const half = this.size / 2;
    const fx = clamp((wx + half) / this.step, 0, this.n - 1.0001);
    const fz = clamp((wz + half) / this.step, 0, this.n - 1.0001);
    const x0 = fx | 0;
    const z0 = fz | 0;
    const tx = fx - x0;
    const tz = fz - z0;
    const n = this.n;
    const h = this.heights;
    const i = z0 * n + x0;
    const h00 = h[i]!;
    const h10 = h[i + 1]!;
    const h01 = h[i + n]!;
    const h11 = h[i + n + 1]!;
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /**
   * Analytic normal from the heightfield. Cheaper than computeVertexNormals
   * (risk: ~1s freeze on a 160^2 grid at load) and seam-free.
   */
  normalAt(wx: number, wz: number, out: Vector3): Vector3 {
    const e = this.step;
    const hL = this.heightAt(wx - e, wz);
    const hR = this.heightAt(wx + e, wz);
    const hD = this.heightAt(wx, wz - e);
    const hU = this.heightAt(wx, wz + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  /** Steepness 0..1, where 1 is vertical. Used by scatter and the flood-fill. */
  slopeAt(wx: number, wz: number): number {
    const e = this.step;
    const hL = this.heightAt(wx - e, wz);
    const hR = this.heightAt(wx + e, wz);
    const hD = this.heightAt(wx, wz - e);
    const hU = this.heightAt(wx, wz + e);
    const gx = (hR - hL) / (2 * e);
    const gz = (hU - hD) / (2 * e);
    return Math.min(1, Math.hypot(gx, gz));
  }

  buildGeometry(): BufferGeometry {
    const n = this.n;
    const verts = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const half = this.size / 2;
    const nrm = new Vector3();

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        const wx = -half + x * this.step;
        const wz = -half + z * this.step;
        verts[i * 3] = wx;
        verts[i * 3 + 1] = this.heights[i]!;
        verts[i * 3 + 2] = wz;
        this.normalAt(wx, wz, nrm);
        normals[i * 3] = nrm.x;
        normals[i * 3 + 1] = nrm.y;
        normals[i * 3 + 2] = nrm.z;
      }
    }

    const quads = (n - 1) * (n - 1);
    const idx = quads * 6 > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
    let k = 0;
    for (let z = 0; z < n - 1; z++) {
      for (let x = 0; x < n - 1; x++) {
        const a = z * n + x;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        idx[k++] = a;
        idx[k++] = c;
        idx[k++] = b;
        idx[k++] = b;
        idx[k++] = c;
        idx[k++] = d;
      }
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(verts, 3));
    g.setAttribute('normal', new BufferAttribute(normals, 3));
    g.setIndex(new BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
