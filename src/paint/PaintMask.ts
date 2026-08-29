/**
 * The paint mask. This is the heart of the game.
 *
 * Layout: one interleaved RG Uint8Array, uploaded directly as an RG8
 * DataTexture with no conversion.
 *   R = paint amount   (0..255, monotonic)
 *   G = freshness      (255 on stamp, decays -> the bright bloom wavefront)
 *
 * Paint is MAX-BLEND, never additive. That single choice buys three things:
 *   - the coverage counter can only ever increment, so it is maintained
 *     incrementally with one branch and never needs a rescan;
 *   - the save file is a pure union, with no ordering bugs;
 *   - reloading a saved area cannot produce a different coverage number than
 *     when he left it.
 */

export const PAINT_THRESHOLD = 128;

/** A recent-paint rectangle whose freshness still needs decaying. */
interface PulseRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  live: boolean;
}

const MAX_PULSE_RECTS = 64;
const PULSE_DECAY = 5;

/**
 * Bounds the cost of one sweep. Normal play never approaches this: at 7 m/s
 * and 60 Hz the ball moves ~0.3 cells per step. It only bites on a genuine
 * teleport, where callers should reset the previous position instead of
 * sweeping.
 */
const MAX_SEGMENT_STEPS = 64;

export class PaintMask {
  readonly n: number;
  /** n*n*2, interleaved [amount, freshness]. Uploaded verbatim as RG8. */
  readonly rg: Uint8Array;
  /** n*n, 0/1. Cells the flood-fill says he can actually reach. */
  readonly paintable: Uint8Array;

  paintableCount = 0;
  paintedCount = 0;

  dirty = false;
  dx0 = 0;
  dz0 = 0;
  dx1 = 0;
  dz1 = 0;

  private falloff = new Uint8Array(1);
  private falloffR = -1;
  private pulses: PulseRect[] = [];

  constructor(cells: number) {
    this.n = cells;
    this.rg = new Uint8Array(cells * cells * 2);
    this.paintable = new Uint8Array(cells * cells);
    for (let i = 0; i < MAX_PULSE_RECTS; i++) {
      this.pulses.push({ x0: 0, z0: 0, x1: 0, z1: 0, live: false });
    }
  }

  get coverage(): number {
    return this.paintableCount === 0 ? 0 : this.paintedCount / this.paintableCount;
  }

  /** Mark every cell paintable. Replaced by the flood-fill result later. */
  setAllPaintable(): void {
    this.paintable.fill(1);
    this.paintableCount = this.n * this.n;
  }

  setPaintableFrom(src: Uint8Array): void {
    this.paintable.set(src);
    let c = 0;
    for (let i = 0; i < src.length; i++) if (src[i]) c++;
    this.paintableCount = c;
  }

  /**
   * Falloff LUT indexed by INTEGER squared distance, so the inner loop needs
   * no sqrt and no float math at all.
   */
  private buildFalloff(r: number): void {
    if (r === this.falloffR) return;
    const r2 = r * r;
    const lut = new Uint8Array(r2 + 1);
    for (let d2 = 0; d2 <= r2; d2++) {
      const t = 1 - Math.sqrt(d2) / r;
      const s = t * t * (3 - 2 * t);
      // 1.35 flattens the plateau so the brush centre saturates quickly and
      // the edge still feathers.
      lut[d2] = Math.min(255, Math.round(255 * s * 1.35));
    }
    this.falloff = lut;
    this.falloffR = r;
  }

  stamp(cxf: number, czf: number, rf: number): void {
    const r = Math.max(1, Math.round(rf));
    this.buildFalloff(r);
    const n = this.n;
    const r2 = r * r;
    const icx = Math.round(cxf);
    const icz = Math.round(czf);

    const x0 = Math.max(0, icx - r);
    const x1 = Math.min(n - 1, icx + r);
    const z0 = Math.max(0, icz - r);
    const z1 = Math.min(n - 1, icz + r);
    if (x1 < x0 || z1 < z0) return;

    const rg = this.rg;
    const paintable = this.paintable;
    const lut = this.falloff;

    for (let z = z0; z <= z1; z++) {
      const dz = z - icz;
      const dz2 = dz * dz;
      const row = z * n;
      for (let x = x0; x <= x1; x++) {
        const dx = x - icx;
        const d2 = dx * dx + dz2;
        if (d2 > r2) continue;
        const v = lut[d2]!;
        const i = row + x;
        const j = i << 1;
        const prev = rg[j]!;
        if (v > prev) {
          rg[j] = v;
          if (prev < PAINT_THRESHOLD && v >= PAINT_THRESHOLD && paintable[i] === 1) {
            this.paintedCount++;
          }
        }
        rg[j + 1] = 255;
      }
    }

    this.markDirty(x0, z0, x1, z1);
    this.pushPulse(x0, z0, x1, z1);
  }

