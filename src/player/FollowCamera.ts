import { PerspectiveCamera, Vector3 } from 'three';
import { damp } from '../core/Spring';

/**
 * The camera's yaw is FIXED for the entire area and never changes. Not once.
 *
 * This is the single most important control decision in the project. If the
 * camera yaws to follow the player, "push up" means "move away from the
 * camera", and that mapping rotates as he turns. Adults tolerate it after a
 * decade of practice; a 5-year-old spins in circles. With fixed yaw, up on the
 * stick is always the same world direction, forever, and he masters it in about
 * ten seconds.
 *
 * The pitch is steep enough (~50 degrees) that the world still reads
 * unmistakably as 3D rather than top-down.
 */
export class FollowCamera {
  readonly camera: PerspectiveCamera;
  /** World-space, CONSTANT direction. Only its length is ever scaled. */
  private offset = new Vector3(0, 14.5, 12.5);
  private lookSmooth = new Vector3();
  private target = new Vector3();
  private look = new Vector3();

  constructor(aspect: number) {
    // Narrower than before. At a shallow angle a wide FOV makes whatever is
    // nearest loom over everything else.
    this.camera = new PerspectiveCamera(42, aspect, 0.5, 300);
  }

  /** Snap on area entry so the first frame is not a swoop from the origin. */
  reset(playerPos: Vector3): void {
    this.camera.position.copy(playerPos).add(this.offset);
    this.lookSmooth.copy(playerPos);
    this.camera.lookAt(this.lookSmooth);
  }

  update(dt: number, pos: Vector3, vel: Vector3, speedNorm: number, lookAhead: number): void {
    // Subtle pull-back at speed. Never a FOV change — that reads as nausea.
    const zoom = 1 + 0.22 * speedNorm;
    this.target.copy(pos).addScaledVector(this.offset, zoom);
    this.camera.position.lerp(this.target, damp(dt, 6.0));

    this.look.copy(pos).addScaledVector(vel, lookAhead);
    // Aim just above him so the world ahead gets the frame rather than the
    // floor underfoot. Kept small: push this up and he sinks toward the bottom
    // of the screen and ends up behind his own thumb.
    this.look.y += 1.0;
    this.lookSmooth.lerp(this.look, damp(dt, 4.0));
    this.camera.lookAt(this.lookSmooth);
  }

  /**
   * Portrait needs more room ahead of the player; landscape needs less height.
   * Called on resize/rotate — the caller eases it rather than snapping.
   */
  setAspect(w: number, h: number): void {
    this.camera.aspect = w / h;
    const portrait = h > w;
    // A shallow ~25-degree pitch, roughly half the old near-overhead angle.
    //
    // This is what makes anything hideable: at 25 degrees a hill of height H
    // conceals about 2.1*H of ground behind it, so a 4m hill hides ~8m of
    // world. The cost is that the whole room is no longer legible at a glance,
    // which was a real virtue of the overhead framing -- the audio pad and the
    // cleared fog carry the "how am I doing" signal now.
    this.offset.set(0, portrait ? 16.5 : 14.5, portrait ? 27 : 24);
    this.camera.updateProjectionMatrix();
  }

  /**
   * The camera basis for input. Because yaw is fixed this is a constant
   * rotation, computed once — "up on the stick" resolves to the same world
   * direction on every frame of the whole game.
   */
  inputBasis(out: { x: Vector3; z: Vector3 }): void {
    // Forward is the camera's -Z projected onto the ground plane.
    out.z.set(0, 0, -1);
    out.x.set(1, 0, 0);
  }
}
