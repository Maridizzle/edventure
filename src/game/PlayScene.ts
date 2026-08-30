import {
  Color,
  Fog,
  Group,
  Mesh,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import { AreaTransform } from '../core/AreaTransform';
import { makeNoiseTextureData } from '../core/Noise';
import { stream } from '../core/Rng';
import type { TierSettings } from '../core/Quality';
import { PaintMask } from '../paint/PaintMask';
import { createFieldTexture, createNoiseTexture, createPaintTexture } from '../paint/PaintTextures';
import { createGroundMaterial } from '../paint/GroundMaterial';
import { Terrain } from '../world/Terrain';
import { layoutScene, type LayoutResult } from '../world/Layout';
import { buildStage, type StageBuild } from '../world/Stage';
import { Props, TOUCH_SCRATCH } from '../world/Props';
import { Door } from '../world/Door';
import { Character } from '../player/Character';
import { FollowCamera } from '../player/FollowCamera';
import { FLAVORS, makeMoveState, stepMotion, type MoveState } from '../player/Motion';
import { createToyMaterial } from '../shape/ToyMaterial';
import { createInstancedToyMaterial } from '../shape/InstancedToyMaterial';
import { blob } from '../content/characters/blob';
import { candy } from '../content/scenes/candy';
import type { SceneDef } from '../content/types';

const NOISE_SIZE = 128;

/** Touching a prop splashes this much ground around it. */
const PROP_SPLASH_M = 5.0;

/**
 * Coverage weighting. Props are worth a lot because bumping things is the fun
 * part, and the fun part should also be the fast route to a finished room.
 */
const GROUND_WEIGHT = 0.6;
const PROP_WEIGHT = 0.4;

export class PlayScene {
  readonly scene = new Scene();
  readonly follow: FollowCamera;

  readonly def: SceneDef;
  readonly terrain: Terrain;
  readonly transform: AreaTransform;
  readonly mask: PaintMask;
  readonly props: Props;

  private groundMat: ShaderMaterial;
  private toyMat: ShaderMaterial;
  private instMat: ShaderMaterial;
  private paintTex;
  private fieldTex;
  private noiseTex;

  private stage: StageBuild;
  private door: Door;
  private worldGroup = new Group();

  private player: Character;
  private move: MoveState;
  private prevCellX = 0;
  private prevCellZ = 0;

  private time = 0;
  private frameIndex = 0;
  private settings: TierSettings;
  private layout: LayoutResult;

  constructor(seed: number, settings: TierSettings, aspect: number, def: SceneDef = candy) {
    this.def = def;
    this.settings = settings;

    const size = def.stage.width;
    const t = def.stage.terrain;

    this.terrain = new Terrain(
      {
        worldSize: size,
        grid: settings.terrainGrid,
        octaves: def.stage.floor === 'flat' ? [] : (t?.octaves ?? []),
        warpFreq: t?.warp.freq ?? 0.01,
        warpAmp: t?.warp.amp ?? 0,
        maxSlopeDeg: t?.maxSlopeDeg ?? 26,
        // A room's floor must not fall away at the rim; the walls bound it.
        edgeFalloff: def.stage.floor === 'flat' ? null : { start: 0.8, power: 2 },
      },
      seed,
    );

    this.transform = AreaTransform.centered(size, settings.maskCells);
    this.mask = new PaintMask(settings.maskCells);
    this.mask.setAllPaintable();

    // --- textures ---
    this.paintTex = createPaintTexture(this.mask);
    const field = new Uint8Array(settings.maskCells * settings.maskCells * 2);
    for (let i = 0; i < settings.maskCells * settings.maskCells; i++) field[i * 2] = 255;
    this.fieldTex = createFieldTexture(field, settings.maskCells);
    this.noiseTex = createNoiseTexture(
      makeNoiseTextureData(NOISE_SIZE, stream(seed, 'noisetex')),
      NOISE_SIZE,
    );

    // --- sky + fog ---
    this.scene.background = new Color().setHex(def.sky.horizon, SRGBColorSpace);
    const fogFar = Math.min(def.sky.fogFar, settings.fogFar);
    this.scene.fog = new Fog(
      new Color().setHex(def.sky.fogColor, SRGBColorSpace).getHex(),
      def.sky.fogNear,
      fogFar,
    );

    const lightDir = new Vector3(...def.light.dir).normalize();
    const fogArgs = {
      fogColor: def.sky.fogColor,
      fogNear: def.sky.fogNear,
      fogFar,
    };

    this.scene.add(this.worldGroup);

    // --- floor ---
    this.groundMat = createGroundMaterial({
      palette: {
        groundA: def.palette.floorA,
        groundB: def.palette.floorB,
        accent: def.palette.accent,
        grayTint: def.palette.grayTint,
      },
      transform: this.transform,
      paintTex: this.paintTex,
      fieldTex: this.fieldTex,
      noiseTex: this.noiseTex,
      heightMin: this.terrain.minHeight,
      heightRange: Math.max(0.001, this.terrain.maxHeight - this.terrain.minHeight),
      lightDir,
      ...fogArgs,
    });
    const ground = new Mesh(this.terrain.buildGeometry(), this.groundMat);
    ground.frustumCulled = false;
    this.worldGroup.add(ground);

    // --- shared materials ---
    this.toyMat = createToyMaterial({
      lightDir,
      grayTint: def.palette.grayTint,
      painted: true,
      ...fogArgs,
    });
    this.instMat = createInstancedToyMaterial({
      lightDir,
      grayTint: def.palette.grayTint,
      ...fogArgs,
    });

    // --- the diorama shell ---
    // Walls use the pre-painted ToyMaterial for now; S2 gives them a shader
    // that samples the floor mask so colour climbs them as he paints.
    this.stage = buildStage(def, this.toyMat);
    this.worldGroup.add(this.stage.group);

    // --- layout, props, door ---
    this.layout = layoutScene(def, seed);
    this.props = new Props(
      def,
      this.layout.placed,
      this.terrain,
      this.instMat,
      this.worldGroup,
      settings.shapeDetail,
    );
    this.door = new Door(
      def,
      this.toyMat,
      this.layout.door,
      this.terrain.heightAt(this.layout.door.x, this.layout.door.z),
      settings.shapeDetail,
    );
    this.worldGroup.add(this.door.group);

    // --- player ---
    this.player = new Character(blob, this.toyMat, settings.shapeDetail);
    this.worldGroup.add(this.player.group);

    this.move = makeMoveState(blob.radius);
    this.move.pos.set(this.layout.spawn.x, 0, this.layout.spawn.z);
    this.move.pos.y = this.terrain.heightAt(this.move.pos.x, this.move.pos.z) + blob.radius;
    this.prevCellX = this.transform.cellX(this.move.pos.x);
    this.prevCellZ = this.transform.cellZ(this.move.pos.z);

    this.follow = new FollowCamera(aspect);
    this.follow.reset(this.move.pos);
  }

  /** 0..1. Ground and props combined; this is what opens the door. */
  get progress(): number {
    return GROUND_WEIGHT * this.mask.coverage + PROP_WEIGHT * this.props.coverage;
  }

  get coverage(): number {
    return this.mask.coverage;
  }

  fixedUpdate(input: Vector2, dt: number): void {
    stepMotion(this.move, blob.movement, input, this.terrain, this.def.stage.width, dt);

    const flavor = FLAVORS[blob.movement.flavor];
    const cx = this.transform.cellX(this.move.pos.x);
    const cz = this.transform.cellZ(this.move.pos.z);
    const r = this.transform.radiusCells(blob.trail.radiusM * flavor.brushScale);

    if (flavor.stampPolicy === 'continuous') {
      this.mask.stampSegment(this.prevCellX, this.prevCellZ, cx, cz, r);
    } else if (this.move.justLanded) {
      this.mask.stamp(cx, cz, r);
    }
    this.prevCellX = cx;
    this.prevCellZ = cz;

    // Bumping things is the fun part, so it is also the fast way to fill a
    // room: every prop touched splashes a wide burst of floor paint.
    this.props.setTime(this.time);
    this.props.collectTouched(this.move.pos.x, this.move.pos.z, blob.radius, TOUCH_SCRATCH);
    for (let i = 0; i < TOUCH_SCRATCH.length; i++) {
      const p = TOUCH_SCRATCH[i]!;
      this.mask.stamp(
        this.transform.cellX(p.x),
        this.transform.cellZ(p.z),
        this.transform.radiusCells(PROP_SPLASH_M),
      );
    }

    this.player.update(this.move, dt);
  }

  render(renderer: WebGLRenderer, dt: number): void {
    this.time += dt;
    this.frameIndex++;

    this.mask.decayPulse();

    if (this.mask.dirty && this.frameIndex % this.settings.maskUploadInterval === 0) {
      this.paintTex.needsUpdate = true;
      this.mask.dirty = false;
    }

    this.groundMat.uniforms.uTime!.value = this.time;
    this.instMat.uniforms.uTime!.value = this.time;

    this.follow.update(dt, this.move.pos, this.move.vel, this.move.speedNorm, blob.face.lookAhead);
    renderer.render(this.scene, this.follow.camera);
  }

  applySettings(s: TierSettings): void {
    this.settings.maskUploadInterval = s.maskUploadInterval;
    this.settings.particles = s.particles;
  }

  resize(w: number, h: number): void {
    this.follow.setAspect(w, h);
  }

  /**
   * Scene switching is a new leak surface. Ten transitions crashes a 4 GB
   * phone if anything here is missed — watch renderer.info.memory.
   */
  dispose(): void {
    this.props.dispose();
    this.stage.dispose();
    this.door.dispose();
    this.player.dispose();
    this.worldGroup.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.groundMat.dispose();
    this.toyMat.dispose();
    this.instMat.dispose();
    this.paintTex.dispose();
    this.fieldTex.dispose();
    this.noiseTex.dispose();
  }
}
