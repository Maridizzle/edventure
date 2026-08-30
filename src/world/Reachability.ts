import type { AreaTransform } from '../core/AreaTransform';
import type { Placed } from './Layout';

/**
 * Flood-fill from spawn to find the floor he can actually reach.
 *
 * This became load-bearing the moment solid objects appeared. Solids can
 * enclose floor area, and floor he cannot reach still counts toward the
 * coverage denominator — which would make the door's threshold unachievable
 * and turn a no-fail game into a dead end.
 *
 * So anything unreachable is marked unpaintable and simply drops out of the
 * denominator. The target is then always achievable by construction.
 */
export function computeReachable(
  transform: AreaTransform,
  placed: Placed[],
  solidRadius: (p: Placed) => number,
  spawn: { x: number; z: number },
  playerRadius: number,
): Uint8Array {
  const n = transform.cells;
  const open = new Uint8Array(n * n);
  open.fill(1);

  // Block cells inside a solid, inflated by the player's own radius: he can
  // never get his centre closer than that.
  for (const p of placed) {
    const r = solidRadius(p);
    if (r <= 0) continue;
    const rr = r + playerRadius;
    const cx = transform.cellX(p.x);
    const cz = transform.cellZ(p.z);
    const rc = transform.radiusCells(rr);
    const x0 = Math.max(0, Math.floor(cx - rc));
    const x1 = Math.min(n - 1, Math.ceil(cx + rc));
    const z0 = Math.max(0, Math.floor(cz - rc));
    const z1 = Math.min(n - 1, Math.ceil(cz + rc));
    const rc2 = rc * rc;
    for (let z = z0; z <= z1; z++) {
      const dz = z - cz;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dz * dz <= rc2) open[z * n + x] = 0;
      }
    }
  }

  const reachable = new Uint8Array(n * n);
  const startX = Math.round(transform.cellX(spawn.x));
  const startZ = Math.round(transform.cellZ(spawn.z));

  // Nudge the seed to the nearest open cell if the spawn itself is blocked.
  let seed = -1;
  for (let r = 0; r < 12 && seed < 0; r++) {
    for (let dz = -r; dz <= r && seed < 0; dz++) {
      for (let dx = -r; dx <= r && seed < 0; dx++) {
        const x = startX + dx;
        const z = startZ + dz;
        if (x < 0 || z < 0 || x >= n || z >= n) continue;
        if (open[z * n + x] === 1) seed = z * n + x;
      }
    }
  }
  if (seed < 0) return open; // nothing open at all; fail safe by keeping it all

  // Iterative flood fill; an Int32Array stack avoids per-cell allocation.
  const stack = new Int32Array(n * n);
  let sp = 0;
  stack[sp++] = seed;
  reachable[seed] = 1;

  while (sp > 0) {
    const i = stack[--sp]!;
    const x = i % n;
    const z = (i / n) | 0;
    if (x > 0) push(i - 1);
    if (x < n - 1) push(i + 1);
    if (z > 0) push(i - n);
    if (z < n - 1) push(i + n);
  }

  function push(j: number): void {
    if (reachable[j] === 1 || open[j] === 0) return;
    reachable[j] = 1;
    stack[sp++] = j;
  }

  return reachable;
}
