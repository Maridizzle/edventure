import { createNoise2D } from 'simplex-noise';
import type { Rng } from './Rng';

export type Noise2D = (x: number, y: number) => number;

export interface Octave {
  freq: number;
  amp: number;
}

export function makeNoise2D(rng: Rng): Noise2D {
  return createNoise2D(rng);
}

/** Summed octaves. Returns roughly [-sumAmp, +sumAmp]. */
export function fbm(n: Noise2D, x: number, y: number, octaves: readonly Octave[]): number {
  let sum = 0;
  for (let i = 0; i < octaves.length; i++) {
    const o = octaves[i]!;
    sum += n(x * o.freq, y * o.freq) * o.amp;
  }
  return sum;
}

/**
 * Domain warp — offset the sample point by another noise lookup before
 * sampling. This is the cheapest way to stop terrain from reading as
 * "noise": it turns round blobs into curved ridges and valleys.
 */
export function warped(
  n: Noise2D,
  w: Noise2D,
  x: number,
  y: number,
  octaves: readonly Octave[],
  warpFreq: number,
  warpAmp: number,
): number {
  const wx = x + w(x * warpFreq, y * warpFreq) * warpAmp;
  const wy = y + w(x * warpFreq + 31.7, y * warpFreq - 17.3) * warpAmp;
  return fbm(n, wx, wy, octaves);
}

/**
 * A tileable RGBA noise texture, generated at runtime so we ship no image
 * assets. R/G drive the paint-edge warp, B the ground colour variation,
 * A the sparkle. Tileable so it can be sampled at any world scale.
 */
export function makeNoiseTextureData(size: number, rng: Rng): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const n1 = makeNoise2D(rng);
  const n2 = makeNoise2D(rng);
  const n3 = makeNoise2D(rng);
  const TAU = Math.PI * 2;

  // Sample 2D noise on a torus embedded in 4D so the result wraps seamlessly.
  // We only have 2D noise, so approximate with two circular sweeps blended.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;

      const a = tileable(n1, u, v, 4, TAU);
      const b = tileable(n2, u, v, 4, TAU);
      const c = tileable(n3, u, v, 2.5, TAU);
      const d = tileable(n1, u, v, 9, TAU);

      data[i] = (a * 0.5 + 0.5) * 255;
      data[i + 1] = (b * 0.5 + 0.5) * 255;
      data[i + 2] = (c * 0.5 + 0.5) * 255;
      data[i + 3] = (d * 0.5 + 0.5) * 255;
    }
  }
  return data;
}

/** Blend four shifted samples so opposite edges match. Cheap, good enough. */
function tileable(n: Noise2D, u: number, v: number, freq: number, _tau: number): number {
  const s = freq;
  const a = n(u * s, v * s);
  const b = n((u - 1) * s, v * s);
  const c = n(u * s, (v - 1) * s);
  const d = n((u - 1) * s, (v - 1) * s);
  const wu = u;
  const wv = v;
  const top = a * (1 - wu) + b * wu;
  const bot = c * (1 - wu) + d * wu;
  return top * (1 - wv) + bot * wv;
}
