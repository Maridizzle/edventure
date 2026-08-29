import { Quaternion, Vector2, Vector3 } from 'three';
import type { Terrain } from '../world/Terrain';
import { clamp } from '../core/Spring';

export type Flavor = 'roll' | 'hop' | 'hover' | 'glide';

export interface MovementDef {
  flavor: Flavor;
  maxSpeed: number;
  accel: number;
  drag: number;
  slopeAssist: number;
  hopHeight?: number;
  hopPerMetre?: number;
}

export interface MoveState {
  pos: Vector3;
  vel: Vector3;
  accel: Vector3;
  speed: number;
  speedNorm: number;
  groundY: number;
  groundNormal: Vector3;
  /** Distance travelled, drives hop phase and roll amount. */
  phase: number;
  justLanded: boolean;
  radius: number;
}

export interface VisualOut {
  quat: Quaternion;
  scale: Vector3;
}

/**
 * A flavor is parameters plus three tiny pure hooks — never a subclass.
 * Shared code owns position, velocity, drag, slope, bounds, and the camera.
 */
export interface MovementFlavor {
  groundOffset(s: MoveState, m: MovementDef): number;
  visual(s: MoveState, m: MovementDef, dt: number, out: VisualOut): void;
  stampPolicy: 'continuous' | 'onLanding';
  /** Brush radius multiplier — each flavor paints with a different signature. */
  brushScale: number;
}

export function makeMoveState(radius: number): MoveState {
  return {
    pos: new Vector3(),
    vel: new Vector3(),
    accel: new Vector3(),
    speed: 0,
    speedNorm: 0,
    groundY: 0,
    groundNormal: new Vector3(0, 1, 0),
    phase: 0,
    justLanded: false,
    radius,
  };
}

// Module-scope scratch. Risk #4: a `new Vector3()` inside the frame loop is a
// 10-40ms GC pause on Chrome Android every few seconds — a visible stutter.
const SCRATCH_DIR = new Vector3();
const SCRATCH_SLOPE = new Vector3();
const PREV_VEL = new Vector3();

const GRAVITY = 9.81;

export function stepMotion(
  s: MoveState,
  m: MovementDef,
  input: Vector2,
  terrain: Terrain,
  worldSize: number,
  dt: number,
): void {
  PREV_VEL.copy(s.vel);

  // 1. Input -> world direction. The camera basis is world-fixed, so up on the
  //    stick is -Z forever.
  SCRATCH_DIR.set(input.x, 0, input.y);
  const inLen = SCRATCH_DIR.length();
  if (inLen > 1) SCRATCH_DIR.multiplyScalar(1 / inLen);

  // 2. Accelerate.
  s.vel.addScaledVector(SCRATCH_DIR, m.accel * dt);

  // 3. Slope assist — rolling downhill should feel like rolling downhill.
  SCRATCH_SLOPE.set(s.groundNormal.x, 0, s.groundNormal.z).multiplyScalar(
    m.slopeAssist * GRAVITY * dt,
  );
  s.vel.add(SCRATCH_SLOPE);

  // 4. Drag, frame-rate independent.
  s.vel.multiplyScalar(Math.pow(m.drag, dt * 60));

  // 5. Clamp.
  s.speed = s.vel.length();
  if (s.speed > m.maxSpeed) {
    s.vel.multiplyScalar(m.maxSpeed / s.speed);
    s.speed = m.maxSpeed;
  }
  s.speedNorm = s.speed / m.maxSpeed;

  // 6. Integrate XZ only. There is NO vertical velocity, ever — which is why
  //    the player cannot fall through the world, tunnel, or get stuck.
  s.pos.x += s.vel.x * dt;
  s.pos.z += s.vel.z * dt;

  // 7. Soft boundary: a rubbery push-back over the outer metres, never a wall.
  softBound(s, worldSize, dt);

  // 8. Snap to terrain.
  s.groundY = terrain.heightAt(s.pos.x, s.pos.z);
  terrain.normalAt(s.pos.x, s.pos.z, s.groundNormal);
  s.phase += s.speed * dt;

  const f = FLAVORS[m.flavor];
  const prevOffset = s.pos.y - s.groundY;
  const offset = f.groundOffset(s, m);
  s.pos.y = s.groundY + offset;

  // Landing detection for the hop flavor's stamp policy.
  s.justLanded = prevOffset > s.radius + 0.02 && offset <= s.radius + 0.02;

  s.accel.subVectors(s.vel, PREV_VEL).multiplyScalar(1 / Math.max(dt, 1e-4));
}

