import type { WebGLRenderer } from 'three';
import type { PaintMask } from '../paint/PaintMask';
import type { Tier } from '../core/Quality';

/**
 * The ONLY place in the entire project where text may exist, and it is behind
 * ?debug=1 so it is impossible to reach by accident.
 *
 * The mask blit in the corner is what turns "the paint trail is subtly offset
 * from the ball" from an evening of confusion into a one-second diagnosis.
 */
export class DebugOverlay {
  static readonly enabled = new URLSearchParams(location.search).get('debug') === '1';

  private el: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private img: ImageData | null = null;
  private acc = 0;
  private frames = 0;
  private fps = 0;

  /** Re-point at a new scene's mask after a room change. */
  remount(parent: HTMLElement, mask: PaintMask): void {
    this.el?.remove();
    this.canvas?.remove();
    this.el = null;
    this.canvas = null;
    this.mount(parent, mask);
  }

  mount(parent: HTMLElement, mask: PaintMask): void {
    if (!DebugOverlay.enabled) return;

    this.el = document.createElement('div');
    this.el.id = 'debug';
    parent.appendChild(this.el);

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'maskblit';
    this.canvas.width = mask.n;
    this.canvas.height = mask.n;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx?.createImageData(mask.n, mask.n) ?? null;
  }

  update(
    dtMs: number,
    renderer: WebGLRenderer,
    mask: PaintMask,
    tier: Tier,
    pixelRatio: number,
  ): void {
    if (!this.el) return;

    this.acc += dtMs;
    this.frames++;
    if (this.acc < 500) return;
    this.fps = (this.frames * 1000) / this.acc;
    this.acc = 0;
    this.frames = 0;

    const info = renderer.info;
    this.el.textContent =
      `fps  ${this.fps.toFixed(1)}  (${dtMs.toFixed(1)}ms)\n` +
      `tier ${tier}  dpr ${pixelRatio.toFixed(2)}\n` +
      `draw ${info.render.calls}  tris ${info.render.triangles}\n` +
      `geo  ${info.memory.geometries}  tex ${info.memory.textures}\n` +
      `mask ${mask.n}^2  cover ${(mask.coverage * 100).toFixed(1)}%\n` +
      `cells ${mask.paintedCount}/${mask.paintableCount}`;

    this.blit(mask);
  }

  private blit(mask: PaintMask): void {
    if (!this.ctx || !this.img) return;
    const d = this.img.data;
    const rg = mask.rg;
    for (let i = 0; i < mask.n * mask.n; i++) {
      const amount = rg[i << 1]!;
      const fresh = rg[(i << 1) + 1]!;
      d[i * 4] = amount;
      d[i * 4 + 1] = Math.max(amount, fresh);
      d[i * 4 + 2] = mask.paintable[i] ? 40 : 0;
      d[i * 4 + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}
