import type { AreaTransform } from '../core/AreaTransform';
import type { PaintMask } from '../paint/PaintMask';

/**
 * The room, seen from above, filling in as he paints it.
 *
 * This exists because the game's own progress rule was unfair: the door opens
 * at half a coverage figure, in a 48 metre room he can see eight metres of.
 * "Progress is shown by the painting itself" is only true if he can see the
 * painting. So here it is -- and it is the same data, not a second scoring
 * system: the pixels are the paint mask, cell for cell.
 *
 * It costs nothing on the GPU. A 2D canvas composited by the browser, redrawn
 * five times a second, exactly like the joystick and the room fade -- all of
 * which are DOM for the same reason.
 */

/** Backing-store size. The mask is 128-256 across, so this never upsamples. */
const RES = 128;
const REDRAW_MS = 200;
/** Where the border sits inside the canvas, in backing-store pixels. */
const INSET = 5;
const RADIUS = 16;

export interface MapColours {
  /** Floor he has painted. */
  painted: number;
  /** Floor he has not. */
  drained: number;
  /** Him. */
  player: number;
  /** The way out. */
  door: number;
}

function css(hex: number, alpha = 1): string {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  /** The room itself, redrawn on a timer; markers are drawn over it each frame. */
  private room: HTMLCanvasElement;
  private roomCtx: CanvasRenderingContext2D | null;
  private img: ImageData | null = null;
  private acc = REDRAW_MS;
  private time = 0;
  private frame: Path2D;
  private perimeter: number;

  constructor(private colours: MapColours) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    this.canvas.width = RES;
    this.canvas.height = RES;
    this.ctx = this.canvas.getContext('2d');

    this.room = document.createElement('canvas');
    this.room.width = RES;
    this.room.height = RES;
    this.roomCtx = this.room.getContext('2d');
    this.img = this.roomCtx?.createImageData(RES, RES) ?? null;

    const box = RES - INSET * 2;
    this.frame = new Path2D();
    this.frame.roundRect(INSET, INSET, box, box, RADIUS);
    // Close enough for a dashed stroke; the corners shave a couple of percent
    // off a rounded rect's true perimeter and nobody can see two percent.
    this.perimeter = box * 4;
  }

  /** A new room: the old one's shape must not linger behind the fade. */
  reset(): void {
    this.acc = REDRAW_MS;
    this.roomCtx?.clearRect(0, 0, RES, RES);
    this.ctx?.clearRect(0, 0, RES, RES);
  }

  setColours(c: MapColours): void {
    this.colours = c;
  }

  /**
   * `gate` is 0..1 toward the door opening, not raw coverage -- the border is
   * a "how close to the way out" bar, and full has to mean open.
   */
  update(
    dtMs: number,
    mask: PaintMask,
    transform: AreaTransform,
    player: { x: number; z: number },
    door: { x: number; z: number },
    gate: number,
    doorOpen: boolean,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.time += dtMs / 1000;

    this.acc += dtMs;
    if (this.acc >= REDRAW_MS) {
      this.acc = 0;
      this.blitRoom(mask);
    }

    ctx.clearRect(0, 0, RES, RES);

    // The room, clipped to the same rounded box the border traces.
    ctx.save();
    ctx.clip(this.frame);
    ctx.drawImage(this.room, 0, 0);
    ctx.restore();

    const toPx = (wx: number, wz: number): [number, number] => [
      INSET + (transform.cellX(wx) / transform.cells) * (RES - INSET * 2),
      INSET + (transform.cellZ(wz) / transform.cells) * (RES - INSET * 2),
    ];

    // The door, always -- shut it is a landmark, open it is a destination.
    // With tight fog and a low camera the real doorway is usually off screen at
    // the moment it opens, which every previous fix has worked around rather
    // than solved.
    const [dx, dy] = toPx(door.x, door.z);
    const beat = doorOpen ? 0.72 + 0.28 * Math.sin(this.time * 4.4) : 0.35;
    ctx.fillStyle = css(this.colours.door, beat);
    ctx.beginPath();
    ctx.arc(dx, dy, doorOpen ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();

    // Him, with a dark rim so he is never lost against painted floor.
    const [pxp, pyp] = toPx(player.x, player.z);
    ctx.beginPath();
    ctx.arc(pxp, pyp, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pxp, pyp, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = css(this.colours.player);
    ctx.fill();

    this.drawFrame(ctx, gate, doorOpen);
  }

  /**
   * The border doubles as the progress bar: one element, two readings. The map
   * says where, the border says how much, and the ring closing is the moment
   * the way out opens.
   */
  private drawFrame(ctx: CanvasRenderingContext2D, gate: number, doorOpen: boolean): void {
    ctx.save();
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';

    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.setLineDash([]);
    ctx.stroke(this.frame);

    const t = Math.max(0, Math.min(1, gate));
    if (t > 0) {
      // One dash as long as the filled fraction, then a gap longer than the
      // whole path -- no arc maths, and it works on any path shape.
      ctx.setLineDash([this.perimeter * t, this.perimeter]);
      // White, not the biome colour. The border has to read against BOTH the
      // dark map and whatever the sky happens to be, and in Candy Land the
      // biome colour and the sky are both pink -- a border painted in it
      // vanishes exactly when it is full and matters most.
      ctx.strokeStyle = doorOpen
        ? `rgba(255,255,255,${0.72 + 0.28 * Math.sin(this.time * 4.4)})`
        : 'rgba(255,255,255,0.92)';
      ctx.stroke(this.frame);
    }
    ctx.restore();
  }

  /** The paint mask, cell for cell. This is `DebugOverlay.blit` grown up. */
  private blitRoom(mask: PaintMask): void {
    if (!this.roomCtx || !this.img) return;
    const d = this.img.data;
    const rg = mask.rg;
    const n = mask.n;

    const pr = (this.colours.painted >> 16) & 255;
    const pg = (this.colours.painted >> 8) & 255;
    const pb = this.colours.painted & 255;
    const dr = (this.colours.drained >> 16) & 255;
    const dg = (this.colours.drained >> 8) & 255;
    const db = this.colours.drained & 255;

    for (let y = 0; y < RES; y++) {
      // Nearest-neighbour, because the mask is 128, 192 or 256 across
      // depending on the quality tier and the canvas is always 128.
      const sz = ((y * n) / RES) | 0;
      for (let x = 0; x < RES; x++) {
        const sx = ((x * n) / RES) | 0;
        const i = sz * n + sx;
        const o = (y * RES + x) * 4;

        if (mask.paintable[i] !== 1) {
          // Floor the flood-fill cannot reach: under a gumdrop hill, mostly.
          // Drawn DARKER rather than transparent -- a hole would let the bright
          // sky through and read as a gap in the room, when what is actually
          // there is a thing standing in the way.
          d[o] = dr * 0.4;
          d[o + 1] = dg * 0.4;
          d[o + 2] = db * 0.4;
          d[o + 3] = 235;
          continue;
        }
        const amount = rg[i << 1]!;
        const t = amount / 255;
        d[o] = dr + (pr - dr) * t;
        d[o + 1] = dg + (pg - dg) * t;
        d[o + 2] = db + (pb - db) * t;
        d[o + 3] = 235;
      }
    }
    this.roomCtx.putImageData(this.img, 0, 0);
  }

  dispose(): void {
    this.canvas.remove();
    this.ctx = null;
    this.roomCtx = null;
    this.img = null;
  }
}
