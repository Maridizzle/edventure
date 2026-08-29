import { Vector2 } from 'three';

/**
 * One floating thumb-stick. Touch anywhere and it spawns under the thumb.
 *
 * Two DOM divs moved with translate3d rather than anything in WebGL: zero draw
 * calls, zero shader cost, crisp at any devicePixelRatio, and composited by the
 * browser on its own thread.
 *
 * Three details matter more than the rest, all of them for a 5-year-old:
 *
 *  - ORIGIN RE-ANCHORING. A small child's thumb wanders. Without it the stick
 *    saturates once they push past the ring and further movement does nothing,
 *    so they have to lift and re-place. With it, the stick follows the thumb
 *    forever and never desyncs.
 *  - NO DEAD ZONE, only 3px of jitter rejection. A dead zone feels to a child
 *    like the game is ignoring them. A gentle response curve gives fine
 *    control near centre instead.
 *  - FIRST POINTER WINS, so a palm resting on the screen is ignored.
 */
export class Joystick {
  readonly value = new Vector2();
  private pointerId: number | null = null;
  private ox = 0;
  private oy = 0;
  private radius = 60;
  private ring!: HTMLDivElement;
  private knob!: HTMLDivElement;
  private el!: HTMLElement;

  /** Fires on the very first touch — used to unlock audio. */
  onFirstTouch: (() => void) | null = null;
  private hadFirstTouch = false;

  attach(el: HTMLElement): void {
    this.el = el;
    el.style.touchAction = 'none';

    this.ring = document.createElement('div');
    this.ring.className = 'stick-ring';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';
    el.appendChild(this.ring);
    el.appendChild(this.knob);

    this.resize();

    el.addEventListener('pointerdown', this.onDown, { passive: false });
    el.addEventListener('pointermove', this.onMove, { passive: false });
    el.addEventListener('pointerup', this.onUp, { passive: false });
    el.addEventListener('pointercancel', this.onUp, { passive: false });
    window.addEventListener('resize', this.resize);
  }

  resize = (): void => {
    this.radius = Math.max(52, Math.min(110, Math.min(innerWidth, innerHeight) * 0.15));
    const d = this.radius * 2;
    this.ring.style.width = `${d}px`;
    this.ring.style.height = `${d}px`;
    const k = this.radius * 0.46;
    this.knob.style.width = `${k}px`;
    this.knob.style.height = `${k}px`;
  };

  private onDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return; // first pointer wins; palms ignored
    e.preventDefault();
    this.pointerId = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    this.ox = e.clientX;
    this.oy = e.clientY;
    this.draw(0, 0);
    this.ring.classList.add('stick-on');
    this.knob.classList.add('stick-on');

    if (!this.hadFirstTouch) {
      this.hadFirstTouch = true;
      this.onFirstTouch?.();
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();

    let dx = e.clientX - this.ox;
    let dy = e.clientY - this.oy;
    const len = Math.hypot(dx, dy);

    // Re-anchor: drag the origin along behind a wandering thumb.
    if (len > this.radius) {
      const k = (len - this.radius) / len;
      this.ox += dx * k;
      this.oy += dy * k;
      dx -= dx * k;
      dy -= dy * k;
    }

    const mag = Math.hypot(dx, dy);
    if (mag < 3) {
      this.value.set(0, 0);
      this.draw(0, 0);
      return;
    }
    const t = Math.pow(Math.min(1, mag / this.radius), 1.35);
    this.value.set((dx / mag) * t, (dy / mag) * t);
    this.draw(dx, dy);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.pointerId = null;
    this.value.set(0, 0);
    this.ring.classList.remove('stick-on');
    this.knob.classList.remove('stick-on');
  };

  /** Only called from pointer handlers, never per frame. */
  private draw(dx: number, dy: number): void {
    const r = this.radius;
    this.ring.style.transform = `translate3d(${this.ox - r}px, ${this.oy - r}px, 0)`;
    const k = r * 0.23;
    this.knob.style.transform = `translate3d(${this.ox + dx - k}px, ${this.oy + dy - k}px, 0)`;
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('resize', this.resize);
    this.ring.remove();
    this.knob.remove();
  }
}