  /**
   * Sweep between two positions so fast movement leaves no gaps in the trail.
   * At 60 fps and 7 m/s the ball travels ~0.12 m per frame, but a dropped
   * frame or a tier switch can make that much larger.
   */
  stampSegment(cx0: number, cz0: number, cx1: number, cz1: number, r: number): void {
    const dist = Math.hypot(cx1 - cx0, cz1 - cz0);
    // Spacing must scale with the brush, not be a fixed constant: paint only
    // crosses PAINT_THRESHOLD within ~0.58r of a stamp centre, so anything
    // wider than ~1.16r leaves a dotted line instead of a stroke. Half the
    // radius is comfortably inside that.
    const spacing = Math.max(0.5, r * 0.5);
    const steps = Math.min(MAX_SEGMENT_STEPS, Math.max(1, Math.ceil(dist / spacing)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.stamp(cx0 + (cx1 - cx0) * t, cz0 + (cz1 - cz0) * t, r);
    }
  }

  private markDirty(x0: number, z0: number, x1: number, z1: number): void {
    if (!this.dirty) {
      this.dx0 = x0;
      this.dz0 = z0;
      this.dx1 = x1;
      this.dz1 = z1;
      this.dirty = true;
      return;
    }
    if (x0 < this.dx0) this.dx0 = x0;
    if (z0 < this.dz0) this.dz0 = z0;
    if (x1 > this.dx1) this.dx1 = x1;
    if (z1 > this.dz1) this.dz1 = z1;
  }

  /** Coalesce into an existing rect when the union stays tight, else take a slot. */
  private pushPulse(x0: number, z0: number, x1: number, z1: number): void {
    const area = (x1 - x0 + 1) * (z1 - z0 + 1);
    let free: PulseRect | null = null;

    for (let i = 0; i < this.pulses.length; i++) {
      const p = this.pulses[i]!;
      if (!p.live) {
        if (!free) free = p;
        continue;
      }
      const ux0 = Math.min(p.x0, x0);
      const uz0 = Math.min(p.z0, z0);
      const ux1 = Math.max(p.x1, x1);
      const uz1 = Math.max(p.z1, z1);
      const uArea = (ux1 - ux0 + 1) * (uz1 - uz0 + 1);
      const pArea = (p.x1 - p.x0 + 1) * (p.z1 - p.z0 + 1);
      if (uArea < (pArea + area) * 1.6) {
        p.x0 = ux0;
        p.z0 = uz0;
        p.x1 = ux1;
        p.z1 = uz1;
        return;
      }
    }

    if (free) {
      free.x0 = x0;
      free.z0 = z0;
      free.x1 = x1;
      free.z1 = z1;
      free.live = true;
    }
    // If every slot is busy the oldest pulse simply keeps its glow one more
    // frame. Invisible, and cheaper than evicting.
  }

  /**
   * Decay freshness only where paint is recent. Decaying the whole array every
   * frame would be 65k writes for nothing.
   */
  decayPulse(): void {
    const rg = this.rg;
    const n = this.n;
    for (let i = 0; i < this.pulses.length; i++) {
      const p = this.pulses[i]!;
      if (!p.live) continue;
      let anyAlive = false;
      for (let z = p.z0; z <= p.z1; z++) {
        const row = z * n;
        for (let x = p.x0; x <= p.x1; x++) {
          const j = ((row + x) << 1) + 1;
          const g = rg[j]!;
          if (g > 0) {
            rg[j] = g > PULSE_DECAY ? g - PULSE_DECAY : 0;
            anyAlive = true;
          }
        }
      }
      if (anyAlive) this.markDirty(p.x0, p.z0, p.x1, p.z1);
      else p.live = false;
    }
  }

  /**
   * Full rescan of the coverage counter. Correct but O(n^2) — the ONLY place
   * this is acceptable is once immediately after restoring a saved mask, and
   * in tests that verify the incremental counter.
   */
  recountPainted(): number {
    let c = 0;
    const rg = this.rg;
    const paintable = this.paintable;
    for (let i = 0; i < paintable.length; i++) {
      if (paintable[i] === 1 && rg[i << 1]! >= PAINT_THRESHOLD) c++;
    }
    this.paintedCount = c;
    return c;
  }

  clear(): void {
    this.rg.fill(0);
    this.paintedCount = 0;
    for (const p of this.pulses) p.live = false;
    this.markDirty(0, 0, this.n - 1, this.n - 1);
  }
}
