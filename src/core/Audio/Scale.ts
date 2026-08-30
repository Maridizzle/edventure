/**
 * Pentatonic tables.
 *
 * This is the single choice that makes procedural audio safe for a five-year-
 * old: within a pentatonic scale, ANY combination of simultaneous notes is
 * consonant. He can paint as fast and as chaotically as he likes and it will
 * never sound wrong, because there is no wrong note available to him.
 */

/** Semitone offsets, major pentatonic, across two octaves. */
export const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

/** Minor pentatonic, for scenes that want a moodier bed. */
export const MINOR_PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

export const SCALES: Record<string, number[]> = {
  majorPentatonic: PENTATONIC,
  minorPentatonic: MINOR_PENTATONIC,
};

/**
 * A scale degree is an index into the table, so content files never have to
 * think in semitones or hertz.
 */
export function degreeToHz(degree: number, rootHz: number, scale: number[] = PENTATONIC): number {
  const i = ((degree % scale.length) + scale.length) % scale.length;
  const octave = Math.floor(degree / scale.length);
  const semitones = scale[i]! + octave * 12;
  return rootHz * Math.pow(2, semitones / 12);
}
