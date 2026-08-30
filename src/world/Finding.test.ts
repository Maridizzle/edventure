import { describe, expect, it } from 'vitest';
import { Group, ShaderMaterial, Vector3 } from 'three';
import { Collectibles, type FoundEvent } from './Collectibles';
import { Props, TOUCH_SCRATCH } from './Props';
import { Terrain } from './Terrain';
import { layoutScene } from './Layout';
import { computeReachable } from './Reachability';
import { AreaTransform } from '../core/AreaTransform';
import { PaintMask } from '../paint/PaintMask';
import { mulberry32 } from '../core/Rng';
import { candy } from '../content/scenes/candy';
import { blob } from '../content/characters/blob';

/**
 * Does he actually MEET anybody?
 *
 * This is the only test that checks the thing the parade is built on. Every
 * other test proves the machinery works; this one plays a room and counts the
 * friends he ends it with. It exists because the machinery was all correct and
 * a whole room could still be finished having found nobody at all, which made
 * the parade and the door celebration impossible to judge.
 *
 * The simulated child WANDERS rather than sweeping. A lawnmower path would
 * cover the floor far more efficiently than a five-year-old does and would
 * quietly turn this into a much weaker claim than it looks.
 */

const SIZE = candy.stage.width;
const CELLS = 128;
const PROP_SPLASH_M = 5.0;
const GATE = 0.5;
/** Three simulated minutes at 60 Hz. Well past when a room normally ends. */
const MAX_STEPS = 60 * 180;

interface Room {
  mask: PaintMask;
  props: Props;
  collectibles: Collectibles;
  transform: AreaTransform;
  terrain: Terrain;
  spawn: { x: number; z: number };
}

function buildRoom(seed: number): Room {
  const t = candy.stage.terrain!;
  const terrain = new Terrain(
    {
      worldSize: SIZE,
      grid: 64,
      octaves: t.octaves,
      warpFreq: t.warp.freq,
      warpAmp: t.warp.amp,
      maxSlopeDeg: t.maxSlopeDeg,
      edgeFalloff: { start: 0.8, power: 2 },
    },
    seed,
  );

  const transform = AreaTransform.centered(SIZE, CELLS);
  const mask = new PaintMask(CELLS);
  mask.setAllPaintable();

  const layout = layoutScene(candy, seed);
  const props = new Props(candy, layout.placed, terrain, new ShaderMaterial(), new Group(), 0);

  mask.setPaintableFrom(
    computeReachable(
      transform,
      layout.placed,
      (pl) => {
        const d = pl.isScatter ? candy.scatter[pl.defIndex]! : candy.fixtures[pl.defIndex]!;
        return (d.solid ?? 0) * pl.scale;
      },
      layout.spawn,
      blob.radius,
    ),
  );

  const collectibles = new Collectibles(
    candy,
    seed,
    terrain,
    layout.placed,
    props,
    new ShaderMaterial(),
    new Group(),
    0,
    SIZE / 2,
  );

  return { mask, props, collectibles, transform, terrain, spawn: layout.spawn };
}

