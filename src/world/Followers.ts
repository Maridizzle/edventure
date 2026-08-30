import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Object3D,
  type Group,
  type ShaderMaterial,
} from 'three';
import { buildMerged } from '../shape/ShapeBuilder';
import { damp } from '../core/Spring';
import type { CollectibleDef } from '../content/types';
import type { Terrain } from './Terrain';

/**
 * The parade.
 *
 * Everyone he has found walks along behind him, in every room, for the rest of
 * the session. That is the whole reward loop and it contains no words: the line
 * over his shoulder getting longer IS the progress bar.
 *
 * They follow a BREADCRUMB TRAIL rather than steering at him directly — a ring
 * buffer of where he has recently been, each friend sampling it further back.
 * The classic trick, and the reason it is the right one here is that the trail
 * already went around every gumdrop hill he went around, so nobody has to
 * pathfind and nobody walks through scenery.
 *
 * Each friend is an InstancedMesh of one. That is a handful of draw calls, paid
 * deliberately: it is the only place in the game where per-frame matrix writes
 * are worth it, and it keeps them on the same material — and therefore the same
 * fog, paint and pop shader — as everything else in the room.
 */

/** Metres between recorded crumbs. Finer than this buys nothing visible. */
const CRUMB_M = 0.35;
/** 256 * 0.35 = ~89 m of history, far more than the longest tail needs. */
const CRUMBS = 256;
/** Metres of trail between one friend and the next. */
const GAP_M = 1.7;
/** How many are DRAWN. Never a cap on what he owns. */
export const MAX_PARADE = 8;

/** A jump this big means a room change, not a walk: refill, do not stretch. */
const TELEPORT_M = 6;

const ARRIVE_M = 1.0;
const CHEER_S = 1.15;

export type ParadeMode = 'trail' | 'cheer' | 'run' | 'wait';

interface Friend {
  def: CollectibleDef;
  mesh: InstancedMesh;
  paintTime: InstancedBufferAttribute;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Gait phase, advanced by how fast this one is actually moving. */
  bob: number;
  /** Lateral offset from the trail, so they weave instead of forming a queue. */
  side: number;
  /** Where it is trying to get to right now. */
  tx: number;
  tz: number;
  arrived: boolean;
}

const M4 = new Matrix4();
const DUMMY = new Object3D();

export class Followers {
  private friends: Friend[] = [];
  private mode: ParadeMode = 'trail';
  private modeT = 0;
  private timeNow = 0;

  /** Ring buffer of his recent positions. */
  private cx = new Float32Array(CRUMBS);
  private cz = new Float32Array(CRUMBS);
  private head = 0;
  private filled = 0;

  /** Where the parade runs to once the door opens. */
  private goalX = 0;
  private goalZ = 0;

  private readonly terrain: Terrain;

  constructor(
    defs: readonly CollectibleDef[],
    terrain: Terrain,
    private readonly material: ShaderMaterial,
    private readonly parent: Group,
    private readonly maxDetail: number,
    spawnX: number,
    spawnZ: number,
  ) {
    this.terrain = terrain;
    this.reseed(spawnX, spawnZ);
    for (let i = 0; i < defs.length && i < MAX_PARADE; i++) {
      this.spawn(defs[i]!, spawnX, spawnZ + GAP_M * (i + 1), 0);
    }
    this.writeMatrices();
  }

  /**
   * A friend joins, at the moment it hatches rather than at the next room.
   *
   * Newest goes to the FRONT of the line, right at his heels, so a find he
   * just made is the one he can see. Past the visible cap the oldest body is
   * released — he still owns it, the roster is the thing that remembers.
   */
  add(def: CollectibleDef, x: number, z: number): void {
    this.spawn(def, x, z, this.timeNow);
    // Move it to the head of the queue: index is position in the line.
    const f = this.friends.pop()!;
    this.friends.unshift(f);
    this.reindex();
    if (this.friends.length > MAX_PARADE) {
      const drop = this.friends.pop()!;
      drop.mesh.geometry.dispose();
      drop.mesh.removeFromParent();
      drop.mesh.dispose();
    }
  }

