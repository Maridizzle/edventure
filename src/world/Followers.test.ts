import { describe, expect, it } from 'vitest';
import { Group, ShaderMaterial } from 'three';
import { Followers, MAX_PARADE } from './Followers';
import { Terrain } from './Terrain';
import { candyCollectibles } from '../content/collectibles/candy';
import { candy } from '../content/scenes/candy';

/**
 * The breadcrumb trail, without a WebGL context.
 *
 * Geometry and InstancedMesh both build fine off-screen, so the thing worth
 * pinning is the following itself: they stay spaced, they stay BEHIND him, a
 * room change does not stretch them across the world, and they all reach the
 * door when told to. A friend who never arrives leaves the celebration hanging.
 */

const FOLLOWERS = candyCollectibles.filter((c) => c.onFind === 'follow');

function terrain(): Terrain {
  const t = candy.stage.terrain!;
  return new Terrain(
    {
      worldSize: candy.stage.width,
      grid: 64,
      octaves: t.octaves,
      warpFreq: t.warp.freq,
      warpAmp: t.warp.amp,
      maxSlopeDeg: t.maxSlopeDeg,
      edgeFalloff: null,
    },
    7,
  );
}

function makeParade(count: number): { f: Followers; parent: Group } {
  const parent = new Group();
  const f = new Followers(
    FOLLOWERS.slice(0, count),
    terrain(),
    new ShaderMaterial(),
    parent,
    0,
    0,
    0,
  );
  return { f, parent };
}

/** Walk him from (0,0) toward +X at a steady 2 m/s, stepping at 60 Hz. */
function walk(f: Followers, seconds: number, speed = 2): { x: number; z: number } {
  const dt = 1 / 60;
  let x = 0;
  let time = 0;
  for (let i = 0; i < seconds * 60; i++) {
    x += speed * dt;
    time += dt;
    f.record(x, 0);
    f.update(dt, x, 0, time);
  }
  return { x, z: 0 };
}

describe('Followers', () => {
  it('builds one body per friend, up to the visible cap', () => {
    const { f, parent } = makeParade(3);
    expect(f.count).toBe(3);
    expect(parent.children).toHaveLength(3);
    f.dispose();
  });

  it('never draws more than the cap, however many he owns', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...FOLLOWERS[i % FOLLOWERS.length]!,
      id: `x${i}`,
    }));
    const parent = new Group();
    const f = new Followers(many, terrain(), new ShaderMaterial(), parent, 0, 0, 0);
    expect(f.count).toBe(MAX_PARADE);
    f.dispose();
  });

  it('keeps them spaced out and behind him', () => {
    const { f } = makeParade(4);
    const p = walk(f, 12);

    let last = 0;
    for (let i = 0; i < f.count; i++) {
      const place = f.place(i)!;
      // Behind, meaning back down the path he came along.
      expect(place.x).toBeLessThan(p.x);
      const d = Math.hypot(place.x - p.x, place.z - p.z);
      // Each one further back than the one in front of it, and no pile-up.
      expect(d).toBeGreaterThan(last + 0.6);
      last = d;
    }
    // The whole tail stays close enough to be on screen with him.
    expect(last).toBeLessThan(12);
    f.dispose();
  });

  it('follows him round a corner instead of cutting it', () => {
    // The point of a breadcrumb trail: the path already went around whatever
    // he went around, so nobody walks through a gumdrop hill.
    const { f } = makeParade(3);
    const dt = 1 / 60;
    let time = 0;
    // Straight out along +X, then a hard left along +Z.
    for (let i = 0; i < 300; i++) {
      const x = i * 0.04;
      time += dt;
      f.record(x, 0);
      f.update(dt, x, 0, time);
    }
    for (let i = 0; i < 60; i++) {
      const z = i * 0.04;
      time += dt;
      f.record(12, z);
      f.update(dt, 12, z, time);
    }
    // Two seconds after the turn the tail is still back along the OLD leg,
    // not strung across the diagonal shortcut.
    const tail = f.place(2)!;
    expect(tail.x).toBeLessThan(12);
    expect(Math.abs(tail.z)).toBeLessThan(1.5);
    f.dispose();
  });

  it('does not stretch across the world when he changes rooms', () => {
    const { f } = makeParade(4);
    walk(f, 10);
    // A room change teleports him; the trail must be refilled, not spanned.
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) f.record(-40, 40);
    for (let i = 0; i < 30; i++) f.update(dt, -40, 40, 10 + i * dt);
    for (let i = 0; i < f.count; i++) {
      const p = f.place(i)!;
      expect(Math.hypot(p.x + 40, p.z - 40)).toBeLessThan(14);
    }
    f.dispose();
  });

  it('everybody reaches the door when sent, and then waits there', () => {
    const { f } = makeParade(5);
    walk(f, 6);
    expect(f.allArrived).toBe(false);

    f.runTo(3, -18);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 15; i++) f.update(dt, 0, 0, 6 + i * dt);

    expect(f.allArrived).toBe(true);
    expect(f.paradeMode).toBe('wait');
    for (let i = 0; i < f.count; i++) {
      const p = f.place(i)!;
      expect(Math.hypot(p.x - 3, p.z + 18)).toBeLessThan(5);
    }
    f.dispose();
  });

  it('has arrived vacuously when he has no friends yet', () => {
    // This is what lets the very first celebration finish at all.
    const { f } = makeParade(0);
    expect(f.count).toBe(0);
    expect(f.allArrived).toBe(true);
    expect(f.sparkleTarget()).toBeNull();
    f.dispose();
  });

  it('a friend found mid-room joins at his heels', () => {
    const { f, parent } = makeParade(2);
    walk(f, 8);
    const newcomer = FOLLOWERS[3]!;
    f.add(newcomer, 16, 0);
    expect(f.count).toBe(3);
    expect(parent.children).toHaveLength(3);
    // Newest is nearest: index 0 is the front of the line.
    expect(f.place(0)!.x).toBeGreaterThan(f.place(2)!.x);
    f.dispose();
  });

  it('drops a body past the cap without ever losing the line', () => {
    // A full line to begin with, whatever this scene happens to define.
    const full = Array.from({ length: MAX_PARADE }, (_, i) => ({
      ...FOLLOWERS[i % FOLLOWERS.length]!,
      id: `full${i}`,
    }));
    const parent = new Group();
    const f = new Followers(full, terrain(), new ShaderMaterial(), parent, 0, 0, 0);
    expect(f.count).toBe(MAX_PARADE);
    for (let i = 0; i < 5; i++) {
      f.add({ ...FOLLOWERS[0]!, id: `extra${i}` }, 0, 0);
      expect(f.count).toBe(MAX_PARADE);
      expect(parent.children).toHaveLength(MAX_PARADE);
    }
    f.dispose();
  });

  it('gives every mesh back', () => {
    const { f, parent } = makeParade(4);
    walk(f, 3);
    f.dispose();
    expect(parent.children).toHaveLength(0);
    expect(f.count).toBe(0);
  });
});
