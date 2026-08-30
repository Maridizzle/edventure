import { Group, Mesh, type ShaderMaterial } from 'three';
import { buildMerged } from '../shape/ShapeBuilder';
import type { SceneDef } from '../content/types';

/**
 * The way out.
 *
 * It stands drained and shut from the moment he arrives, so it is visibly a
 * thing that will matter later without a single word explaining it. When the
 * scene is painted enough it blooms into colour and opens — S3 animates that;
 * S1 only needs it to be standing there, gray and obvious.
 */
export class Door {
  readonly group = new Group();
  private mesh: Mesh;

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
    this.group.add(this.mesh);
    this.group.position.set(pos.x, y, pos.z);
    this.group.rotation.y = pos.yaw;
    this.group.scale.setScalar(scene.door.scale);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}
