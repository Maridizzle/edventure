import { VoiceStore } from '../core/Audio/Voice';
import type { AudioEngine } from '../core/Audio/AudioEngine';

/**
 * The grown-up door. Three icons, no words.
 *
 * Reached by holding a corner of the screen for two seconds — a gesture a
 * five-year-old will not perform by accident, and one that leaves nothing on
 * screen for him to find. Nothing in here is ever prompted during play, which
 * is the point: a microphone permission dialog appearing mid-game would be a
 * genuinely bad moment, so it can only ever happen because an adult went
 * looking for it.
 *
 * Rule #1 holds absolutely rather than by exception: record, play and delete
 * are a circle, a triangle and a bin. No letters anywhere.
 */

const HOLD_MS = 2000;
/** How far a finger may drift and still count as a hold. */
const SLOP_PX = 24;

const ICON_RECORD = `<circle cx="24" cy="24" r="13"/>`;
const ICON_STOP = `<rect x="14" y="14" width="20" height="20" rx="3"/>`;
const ICON_PLAY = `<path d="M18 13 L36 24 L18 35 Z"/>`;
const ICON_TRASH =
  `<path d="M16 18h16l-1.4 17a2 2 0 0 1-2 1.9h-9.2a2 2 0 0 1-2-1.9Z"/>` +
  `<path d="M13 15h22" stroke-width="3" stroke-linecap="round" fill="none"/>` +
  `<path d="M20 15v-2.5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2V15" stroke-width="3" fill="none"/>`;

function icon(paths: string, cls: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `gp-btn ${cls}`;
  // aria-label is never rendered, so the zero-text rule is untouched -- and a
  // button with no accessible name is simply broken for the adult using it.
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true">${paths}</svg>`;
  return b;
}

export class GrownUpPanel {
  private hotspot!: HTMLDivElement;
  private scrim: HTMLDivElement | null = null;
  private timer: number | null = null;
  private startX = 0;
  private startY = 0;
  private pointerId: number | null = null;

  private recordBtn!: HTMLButtonElement;
  private playBtn!: HTMLButtonElement;
  private trashBtn!: HTMLButtonElement;

  /** True while the panel is up, so the game can stop taking joystick input. */
  get open(): boolean {
    return this.scrim !== null;
  }

  constructor(
    private readonly parent: HTMLElement,
    private readonly voice: VoiceStore,
    private readonly audio: AudioEngine,
  ) {
    this.hotspot = document.createElement('div');
    this.hotspot.id = 'gp-hotspot';
    this.hotspot.addEventListener('pointerdown', this.onDown);
    this.hotspot.addEventListener('pointermove', this.onMove);
    this.hotspot.addEventListener('pointerup', this.cancel);
    this.hotspot.addEventListener('pointercancel', this.cancel);
    parent.appendChild(this.hotspot);
  }

  private onDown = (e: PointerEvent): void => {
    // Never let the hold reach the joystick, or he drives off while an adult
    // is holding the corner.
    e.stopPropagation();
    if (this.pointerId !== null || this.open) return;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    // Only becomes visible most of the way through the hold: an adult holding
    // deliberately gets feedback, a child brushing the corner sees nothing.
    this.hotspot.classList.add('gp-holding');
    this.timer = window.setTimeout(() => this.show(), HOLD_MS);
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > SLOP_PX) this.cancel();
  };

  private cancel = (): void => {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pointerId = null;
    this.hotspot.classList.remove('gp-holding');
  };

  private show(): void {
    this.cancel();
    if (this.open) return;

    const scrim = document.createElement('div');
    scrim.id = 'gp-scrim';
    // A tap anywhere off the buttons closes it. No close button, no label.
    scrim.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.target === scrim) this.hide();
    });

    const row = document.createElement('div');
    row.className = 'gp-row';

    this.recordBtn = icon(ICON_RECORD, 'gp-record', 'Record cheer');
    this.playBtn = icon(ICON_PLAY, 'gp-play', 'Play cheer');
    this.trashBtn = icon(ICON_TRASH, 'gp-trash', 'Delete cheer');

    this.recordBtn.addEventListener('click', () => void this.toggleRecord());
    this.playBtn.addEventListener('click', () => {
      // A click is a real gesture, which is the only moment audio may start.
      this.audio.unlock();
      this.voice.play(this.audio);
    });
    this.trashBtn.addEventListener('click', () => void this.voice.clear().then(() => this.sync()));

    row.append(this.recordBtn, this.playBtn, this.trashBtn);
    scrim.appendChild(row);
    this.parent.appendChild(scrim);
    this.scrim = scrim;
    this.sync();
  }

  private async toggleRecord(): Promise<void> {
    if (this.voice.recording) {
      this.voice.stop();
      return;
    }
    if (!VoiceStore.supported) return;
    this.audio.unlock();
    this.recordBtn.classList.add('gp-live');
    this.sync();
    await this.voice.record();
    this.recordBtn.classList.remove('gp-live');
    void this.voice.prime(this.audio);
    this.sync();
  }

  /** Icons reflect state; nothing explains it, because nothing has to. */
  private sync(): void {
    if (!this.scrim) return;
    const live = this.voice.recording;
    this.recordBtn.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true">${
      live ? ICON_STOP : ICON_RECORD
    }</svg>`;
    this.recordBtn.classList.toggle('gp-live', live);
    this.recordBtn.classList.toggle('gp-off', !VoiceStore.supported);
    const usable = this.voice.has && !live;
    this.playBtn.classList.toggle('gp-off', !usable);
    this.trashBtn.classList.toggle('gp-off', !usable);
  }

  hide(): void {
    this.voice.stop();
    this.scrim?.remove();
    this.scrim = null;
  }

  dispose(): void {
    this.cancel();
    this.hide();
    this.hotspot.remove();
  }
}