const BOUND_MARGIN = 6;

function softBound(s: MoveState, worldSize: number, dt: number): void {
  const limit = worldSize / 2 - BOUND_MARGIN;
  const push = (v: number): number => {
    const over = Math.abs(v) - limit;
    if (over <= 0) return 0;
    const t = clamp(over / BOUND_MARGIN, 0, 1);
    return -Math.sign(v) * t * t * 34;
  };
  const ax = push(s.pos.x);
  const az = push(s.pos.z);
  if (ax !== 0) s.vel.x += ax * dt;
  if (az !== 0) s.vel.z += az * dt;

  // A hard stop only well past the soft zone, so he can never actually leave.
  const hard = worldSize / 2 - 1.5;
  s.pos.x = clamp(s.pos.x, -hard, hard);
  s.pos.z = clamp(s.pos.z, -hard, hard);
}

const UP = new Vector3(0, 1, 0);
const AXIS = new Vector3();
const DELTA_Q = new Quaternion();

export const FLAVORS: Record<Flavor, MovementFlavor> = {
  roll: {
    stampPolicy: 'continuous',
    brushScale: 1,
    groundOffset: (s) => s.radius,
    visual: (s, _m, dt, out) => {
      if (s.speed > 0.01) {
        AXIS.crossVectors(UP, s.vel).normalize();
        DELTA_Q.setFromAxisAngle(AXIS, (s.speed * dt) / s.radius);
        out.quat.premultiply(DELTA_Q);
      }
      const squash = 1 + 0.08 * s.speedNorm;
      out.scale.set(squash, 1 / squash, squash);
    },
  },

  hop: {
    stampPolicy: 'onLanding',
    brushScale: 1.45,
    groundOffset: (s, m) => {
      const t = Math.sin(s.phase * (m.hopPerMetre ?? 0.42) * Math.PI);
      return s.radius + (m.hopHeight ?? 1.1) * t * t;
    },
    visual: (s, m, _dt, out) => {
      const t = Math.sin(s.phase * (m.hopPerMetre ?? 0.42) * Math.PI);
      const air = t * t;
      // Squash on landing, stretch at apex.
      const sy = 0.78 + 0.5 * air;
      out.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      if (s.speed > 0.05) {
        out.quat.setFromUnitVectors(UP, UP); // keep upright
        const yaw = Math.atan2(s.vel.x, s.vel.z);
        DELTA_Q.setFromAxisAngle(UP, yaw);
        out.quat.copy(DELTA_Q);
      }
    },
  },

  hover: {
    stampPolicy: 'continuous',
    brushScale: 1.5,
    groundOffset: (s) => s.radius + 0.9 + 0.12 * Math.sin(s.phase * 2),
    visual: (s, _m, _dt, out) => {
      // Bank into the turn, never tumble.
      const bank = clamp(s.vel.x * 0.05, -0.32, 0.32);
      AXIS.set(0, 0, 1);
      out.quat.setFromAxisAngle(AXIS, -bank);
      out.scale.set(1, 1, 1);
    },
  },

  glide: {
    stampPolicy: 'continuous',
    brushScale: 0.6,
    groundOffset: (s) => s.radius,
    visual: (s, _m, _dt, out) => {
      const stretch = 1 + 0.3 * s.speedNorm;
      out.scale.set(1 / Math.sqrt(stretch), 1 / Math.sqrt(stretch), stretch);
      if (s.speed > 0.05) {
        const yaw = Math.atan2(s.vel.x, s.vel.z);
        out.quat.setFromAxisAngle(UP, yaw);
      }
    },
  },
};
