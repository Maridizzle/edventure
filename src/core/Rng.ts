/**
 * Seeded RNG.
 *
 * Risk #5 in the plan: if every subsystem draws from one shared stream, adding
 * a prop kind shifts RNG consumption and every previously-saved area
 * regenerates with different terrain — silently invalidating his paintings.
 * So each subsystem gets its own stream, derived from (seed, name).
 */

export type Rng = () => number;

/** mulberry32 — small, fast, good enough, and stable forever. */
export function mulberry32(a: number): Rng {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string, mixed with a numeric seed. */
export function hashSeed(seed: number, name: string): number {
  let h = 0x811c9dc5 ^ (seed | 0);
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The only way subsystems should obtain randomness. */
export function stream(seed: number, name: string): Rng {
  return mulberry32(hashSeed(seed, name));
}

export function randRange(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

export function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