/** Play the room the way he does, and report who he met before the door opened. */
function playRoom(seed: number): {
  found: Set<string>;
  /** Step index at which each follower was met, in order. */
  metAt: number[];
  steps: number;
  progress: number;
} {
  const room = buildRoom(seed);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const found = new Set<string>();
  const metAt: number[] = [];
  const events: FoundEvent[] = [];

  const pos = new Vector3(room.spawn.x, 0, room.spawn.z);
  const vel = new Vector3();
  let heading = Math.PI; // into the room, away from the open front
  const dt = 1 / 60;
  const speed = blob.movement.maxSpeed * 0.75;
  const half = SIZE / 2 - 1.5;

  let prevX = room.transform.cellX(pos.x);
  let prevZ = room.transform.cellZ(pos.z);
  const brush = room.transform.radiusCells(blob.trail.radiusM);
  const splash = room.transform.radiusCells(PROP_SPLASH_M);

  let steps = 0;
  let progress = 0;
  for (; steps < MAX_STEPS; steps++) {
    // A wandering drive: mostly straight, with a lurch every so often. Nobody
    // this age drives in straight lines, and nobody sweeps a room.
    heading += (rng() - 0.5) * 0.22;
    if (rng() < 0.012) heading += (rng() - 0.5) * 2.4;

    vel.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;

    // Walls turn him around rather than letting him grind along them forever.
    if (pos.x < -half || pos.x > half) {
      pos.x = Math.max(-half, Math.min(half, pos.x));
      heading = -heading;
    }
    if (pos.z < -half || pos.z > half) {
      pos.z = Math.max(-half, Math.min(half, pos.z));
      heading = Math.PI - heading;
    }
    room.props.resolveSolids(pos, vel, blob.radius);

    const cx = room.transform.cellX(pos.x);
    const cz = room.transform.cellZ(pos.z);
    room.mask.stampSegment(prevX, prevZ, cx, cz, brush);
    prevX = cx;
    prevZ = cz;

    room.props.setTime(steps * dt);
    room.collectibles.setTime(steps * dt);
    room.props.collectTouched(pos.x, pos.z, blob.radius, TOUCH_SCRATCH);
    for (const p of TOUCH_SCRATCH) {
      room.mask.stamp(room.transform.cellX(p.x), room.transform.cellZ(p.z), splash);
      room.collectibles.onPropPainted(p, events, (id) => room.props.hide(id));
    }
    room.collectibles.checkProximity(pos.x, pos.z, blob.radius, events);

    for (const f of events) {
      if (!found.has(f.def.id) && f.def.onFind === 'follow') metAt.push(steps);
      found.add(f.def.id);
      room.mask.stamp(
        room.transform.cellX(f.x),
        room.transform.cellZ(f.z),
        room.transform.radiusCells(PROP_SPLASH_M * 1.6),
      );
    }
    events.length = 0;

    progress = 0.6 * room.mask.coverage + 0.4 * room.props.coverage;
    if (progress >= GATE) break;
  }

  room.props.dispose();
  room.collectibles.dispose();
  return { found, metAt, steps, progress };
}

const SEEDS = [1, 7, 42, 101, 2024, 77777];

/**
 * Measured against the old constants, this simulation said something useful and
 * unwelcome: a child who drives a room out to the gate met four of the six
 * either way. The find rate at the END of a room was never the problem.
 *
 * What changed is WHEN. Median time to his first friend went from about 19
 * seconds of continuous driving to about 7. That is the number that decides
 * whether the parade is a thing he notices, and it is the number pinned here.
 *
 * These times are optimistic in absolute terms -- the simulated child drives
 * flat out and never stops to spin on the spot, which a real one does
 * constantly. Read them as a comparison, not as a stopwatch.
 */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

describe('meeting his friends', () => {
  const runs = SEEDS.map((s) => ({ seed: s, ...playRoom(s) }));
  const followers = new Set(
    candy.collectibles.filter((c) => c.onFind === 'follow').map((c) => c.id),
  );

  it('the room actually finishes', () => {
    // If the gate is never reached the counts below mean nothing.
    for (const r of runs) {
      expect(
        r.progress,
        `seed ${r.seed} only reached ${(r.progress * 100) | 0}%`,
      ).toBeGreaterThanOrEqual(GATE);
    }
  });

  it('the first friend turns up early, not at the end', () => {
    const first = runs.map((r) => (r.metAt.length ? r.metAt[0]! / 60 : Infinity));
    expect(
      median(first),
      `first friend at (s): ${first.map((v) => v.toFixed(0)).join(', ')}`,
    ).toBeLessThan(15);
    // And never a whole room with nobody.
    for (const [i, t] of first.entries()) {
      expect(t, `seed ${SEEDS[i]} met nobody at all`).toBeLessThan(60);
    }
  });

  it('he ends every room with a parade, never empty-handed', () => {
    for (const r of runs) {
      const mine = [...r.found].filter((id) => followers.has(id));
      expect(mine.length, `seed ${r.seed} found ${mine.length} followers`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it('finds both kinds, so neither way of hiding is dead weight', () => {
    const byId = new Map(candy.collectibles.map((c) => [c.id, c]));
    let disguise = 0;
    let tucked = 0;
    for (const r of runs) {
      for (const id of r.found) {
        const c = byId.get(id);
        if (c?.hide === 'disguise') disguise++;
        if (c?.hide === 'tucked') tucked++;
      }
    }
    expect(disguise, 'no disguised creature was ever bumped into').toBeGreaterThan(0);
    expect(tucked, 'no tucked creature was ever walked up to').toBeGreaterThan(0);
  });
});
