import { Group, Mesh, Quaternion, Vector3, type BufferGeometry, type ShaderMaterial } from 'three';
import { buildParts } from '../shape/ShapeBuilder';
import { springStep } from '../core/Spring';
import type { CharacterDef } from '../content/types';
import type { MoveState, VisualOut } from './Motion';
import { FLAVORS } from './Motion';

interface SpringPart {
  mesh: Mesh;
  rest: Vector3;
  offset: Vector3;
  velocity: Vector3;
  mass: number;
}

const ZERO = new Vector3();
const KICK = new Vector3();

/**
 * A character assembled from a data file.
 *
 * The whole reason this needs no rigs and no animation files: each named part
 * gets a critically-damped spring chasing its rest position, kicked by the
 * body's acceleration. Ten lines of physics makes a pile of spheres feel
 * squishy, weighted and alive.
 */
export class Character {
  readonly group = new Group();
  readonly def: CharacterDef;
  private parts: SpringPart[] = [];
  private visual: VisualOut = { quat: new Quaternion(), scale: new Vector3(1, 1, 1) };
  /** Tumbles with the movement flavor. */
  private inner = new Group();
  /** Stays world-aligned so the face is always visible. */
  private face = new Group();
  private silhouettes: Mesh[] = [];

  constructor(
    def: CharacterDef,
    material: ShaderMaterial,
    maxDetail: number,
    silhouette?: ShaderMaterial,
  ) {
    this.def = def;
    const built = buildParts(def.shape, def.palette, maxDetail);

    if (built.body) {
      const m = new Mesh(built.body, material);
      m.frustumCulled = false;
      this.inner.add(m);
      this.addSilhouette(built.body, silhouette, this.inner);
    }

    for (const p of built.named) {
      const mesh = new Mesh(p.geometry, material);
      mesh.frustumCulled = false;
      mesh.position.copy(p.rest);
      // Billboard parts hang off the outer group so the body's tumble never
      // rotates them. The camera's yaw is fixed, so world-aligned is
      // player-facing.
      const host = p.billboard ? this.face : this.inner;
      host.add(mesh);
      this.addSilhouette(p.geometry, silhouette, host);
      this.parts.push({
        mesh,
        rest: p.rest.clone(),
        offset: new Vector3(),
        velocity: new Vector3(),
        // Parts further from the centre swing more.
        mass: 0.4 + p.rest.length() * 1.1,
      });
    }

    this.group.add(this.inner);
    this.group.add(this.face);
  }

  /**
   * A copy of the body that draws ONLY where something is in front of it.
   *
   * Dropping the camera to a shallow angle means the hills that hide
   * collectibles can equally hide the player, and losing sight of yourself is
   * the one thing this game must never do. `GreaterDepth` renders the copy
   * exclusively where the depth test fails, so it is invisible in the open and
   * becomes a bright outline the instant he goes behind a hill.
   */
  private addSilhouette(
    geometry: BufferGeometry,
    material: ShaderMaterial | undefined,
    host: Group,
  ): void {
    if (!material) return;
    const m = new Mesh(geometry, material);
    m.frustumCulled = false;
    m.renderOrder = 900;
    host.add(m);
    this.silhouettes.push(m);
  }

  /** Called from the fixed sim step. */
  update(s: MoveState, dt: number): void {
    this.group.position.copy(s.pos);

    const flavor = FLAVORS[this.def.movement.flavor];
    flavor.visual(s, this.def.movement, dt, this.visual);
    this.inner.quaternion.copy(this.visual.quat);
    this.inner.scale.copy(this.visual.scale);
    // The face squashes with the body but never tumbles with it.
    this.face.scale.copy(this.visual.scale);

    const w = this.def.wobble;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]!;
      KICK.copy(s.accel).multiplyScalar(-w.kick * p.mass * dt);
      p.velocity.add(KICK);
      springStep(p.offset, p.velocity, ZERO, w.stiffness, w.damping, dt);
      p.mesh.position.copy(p.rest).add(p.offset);
    }
  }

  dispose(): void {
    // Undisposed geometry crashes the tab after ~10 scene switches on a 4 GB
    // phone; renderer.info.memory must return to baseline.
    //
    // Silhouettes SHARE geometry with the meshes they shadow, so detach them
    // first and dispose each buffer exactly once.
    for (const m of this.silhouettes) m.removeFromParent();
    this.silhouettes.length = 0;
    for (const g of [this.inner, this.face]) {
      g.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose();
      });
    }
    this.parts.length = 0;
  }
}
