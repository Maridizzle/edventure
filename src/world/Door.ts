import { Group, Mesh, Vector3, type ShaderMaterial } from 'three';
import { buildMerged } from '../shape/ShapeBuilder';
import { damp } from '../core/Spring';
import type { SceneDef } from '../content/types';

/**
 * The way out.
 *
 * It stands drained and shut from the moment he arrives, so it is visibly a
 * thing that will matter later without a single word explaining it. When the
 * room is painted enough it blooms into colour and swings open.
 *
 * The beckoning matters more here than it looks. The fog is tight and the
 * camera is low, so when the door opens it is very likely OFF SCREEN — he can
 * finish a room and never notice. The mote it throws toward him every few
 * seconds is the entire wordless instruction, and without it the loop can
 * silently stall.
 */

const OPEN_TIME = 1.1;
/** How close he must get to go through. */
export const DOOR_TRIGGER_R = 3.0;
/** Seconds between "this way" motes once it is open. */
const BECKON_EVERY = 6;

export class Door {
  readonly group = new Group();
  readonly position = new Vector3();
  private mesh: Mesh;
  private inner = new Group();

  private opening = false;
  /** 0 = shut, 1 = fully open. */
  private t = 0;
  private beckonTimer = 0;

  constructor(
    scene: SceneDef,
    material: ShaderMaterial,
    pos: { x: number; z: number; yaw: number },
    y: number,
    maxDetail: number,
  ) {
    const geometry = buildMerged(scene.door.shape, scene.door.palette, maxDetail);
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.inner.add(this.mesh);
    this.group.add(this.inner);
    this.group.position.set(pos.x, y, pos.z);
    this.group.rotation.y = pos.yaw;
    this.group.scale.setScalar(scene.door.scale);
    this.position.set(pos.x, y, pos.z);
  }

  get isOpen(): boolean {
    return this.opening;
  }

  /** Fully open and safe to walk through. */
  get ready(): boolean {
    return this.t > 0.6;
  }

  open(): void {
    if (this.opening) return;
    this.opening = true;
    // Beckon almost immediately the first time, then settle into the cadence.
    this.beckonTimer = 0.8;
  }

  /** True on the frames it wants to throw a "this way" mote. */
  update(dt: number): boolean {
    if (!this.opening) return false;

    this.t += (1 - this.t) * damp(dt, 1 / (OPEN_TIME * 0.35));

    // Rise and swell as it opens, with a little overshoot at the top.
    const overshoot = 1 + Math.sin(Math.min(1, this.t) * Math.PI) * 0.18;
    this.inner.scale.setScalar(overshoot);
    this.inner.position.y = this.t * 0.4;

    this.beckonTimer -= dt;
    if (this.beckonTimer <= 0) {
      this.beckonTimer = BECKON_EVERY;
      return true;
    }
    return false;
  }

  /** Has he reached it? Only ever true once the door has actually opened. */
  reached(x: number, z: number, radius: number): boolean {
    if (!this.ready) return false;
    const dx = this.position.x - x;
    const dz = this.position.z - z;
    const r = DOOR_TRIGGER_R + radius;
    return dx * dx + dz * dz <= r * r;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}
