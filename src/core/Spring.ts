import { Vector3 } from 'three';

/**
 * Frame-rate-independent smoothing factor.
 *
 * Use this instead of `a.lerp(b, 0.1)` everywhere. Raw lerp constants are
 * frame-rate dependent, which matters a lot here because the quality governor
 * moves the device between 30 and 60 fps mid-session — camera feel must not
 * change when it does.
 */
export function damp(dt: number, rate: number): number {
  return 1 - Math.exp(-dt * rate);
}

export function dampScalar(cur: number, target: number, dt: number, rate: number): number {
  return cur + (target - cur) * damp(dt, rate);
}

/**
 * Critically-damped-ish spring step, in place.
 *
 * This is what makes a pile of primitives feel alive: each named body part
 * chases its rest position while being kicked by the body's acceleration.
 * Ten lines, and it replaces an entire rig-and-animation pipeline.
 */
export function springStep(
  pos: Vector3,
  vel: Vector3,
  target: Vector3,
  stiffness: number,
  damping: number,
  dt: number,
): void {
  // Semi-implicit Euler: stable at the step sizes we use.
  vel.x += ((target.x - pos.x) * stiffness - vel.x * damping) * dt;
  vel.y += ((target.y - pos.y) * stiffness - vel.y * damping) * dt;
  vel.z += ((target.z - pos.z) * stiffness - vel.z * damping) * dt;
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.z += vel.z * dt;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
