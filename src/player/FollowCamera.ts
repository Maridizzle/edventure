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
    this.camera = new PerspectiveCamera(50, aspect, 0.5, 300);
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
    // Framed for a diorama, not a field. The walls have to be visible or the
    // stage stops reading as an enclosed place -- which is the entire point of
    // building it as one. Pulled back further than a follow-cam would normally
    // sit, and deliberately so.
    this.offset.set(0, portrait ? 22 : 19, portrait ? 19 : 16);
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
