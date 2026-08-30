/**
 * The silly noises.
 *
 * Each voice is one oscillator with a pitch envelope and a fast amplitude
 * decay. What makes them read as cartoon rather than musical is the pitch
 * MOVEMENT — a boing falls, a pop leaps up, a squeak darts and vanishes — but
 * every one starts from a pitch the scale handed it, so the silliness never
 * costs us tunefulness.
 */

export type VoiceName = 'boing' | 'pop' | 'squeak' | 'wobble' | 'bloop';

type Voice = (
  ctx: AudioContext,
  out: AudioNode,
  hz: number,
  at: number,
  done: () => void,
) => void;

function envelope(
  ctx: AudioContext,
  osc: OscillatorNode,
  out: AudioNode,
  at: number,
  peak: number,
  attack: number,
  decay: number,
  done: () => void,
): void {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  osc.connect(g);
  g.connect(out);
  osc.start(at);
  osc.stop(at + attack + decay + 0.02);
  osc.onended = () => {
    g.disconnect();
    done();
  };
}

export const VOICES: Record<VoiceName, Voice> = {
  /** Falls a fifth and lands. The classic cartoon bounce. */
  boing(ctx, out, hz, at, done) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(hz * 1.5, at);
    osc.frequency.exponentialRampToValueAtTime(hz * 0.62, at + 0.22);
    envelope(ctx, osc, out, at, 0.3, 0.006, 0.3, done);
  },

  /** Leaps upward and stops dead. */
  pop(ctx, out, hz, at, done) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(hz * 0.7, at);
    osc.frequency.exponentialRampToValueAtTime(hz * 1.6, at + 0.05);
    envelope(ctx, osc, out, at, 0.16, 0.003, 0.1, done);
  },

  /** Short, high and gone. */
  squeak(ctx, out, hz, at, done) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(hz * 1.9, at);
    osc.frequency.exponentialRampToValueAtTime(hz * 2.6, at + 0.07);
    envelope(ctx, osc, out, at, 0.09, 0.004, 0.09, done);
  },

  /** Vibrato, via a detune LFO. */
  wobble(ctx, out, hz, at, done) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, at);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 70;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.detune);
    lfo.start(at);
    lfo.stop(at + 0.42);

    envelope(ctx, osc, out, at, 0.24, 0.008, 0.36, done);
  },

  /** Round and soft — the gentle one, so the mix is not all spikes. */
  bloop(ctx, out, hz, at, done) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz * 0.9, at);
    osc.frequency.exponentialRampToValueAtTime(hz * 1.05, at + 0.12);
    envelope(ctx, osc, out, at, 0.3, 0.01, 0.26, done);
  },
};