  private spawn(def: CollectibleDef, x: number, z: number, popAt: number): void {
    const i = this.friends.length;
    const geometry = buildMerged(def.shape, def.palette, this.maxDetail);
    const mesh = new InstancedMesh(geometry, this.material, 1);
    mesh.frustumCulled = false;

    const paintTime = new InstancedBufferAttribute(new Float32Array(1), 1);
    const tint = new InstancedBufferAttribute(new Float32Array(3), 3);
    paintTime.setUsage(DynamicDrawUsage);
    // Never -1: that is the shader's "never painted" sentinel and would draw
    // them drained gray. 0 means "painted at the start of this room", so the
    // ones who came through the door with him pop into being as the fade lifts.
    paintTime.array[0] = popAt;
    tint.array.fill(1);
    geometry.setAttribute('aPaintTime', paintTime);
    geometry.setAttribute('aTint', tint);

    // Alternate sides and stagger the gait so a line of eight reads as a
    // gaggle of animals rather than one animal drawn eight times.
    const side = (i % 2 === 0 ? 1 : -1) * (0.45 + (i % 3) * 0.22);
    this.friends.push({
      def,
      mesh,
      paintTime,
      x: x + side,
      y: this.terrain.heightAt(x + side, z),
      z,
      yaw: 0,
      bob: i * 1.7,
      side,
      tx: x + side,
      tz: z,
      arrived: false,
    });
    this.parent.add(mesh);
  }

  /** Side offsets belong to a position in the line, not to an animal. */
  private reindex(): void {
    for (let i = 0; i < this.friends.length; i++) {
      this.friends[i]!.side = (i % 2 === 0 ? 1 : -1) * (0.45 + (i % 3) * 0.22);
    }
  }

  get count(): number {
    return this.friends.length;
  }

  /** Everybody standing exactly where he is. Used at spawn and after a door. */
  private reseed(x: number, z: number): void {
    this.cx.fill(x);
    this.cz.fill(z);
    this.head = 0;
    this.filled = CRUMBS;
  }

  /**
   * Drop a crumb if he has moved far enough. Call from the fixed step, so the
   * trail's spacing does not change when the frame rate does.
   */
  record(x: number, z: number): void {
    const lx = this.cx[this.head]!;
    const lz = this.cz[this.head]!;
    const d2 = (x - lx) * (x - lx) + (z - lz) * (z - lz);
    if (d2 > TELEPORT_M * TELEPORT_M) {
      this.reseed(x, z);
      return;
    }
    if (d2 < CRUMB_M * CRUMB_M) return;
    this.head = (this.head + 1) % CRUMBS;
    this.cx[this.head] = x;
    this.cz[this.head] = z;
    if (this.filled < CRUMBS) this.filled++;
  }

  /**
   * The crumb roughly `dist` metres back along his path, and the normal to the
   * path there.
   *
   * The normal is what makes the side offsets read as a gaggle walking abreast.
   * Offsetting along a fixed axis instead puts a follower FORWARD or BACKWARD
   * along the trail whenever he happens to be walking that way, and the line
   * silently collapses into a pile -- which is exactly what it did.
   */
  private sampleBack(dist: number, out: Sample): void {
    const steps = Math.min(this.filled - 1, Math.max(0, Math.round(dist / CRUMB_M)));
    const i = (this.head - steps + CRUMBS * 2) % CRUMBS;
    out.x = this.cx[i]!;
    out.z = this.cz[i]!;

    const ahead = (this.head - Math.max(0, steps - 3) + CRUMBS * 2) % CRUMBS;
    const dx = this.cx[ahead]! - out.x;
    const dz = this.cz[ahead]! - out.z;
    const len = Math.hypot(dx, dz);
    // Standing still: any perpendicular will do, and it will not be seen.
    out.nx = len > 1e-4 ? -dz / len : 1;
    out.nz = len > 1e-4 ? dx / len : 0;
  }

  /**
   * Everybody pops, leaps and spins on the spot.
   *
   * Reuses the props' paint animation exactly: writing `aPaintTime` is the
   * whole cost of the pop, and it is staggered so the cheer ripples down the
   * line instead of firing as one thud.
   */
  cheer(time: number): void {
    this.mode = 'cheer';
    this.modeT = 0;
    for (let i = 0; i < this.friends.length; i++) {
      const f = this.friends[i]!;
      f.paintTime.array[0] = time + i * 0.08;
      f.paintTime.needsUpdate = true;
      f.arrived = false;
    }
  }

  /** Break formation and gather into a little arc in front of the door. */
  runTo(x: number, z: number): void {
    this.mode = 'run';
    this.modeT = 0;
    this.goalX = x;
    this.goalZ = z;
  }

  get paradeMode(): ParadeMode {
    return this.mode;
  }

  /** True once everyone is standing at the door. Vacuously true with nobody. */
  get allArrived(): boolean {
    for (const f of this.friends) if (!f.arrived) return false;
    return true;
  }

  /** Where a friend is standing, nearest him first. Nearest-first, like the line. */
  place(i: number): { x: number; y: number; z: number } | null {
    const f = this.friends[i];
    return f ? { x: f.x, y: f.y, z: f.z } : null;
  }

