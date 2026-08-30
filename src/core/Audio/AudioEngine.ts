import { PENTATONIC, degreeToHz } from './Scale';
import { VOICES, type VoiceName } from './Voices';

/**
 * Procedural sound. No audio files anywhere.
 *
 * The design rule: silly, but always in tune. Every noise is a cartoon boing,
 * pop, squeak or wobble, and every one is pitched to a pentatonic scale. That
 * combination is what makes it safe for a child — he can mash through a whole
 * room as fast as he likes and it still comes out as music. He cannot make it
 * sound wrong.
 *
 * Two guards stop a wide paint splash becoming a wall of noise: notes stagger
 * apart in time, and only so many may sound at once.
 */

const MAX_VOICES = 6;
const STAGGER_S = 0.045;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private padGain: GainNode | null = null;
  private padOscs: OscillatorNode[] = [];
  private silentEl: HTMLAudioElement | null = null;

  private rootHz = 293.66;
  private scale: number[] = PENTATONIC;
  private voiceCursor = 0;
  private active = 0;
  /** Next free slot in the stagger queue, in context time. */
  private nextSlot = 0;

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /**
   * Must be called from a real user gesture. Mobile browsers refuse to start
   * audio otherwise.
   */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;

    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    void ctx.resume();

    // iOS mutes WebAudio via the hardware ringer switch unless the page has a
    // real playback session. Without this the game looks silently broken.
    this.startSilentLoop();
  }

  private startSilentLoop(): void {
    if (this.silentEl) return;
    try {
      const el = document.createElement('audio');
      el.setAttribute('playsinline', '');
      el.loop = true;
      // 0.05s of silent WAV.
      el.src =
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';
      el.volume = 0.001;
      void el.play().catch(() => {});
      this.silentEl = el;
    } catch {
      /* not fatal; Android is unaffected */
    }
  }

  setScene(rootHz: number, scale: number[] = PENTATONIC): void {
    this.rootHz = rootHz;
    this.scale = scale;
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  /**
   * One silly noise, pitched into the scene's scale.
   *
   * `degrees` comes straight from the prop's data. Voices round-robin so
   * consecutive hits never sound the same — that is the "alternating silly
   * noises" part.
   */
  play(degrees: number[] | null, voice?: VoiceName): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== 'running' || !degrees || degrees.length === 0) return;
    if (this.active >= MAX_VOICES) return;

    const names = Object.keys(VOICES) as VoiceName[];
    const name = voice ?? names[this.voiceCursor % names.length]!;
    this.voiceCursor++;

    const degree = degrees[(Math.random() * degrees.length) | 0]!;
    const hz = degreeToHz(degree, this.rootHz, this.scale);

    // Stagger so a splash that paints eight things is a flourish, not a blare.
    const now = ctx.currentTime;
    const at = Math.max(now + 0.01, this.nextSlot);
    this.nextSlot = at + STAGGER_S;

    this.active++;
    const done = () => {
      this.active--;
    };
    VOICES[name](ctx, master, hz, at, done);
  }

  /**
   * Decode recorded audio. Needs a running context, so it can only happen
   * after the first touch -- which is fine, since nothing plays before then.
   */
  async decode(data: ArrayBuffer): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return null;
    try {
      // decodeAudioData detaches the buffer it is given, and a recording has to
      // survive being played twice. Hand it a copy.
      return await ctx.decodeAudioData(data.slice(0));
    } catch {
      return null;
    }
  }

  /**
   * Play a recorded sound through the same bus as everything else, so it ducks
   * under the compressor with the pad and the boings instead of clipping over
   * the top of them.
   */
  playBuffer(buffer: AudioBuffer, gain = 1): boolean {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== 'running') return false;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(master);
    src.start();
    return true;
  }

  /**
   * The ambient bed. Gains voices and brightness as the room fills, so
   * progress is audible even when he is watching the ball rather than the room.
   */
  startPad(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.padOscs.length) return;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    this.padGain = gain;

    for (const [i, degree] of [0, 7, 12].entries()) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = degreeToHz(degree, this.rootHz * 0.5, this.scale);
      osc.detune.value = (i - 1) * 6;
      const g = ctx.createGain();
      g.gain.value = 1 / 3;
      osc.connect(g);
      g.connect(gain);
      osc.start();
      this.padOscs.push(osc);
    }
  }

  setCoverage(coverage: number): void {
    if (!this.padGain || !this.ctx) return;
    const target = 0.05 + coverage * 0.16;
    this.padGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.6);
  }

  dispose(): void {
    for (const o of this.padOscs) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    this.padOscs.length = 0;
    this.silentEl?.pause();
    this.silentEl = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
