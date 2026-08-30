/**
 * The fade between rooms.
 *
 * A DOM overlay rather than a WebGL pass: it costs no fill rate, cannot fail on
 * a weak GPU, and keeps covering the screen even while the old scene is being
 * torn down and the new one compiled.
 */
export class Transition {
  private el: HTMLDivElement;
  private busy = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'fade';
    parent.appendChild(this.el);
  }

  get running(): boolean {
    return this.busy;
  }

  setColor(hex: number): void {
    this.el.style.background = `#${hex.toString(16).padStart(6, '0')}`;
  }

  /**
   * Fade out, run `swap`, fade back in. `swap` is where the old scene is
   * disposed and the new one built and compiled, so every hitch it causes
   * happens behind a solid colour.
   */
  async run(swap: () => void | Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    this.el.classList.add('on');
    await wait(480);

    await swap();
    // One frame for the new scene to settle before revealing it.
    await nextFrame();
    await nextFrame();

    this.el.classList.remove('on');
    await wait(420);
    this.busy = false;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