  /** A friend to sparkle while they wait, or null. */
  sparkleTarget(): { x: number; y: number; z: number; color: number } | null {
    if (this.friends.length === 0) return null;
    const f = this.friends[(Math.random() * this.friends.length) | 0]!;
    return { x: f.x, y: f.y + 0.9, z: f.z, color: f.def.palette[0] ?? 0xffffff };
  }

  update(dt: number, px: number, pz: number, time: number): void {
    this.timeNow = time;
    if (this.friends.length === 0) return;
    this.modeT += dt;
    if (this.mode === 'cheer' && this.modeT >= CHEER_S) this.mode = 'trail';

    const n = this.friends.length;
    for (let i = 0; i < n; i++) {
      const f = this.friends[i]!;

      if (this.mode === 'run' || this.mode === 'wait') {
        // A shallow arc facing back into the room, so the crowd is between him
        // and the doorway rather than hidden behind it.
        const spread = n === 1 ? 0 : (i / (n - 1) - 0.5) * 1.5;
        const r = 2.4 + (i % 2) * 0.7;
        f.tx = this.goalX + Math.sin(spread) * r;
        f.tz = this.goalZ + Math.cos(spread) * r;
      } else if (this.mode === 'cheer') {
        // Hold position and jump: the room is what moves during the cheer.
        f.tx = f.x;
        f.tz = f.z;
      } else {
        this.sampleBack(GAP_M * (i + 1), SAMPLE);
        f.tx = SAMPLE.x + SAMPLE.nx * f.side;
        f.tz = SAMPLE.z + SAMPLE.nz * f.side;
      }

      const dx = f.tx - f.x;
      const dz = f.tz - f.z;
      const dist = Math.hypot(dx, dz);
      f.arrived = this.mode === 'run' || this.mode === 'wait' ? dist < ARRIVE_M : false;

      // Running is urgent; ambling behind him is not.
      const rate = this.mode === 'run' ? 3.4 : 5.5;
      const k = damp(dt, rate);
      const mx = dx * k;
      const mz = dz * k;
      f.x += mx;
      f.z += mz;

      const moved = Math.hypot(mx, mz);
      const speed = dt > 0 ? moved / dt : 0;

      // Face the way it is going, but only once actually going somewhere --
      // otherwise a stationary animal spins on rounding error.
      if (moved > 0.004) {
        const want = Math.atan2(mx, mz);
        let delta = want - f.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        f.yaw += delta * damp(dt, 9);
      }

      f.y = this.terrain.heightAt(f.x, f.z);
      f.bob += dt * (2.5 + speed * 2.2);

      // A cheering animal leaps and spins; a walking one trots.
      let lift = Math.abs(Math.sin(f.bob)) * Math.min(0.26, speed * 0.07);
      let spin = 0;
      if (this.mode === 'cheer') {
        const t = Math.max(0, this.modeT - i * 0.08);
        lift += Math.abs(Math.sin(t * 8.5)) * 0.62 * Math.max(0, 1 - t / CHEER_S);
        spin = t * 7;
      } else if (this.mode === 'wait') {
        lift += Math.abs(Math.sin(f.bob * 2.2)) * 0.3;
      }

      DUMMY.position.set(f.x, f.y + lift, f.z);
      DUMMY.rotation.set(0, f.yaw + spin, 0);
      DUMMY.scale.setScalar(f.def.scale);
      DUMMY.updateMatrix();
      M4.copy(DUMMY.matrix);
      f.mesh.setMatrixAt(0, M4);
      f.mesh.instanceMatrix.needsUpdate = true;
    }

    // Once they are all there, settle into bouncing rather than creeping.
    if (this.mode === 'run' && this.allArrived) this.mode = 'wait';

    // He can keep driving throughout, and if he wanders off they come back to
    // him -- the celebration must never take control away.
    if (this.mode === 'wait') {
      const away = Math.hypot(px - this.goalX, pz - this.goalZ);
      if (away > 26) this.mode = 'trail';
    }
  }

  private writeMatrices(): void {
    for (const f of this.friends) {
      DUMMY.position.set(f.x, f.y, f.z);
      DUMMY.rotation.set(0, f.yaw, 0);
      DUMMY.scale.setScalar(f.def.scale);
      DUMMY.updateMatrix();
      M4.copy(DUMMY.matrix);
      f.mesh.setMatrixAt(0, M4);
      f.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const f of this.friends) {
      f.mesh.geometry.dispose();
      f.mesh.removeFromParent();
      f.mesh.dispose();
    }
    this.friends.length = 0;
  }
}

interface Sample {
  x: number;
  z: number;
  /** Unit normal to the path at that point. */
  nx: number;
  nz: number;
}

/** Shared scratch: the follow loop allocates nothing. */
const SAMPLE: Sample = { x: 0, z: 0, nx: 1, nz: 0 };
