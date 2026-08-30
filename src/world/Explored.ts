import { ClampToEdgeWrapping, DataTexture, LinearFilter, NoColorSpace, RGFormat, UnsignedByteType } from 'three';
import { PaintMask } from '../paint/PaintMask';
import { AreaTransform } from '../core/AreaTransform';

/**
 * Where he has BEEN, as opposed to where he has painted.
 *
 * The fog originally lifted only over painted ground. But the brush is under
 * two metres wide while he can see many metres, so he sees far more than he
 * paints — and everything he merely looked at fogged over again the moment he
 * walked away. Correctly reported as "the fog doesn't stay gone".
 *
 * So exploration, not painting, is what clears fog. He went there; it stays
 * visible. Painted ground still counts too, but this is the channel that
 * actually matches what a child expects.
 *
 * Pure reuse: `PaintMask` is already a monotonic max-blend stamped grid with a
 * dirty rect, which is exactly what this needs. A coarse grid is plenty — the
 * fog edge is soft and the shader filters it linearly.
 */

const CELLS = 64;
/** Generous: he should not have to drive over every square metre to reveal it. */
export const EXPLORE_RADIUS_M = 7.5;

export class Explored {
  readonly mask: PaintMask;
  readonly transform: AreaTransform;
  readonly texture: DataTexture;
  private prevX = 0;
  private prevZ = 0;
  private started = false;

  constructor(worldSize: number) {
    this.mask = new PaintMask(CELLS);
    this.mask.setAllPaintable();
    this.transform = AreaTransform.centered(worldSize, CELLS);

    const t = new DataTexture(this.mask.rg, CELLS, CELLS, RGFormat, UnsignedByteType);
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.wrapS = ClampToEdgeWrapping;
    t.wrapT = ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.flipY = false;
    t.unpackAlignment = 1;
    t.colorSpace = NoColorSpace;
    t.needsUpdate = true;
    this.texture = t;
  }

  /** Sweep from the last position so fast movement leaves no unexplored gaps. */
  visit(wx: number, wz: number): void {
    const cx = this.transform.cellX(wx);
    const cz = this.transform.cellZ(wz);
    const r = this.transform.radiusCells(EXPLORE_RADIUS_M);
    if (this.started) this.mask.stampSegment(this.prevX, this.prevZ, cx, cz, r);
    else this.mask.stamp(cx, cz, r);
    this.started = true;
    this.prevX = cx;
    this.prevZ = cz;
  }

  /** Once per rendered frame, never from the sim step. */
  upload(): void {
    if (!this.mask.dirty) return;
    this.texture.needsUpdate = true;
    this.mask.dirty = false;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
