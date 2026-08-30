import { describe, expect, it } from 'vitest';
import { Group, ShaderMaterial } from 'three';
import { Props, TOUCH_SCRATCH, type PropTouch } from './Props';
import { Terrain } from './Terrain';
import { layoutScene } from './Layout';
import { candy } from '../content/scenes/candy';

/**
 * The cheer wave.
 *
 * `aPaintTime` in the future means "pop when the wave gets here", which is what
 * makes a whole room bouncing in sequence cost one float per object. The trap
 * is that the same attribute also says whether a thing is in colour at all, so
 * a wave that touched an unpainted prop would bloom it for free — colouring in
 * a gumdrop he never went near, and quietly lying about what he has done.
 */
function build(seed = 5): { props: Props; parent: Group } {
  const t = candy.stage.terrain!;
  const terrain = new Terrain(
    {
      worldSize: candy.stage.width,
      grid: 64,
      octaves: t.octaves,
      warpFreq: t.warp.freq,
      warpAmp: t.warp.amp,
      maxSlopeDeg: t.maxSlopeDeg,
      edgeFalloff: null,
    },
    seed,
  );
  const parent = new Group();
  const props = new Props(
    candy,
    layoutScene(candy, seed).placed,
    terrain,
    new ShaderMaterial(),
    parent,
    0,
  );
  return { props, parent };
}

/** Sweep the whole stage, touching everything. */
function paintEverything(props: Props): PropTouch[] {
  const all: PropTouch[] = [];
  const half = candy.stage.width / 2;
  for (let z = -half; z <= half; z += 2) {
    for (let x = -half; x <= half; x += 2) {
      props.collectTouched(x, z, 3, TOUCH_SCRATCH);
      all.push(...TOUCH_SCRATCH);
    }
  }
  return all;
}

function paintTimes(props: Props): number[] {
  const out: number[] = [];
  for (const k of props.kinds) out.push(...Array.from(k.paintTime.array));
  return out;
}

describe('Props.cheer', () => {
  it('leaves an unpainted room completely alone', () => {
    const { props } = build();
    props.setTime(10);
    props.cheer(0, 0);
    // -1 is the shader's "never painted" sentinel. Every last one must keep it,
    // or the celebration colours in things he never touched.
    expect(paintTimes(props).every((v) => v === -1)).toBe(true);
  });

  it('schedules every painted prop, and only painted ones', () => {
    const { props } = build();
    paintEverything(props);
    expect(props.paintedCount).toBeGreaterThan(20);
    expect(props.paintedCount).toBeLessThanOrEqual(props.total);

    const NOW = 40;
    props.setTime(NOW);
    props.cheer(0, 0);

    const times = paintTimes(props);
    const scheduled = times.filter((v) => v >= NOW);
    const untouched = times.filter((v) => v === -1);
    expect(scheduled).toHaveLength(props.paintedCount);
    expect(untouched).toHaveLength(props.total - props.paintedCount);
  });

  it('ripples outward instead of firing as one thud', () => {
    const { props } = build();
    paintEverything(props);
    const NOW = 40;
    props.setTime(NOW);
    props.cheer(0, 0);

    const delays = paintTimes(props)
      .filter((v) => v >= NOW)
      .map((v) => v - NOW);
    const spread = Math.max(...delays) - Math.min(...delays);
    // A visible wave, but over in about a second -- not a slow crawl he waits on.
    expect(spread).toBeGreaterThan(0.4);
    expect(Math.max(...delays)).toBeLessThan(2.5);
  });

  it('is safe to fire twice', () => {
    const { props } = build();
    paintEverything(props);
    props.setTime(40);
    props.cheer(0, 0);
    props.setTime(41);
    expect(() => props.cheer(9, -9)).not.toThrow();
    expect(paintTimes(props).filter((v) => v >= 41)).toHaveLength(props.paintedCount);
  });
});
